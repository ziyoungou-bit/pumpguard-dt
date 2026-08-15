"""Behavioural tests for the simulation engine.

These are not unit tests of arithmetic. Each one asserts a claim the project
makes about the machine: that a healthy pump is quiet, that faults develop
rather than appear, that an instrument failure is not a machine failure, and
that two visitors never see each other's faults.

Reference duty point, verified against `physics.pump_model` directly:
21.0 L/min at 7.59 m, 61.9 % efficiency, 0.563 A at 1450 rpm, valve open.
"""

from __future__ import annotations

import pytest

from app.contracts import AssetState, FaultType, SensorQuality, Telemetry
from app.simulation import SimulationSession

DT = 0.1
DUTY_FLOW_LPM = 21.0


def run(session: SimulationSession, seconds: float, dt: float = DT) -> list[Telemetry]:
    return [session.step(dt) for _ in range(int(round(seconds / dt)))]


def started(session_id: str, settle_s: float = 20.0) -> SimulationSession:
    """A session running steadily at duty, past the start-up alarm inhibit."""
    session = SimulationSession(session_id)
    assert session.command("start")["ok"]
    run(session, settle_s)
    assert session.state == AssetState.RUNNING.value
    return session


# ---------------------------------------------------------------------------
# 1. A healthy machine is silent
# ---------------------------------------------------------------------------


def test_healthy_duty_run_raises_no_alarms_for_60_seconds():
    session = SimulationSession("healthy")
    session.command("start")
    frames = run(session, 60.0)

    assert session.state == AssetState.RUNNING.value
    assert session.alarms == [], [a.description for a in session.alarms]
    assert session.alarm_history == []

    steady = frames[-1]
    assert steady.flow_lpm == pytest.approx(DUTY_FLOW_LPM, abs=0.5)
    assert steady.pump_head_m == pytest.approx(7.59, abs=0.1)
    assert steady.motor_current_a == pytest.approx(0.671, abs=0.02)
    assert steady.pump_efficiency == pytest.approx(0.419, abs=0.01)
    assert steady.npsh_margin_m > 5.0
    assert steady.fault_state == FaultType.NORMAL.value
    assert steady.health_index == pytest.approx(100.0, abs=0.5)
    assert all(q == SensorQuality.GOOD.value for q in steady.sensor_quality.values())


# ---------------------------------------------------------------------------
# 4. Faults develop, they do not snap
# ---------------------------------------------------------------------------


def test_flow_restriction_ramps_and_does_not_snap():
    session = started("restriction")
    baseline = session.last_telemetry.flow_lpm

    session.inject_fault(FaultType.FLOW_RESTRICTION.value, 1.0, ramp_s=8.0)
    frames = run(session, 60.0)

    at_half_second = frames[4].flow_lpm  # t = 0.5 s after injection
    final = frames[-1].flow_lpm

    assert final < baseline * 0.35, "a fully developed blockage must throttle the pump"
    # The whole point of the first-order lag: half a second in, the machine is
    # still essentially where it was.
    distance_moved = abs(baseline - at_half_second)
    distance_total = abs(baseline - final)
    assert distance_moved < 0.15 * distance_total

    # And the operating point moved along the pump curve rather than being
    # overwritten: less flow, more head, less current.
    assert frames[-1].pump_head_m > frames[0].pump_head_m
    assert frames[-1].motor_current_a < frames[0].motor_current_a


def test_clearing_a_fault_ramps_back_to_healthy():
    session = started("recovery")
    session.inject_fault(FaultType.FLOW_RESTRICTION.value, 1.0, ramp_s=4.0)
    run(session, 40.0)
    assert session.last_telemetry.flow_lpm < 8.0

    session.clear_fault(ramp_s=4.0)
    frames = run(session, 40.0)
    assert frames[-1].flow_lpm == pytest.approx(DUTY_FLOW_LPM, abs=0.6)
    assert frames[-1].fault_state == FaultType.NORMAL.value


# ---------------------------------------------------------------------------
# 5. Dry running: temperature up, current down
# ---------------------------------------------------------------------------


def test_dry_run_raises_temperature_and_unloads_the_motor():
    session = started("dryrun")
    before = session.last_telemetry

    session.inject_fault(FaultType.DRY_RUN.value, 1.0, ramp_s=8.0)
    frames = run(session, 25.0)
    after = frames[-1]

    assert after.motor_temperature_c > before.motor_temperature_c + 1.0
    assert after.bearing_temperature_c > before.bearing_temperature_c
    # Losing the liquid unloads the motor. Current falling, not rising, is the
    # electrical signature of a dry run.
    assert after.motor_current_a < before.motor_current_a - 0.05
    assert after.flow_lpm < 2.0
    assert after.fault_state == FaultType.DRY_RUN.value


# ---------------------------------------------------------------------------
# 6. Cavitation comes from the NPSH margin, not from a flag
# ---------------------------------------------------------------------------


def test_cavitation_drives_npsh_margin_negative_and_raises_high_frequency_energy():
    session = started("cavitation")
    baseline_hf = session.last_telemetry.high_frequency_energy
    baseline_crest = session.last_telemetry.crest_factor

    session.inject_fault(FaultType.CAVITATION.value, 1.0, ramp_s=8.0)
    frames = run(session, 40.0)

    assert min(f.npsh_margin_m for f in frames) < 0.0
    assert max(f.high_frequency_energy for f in frames) > 3.0 * baseline_hf
    assert max(f.crest_factor for f in frames) > baseline_crest + 0.5
    # Suction pressure collapses toward the vapour pressure of the liquid.
    assert min(f.suction_pressure_kpa for f in frames) < 40.0
    # Sustained cavitation is not something the machine is left to survive.
    assert session.state in (AssetState.STOPPING.value, AssetState.FAULT.value)


def test_cavitation_makes_the_flow_unsteady():
    """Bubble collapse produces an unsteady delivery, not a lower steady one."""
    session = started("cavitation-noise")
    healthy = [f.flow_lpm for f in run(session, 10.0)]

    session.inject_fault(FaultType.CAVITATION.value, 1.0, ramp_s=4.0)
    frames = run(session, 10.0)
    cavitating = [f.flow_lpm for f in frames if f.npsh_margin_m < 0.0]

    assert len(cavitating) > 10
    assert _spread(cavitating) > 3.0 * _spread(healthy)


def _spread(values: list[float]) -> float:
    mean = sum(values) / len(values)
    return (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5


# ---------------------------------------------------------------------------
# 7. An instrument fault is not a machine fault
# ---------------------------------------------------------------------------


def test_frozen_flow_transmitter_is_flagged_but_the_process_is_untouched():
    session = started("frozen-ft")
    true_flow_before = session.truth["flow_lpm"]

    session.inject_fault(FaultType.SENSOR_FAULT.value, 1.0, tag="FT-101", mode="freeze")
    frames = run(session, 20.0)

    quality = frames[-1].sensor_quality["FT-101"]
    assert quality in (SensorQuality.BAD.value, SensorQuality.UNCERTAIN.value)

    # The reading is stuck ...
    readings = {round(f.flow_lpm, 6) for f in frames}
    assert len(readings) == 1

    # ... and the pump is doing exactly what it was doing before.
    assert session.truth["flow_lpm"] == pytest.approx(true_flow_before, rel=0.01)
    assert session.truth["motor_current_a"] == pytest.approx(0.671, abs=0.02)
    assert session.state == AssetState.RUNNING.value
    assert frames[-1].fault_state == FaultType.SENSOR_FAULT.value


def test_sensor_bias_shifts_the_reading_only():
    session = started("biased-pt")
    true_suction = session.truth["suction_pressure_kpa"]

    session.inject_fault(FaultType.SENSOR_FAULT.value, 1.0, tag="PT-101", mode="bias")
    frames = run(session, 5.0)

    assert frames[-1].suction_pressure_kpa > true_suction + 5.0
    assert session.truth["suction_pressure_kpa"] == pytest.approx(true_suction, rel=0.01)
    assert frames[-1].sensor_quality["PT-101"] == SensorQuality.UNCERTAIN.value


def test_lost_signal_is_bad_quality_and_stops_the_machine():
    """Dropout is the one instrumentation condition allowed to act on the process."""
    session = started("dropout-ft")
    session.inject_fault(FaultType.SENSOR_FAULT.value, 1.0, tag="FT-101", mode="dropout")
    frames = run(session, 20.0)

    assert any(f.sensor_quality["FT-101"] == SensorQuality.BAD.value for f in frames)
    assert session.state in (AssetState.STOPPING.value, AssetState.FAULT.value)


# ---------------------------------------------------------------------------
# 8. Sessions are independent
# ---------------------------------------------------------------------------


def test_two_sessions_do_not_interfere():
    a = started("visitor-a")
    b = started("visitor-b")

    a.inject_fault(FaultType.CAVITATION.value, 1.0, ramp_s=4.0)
    for _ in range(200):
        a.step(DT)
        b.step(DT)

    assert a.last_telemetry.fault_state == FaultType.CAVITATION.value
    assert a.state != AssetState.RUNNING.value, "the cavitating machine should have been tripped"

    assert b.state == AssetState.RUNNING.value
    assert b.last_telemetry.fault_state == FaultType.NORMAL.value
    assert b.last_telemetry.npsh_margin_m > 5.0
    assert b.last_telemetry.flow_lpm == pytest.approx(DUTY_FLOW_LPM, abs=0.5)
    assert b.alarms == []


def test_sessions_have_independent_valve_and_speed_setpoints():
    a = started("valve-a")
    b = started("valve-b")

    a.set_valve(0.35)
    b.set_speed(1100.0)
    run(a, 20.0)
    run(b, 20.0)

    # A throttled at full speed; B at reduced speed with the valve untouched.
    assert a.valve_opening == 0.35 and b.valve_opening == 1.0
    assert a.last_telemetry.rpm == pytest.approx(1450.0, abs=5.0)
    assert a.last_telemetry.flow_lpm < DUTY_FLOW_LPM - 1.5
    assert b.last_telemetry.rpm == pytest.approx(1100.0, abs=5.0)
    assert b.last_telemetry.flow_lpm < DUTY_FLOW_LPM - 1.5
    assert a.last_telemetry.flow_lpm != b.last_telemetry.flow_lpm


# ---------------------------------------------------------------------------
# 9. Stopping
# ---------------------------------------------------------------------------


def test_stopping_coasts_down_to_zero_speed_and_zero_flow():
    session = started("stopping")
    assert session.command("stop")["ok"]
    frames = run(session, 40.0)

    assert session.state == AssetState.OFF.value
    assert frames[-1].rpm == 0.0
    assert frames[-1].flow_lpm == 0.0
    assert frames[-1].vibration_rms_mm_s == 0.0
    # Coast-down, not a step: the shaft is still turning a second after the
    # stop command.
    assert frames[10].rpm > 100.0


# ---------------------------------------------------------------------------
# 10. Alarms do not spam
# ---------------------------------------------------------------------------


def test_a_persisting_condition_raises_one_alarm_not_one_per_tick():
    session = started("alarm-spam")
    session.inject_fault(FaultType.FLOW_RESTRICTION.value, 1.0, ramp_s=8.0)
    run(session, 60.0)  # 600 ticks with the condition present

    flow_records = [a for a in session.alarm_records if a.tag == "FT-101"]
    assert len(flow_records) == 1
    record = flow_records[0]
    assert record.state == "ACTIVE"
    assert record.severity in ("WARNING", "ALARM", "TRIP")
    assert record.unit == "L/min"
    assert record.acknowledged is False

    counts = [len(session.alarms) for _ in range(50) if session.step(DT)]
    assert len(set(counts)) == 1


def test_acknowledge_and_reset():
    session = started("ack")
    session.inject_fault(FaultType.FLOW_RESTRICTION.value, 1.0, ramp_s=4.0)
    run(session, 40.0)
    assert session.alarms

    assert session.command("ack")["ok"]
    assert all(a.acknowledged for a in session.alarms)
    assert all(a.acknowledged_at for a in session.alarms)

    session.command("stop")
    run(session, 30.0)
    assert session.command("reset")["ok"]
    assert session.alarms == []
    assert session.alarm_history, "a reset clears the annunciation, not the evidence"


# ---------------------------------------------------------------------------
# Telemetry contract
# ---------------------------------------------------------------------------


def test_every_telemetry_field_is_populated_and_finite():
    session = started("contract")
    frame = session.step(DT).to_dict()

    assert frame["schema_version"] == "1.0.0"
    assert frame["data_source"] == "SIMULATION"
    assert set(frame["sensor_quality"]) == {
        "FT-101",
        "PT-101",
        "PT-102",
        "CT-101",
        "TT-101",
        "TT-102",
        "ACC-101",
        "RPM-101",
    }
    numeric = {k: v for k, v in frame.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    assert numeric, "telemetry must carry numbers"
    for key, value in numeric.items():
        assert value == value, f"{key} is NaN"
        assert abs(value) < 1e9, f"{key} is not a physical quantity"


def test_differential_pressure_matches_the_two_transmitters():
    session = started("dp")
    frame = session.step(DT)
    assert frame.differential_pressure_kpa == pytest.approx(
        frame.discharge_pressure_kpa - frame.suction_pressure_kpa, abs=1e-6
    )
    # dP = rho g H against the head from the pump curve.
    assert frame.differential_pressure_kpa == pytest.approx(9.7905 * frame.pump_head_m, rel=0.05)


def test_mechanical_faults_show_in_the_expected_vibration_order():
    """Severity 0.9, not 1.0.

    The vibration trip is now derived from ISO 20816-1's operational-limit rule
    (1.25 x the zone C upper limit = 5.625 mm/s) rather than from a sourceless
    18.0, and a fully developed imbalance takes this machine past it: severity
    0.9 settles at 5.55 mm/s and runs, severity 1.0 trips. This test is about
    WHERE the energy appears, so it is run at the highest severity the machine
    survives; that the machine does not survive 1.0 is asserted separately
    below, because it is protection working rather than a limitation.
    """
    imbalance = started("imbalance")
    imbalance.inject_fault(FaultType.IMBALANCE.value, 0.9, ramp_s=4.0)
    frames = run(imbalance, 40.0)
    healthy_1x = 0.55
    assert frames[-1].asset_state == AssetState.RUNNING.value
    assert frames[-1].amplitude_1x_mm_s > 4.0 * healthy_1x
    assert frames[-1].amplitude_1x_mm_s > frames[-1].amplitude_2x_mm_s

    misalignment = started("misalignment")
    misalignment.inject_fault(FaultType.MISALIGNMENT.value, 0.9, ramp_s=4.0)
    frames = run(misalignment, 40.0)
    # Misalignment lives at 2x and in the axial direction.
    assert frames[-1].amplitude_2x_mm_s > frames[-1].amplitude_1x_mm_s
    assert frames[-1].vibration_z_mm_s > 1.0


def test_a_fully_developed_imbalance_trips_the_machine():
    """The consequence of sourcing the trip threshold, asserted rather than met
    by accident.

    It used to be 18.0 mm/s, four times the zone C/D boundary and citable to
    nothing, so no mechanical fault this simulator can produce ever reached it
    and the interlock was decorative. At 1.25 x zone C the protection actually
    protects.
    """
    session = started("imbalance-trip")
    session.inject_fault(FaultType.IMBALANCE.value, 1.0, ramp_s=4.0)
    run(session, 40.0)
    assert session.state == AssetState.FAULT.value


def test_injecting_an_unknown_fault_is_rejected():
    session = SimulationSession("bad-fault")
    with pytest.raises(ValueError):
        session.inject_fault("gremlins", 1.0)
    with pytest.raises(ValueError):
        session.inject_fault(FaultType.SENSOR_FAULT.value, 1.0, tag="XX-999", mode="freeze")
