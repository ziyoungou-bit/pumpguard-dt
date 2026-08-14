"""The diagnosis: physics rules and the classifier, kept apart on purpose.

Two independent opinions are formed about every frame.

*The physics rules* are explicit comparisons between a measurement and a
reference an engineer can check: the 1x amplitude against the commissioned
healthy level at this speed, the flow and head against the pump curve solved at
this speed, the NPSH margin against zero. Each one carries the number it looked
at, its unit and the threshold it was compared against, so the reasoning can be
disputed on its merits.

*The classifier* is a vote from a random forest fitted on simulated data.

They are reported in separate fields, and when they disagree
`physics_model_conflict` is set and both opinions stay visible. Averaging them
into one number, or quietly preferring whichever is more convenient, would throw
away the most useful thing the pair produces: the knowledge that the situation is
not what one of them thinks it is.

When they do disagree and a condition must still be named, a positive physics
finding wins. A negative NPSH margin is a measurement; a forest vote is an
inference from a model of a simulation.

**Instrumentation is checked first.** If a channel's quality is BAD there is no
measurement, and diagnosing a machine fault from a broken transmitter is exactly
the failure this project exists to demonstrate. A BAD channel yields
`sensor_fault`, not a mechanical condition.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..config.alarm_thresholds import ALARM_LIMITS
from ..config.pump_parameters import PUMP
from ..contracts import Diagnosis, DiagnosisEvidence, FaultType, SensorQuality, Telemetry
from ..physics import pump_model
from .explain import CONTRIBUTION_BASIS, feature_importance, prediction_contributions
from .inference import InferenceService, get_service

# --------------------------------------------------------------------------
# Commissioned references
#
# The vibration references are the levels this asset shows in good order at its
# rated speed, taken from the verified healthy duty point that
# `config/alarm_thresholds` documents. They are commissioning baselines, which
# is how a real condition-monitoring system holds them: a machine is judged
# against itself when it was known to be healthy, not against a universal
# constant.
#
# Amplitudes of a forced response scale with the square of speed, so each
# reference is scaled by (rpm / rated)^2 before it is used.
# --------------------------------------------------------------------------

HEALTHY_1X_MM_S: float = 0.55
HEALTHY_2X_MM_S: float = 0.22
HEALTHY_HIGH_FREQUENCY_MM_S: float = 0.25

#: How many times the commissioned level counts as "elevated". Well clear of
#: the few per cent of scatter a healthy machine shows tick to tick.
ELEVATED_RATIO: float = 2.5
#: Below this the order is treated as unchanged, which is what separates
#: imbalance (1x alone) from misalignment (2x leading).
UNCHANGED_RATIO: float = 2.0

#: Hydraulic gates, as fractions of the duty point the pump curve predicts at
#: the measured speed with the valve open. A throttled valve moves flow by about
#: 15 % over its whole 0.3-1.0 range on this circuit, so 0.80 separates a
#: genuine restriction from legitimate throttling -- see the limitation note at
#: the bottom of this module.
RESTRICTION_FLOW_RATIO: float = 0.80
RESTRICTION_HEAD_RATIO: float = 1.10
#: Losing prime collapses head as well as flow, which is what tells a dry run
#: apart from a blockage: a blockage pushes the operating point up the curve.
DRY_RUN_FLOW_RATIO: float = 0.55
DRY_RUN_HEAD_RATIO: float = 0.55
DRY_RUN_CURRENT_RATIO: float = 0.95

#: NPSH margin at which the suction side is treated as significantly eroded.
#: The commissioned duty margin is 6.95 m and the low-margin warning is 1.5 m;
#: 4.0 m sits between them, so the rule fires while there is still margin left
#: rather than only once the pump is already cavitating.
NPSH_ERODED_M: float = 4.0

#: ISO 20816-1 Class I band edges, used for the vibration term of the health
#: index. Published values, unchanged.
ISO_GOOD_MM_S: float = 1.8
ISO_TRIP_MM_S: float = 11.2

#: Confidence below which the classifier is not treated as making a claim, so a
#: near-tie is not reported as a disagreement with the physics.
MODEL_CLAIM_CONFIDENCE: float = 0.50

_LIMITS = {limit.key: limit for limit in ALARM_LIMITS}


# --------------------------------------------------------------------------
# Physics rules
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class _Duty:
    """The duty point the pump curve predicts for the measured speed, valve open.

    The yardstick every hydraulic rule measures against. It is solved from
    `physics.pump_model`, so the reference moves correctly with speed instead of
    being a table of numbers valid only at 1450 rpm.
    """

    flow_lpm: float
    head_m: float
    current_a: float
    valid: bool


def _duty_reference(rpm: float) -> _Duty:
    point = pump_model.solve_operating_point(speed_rpm=rpm, valve_opening=1.0)
    return _Duty(
        flow_lpm=point.flow_lpm,
        head_m=point.head_m,
        current_a=point.motor_current_a,
        valid=point.flow_lpm > 0.1 and point.head_m > 0.1 and point.motor_current_a > 0.01,
    )


def _speed_scale(rpm: float) -> float:
    """(rpm / rated)^2, the factor a forced vibration response scales by."""
    if rpm <= 0.0:
        return 0.0
    return (rpm / PUMP.rated_speed_rpm) ** 2


def _evidence(statement: str, value: float, unit: str, reference: str) -> DiagnosisEvidence:
    return DiagnosisEvidence(
        source="physics",
        statement=statement,
        measured_value=round(float(value), 4),
        unit=unit,
        reference=reference,
    )


def bad_sensors(telemetry: Telemetry) -> tuple[list[str], list[str]]:
    """Tags reporting BAD and tags reporting UNCERTAIN."""
    bad = [tag for tag, quality in telemetry.sensor_quality.items() if quality == SensorQuality.BAD.value]
    uncertain = [
        tag for tag, quality in telemetry.sensor_quality.items() if quality == SensorQuality.UNCERTAIN.value
    ]
    return bad, uncertain


def physics_diagnosis(telemetry: Telemetry) -> tuple[str, list[DiagnosisEvidence]]:
    """Apply the rules in order of precedence and return the condition plus its evidence.

    Instrumentation first, then the two suction-side conditions, then the two
    hydraulic ones, then the two mechanical ones. The order matters only where
    conditions could both fire; every gate below is written so they cannot.
    """
    evidence: list[DiagnosisEvidence] = []
    bad, uncertain = bad_sensors(telemetry)

    if bad:
        evidence.append(
            _evidence(
                f"Signal lost on {', '.join(sorted(bad))}; the process value is not being measured, "
                "so no machine condition can be diagnosed from it",
                len(bad),
                "channels",
                "SensorQuality.BAD on any channel",
            )
        )
        return FaultType.SENSOR_FAULT.value, evidence

    scale = _speed_scale(telemetry.rpm)
    duty = _duty_reference(telemetry.rpm)

    cavitation = _cavitation_rule(telemetry, scale)
    if cavitation:
        return FaultType.CAVITATION.value, cavitation

    if duty.valid:
        dry_run = _dry_run_rule(telemetry, duty)
        if dry_run:
            return FaultType.DRY_RUN.value, dry_run

        restriction = _restriction_rule(telemetry, duty)
        if restriction:
            return FaultType.FLOW_RESTRICTION.value, restriction

    if scale > 0.0:
        misalignment = _misalignment_rule(telemetry, scale)
        if misalignment:
            return FaultType.MISALIGNMENT.value, misalignment

        imbalance = _imbalance_rule(telemetry, scale)
        if imbalance:
            return FaultType.IMBALANCE.value, imbalance

    if uncertain:
        evidence.append(
            _evidence(
                f"Degraded signal quality on {', '.join(sorted(uncertain))} with no machine fault "
                "indicated; the instrument is suspect, the machine is not",
                len(uncertain),
                "channels",
                "SensorQuality.UNCERTAIN on any channel",
            )
        )
        return FaultType.SENSOR_FAULT.value, evidence

    evidence.append(
        _evidence(
            "Vibration orders, hydraulic duty point and NPSH margin are all within their "
            "commissioned references",
            telemetry.vibration_rms_mm_s,
            "mm/s",
            f"ISO 20816-1 Class I good below {ISO_GOOD_MM_S} mm/s",
        )
    )
    return FaultType.NORMAL.value, evidence


def _cavitation_rule(telemetry: Telemetry, scale: float) -> list[DiagnosisEvidence]:
    """Negative or eroded NPSH margin, corroborated by high-frequency energy."""
    margin = telemetry.npsh_margin_m
    hf_reference = HEALTHY_HIGH_FREQUENCY_MM_S * scale
    hf_ratio = telemetry.high_frequency_energy / hf_reference if hf_reference > 1e-9 else 0.0
    warning = _LIMITS["npsh_margin_low"].warning

    if margin >= NPSH_ERODED_M:
        return []

    evidence = [
        _evidence(
            "NPSH margin has fallen below the commissioned duty margin of 6.95 m; the suction "
            "side is restricted",
            margin,
            "m",
            f"eroded below {NPSH_ERODED_M} m, low-margin warning at {warning} m",
        )
    ]
    if margin < 0.0:
        evidence.append(
            _evidence(
                "NPSH available is below NPSH required, so vapour bubbles form and collapse in "
                "the impeller: the pump is cavitating by definition",
                margin,
                "m",
                "NPSHa - NPSHr < 0",
            )
        )
        evidence.append(
            _evidence(
                "Suction pressure is at or near the fluid vapour pressure",
                telemetry.suction_pressure_kpa,
                "kPa a",
                f"low-suction alarm at {_LIMITS['suction_pressure_low'].alarm} kPa a",
            )
        )
    if hf_ratio > UNCHANGED_RATIO:
        evidence.append(
            _evidence(
                "High-frequency band energy is elevated, the broadband signature of bubble "
                "implosion, while 1x is unchanged",
                telemetry.high_frequency_energy,
                "mm/s",
                f"{hf_ratio:.1f}x the commissioned {hf_reference:.2f} mm/s at this speed",
            )
        )
        evidence.append(
            _evidence(
                "Crest factor is raised by impulsive content",
                telemetry.crest_factor,
                "",
                "1.41 for a pure sinusoid",
            )
        )
    return evidence


def _dry_run_rule(telemetry: Telemetry, duty: _Duty) -> list[DiagnosisEvidence]:
    """Flow and head both collapsed while the motor unloads and heat builds."""
    flow_ratio = telemetry.flow_lpm / duty.flow_lpm
    head_ratio = telemetry.pump_head_m / duty.head_m
    current_ratio = telemetry.motor_current_a / duty.current_a

    if not (
        flow_ratio < DRY_RUN_FLOW_RATIO
        and head_ratio < DRY_RUN_HEAD_RATIO
        and current_ratio < DRY_RUN_CURRENT_RATIO
    ):
        return []

    return [
        _evidence(
            "Flow has collapsed and head has collapsed with it; the impeller is passing gas, "
            "not liquid",
            telemetry.flow_lpm,
            "L/min",
            f"{flow_ratio:.0%} of the {duty.flow_lpm:.1f} L/min the pump curve gives at this speed",
        ),
        _evidence(
            "Developed head has fallen instead of rising, which rules out a discharge blockage",
            telemetry.pump_head_m,
            "m",
            f"{head_ratio:.0%} of the {duty.head_m:.2f} m duty head at this speed",
        ),
        _evidence(
            "Motor current has fallen: the hydraulic load has gone, so the motor is unloaded",
            telemetry.motor_current_a,
            "A",
            f"low-current alarm at {_LIMITS['motor_current_low'].alarm} A, duty {duty.current_a:.3f} A",
        ),
        _evidence(
            "Motor temperature is rising while the load falls; the liquid was the coolant as "
            "well as the load",
            telemetry.motor_temperature_c,
            "C",
            f"high-temperature warning at {_LIMITS['motor_temperature_high'].warning} C",
        ),
    ]


def _restriction_rule(telemetry: Telemetry, duty: _Duty) -> list[DiagnosisEvidence]:
    """Flow down, head up, current down: the operating point has slid up the curve."""
    flow_ratio = telemetry.flow_lpm / duty.flow_lpm
    head_ratio = telemetry.pump_head_m / duty.head_m
    current_ratio = telemetry.motor_current_a / duty.current_a

    if not (
        flow_ratio < RESTRICTION_FLOW_RATIO
        and head_ratio > RESTRICTION_HEAD_RATIO
        and current_ratio < 1.02
    ):
        return []

    return [
        _evidence(
            "Flow is below the duty point the pump curve predicts at this speed",
            telemetry.flow_lpm,
            "L/min",
            f"{flow_ratio:.0%} of {duty.flow_lpm:.1f} L/min, restriction gate {RESTRICTION_FLOW_RATIO:.0%}",
        ),
        _evidence(
            "Developed head has risen as flow fell: the operating point has moved up the pump "
            "curve, which is what added system resistance does",
            telemetry.pump_head_m,
            "m",
            f"{head_ratio:.0%} of the {duty.head_m:.2f} m duty head at this speed",
        ),
        _evidence(
            "Motor current has not risen; a throttled centrifugal pump unloads rather than "
            "overloads, which is how this differs from a mechanical seizure",
            telemetry.motor_current_a,
            "A",
            f"duty {duty.current_a:.3f} A at this speed",
        ),
        _evidence(
            "Pump efficiency has fallen as the operating point moved away from best efficiency",
            telemetry.pump_efficiency,
            "",
            f"best efficiency {PUMP.bep_efficiency:.2f} at {PUMP.bep_flow_lpm:.0f} L/min",
        ),
    ]


def _imbalance_rule(telemetry: Telemetry, scale: float) -> list[DiagnosisEvidence]:
    """1x alone elevated. A rotating unbalance is a once-per-revolution radial force."""
    reference_1x = HEALTHY_1X_MM_S * scale
    reference_2x = HEALTHY_2X_MM_S * scale
    if reference_1x <= 1e-9:
        return []
    ratio_1x = telemetry.amplitude_1x_mm_s / reference_1x
    ratio_2x = telemetry.amplitude_2x_mm_s / reference_2x if reference_2x > 1e-9 else 0.0

    if not (ratio_1x > ELEVATED_RATIO and ratio_2x < UNCHANGED_RATIO):
        return []

    return [
        _evidence(
            "Vibration at the rotational frequency is elevated",
            telemetry.amplitude_1x_mm_s,
            "mm/s",
            f"{ratio_1x:.1f}x the commissioned {reference_1x:.2f} mm/s at this speed, "
            f"gate {ELEVATED_RATIO}x",
        ),
        _evidence(
            "Vibration at twice the rotational frequency is unchanged, which separates an "
            "unbalance from a misaligned coupling",
            telemetry.amplitude_2x_mm_s,
            "mm/s",
            f"{ratio_2x:.1f}x the commissioned {reference_2x:.2f} mm/s at this speed",
        ),
        _evidence(
            "Overall vibration against ISO 20816-1 Class I",
            telemetry.vibration_rms_mm_s,
            "mm/s",
            f"good below {ISO_GOOD_MM_S}, unsatisfactory above {_LIMITS['vibration_high'].alarm}",
        ),
    ]


def _misalignment_rule(telemetry: Telemetry, scale: float) -> list[DiagnosisEvidence]:
    """2x elevated and leading 1x. An angular coupling error pushes twice a turn."""
    reference_1x = HEALTHY_1X_MM_S * scale
    reference_2x = HEALTHY_2X_MM_S * scale
    if reference_2x <= 1e-9:
        return []
    ratio_2x = telemetry.amplitude_2x_mm_s / reference_2x
    ratio_1x = telemetry.amplitude_1x_mm_s / reference_1x if reference_1x > 1e-9 else 0.0

    if not (ratio_2x > ELEVATED_RATIO and telemetry.amplitude_2x_mm_s > 0.8 * telemetry.amplitude_1x_mm_s):
        return []

    return [
        _evidence(
            "Vibration at twice the rotational frequency is elevated and now comparable with or "
            "above 1x, the classic misalignment order",
            telemetry.amplitude_2x_mm_s,
            "mm/s",
            f"{ratio_2x:.1f}x the commissioned {reference_2x:.2f} mm/s at this speed, "
            f"gate {ELEVATED_RATIO}x",
        ),
        _evidence(
            "1x has risen far less than 2x, which separates a misaligned coupling from an "
            "unbalanced rotor",
            telemetry.amplitude_1x_mm_s,
            "mm/s",
            f"{ratio_1x:.1f}x the commissioned {reference_1x:.2f} mm/s at this speed",
        ),
        _evidence(
            "Overall vibration against ISO 20816-1 Class I",
            telemetry.vibration_rms_mm_s,
            "mm/s",
            f"good below {ISO_GOOD_MM_S}, unsatisfactory above {_LIMITS['vibration_high'].alarm}",
        ),
    ]


# --------------------------------------------------------------------------
# Health index
# --------------------------------------------------------------------------

#: Weights of the five terms. They sum to 100, so a machine failing every term
#: scores zero and the contribution of each term is readable straight off.
HEALTH_WEIGHTS: dict[str, float] = {
    "vibration": 30.0,
    "temperature": 15.0,
    "hydraulic": 25.0,
    "anomaly": 20.0,
    "sensor": 10.0,
}

HEALTH_INDEX_LABEL = "Prototype Engineering Health Index"
HEALTH_INDEX_BASIS = (
    "Prototype Engineering Health Index: a weighted deduction from 100 across vibration "
    "(ISO 20816-1 Class I band edges), temperature (against this asset's alarm limits), "
    "hydraulic performance (duty point from the pump curve), the unsupervised anomaly score "
    "and instrument validity. It is this project's own composite, useful for trending on this "
    "asset. It is NOT an ISO-conformant assessment and no ISO conformance is claimed."
)


def health_index(telemetry: Telemetry, anomaly_score: float = 0.0) -> float:
    """0..100, 100 = healthy. See `HEALTH_INDEX_BASIS` for exactly what it means."""
    penalties = health_terms(telemetry, anomaly_score)
    return round(max(0.0, min(100.0, 100.0 - sum(penalties.values()))), 2)


def health_terms(telemetry: Telemetry, anomaly_score: float = 0.0) -> dict[str, float]:
    """The five deductions, so the index can be shown broken down rather than as one number."""
    vibration = _fraction(telemetry.vibration_rms_mm_s, ISO_GOOD_MM_S, ISO_TRIP_MM_S)

    motor = _fraction(
        telemetry.motor_temperature_c,
        _LIMITS["motor_temperature_high"].warning,
        _LIMITS["motor_temperature_high"].trip,
    )
    bearing = _fraction(
        telemetry.bearing_temperature_c,
        _LIMITS["bearing_temperature_high"].warning,
        _LIMITS["bearing_temperature_high"].trip,
    )
    temperature = max(motor, bearing)

    duty = _duty_reference(telemetry.rpm)
    if duty.valid:
        # Two independent hydraulic complaints: how far the duty point has moved
        # and how much NPSH margin is left. The worse one decides.
        flow_loss = _fraction(1.0 - telemetry.flow_lpm / duty.flow_lpm, 0.15, 1.0)
        npsh_loss = _fraction(-telemetry.npsh_margin_m, -NPSH_ERODED_M, 0.0)
        hydraulic = max(flow_loss, npsh_loss)
    else:
        hydraulic = 0.0

    bad, uncertain = bad_sensors(telemetry)
    sensor = 1.0 if bad else (0.5 if uncertain else 0.0)

    return {
        "vibration": HEALTH_WEIGHTS["vibration"] * vibration,
        "temperature": HEALTH_WEIGHTS["temperature"] * temperature,
        "hydraulic": HEALTH_WEIGHTS["hydraulic"] * hydraulic,
        "anomaly": HEALTH_WEIGHTS["anomaly"] * min(max(float(anomaly_score), 0.0), 1.0),
        "sensor": HEALTH_WEIGHTS["sensor"] * sensor,
    }


def _fraction(value: float, good: float, bad: float) -> float:
    """0 at or below `good`, 1 at or above `bad`, linear between."""
    if bad <= good:
        return 0.0
    return min(max((value - good) / (bad - good), 0.0), 1.0)


def severity_label(index: float) -> str:
    """The contract's four-step severity, derived from the health index."""
    if index >= 85.0:
        return "none"
    if index >= 70.0:
        return "minor"
    if index >= 45.0:
        return "moderate"
    return "severe"


# --------------------------------------------------------------------------
# Recommended actions
# --------------------------------------------------------------------------

RECOMMENDED_ACTIONS: dict[str, list[str]] = {
    FaultType.NORMAL.value: [
        "No action. Continue routine monitoring.",
        "Record the current vibration and duty point as the running baseline.",
    ],
    FaultType.IMBALANCE.value: [
        "Trend the 1x amplitude; an unbalance grows slowly and rarely needs an immediate stop.",
        "Inspect the impeller for deposits, erosion or a lost balance weight at the next shutdown.",
        "Check the coupling and shaft for a bent or loose element before balancing.",
        "Balance the rotor in place if the 1x amplitude passes the ISO 20816-1 Class I 4.5 mm/s band edge.",
    ],
    FaultType.MISALIGNMENT.value: [
        "Trend 2x and the axial channel; misalignment loads the bearings and the seal continuously.",
        "Check the coupling condition, the shim pack and the hold-down bolts for a soft foot.",
        "Laser-align the pump to the motor cold, then re-check hot to confirm thermal growth.",
        "Inspect the mechanical seal for leakage: it takes the misalignment load first.",
    ],
    FaultType.CAVITATION.value: [
        "Reduce the risk now: throttle the discharge back, or lower the speed, to cut the flow "
        "and with it NPSHr.",
        "Check the suction strainer and suction isolation valve for a restriction.",
        "Confirm the reservoir level and the suction lift against the NPSH available calculation.",
        "Do not leave the pump running with a negative margin: bubble collapse erodes the "
        "impeller and destroys the seal.",
    ],
    FaultType.FLOW_RESTRICTION.value: [
        "Confirm the control-valve position before treating this as a fault: a throttled valve "
        "produces the same hydraulics as a blockage.",
        "Check the discharge strainer and any inline filter for fouling.",
        "Compare the measured duty point against the pump curve to size the added resistance.",
        "Watch the running time at low flow: a centrifugal pump run near shutoff recirculates "
        "and heats the liquid.",
    ],
    FaultType.DRY_RUN.value: [
        "Stop the pump. Running dry destroys the mechanical seal within minutes.",
        "Check the reservoir level, the suction valve and the foot valve for loss of prime.",
        "Re-prime the pump and confirm flow before restarting.",
        "Let the machine cool before restarting: it has lost the liquid that cools it.",
    ],
    FaultType.SENSOR_FAULT.value: [
        "Treat this as an instrument fault, not a machine fault; do not act on the affected "
        "reading.",
        "Check the transmitter loop, wiring and terminals on the flagged tag.",
        "Cross-check the affected value against an independent measurement before trusting it.",
        "Recalibrate or replace the transmitter, then confirm the reading tracks the process again.",
    ],
}


# --------------------------------------------------------------------------
# The diagnosis
# --------------------------------------------------------------------------


def diagnose(telemetry: Telemetry, service: InferenceService | None = None) -> Diagnosis:
    """Build the full `contracts.Diagnosis` for one telemetry frame.

    Works with or without a loaded model. In physics-only mode `model_evidence`
    says so explicitly rather than being silently empty.
    """
    service = service or get_service()

    physics_condition, physics_evidence = physics_diagnosis(telemetry)
    model_condition, confidence, distribution = service.predict(telemetry)
    anomaly = service.anomaly_score(telemetry)

    model_evidence = _model_evidence(telemetry, service, model_condition, confidence, distribution, anomaly)

    model_claims = model_condition is not None and confidence >= MODEL_CLAIM_CONFIDENCE
    conflict = model_claims and model_condition != physics_condition

    if physics_condition != FaultType.NORMAL.value or not model_claims:
        detected = physics_condition
    else:
        detected = model_condition

    index = health_index(telemetry, anomaly)
    contributions = prediction_contributions(telemetry, service, target_class=detected) if model_claims else {}

    return Diagnosis(
        detected_condition=detected,
        confidence=round(float(confidence), 4),
        health_index=index,
        severity_label=severity_label(index),
        physics_evidence=physics_evidence,
        model_evidence=model_evidence,
        feature_importance=contributions or feature_importance(service, top_n=6),
        recommended_actions=list(RECOMMENDED_ACTIONS.get(detected, [])),
        anomaly_score=round(float(anomaly), 4),
        is_sensor_fault=detected == FaultType.SENSOR_FAULT.value,
        physics_model_conflict=conflict,
    )


def _model_evidence(
    telemetry: Telemetry,
    service: InferenceService,
    model_condition: str | None,
    confidence: float,
    distribution: dict[str, float],
    anomaly: float,
) -> list[DiagnosisEvidence]:
    if model_condition is None:
        return [
            DiagnosisEvidence(
                source="model",
                statement=(
                    "No trained classifier is loaded; this diagnosis rests on the physics rules "
                    f"alone ({service.load_error or 'artefacts unavailable'})"
                ),
                measured_value=None,
                unit="",
                reference="app.ml.inference physics-only mode",
            )
        ]

    runner_up = sorted(distribution.items(), key=lambda item: item[1], reverse=True)[1:2]
    evidence = [
        DiagnosisEvidence(
            source="model",
            statement=f"Random forest classifies this frame as {model_condition}",
            measured_value=round(float(confidence), 4),
            unit="probability",
            reference=f"claim threshold {MODEL_CLAIM_CONFIDENCE}, trained on simulated data only",
        )
    ]
    if runner_up:
        name, probability = runner_up[0]
        evidence.append(
            DiagnosisEvidence(
                source="model",
                statement=f"Next most likely condition is {name}",
                measured_value=round(float(probability), 4),
                unit="probability",
                reference="second-ranked class probability",
            )
        )
    evidence.append(
        DiagnosisEvidence(
            source="model",
            statement=(
                "Unsupervised anomaly score from an isolation forest fitted on healthy frames "
                "only, so it can flag a condition the classifier was never trained on"
            ),
            measured_value=round(float(anomaly), 4),
            unit="0..1",
            reference="0 = as healthy as the training normals, 1 = far outside them",
        )
    )
    for contribution_name, value in prediction_contributions(
        telemetry, service, target_class=model_condition, top_n=3
    ).items():
        evidence.append(
            DiagnosisEvidence(
                source="model",
                statement=(
                    f"{contribution_name} {'supported' if value >= 0 else 'argued against'} this "
                    "classification"
                ),
                measured_value=round(float(value), 4),
                unit="probability",
                reference=CONTRIBUTION_BASIS,
            )
        )
    return evidence


# --------------------------------------------------------------------------
# Known limitations of these rules, stated here rather than discovered later
# --------------------------------------------------------------------------
#
# * The telemetry contract carries no control-valve position, so the restriction
#   rule cannot distinguish a partly closed valve from a fouled line. The gate is
#   set so that throttling across the valve's whole range does not fire it, which
#   means a genuine restriction milder than that range is also missed.
# * The vibration references are the levels the current simulator produces. They
#   are commissioning baselines for this asset, not universal constants, and they
#   must be re-measured if the vibration source changes.
# * A mild cavitation with an NPSH margin still above 4 m does not fire the
#   suction rule. When the classifier calls it anyway, the disagreement is
#   reported through `physics_model_conflict` instead of being resolved silently.

__all__ = [
    "HEALTH_INDEX_BASIS",
    "HEALTH_INDEX_LABEL",
    "RECOMMENDED_ACTIONS",
    "bad_sensors",
    "diagnose",
    "health_index",
    "health_terms",
    "physics_diagnosis",
    "severity_label",
]
