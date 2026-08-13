"""The simulation engine: one tick of a motor-pump set, end to end.

`SimulationSession` is the only object the API layer touches. One session is
one visitor watching one machine: all mutable state lives on the instance and
there is no module-level value that a tick can write to, so two visitors
cannot see each other's faults.

The order inside `step` is the order of causation, and it matters:

    1. fault dynamics advance          (a condition develops)
    2. the state machine advances      (speed follows the commanded state)
    3. the hydraulics are solved       (pump_model decides flow and head)
    4. the thermal states advance      (temperature follows the load)
    5. vibration is synthesised        (mechanics follow speed and defects)
    6. the sensors measure             (instruments observe the process)
    7. interlocks and alarms evaluate  (protection observes the instruments)

Steps 6 and 7 are downstream of everything else on purpose. Protection sees
what the instruments report, never the true process value -- which is why a
frozen transmitter can hide a real problem here, exactly as it can on a plant.

Nothing in this module invents a process value. Flow, head, efficiency, power
and current all come from `physics.pump_model`; this module only decides which
parameters to hand it.
"""

from __future__ import annotations

import math
import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import numpy as np

from ..automation.alarms import AlarmManager
from ..automation.interlocks import InterlockChain, ProcessSnapshot
from ..automation.state_machine import Event, PumpStateMachine, TransitionResult
from ..config.alarm_thresholds import ALARM_STARTUP_INHIBIT_S, INTERLOCKS
from ..config.pump_parameters import ASSET, FLUID, MOTOR, PUMP
from ..contracts import Alarm, AssetState, DataSource, FaultType, Telemetry
from ..physics import pump_model
from .faults import DEFAULT_RAMP_S, FaultModel
from .sensors import SensorBus
from .thermal import ThermalModel

# --------------------------------------------------------------------------
# Vibration synthesis
# --------------------------------------------------------------------------
#
# WIRING POINT FOR app.signal_processing (owned by another agent).
#
# What is here now is an *amplitude-domain estimate*: each mechanical defect
# contributes a component at its characteristic order, and the overall RMS is
# the root-sum-square of those components. It is physically sensible -- an
# imbalance really does show at 1x, a misalignment at 2x, cavitation as
# broadband high-frequency energy -- but it is not a spectrum, because no
# waveform is generated.
#
# The signal-processing agent's feature extractor replaces it without touching
# this file: the main agent assigns
#
#     session.vibration_feature_hook = extractor
#
# where `extractor(state: VibrationState) -> dict[str, float]` returns any of
# the Telemetry vibration field names. Returned keys override the estimate;
# missing keys keep it. This module must not import signal_processing, so the
# dependency runs one way only: signal_processing -> contracts, engine -> hook.

#: Baseline component amplitudes at rated speed on a healthy machine, mm/s.
#: Chosen so the healthy overall RMS lands near 0.75 mm/s, comfortably inside
#: ISO 10816-1 Class I "good" (below 1.8 mm/s) and far from the 4.5 mm/s alarm.
_BASE_1X_MM_S = 0.55
_BASE_2X_MM_S = 0.22
_BASE_BLADE_PASS_MM_S = 0.15
_BASE_HIGH_FREQUENCY_MM_S = 0.25
_BASE_BROADBAND_MM_S = 0.35

#: Growth factors at full fault severity, chosen so a fully developed defect
#: lands in the ISO "unsatisfactory" band rather than off the scale.
_IMBALANCE_1X_GAIN = 10.0
_MISALIGNMENT_2X_GAIN = 18.0
_MISALIGNMENT_AXIAL_GAIN = 18.0
_CAVITATION_HF_GAIN = 14.0
#: Centre of the cavitation/bearing band, expressed as an order of rotation.
_HF_BAND_ORDER = 12.0


@dataclass(frozen=True)
class VibrationState:
    """The mechanical state a feature extractor needs, and the estimate made from it."""

    rpm: float
    rotational_frequency_hz: float
    blade_pass_frequency_hz: float
    amplitude_1x_mm_s: float
    amplitude_2x_mm_s: float
    blade_pass_mm_s: float
    high_frequency_energy: float
    broadband_mm_s: float
    axial_mm_s: float
    rms_mm_s: float
    peak_mm_s: float
    crest_factor: float
    dominant_frequency_hz: float


VibrationHook = Callable[[VibrationState], dict[str, float]]


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------


class SimulationSession:
    """One independent digital twin of P-101 / MTR-101."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        seed = zlib.crc32(session_id.encode("utf-8"))

        self._rng = np.random.default_rng(seed)
        self._faults = FaultModel()
        self._sensors = SensorBus(seed)
        self._thermal = ThermalModel()
        self._machine = PumpStateMachine(PUMP.rated_speed_rpm, INTERLOCKS.start_timeout_s)
        self._interlocks = InterlockChain()
        self._alarms = AlarmManager()

        self.valve_opening: float = 1.0
        self._elapsed_s: float = 0.0
        self._wall_clock_start = datetime.now(timezone.utc)
        self._truth: dict[str, float] = {}
        self.last_telemetry: Telemetry | None = None

        #: See the wiring note above. Left None until the main agent connects
        #: the signal-processing feature extractor.
        self.vibration_feature_hook: VibrationHook | None = None

    # -- tick -------------------------------------------------------------

    def step(self, dt: float = 0.1) -> Telemetry:
        """Advance the machine by `dt` seconds and return one telemetry frame."""
        dt = max(float(dt), 1e-3)
        self._elapsed_s += dt

        self._faults.update(dt)
        effects = self._faults.effects()
        self._machine.update(dt)

        rpm = self._machine.rpm
        hydraulics = self._solve_hydraulics(rpm, effects)
        self._thermal.update(
            dt,
            load_fraction=hydraulics["shaft_power_w"] / MOTOR.rated_power_w,
            prime_loss=effects.prime_loss,
            running=self._machine.is_driven,
        )
        vibration = self._synthesise_vibration(rpm, effects, hydraulics)

        measured = self._measure(dt, rpm, hydraulics, vibration)
        self._evaluate_protection(dt, measured)

        telemetry = self._build_telemetry(measured, hydraulics, vibration, effects)
        self.last_telemetry = telemetry
        return telemetry

    # -- physics ----------------------------------------------------------

    def _solve_hydraulics(self, rpm: float, effects) -> dict[str, float]:
        """Everything hydraulic and electrical, from `pump_model` only."""
        wet = pump_model.solve_operating_point(
            speed_rpm=rpm,
            valve_opening=self.valve_opening,
            blockage=effects.discharge_blockage,
        )

        flow_m3s = wet.flow_m3s
        head_m = wet.head_m
        efficiency = wet.efficiency
        shaft_w = wet.shaft_power_w
        electrical_w = wet.electrical_power_w

        prime = effects.prime_loss
        if prime > 0.0:
            # Losing prime is progressive: the impeller passes a mixture, so
            # the state is a blend of the wetted and the dry solution of the
            # same model rather than a switch between two presets. Head is
            # taken to zero with the liquid -- a pump full of air develops no
            # head in metres of water, whatever it does in metres of air.
            dry = pump_model.solve_operating_point(
                speed_rpm=rpm,
                valve_opening=self.valve_opening,
                blockage=effects.discharge_blockage,
                dry_run=True,
            )
            flow_m3s *= 1.0 - prime
            head_m *= 1.0 - prime
            efficiency *= 1.0 - prime
            shaft_w = wet.shaft_power_w * (1.0 - prime) + dry.shaft_power_w * prime
            electrical_w = wet.electrical_power_w * (1.0 - prime) + dry.electrical_power_w * prime

        # Mechanical defects cost efficiency and add drag.
        penalty = effects.efficiency_penalty
        if penalty > 0.0:
            efficiency *= 1.0 - penalty
            shaft_w *= 1.0 + penalty
            electrical_w *= 1.0 + penalty

        # Suction side. The cavitation fault raises the suction-side
        # restriction, so NPSHa falls out of the same equation that produces a
        # healthy margin -- there is no "cavitating" flag anywhere.
        suction_pa = pump_model.suction_pressure_pa(flow_m3s, blockage=effects.suction_restriction)
        npsh_margin = pump_model.cavitation_margin(flow_m3s, effects.suction_restriction)

        # Below zero margin the vapour bubbles collapse in the impeller:
        # partial head breakdown plus the characteristic unsteadiness. Two
        # metres below zero is taken as full breakdown.
        breakdown = min(max(-npsh_margin / 2.0, 0.0), 1.0)
        if breakdown > 0.0 and flow_m3s > 0.0:
            flow_m3s *= (1.0 - 0.30 * breakdown) * (1.0 + float(self._rng.normal(0.0, 0.06 * breakdown)))
            head_m *= (1.0 - 0.25 * breakdown) * (1.0 + float(self._rng.normal(0.0, 0.05 * breakdown)))
            efficiency *= 1.0 - 0.20 * breakdown
            flow_m3s = max(flow_m3s, 0.0)
            head_m = max(head_m, 0.0)

        hydraulic_w = FLUID.density * FLUID.gravity * flow_m3s * head_m
        current_a = pump_model.motor_current(electrical_w)
        discharge_pa = suction_pa + FLUID.density * FLUID.gravity * head_m

        return {
            "flow_m3s": flow_m3s,
            "flow_lpm": pump_model.m3s_to_lpm(flow_m3s),
            "head_m": head_m,
            "efficiency": efficiency,
            "hydraulic_power_w": hydraulic_w,
            "shaft_power_w": shaft_w,
            "electrical_power_w": electrical_w,
            "motor_current_a": current_a,
            "suction_pressure_kpa": suction_pa / 1000.0,
            "discharge_pressure_kpa": discharge_pa / 1000.0,
            "npsh_margin_m": npsh_margin,
            "cavitation_breakdown": breakdown,
        }

    # -- mechanics --------------------------------------------------------

    def _synthesise_vibration(self, rpm: float, effects, hydraulics: dict[str, float]) -> VibrationState:
        speed_ratio = rpm / PUMP.rated_speed_rpm
        rotational_hz = rpm / 60.0
        blade_pass_hz = rotational_hz * PUMP.impeller_vanes
        # Amplitude of a forced response scales with the square of speed.
        scale = speed_ratio**2
        breakdown = hydraulics["cavitation_breakdown"]

        amp_1x = _BASE_1X_MM_S * scale * (1.0 + _IMBALANCE_1X_GAIN * effects.imbalance)
        amp_2x = _BASE_2X_MM_S * scale * (1.0 + _MISALIGNMENT_2X_GAIN * effects.misalignment)
        blade_pass = _BASE_BLADE_PASS_MM_S * scale * (1.0 + 2.0 * effects.discharge_blockage)
        high_frequency = _BASE_HIGH_FREQUENCY_MM_S * scale * (1.0 + _CAVITATION_HF_GAIN * breakdown)
        broadband = _BASE_BROADBAND_MM_S * speed_ratio
        # Misalignment is the classic axial signature; imbalance is not.
        axial = 0.18 * scale * (1.0 + _MISALIGNMENT_AXIAL_GAIN * effects.misalignment)

        rms = math.sqrt(amp_1x**2 + amp_2x**2 + blade_pass**2 + high_frequency**2 + broadband**2 + axial**2)
        # A sinusoid has a crest factor of sqrt(2); impulsive content (bubble
        # collapse, bearing defects) pushes it up, which is why crest factor is
        # a cavitation indicator in its own right.
        crest = 1.414 + 1.2 * breakdown + 0.3 * effects.misalignment
        peak = rms * crest

        candidates = [
            (rotational_hz, amp_1x),
            (2.0 * rotational_hz, amp_2x),
            (blade_pass_hz, blade_pass),
            (_HF_BAND_ORDER * rotational_hz, high_frequency),
        ]
        dominant_hz = max(candidates, key=lambda item: item[1])[0] if rpm > 0 else 0.0

        return VibrationState(
            rpm=rpm,
            rotational_frequency_hz=rotational_hz,
            blade_pass_frequency_hz=blade_pass_hz,
            amplitude_1x_mm_s=amp_1x,
            amplitude_2x_mm_s=amp_2x,
            blade_pass_mm_s=blade_pass,
            high_frequency_energy=high_frequency,
            broadband_mm_s=broadband,
            axial_mm_s=axial,
            rms_mm_s=rms,
            peak_mm_s=peak,
            crest_factor=crest,
            dominant_frequency_hz=dominant_hz,
        )

    # -- instrumentation --------------------------------------------------

    def _measure(
        self, dt: float, rpm: float, hydraulics: dict[str, float], vibration: VibrationState
    ) -> dict[str, float]:
        """Read every instrument. This is the only place true values become readings."""
        self._truth = {
            "rpm": rpm,
            "flow_lpm": hydraulics["flow_lpm"],
            "head_m": hydraulics["head_m"],
            "suction_pressure_kpa": hydraulics["suction_pressure_kpa"],
            "discharge_pressure_kpa": hydraulics["discharge_pressure_kpa"],
            "motor_current_a": hydraulics["motor_current_a"],
            "motor_temperature_c": self._thermal.motor_c,
            "bearing_temperature_c": self._thermal.bearing_c,
            "vibration_rms_mm_s": vibration.rms_mm_s,
            "npsh_margin_m": hydraulics["npsh_margin_m"],
        }

        bus = self._sensors
        measured = {
            "rpm": bus.read(ASSET.speed, rpm, dt),
            "flow_lpm": bus.read(ASSET.flow, hydraulics["flow_lpm"], dt),
            "suction_pressure_kpa": bus.read(ASSET.suction_pressure, hydraulics["suction_pressure_kpa"], dt),
            "discharge_pressure_kpa": bus.read(ASSET.discharge_pressure, hydraulics["discharge_pressure_kpa"], dt),
            "motor_current_a": bus.read(ASSET.current, hydraulics["motor_current_a"], dt),
            "motor_temperature_c": bus.read(ASSET.motor_temperature, self._thermal.motor_c, dt),
            "bearing_temperature_c": bus.read(ASSET.bearing_temperature, self._thermal.bearing_c, dt),
            "vibration_rms_mm_s": bus.read(ASSET.accelerometer, vibration.rms_mm_s, dt),
        }
        measured["differential_pressure_kpa"] = (
            measured["discharge_pressure_kpa"] - measured["suction_pressure_kpa"]
        )
        return measured

    # -- protection -------------------------------------------------------

    def _evaluate_protection(self, dt: float, measured: dict[str, float]) -> None:
        snapshot = self._snapshot(measured)
        self._interlocks.evaluate(dt, snapshot)
        if self._interlocks.tripped and self._machine.state in (AssetState.STARTING, AssetState.RUNNING):
            self._machine.fire(Event.TRIP, self._interlocks.trip_reason())

        alarms_live = (
            self._machine.state is AssetState.RUNNING
            and self._machine.running_time_s >= ALARM_STARTUP_INHIBIT_S
        )
        self._alarms.evaluate(
            self._timestamp(),
            {
                "flow_low": measured["flow_lpm"],
                "suction_pressure_low": measured["suction_pressure_kpa"],
                "discharge_pressure_high": measured["discharge_pressure_kpa"],
                "motor_current_high": measured["motor_current_a"],
                "motor_current_low": measured["motor_current_a"],
                "motor_temperature_high": measured["motor_temperature_c"],
                "bearing_temperature_high": measured["bearing_temperature_c"],
                "vibration_high": measured["vibration_rms_mm_s"],
                "npsh_margin_low": self._truth["npsh_margin_m"],
            },
            enabled=alarms_live,
        )

    def _snapshot(self, measured: dict[str, float]) -> ProcessSnapshot:
        return ProcessSnapshot(
            state=self._machine.state,
            running_time_s=self._machine.running_time_s,
            estop_active=self._machine.estop_active,
            flow_lpm=measured["flow_lpm"],
            suction_pressure_kpa=measured["suction_pressure_kpa"],
            motor_temperature_c=measured["motor_temperature_c"],
            bearing_temperature_c=measured["bearing_temperature_c"],
            vibration_rms_mm_s=measured["vibration_rms_mm_s"],
            bad_sensor_tags=self._sensors.bad_tags(),
        )

    # -- telemetry --------------------------------------------------------

    def _build_telemetry(self, measured, hydraulics, vibration: VibrationState, effects) -> Telemetry:
        fault, severity = self._faults.dominant()
        if fault is FaultType.NORMAL and self._sensors.faulted_tags():
            # An instrumentation fault is a reportable condition of the asset
            # even though the machine itself is healthy.
            fault, severity = FaultType.SENSOR_FAULT, 1.0

        fields = self._vibration_fields(vibration, measured["vibration_rms_mm_s"])
        health, anomaly = self._condition_indices(severity, measured["vibration_rms_mm_s"], hydraulics["npsh_margin_m"])

        return Telemetry(
            timestamp=self._timestamp(),
            elapsed_s=round(self._elapsed_s, 3),
            rpm=measured["rpm"],
            flow_lpm=measured["flow_lpm"],
            pump_head_m=hydraulics["head_m"],
            suction_pressure_kpa=measured["suction_pressure_kpa"],
            discharge_pressure_kpa=measured["discharge_pressure_kpa"],
            differential_pressure_kpa=measured["differential_pressure_kpa"],
            motor_current_a=measured["motor_current_a"],
            motor_temperature_c=measured["motor_temperature_c"],
            bearing_temperature_c=measured["bearing_temperature_c"],
            vibration_x_mm_s=fields["vibration_x_mm_s"],
            vibration_y_mm_s=fields["vibration_y_mm_s"],
            vibration_z_mm_s=fields["vibration_z_mm_s"],
            vibration_rms_mm_s=fields["vibration_rms_mm_s"],
            vibration_peak_mm_s=fields["vibration_peak_mm_s"],
            crest_factor=fields["crest_factor"],
            amplitude_1x_mm_s=fields["amplitude_1x_mm_s"],
            amplitude_2x_mm_s=fields["amplitude_2x_mm_s"],
            high_frequency_energy=fields["high_frequency_energy"],
            dominant_frequency_hz=fields["dominant_frequency_hz"],
            rotational_frequency_hz=measured["rpm"] / 60.0,
            pump_efficiency=hydraulics["efficiency"],
            hydraulic_power_w=hydraulics["hydraulic_power_w"],
            shaft_power_w=hydraulics["shaft_power_w"],
            electrical_power_w=hydraulics["electrical_power_w"],
            health_index=health,
            anomaly_score=anomaly,
            fault_state=fault.value,
            severity=round(severity, 4),
            asset_state=self._machine.state.value,
            npsh_margin_m=hydraulics["npsh_margin_m"],
            data_source=DataSource.SIMULATION.value,
            sensor_quality=self._sensors.quality,
        )

    def _vibration_fields(self, vibration: VibrationState, measured_rms: float) -> dict[str, float]:
        """Vibration part of the frame, scaled by what ACC-101 actually reported.

        The accelerometer's noise and any sensor fault on it are applied to the
        overall RMS, and every other amplitude is scaled by the same ratio, so
        a faulty accelerometer corrupts the whole vibration picture coherently
        instead of only one field.
        """
        ratio = measured_rms / vibration.rms_mm_s if vibration.rms_mm_s > 1e-9 else 0.0
        fields = {
            "vibration_rms_mm_s": measured_rms,
            "vibration_peak_mm_s": vibration.peak_mm_s * ratio,
            "crest_factor": vibration.crest_factor,
            "amplitude_1x_mm_s": vibration.amplitude_1x_mm_s * ratio,
            "amplitude_2x_mm_s": vibration.amplitude_2x_mm_s * ratio,
            "high_frequency_energy": vibration.high_frequency_energy * ratio,
            "dominant_frequency_hz": vibration.dominant_frequency_hz,
            # Radial pair plus axial. A real triaxial split needs the waveform;
            # these are the placeholder proportions the wiring note describes.
            "vibration_x_mm_s": measured_rms * 0.78,
            "vibration_y_mm_s": measured_rms * 0.62,
            "vibration_z_mm_s": vibration.axial_mm_s * ratio,
        }
        if self.vibration_feature_hook is not None:
            fields.update(self.vibration_feature_hook(vibration))
        return fields

    def _condition_indices(self, severity: float, vibration_rms: float, npsh_margin: float) -> tuple[float, float]:
        """Heuristic health and anomaly indices.

        Explicitly a placeholder: the ML agent's anomaly detector replaces the
        anomaly score, and the diagnosis service will own health. It is kept
        physically anchored -- vibration against the ISO trip level, NPSH
        margin against the alarm level -- so it is never obviously wrong on
        screen while the model is being trained.
        """
        vibration_deviation = min(max((vibration_rms - 1.0) / (11.2 - 1.0), 0.0), 1.0)
        npsh_deviation = min(max((1.5 - npsh_margin) / 3.0, 0.0), 1.0)
        physical = max(vibration_deviation, npsh_deviation)
        anomaly = min(max(0.6 * severity + 0.4 * physical, 0.0), 1.0)
        health = 100.0 * (1.0 - min(max(0.7 * severity + 0.3 * physical, 0.0), 1.0))
        return round(health, 2), round(anomaly, 4)

    def _timestamp(self) -> str:
        return (self._wall_clock_start + timedelta(seconds=self._elapsed_s)).isoformat()

    # -- commands ---------------------------------------------------------

    def command(self, name: str, **kwargs) -> dict:
        """Operator command. Never raises for an illegal request; returns why."""
        action = str(name).strip().lower()
        if action == "start":
            snapshot = self._snapshot(self._last_measured())
            result = self._machine.request_start(self._interlocks.start_permissive(snapshot))
        elif action == "stop":
            result = self._machine.fire(Event.STOP, "operator stop")
        elif action == "estop":
            result = self._machine.request_estop(bool(kwargs.get("active", True)))
        elif action == "reset":
            result = self._reset()
        elif action == "ack":
            alarm_id = kwargs.get("alarm_id")
            count = self._alarms.acknowledge(
                self._timestamp(), int(alarm_id) if alarm_id is not None else None
            )
            return self._response(True, f"acknowledged {count} alarm(s)")
        elif action == "mode":
            result = self._set_mode(str(kwargs.get("mode", "")).strip().upper())
        else:
            return self._response(False, f"unknown command {name!r}")

        return self._response(result.accepted, result.reason)

    def _reset(self) -> TransitionResult:
        """The panel reset button.

        It does two things, as the physical button does: it clears the alarm
        annunciation, and it lifts a latched fault if one is present. It can
        never lift an emergency stop -- that requires the E-stop device itself
        to be released, which is the whole point of an E-stop.
        """
        if self._machine.state is AssetState.E_STOP:
            return self._machine.fire(Event.RESET)  # rejected, with the reason
        cleared = len(self._alarms.active)
        if self._machine.state is AssetState.FAULT:
            result = self._machine.fire(Event.RESET, "operator reset")
        else:
            result = TransitionResult(True, f"cleared {cleared} alarm(s)")
        self._alarms.reset()
        self._interlocks.reset()
        return result

    def _set_mode(self, mode: str) -> TransitionResult:
        if mode in ("MAINTENANCE", "MAINT"):
            return self._machine.fire(Event.ENTER_MAINTENANCE, "maintenance requested")
        if mode in ("AUTO", "NORMAL", "OPERATIONAL"):
            return self._machine.fire(Event.EXIT_MAINTENANCE, "returned to service")
        return TransitionResult(False, f"unknown mode {mode!r}; expected MAINTENANCE or AUTO")

    def _response(self, ok: bool, reason: str) -> dict:
        return {
            "ok": ok,
            "state": self._machine.state.value,
            "reason": reason,
            "session_id": self.session_id,
        }

    def _last_measured(self) -> dict[str, float]:
        """Measured values for a permissive check before the first tick."""
        if self.last_telemetry is None:
            return {
                "flow_lpm": 0.0,
                "suction_pressure_kpa": 0.0,
                "motor_temperature_c": self._thermal.motor_c,
                "bearing_temperature_c": self._thermal.bearing_c,
                "vibration_rms_mm_s": 0.0,
            }
        t = self.last_telemetry
        return {
            "flow_lpm": t.flow_lpm,
            "suction_pressure_kpa": t.suction_pressure_kpa,
            "motor_temperature_c": t.motor_temperature_c,
            "bearing_temperature_c": t.bearing_temperature_c,
            "vibration_rms_mm_s": t.vibration_rms_mm_s,
        }

    # -- fault injection --------------------------------------------------

    def inject_fault(
        self,
        fault: str,
        severity: float,
        ramp_s: float = DEFAULT_RAMP_S,
        *,
        tag: str = ASSET.flow,
        mode: str = "freeze",
    ) -> None:
        """Develop a fault over `ramp_s`. Never snaps a value to a preset.

        `tag` and `mode` apply only to `sensor_fault`, which is an
        instrumentation failure and therefore has no process dynamics: it is
        armed on one named transmitter and leaves the physics untouched.
        """
        kind = FaultType(fault) if not isinstance(fault, FaultType) else fault
        if kind is FaultType.NORMAL:
            self.clear_fault(ramp_s)
            return
        if kind is FaultType.SENSOR_FAULT:
            self._sensors.arm(tag, mode, severity)
            return
        self._faults.inject(kind, severity, ramp_s)

    def clear_fault(self, ramp_s: float = DEFAULT_RAMP_S) -> None:
        """Ramp every process fault back to healthy and repair every instrument."""
        self._faults.clear(ramp_s)
        self._sensors.clear()

    def set_valve(self, opening: float) -> None:
        self.valve_opening = min(max(float(opening), 0.0), 1.0)

    def set_speed(self, rpm: float) -> None:
        self._machine.set_speed(rpm)

    # -- queries ----------------------------------------------------------

    @property
    def alarms(self) -> list[Alarm]:
        return self._alarms.active

    @property
    def alarm_history(self) -> list[Alarm]:
        return self._alarms.history

    @property
    def alarm_records(self) -> list[Alarm]:
        """Active and cleared alarms together, in the order they were raised."""
        return self._alarms.all_records

    @property
    def state(self) -> str:
        return self._machine.state.value

    @property
    def rpm(self) -> float:
        return self._machine.rpm

    @property
    def truth(self) -> dict[str, float]:
        """The true process values behind the last frame, before the sensors.

        Diagnostics and tests only. Nothing in the protection path may read
        this: that is the whole point of the sensor layer.
        """
        return dict(self._truth)

    @property
    def interlocks(self) -> list[dict[str, object]]:
        return [result.as_dict() for result in self._interlocks.results]

    @property
    def fault_severities(self) -> dict[str, float]:
        return self._faults.snapshot()
