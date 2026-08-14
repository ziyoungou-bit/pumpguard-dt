"""A visitor's first frame must show a machine that is doing something.

A stopped pump is the correct initial state for a plant and the wrong one for a
page opened cold: every panel reads zero, and a machine at rest is
indistinguishable from a site that failed to load. The bundled recording was
changed to open at the duty point for that reason, and this is the same fix on
the live path -- without it, connecting to the real backend made the app look
WORSE than its offline fallback.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.api.sessions import WARM_START_S, SessionManager
from app.config.pump_parameters import MOTOR, THERMAL
from app.contracts import AssetState, DataSource, FaultType
from app.ml.diagnosis import diagnose
from app.ml.inference import CLASSIFIER_FILENAME, DEFAULT_MODEL_DIR, InferenceService


def manager(data_source: DataSource = DataSource.SIMULATION) -> SessionManager:
    return SessionManager(
        data_source=data_source,
        tick_interval_s=0.2,
        idle_timeout_s=600.0,
        max_sessions=10,
    )


def test_a_new_simulated_session_is_already_running():
    session = manager().create()
    frame = session.latest

    assert frame is not None, "a new session must have a frame before it is handed out"
    assert frame.asset_state == AssetState.RUNNING.value
    assert frame.rpm > 1000
    assert frame.flow_lpm > 15


def test_the_first_frame_is_settled_rather_than_mid_ramp():
    """Past the speed ramp and the start-up alarm inhibit, not part-way up it."""
    session = manager().create()
    before = session.latest
    assert before is not None

    after = session.advance(5.0)
    # A steady machine: five more seconds must not move the hydraulics much.
    assert after.rpm == pytest.approx(before.rpm, rel=0.02)
    assert after.flow_lpm == pytest.approx(before.flow_lpm, rel=0.05)
    assert WARM_START_S >= 20.0


def test_the_first_frame_is_thermally_settled():
    """Duty flow and duty current at ambient temperature is not a real state.

    The motor time constant is 420 s, so a warm start that only simulates
    forward leaves the machine cold while every hydraulic and electrical
    reading says it has been running. That combination does not occur in the
    training data and the classifier read it, correctly, as mutually
    inconsistent instrumentation -- it reported a healthy machine as a sensor
    fault with 0.66 confidence. The temperatures are set to the thermal model's
    own fixed point instead of being integrated toward it.
    """
    frame = manager().create().latest
    assert frame is not None

    rise = frame.motor_temperature_c - THERMAL.ambient_c
    assert rise > 15, "the motor is still at ambient after a warm start"

    # The fixed point for this load, from the same model: ambient + rise * load,
    # with load being SHAFT power over the motor rating.
    load = frame.shaft_power_w / MOTOR.rated_power_w
    assert frame.motor_temperature_c == pytest.approx(
        THERMAL.ambient_c + THERMAL.motor_rise_at_rated_c * load, abs=1.5
    )
    assert frame.bearing_temperature_c == pytest.approx(
        THERMAL.ambient_c + THERMAL.bearing_rise_at_rated_c * load, abs=1.5
    )
    # Still well inside limits: settled, not hot.
    assert frame.motor_temperature_c < 65


@pytest.mark.skipif(
    not (Path(DEFAULT_MODEL_DIR) / CLASSIFIER_FILENAME).exists(),
    reason="no trained artefacts; run `python -m app.ml.train --output models` first",
)
def test_the_first_frame_is_usually_diagnosed_healthy():
    """A visitor opening the site cold should not be told the pump is faulty.

    This asserts a RATE, not an outcome, and the rate it asserts is poor. That
    is deliberate: the number is the finding.

    Settling the thermal state took the misdiagnosis rate on a fresh healthy
    session from about 100 % down to 45 % -- measured over 60 sessions, 33
    normal against 27 sensor_fault at a mean confidence of 0.60. The residual
    is not noise and not tuning. The classifier cannot separate `normal` from
    `sensor_fault` because on the feature vector they are very nearly the same
    thing: a sensor-fault frame has entirely normal machine physics with one
    channel corrupted, and what actually carries that information is the
    `sensor_quality` map, which is not a feature. The grouped confusion matrix
    from training says the same thing -- 189 normal frames called sensor_fault
    and 237 the other way.

    The principled fix is to stop asking a process-data classifier to detect a
    measurement-chain condition: drop `sensor_fault` from the label set and
    declare it from the quality flags, which is both how a real system does it
    and what `diagnosis.bad_sensors` already implements. That changes what the
    Fault Diagnosis page claims, so it is a decision to be taken deliberately
    rather than smuggled in behind a red test.

    Until then this guards against regression past the current state without
    pretending the current state is good.
    """
    service = InferenceService(DEFAULT_MODEL_DIR)
    m = manager()
    verdicts = [
        diagnose(m.create().latest, service).detected_condition for _ in range(40)
    ]
    healthy = verdicts.count(FaultType.NORMAL.value)
    assert healthy >= 16, (
        f"only {healthy}/40 fresh healthy sessions were diagnosed normal; "
        "the warm start or the classifier has regressed"
    )


def test_the_first_frame_carries_no_alarms():
    """Flow, current and pressure are legitimately out of limits during a start.

    Handing a visitor a machine that is running but alarming would trade one bad
    first impression for another.
    """
    session = manager().create()
    assert session.provider.alarms == []


def test_each_visitor_gets_their_own_running_machine():
    m = manager()
    a = m.create()
    b = m.create()

    assert a.id != b.id
    assert a.latest is not None and b.latest is not None
    assert a.latest.asset_state == AssetState.RUNNING.value
    assert b.latest.asset_state == AssetState.RUNNING.value


def test_a_recorded_session_is_not_advanced():
    """A recording has its own timeline; warming it would skip its first frames.

    Guarding on the data source rather than on whether the command was accepted,
    because a recorded provider may well accept a start and simply seek.
    """
    session = manager(DataSource.RECORDED).create()
    # Either no frame yet, or the recording's own first frame -- what must NOT
    # happen is twenty seconds of someone's dataset being consumed silently.
    assert session.tick_count == 0
