"""Behavioural tests for the ML layer.

The claims under test are the ones that decide whether this part of the product
is trustworthy, not whether individual functions return the right type:

  * the dataset is reproducible, covers every class, and contains no frame from
    a machine that was not running;
  * a model is never served against a feature order it was not fitted on;
  * the whole pipeline -- simulator to features to forest -- names the fault
    that was actually injected;
  * the unsupervised detector separates healthy from severe;
  * missing artefacts degrade to physics, they do not crash the backend;
  * the physics rules produce checkable evidence, and a broken instrument is
    reported as a broken instrument rather than as a broken machine.

Tests that need trained artefacts skip with an explanation when `models/` is
empty, which is the state of a fresh checkout before `python -m app.ml.train`.
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import pytest

from app.contracts import FEATURE_ORDER, AssetState, FaultType, SensorQuality, Telemetry
from app.health import health_breakdown
from app.ml import dataset as dataset_module
from app.ml.dataset import RunSpec, plan_runs, simulate_run
from app.ml.diagnosis import diagnose, health_index, physics_diagnosis
from app.ml.inference import (
    CLASSIFIER_FILENAME,
    DEFAULT_MODEL_DIR,
    FeatureOrderMismatch,
    InferenceService,
    ModelBundle,
    feature_vector,
)
from app.simulation import SimulationSession

MODEL_DIR = Path(DEFAULT_MODEL_DIR)
HEALTH_CASES = json.loads((Path(__file__).resolve().parents[2] / "testdata" / "health_cases.json").read_text())
requires_model = pytest.mark.skipif(
    not (MODEL_DIR / CLASSIFIER_FILENAME).exists(),
    reason=f"no trained artefacts in {MODEL_DIR}; run `python -m app.ml.train --output models` first",
)


@pytest.fixture(scope="module")
def service() -> InferenceService:
    return InferenceService(MODEL_DIR)


# ---------------------------------------------------------------------------
# Helpers: a clean run of one condition, independent of the training data
# ---------------------------------------------------------------------------
#
# The session ids here are deliberately unlike the training run ids, so these
# frames come from noise streams the model has never seen. Testing a classifier
# on the same random stream it was trained on measures nothing.


def clean_run(
    fault: FaultType,
    severity: float,
    *,
    session_id: str | None = None,
    rpm: float = 1450.0,
    valve: float = 1.0,
    warmup_s: float = 60.0,
    develop_s: float = 12.0,
    frames: int = 12,
    sensor_tag: str = "",
    sensor_mode: str = "",
):
    """Warm a machine up, inject one condition, and return developed frames.

    Only RUNNING frames are returned, for the same reason the dataset keeps only
    RUNNING frames: a tripped machine is not an example of what tripped it.
    """
    session = SimulationSession(session_id or f"verify-{fault.value}-{severity}-{rpm}-{valve}")
    session.set_speed(rpm)
    session.set_valve(valve)
    session.command("start")
    for _ in range(int(warmup_s)):
        session.step(1.0)
    assert session.state == AssetState.RUNNING.value

    if fault is not FaultType.NORMAL:
        if fault is FaultType.SENSOR_FAULT:
            session.inject_fault(fault.value, severity, tag=sensor_tag, mode=sensor_mode)
        else:
            session.inject_fault(fault.value, severity)

    collected = []
    for _ in range(int(develop_s / 0.2)):
        telemetry = session.step(0.2)
        if telemetry.asset_state != AssetState.RUNNING.value:
            break
        if telemetry.fault_state == fault.value and telemetry.severity >= 0.6 * severity:
            collected.append(telemetry)
    assert collected, f"no usable {fault.value} frames were produced"
    return collected[-frames:]


# ---------------------------------------------------------------------------
# 1. The dataset is reproducible, complete, and free of stopped-machine frames
# ---------------------------------------------------------------------------


def test_run_plan_is_deterministic_and_covers_every_class():
    first = plan_runs(seed=dataset_module.DATASET_SEED)
    second = plan_runs(seed=dataset_module.DATASET_SEED)

    assert first == second
    assert {spec.fault for spec in first} == {fault.value for fault in FaultType}
    # A different seed must actually change the plan, otherwise the seed is
    # decorative and "reproducible" means nothing.
    assert plan_runs(seed=dataset_module.DATASET_SEED + 1) != first


def test_repeated_generation_of_the_same_run_is_byte_identical():
    spec = RunSpec(
        run_id="reproducibility-check",
        fault=FaultType.IMBALANCE.value,
        severity=0.7,
        rpm=1400.0,
        valve=0.75,
        warmup_s=30.0,
    )
    assert simulate_run(spec) == simulate_run(spec)


def test_sampled_dataset_covers_every_class_with_no_stopped_machine_frames():
    """One run per class, generated exactly as `build_dataset` generates them."""
    specs = [
        RunSpec("check-normal", FaultType.NORMAL.value, 0.0, 1450.0, 1.0, 30.0),
        RunSpec("check-imbalance", FaultType.IMBALANCE.value, 0.7, 1450.0, 1.0, 30.0),
        RunSpec("check-misalignment", FaultType.MISALIGNMENT.value, 0.7, 1400.0, 0.9, 30.0),
        RunSpec("check-restriction", FaultType.FLOW_RESTRICTION.value, 0.6, 1450.0, 1.0, 30.0),
        # Severe enough that the low-suction interlock stops the machine part
        # way through the run: this run is the reason the rule exists.
        RunSpec("check-cavitation", FaultType.CAVITATION.value, 0.9, 1450.0, 1.0, 30.0),
        RunSpec("check-dry-run", FaultType.DRY_RUN.value, 0.8, 1450.0, 1.0, 30.0),
        RunSpec("check-sensor", FaultType.SENSOR_FAULT.value, 1.0, 1450.0, 1.0, 30.0, "FT-101", "bias"),
    ]
    rows = [row for spec in specs for row in simulate_run(spec)]

    assert {row["label"] for row in rows} == {fault.value for fault in FaultType}
    assert all(row["asset_state"] == AssetState.RUNNING.value for row in rows)
    assert all(set(FEATURE_ORDER) <= set(row) for row in rows)


def test_cavitation_run_is_stopped_by_the_interlock_but_still_yields_running_frames():
    """The trap the acceptance rules exist to avoid, asserted directly."""
    spec = RunSpec("check-cavitation-trip", FaultType.CAVITATION.value, 0.9, 1450.0, 1.0, 30.0)
    rows = simulate_run(spec)

    assert rows, "a severe cavitation run must still contribute frames from before the trip"
    assert all(row["asset_state"] == AssetState.RUNNING.value for row in rows)
    # Frames from a stopped pump would show no flow at all; these show a pump
    # that is running and cavitating.
    assert all(row["flow_lpm"] > 1.0 for row in rows)
    assert min(row["npsh_margin_m"] for row in rows) < 0.0


# ---------------------------------------------------------------------------
# 2. A model is never served against the wrong columns
# ---------------------------------------------------------------------------


@requires_model
def test_persisted_feature_order_matches_the_contract(service: InferenceService):
    assert service.classifier is not None
    assert tuple(service.classifier.feature_order) == tuple(FEATURE_ORDER)
    assert service.anomaly is not None
    assert tuple(service.anomaly.feature_order) == tuple(FEATURE_ORDER)


def test_a_shuffled_feature_order_is_rejected_rather_than_repaired():
    shuffled = tuple(reversed(FEATURE_ORDER))
    bundle = ModelBundle(estimator=object(), feature_order=shuffled, classes=("normal",))

    with pytest.raises(FeatureOrderMismatch):
        bundle.validate()


@requires_model
def test_loading_an_artefact_with_a_shuffled_order_raises_on_load(tmp_path: Path):
    """The check must happen at load, not on the first prediction of nonsense."""
    original = joblib.load(MODEL_DIR / CLASSIFIER_FILENAME)
    joblib.dump(
        ModelBundle(
            estimator=original.estimator,
            feature_order=tuple(reversed(FEATURE_ORDER)),
            classes=original.classes,
        ),
        tmp_path / CLASSIFIER_FILENAME,
    )

    with pytest.raises(FeatureOrderMismatch):
        InferenceService(tmp_path)


# ---------------------------------------------------------------------------
# 3. The pipeline names the fault that was injected
# ---------------------------------------------------------------------------


@requires_model
@pytest.mark.parametrize(
    ("fault", "severity"),
    [
        (FaultType.IMBALANCE, 0.7),
        (FaultType.MISALIGNMENT, 0.7),
        (FaultType.CAVITATION, 0.8),
        (FaultType.DRY_RUN, 0.8),
        (FaultType.FLOW_RESTRICTION, 0.7),
    ],
)
def test_inference_recovers_the_injected_fault(service: InferenceService, fault: FaultType, severity: float):
    frames = clean_run(fault, severity)
    predictions = [service.predict(frame)[0] for frame in frames]

    majority = max(set(predictions), key=predictions.count)
    assert majority == fault.value, f"predicted {set(predictions)} for an injected {fault.value}"


@requires_model
def test_a_healthy_machine_is_called_healthy(service: InferenceService):
    frames = clean_run(FaultType.NORMAL, 0.0, session_id="verify-healthy", warmup_s=120.0)
    predictions = [service.predict(frame)[0] for frame in frames]

    assert max(set(predictions), key=predictions.count) == FaultType.NORMAL.value


# ---------------------------------------------------------------------------
# 4. The anomaly detector separates healthy from severe
# ---------------------------------------------------------------------------


@requires_model
def test_anomaly_score_is_lower_for_a_healthy_machine_than_a_severe_fault(service: InferenceService):
    healthy = clean_run(FaultType.NORMAL, 0.0, session_id="anomaly-healthy")[-1]
    severe = clean_run(FaultType.IMBALANCE, 0.95, session_id="anomaly-severe")[-1]

    healthy_score = service.anomaly_score(healthy)
    severe_score = service.anomaly_score(severe)

    assert 0.0 <= healthy_score <= 1.0
    assert 0.0 <= severe_score <= 1.0
    assert healthy_score < severe_score


# ---------------------------------------------------------------------------
# 5. Missing artefacts degrade, they do not crash
# ---------------------------------------------------------------------------


def test_missing_artefacts_fall_back_to_physics_only(tmp_path: Path):
    empty = InferenceService(tmp_path)
    frame = clean_run(FaultType.CAVITATION, 0.8, session_id="fallback-cavitation")[-1]

    assert empty.is_available is False
    assert empty.load_error
    assert empty.predict(frame) == (None, 0.0, {})
    assert empty.anomaly_score(frame) == 0.0

    # The whole diagnosis must still be produced from the rules alone.
    diagnosis = diagnose(frame, empty)
    assert diagnosis.detected_condition == FaultType.CAVITATION.value
    assert diagnosis.confidence == 0.0
    assert diagnosis.physics_evidence
    assert any("no trained classifier" in item.statement.lower() for item in diagnosis.model_evidence)
    assert diagnosis.physics_model_conflict is False


# ---------------------------------------------------------------------------
# 6. The physics rules produce evidence an engineer can check
# ---------------------------------------------------------------------------


def test_cavitation_evidence_is_non_empty_and_cites_the_npsh_margin():
    frame = clean_run(FaultType.CAVITATION, 0.8, session_id="evidence-cavitation")[-1]
    condition, evidence = physics_diagnosis(frame)

    assert condition == FaultType.CAVITATION.value
    assert evidence
    assert all(item.source == "physics" for item in evidence)

    npsh_items = [item for item in evidence if "npsh" in item.statement.lower()]
    assert npsh_items, [item.statement for item in evidence]
    cited = npsh_items[0]
    assert cited.unit == "m"
    assert cited.measured_value == pytest.approx(frame.npsh_margin_m, abs=0.01)
    assert cited.reference


def test_every_piece_of_physics_evidence_carries_a_value_a_unit_and_a_reference():
    for fault, severity in (
        (FaultType.IMBALANCE, 0.8),
        (FaultType.MISALIGNMENT, 0.8),
        (FaultType.FLOW_RESTRICTION, 0.8),
        (FaultType.DRY_RUN, 0.9),
    ):
        frame = clean_run(fault, severity, session_id=f"evidence-{fault.value}")[-1]
        condition, evidence = physics_diagnosis(frame)

        assert condition == fault.value, f"physics rules called {fault.value} a {condition}"
        for item in evidence:
            assert item.measured_value is not None
            assert item.reference
            assert item.statement


# ---------------------------------------------------------------------------
# 7. A broken instrument is an instrument fault, not a machine fault
# ---------------------------------------------------------------------------


def test_a_bad_sensor_quality_yields_a_sensor_fault_not_a_mechanical_one():
    frames = clean_run(
        FaultType.SENSOR_FAULT,
        1.0,
        session_id="sensor-dropout",
        sensor_tag="FT-101",
        sensor_mode="dropout",
        develop_s=3.0,
    )
    bad = [f for f in frames if SensorQuality.BAD.value in f.sensor_quality.values()]
    assert bad, "the dropout fault never produced a BAD channel"
    frame = bad[-1]

    diagnosis = diagnose(frame, InferenceService(MODEL_DIR))

    assert diagnosis.detected_condition == FaultType.SENSOR_FAULT.value
    assert diagnosis.is_sensor_fault is True
    assert any("FT-101" in item.statement for item in diagnosis.physics_evidence)
    assert any("instrument fault" in action.lower() for action in diagnosis.recommended_actions)


def test_a_frozen_transmitter_is_still_reported_as_an_instrument_fault():
    """The mode deliberately left out of training: the rules must still catch it."""
    frames = clean_run(
        FaultType.SENSOR_FAULT,
        1.0,
        session_id="sensor-freeze",
        sensor_tag="PT-101",
        sensor_mode="freeze",
        develop_s=6.0,
    )
    condition, evidence = physics_diagnosis(frames[-1])

    assert condition == FaultType.SENSOR_FAULT.value
    assert any("PT-101" in item.statement for item in evidence)


# ---------------------------------------------------------------------------
# 8. The health index behaves like a health index
# ---------------------------------------------------------------------------

def _telemetry_from_health_case(item: dict) -> Telemetry:
    state = AssetState.RUNNING.value if item["running"] else AssetState.OFF.value
    return Telemetry(
        timestamp="2026-08-19T00:00:00+00:00",
        elapsed_s=0.0,
        rpm=1450.0 if item["running"] else 0.0,
        flow_lpm=115.52 if item["running"] else 0.0,
        pump_head_m=7.59 if item["running"] else 0.0,
        suction_pressure_kpa=92.0,
        discharge_pressure_kpa=166.3,
        differential_pressure_kpa=74.3,
        motor_current_a=2.165 if item["running"] else 0.0,
        motor_temperature_c=56.0,
        bearing_temperature_c=float(item["bearing_temperature_c"]),
        vibration_x_mm_s=0.0,
        vibration_y_mm_s=0.0,
        vibration_z_mm_s=0.0,
        vibration_rms_mm_s=float(item["vibration_rms_mm_s"]),
        vibration_peak_mm_s=0.0,
        crest_factor=1.414,
        amplitude_1x_mm_s=0.0,
        amplitude_2x_mm_s=0.0,
        high_frequency_energy=0.0,
        dominant_frequency_hz=0.0,
        rotational_frequency_hz=24.1667 if item["running"] else 0.0,
        pump_efficiency=float(item["pump_efficiency"]),
        hydraulic_power_w=0.0,
        shaft_power_w=0.0,
        electrical_power_w=0.0,
        health_index=0.0,
        anomaly_score=0.0,
        fault_state=FaultType.NORMAL.value,
        severity=0.0,
        asset_state=state,
        npsh_margin_m=float(item["npsh_margin_m"]),
        sensor_quality={},
    )


# This is a sampled lock for one coefficient, not a complete cross-language
# consistency test. It catches someone changing the vibration penalty slope
# literal. It does not catch formula rewrites that preserve this text by moving
# the arithmetic elsewhere, changes to other zone slopes, zone boundaries, NPSH
# penalties, or temperature penalties. Complete coverage requires both sides to
# assert all outputs for the same fixture set; health_cases.json already does
# that semantic check on both sides, and this source sentinel is an extra layer.
# Known weak point: it matches source text, so formatting-only changes can cause
# false positives. If that happens, update the matched string; do not delete the
# test.
def test_frontend_vibration_penalty_coefficients_stay_aligned():
    frontend_vibration = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "vibration.ts"
    source = frontend_vibration.read_text(encoding="utf-8")
    assert "return 4 * inZoneA + 11 * inZoneB + 22 * inZoneC + 40 * inZoneD" in source

def test_backend_health_matches_the_shared_frontend_fixture():
    for item in HEALTH_CASES:
        result = health_breakdown(_telemetry_from_health_case(item))
        assert result.scored is item["expected_scored"], item["name"]
        assert result.health == pytest.approx(item["expected_health"], abs=1e-6), item["name"]


def test_health_index_is_bounded_and_falls_when_the_machine_is_sick():
    healthy = clean_run(FaultType.NORMAL, 0.0, session_id="health-healthy")[-1]
    severe = clean_run(FaultType.IMBALANCE, 0.95, session_id="health-severe")[-1]
    cavitating = clean_run(FaultType.CAVITATION, 0.9, session_id="health-cavitation")[-1]

    healthy_index = health_index(healthy, anomaly_score=0.05)
    severe_index = health_index(severe, anomaly_score=0.9)
    cavitating_index = health_index(cavitating, anomaly_score=0.9)

    for value in (healthy_index, severe_index, cavitating_index):
        assert 0.0 <= value <= 100.0

    assert severe_index < healthy_index
    assert cavitating_index < healthy_index
    assert healthy_index > 90.0


@requires_model
def test_diagnosis_reports_a_conflict_rather_than_hiding_it(service: InferenceService):
    """The conflict flag must be a real comparison, not a field that is always False."""
    frame = clean_run(FaultType.IMBALANCE, 0.8, session_id="conflict-imbalance")[-1]
    agreeing = diagnose(frame, service)

    assert agreeing.detected_condition == FaultType.IMBALANCE.value
    assert agreeing.physics_model_conflict is False
    assert agreeing.physics_evidence and agreeing.model_evidence
    assert agreeing.feature_importance
    assert agreeing.recommended_actions
    assert 0.0 <= agreeing.confidence <= 1.0
    assert agreeing.severity_label in ("none", "minor", "moderate", "severe")

    # Physics sees an unbalanced rotor; the model is told the frame is healthy.
    # The disagreement must surface, and the measurement must win.
    class _ModelSaysHealthy(InferenceService):
        def predict(self, telemetry):
            return FaultType.NORMAL.value, 0.99, {FaultType.NORMAL.value: 0.99}

    conflicted = diagnose(frame, _ModelSaysHealthy(MODEL_DIR))
    assert conflicted.physics_model_conflict is True
    assert conflicted.detected_condition == FaultType.IMBALANCE.value


@requires_model
def test_feature_contributions_explain_the_prediction(service: InferenceService):
    from app.ml.explain import feature_importance, prediction_contributions

    frame = clean_run(FaultType.MISALIGNMENT, 0.8, session_id="explain-misalignment")[-1]
    importance = feature_importance(service)
    contributions = prediction_contributions(frame, service, top_n=None)

    assert set(importance) == set(FEATURE_ORDER)
    assert sum(importance.values()) == pytest.approx(1.0, abs=1e-6)

    # The contributions plus the forest's base rate must reconstruct the
    # predicted probability; if they do not, the walk of the trees is wrong.
    predicted, confidence, _ = service.predict(frame)
    assert predicted == FaultType.MISALIGNMENT.value
    base = sum(
        _root_proportion(tree, list(service.classes).index(predicted))
        for tree in service.classifier.estimator.estimators_
    ) / len(service.classifier.estimator.estimators_)
    assert base + sum(contributions.values()) == pytest.approx(confidence, abs=1e-6)


def _root_proportion(tree, class_index: int) -> float:
    values = tree.tree_.value[0][0]
    return float(values[class_index]) / float(values.sum())


def test_feature_vector_follows_the_contract_order():
    frame = clean_run(FaultType.NORMAL, 0.0, session_id="feature-order", warmup_s=30.0)[-1]
    vector = feature_vector(frame)

    assert vector.shape == (len(FEATURE_ORDER),)
    for index, name in enumerate(FEATURE_ORDER):
        assert vector[index] == pytest.approx(getattr(frame, name))
