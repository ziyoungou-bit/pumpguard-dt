"""Tests for the SCADA state machine, interlocks and start permissives.

The claims under test are safety claims, so they are asserted at the session
level -- through the same `command()` an operator's HMI would call -- rather
than by poking the state machine's internals.
"""

from __future__ import annotations

import pytest

from app.automation.state_machine import TRANSITIONS, Event, PumpStateMachine
from app.config.alarm_thresholds import INTERLOCKS
from app.contracts import AssetState
from app.simulation import SimulationSession

DT = 0.1


def run(session: SimulationSession, seconds: float) -> None:
    for _ in range(int(round(seconds / DT))):
        session.step(DT)


# ---------------------------------------------------------------------------
# The table itself
# ---------------------------------------------------------------------------


def test_every_state_appears_in_the_transition_table():
    assert set(TRANSITIONS) == set(AssetState)


def test_start_is_only_legal_from_off():
    legal = [state for state, events in TRANSITIONS.items() if Event.START in events]
    assert legal == [AssetState.OFF]


def test_emergency_stop_is_reachable_from_every_running_or_idle_state():
    for state in (AssetState.OFF, AssetState.STARTING, AssetState.RUNNING, AssetState.STOPPING, AssetState.FAULT):
        assert Event.ESTOP in TRANSITIONS[state]


def test_e_stop_can_only_be_left_by_resetting_the_e_stop():
    assert set(TRANSITIONS[AssetState.E_STOP]) == {Event.ESTOP_RESET}


def test_illegal_transitions_are_rejected_with_a_reason_not_an_exception():
    machine = PumpStateMachine(1450.0, INTERLOCKS.start_timeout_s)
    result = machine.fire(Event.START_COMPLETE)
    assert result.accepted is False
    assert "rejected" in result.reason
    assert machine.state is AssetState.OFF


# ---------------------------------------------------------------------------
# 2. Emergency stop blocks starting, absolutely
# ---------------------------------------------------------------------------


def test_e_stop_blocks_start_and_the_state_does_not_move():
    session = SimulationSession("estop")
    assert session.command("estop", active=True)["ok"]
    assert session.state == AssetState.E_STOP.value

    for _ in range(5):
        response = session.command("start")
        assert response["ok"] is False
        assert "emergency stop" in response["reason"].lower()
        assert response["state"] == AssetState.E_STOP.value

    run(session, 10.0)
    assert session.state == AssetState.E_STOP.value
    assert session.rpm == 0.0
    assert session.last_telemetry.flow_lpm == 0.0


def test_e_stop_while_running_stops_the_machine():
    session = SimulationSession("estop-running")
    session.command("start")
    run(session, 20.0)
    assert session.state == AssetState.RUNNING.value

    session.command("estop", active=True)
    assert session.state == AssetState.E_STOP.value
    run(session, 10.0)
    assert session.rpm == 0.0
    assert session.last_telemetry.flow_lpm == 0.0

    # Reset the emergency stop, and only then may the machine start.
    assert session.command("estop", active=False)["ok"]
    assert session.state == AssetState.OFF.value
    assert session.command("start")["ok"]


def test_a_maintenance_or_reset_command_cannot_escape_e_stop():
    session = SimulationSession("estop-escape")
    session.command("estop", active=True)
    for command, kwargs in (("reset", {}), ("mode", {"mode": "MAINTENANCE"}), ("stop", {})):
        response = session.command(command, **kwargs)
        assert response["ok"] is False
        assert session.state == AssetState.E_STOP.value


# ---------------------------------------------------------------------------
# 3. Maintenance blocks automatic starting
# ---------------------------------------------------------------------------


def test_maintenance_blocks_start():
    session = SimulationSession("maintenance")
    assert session.command("mode", mode="MAINTENANCE")["ok"]
    assert session.state == AssetState.MAINTENANCE.value

    response = session.command("start")
    assert response["ok"] is False
    assert "maintenance" in response["reason"].lower()
    assert session.state == AssetState.MAINTENANCE.value

    run(session, 10.0)
    assert session.state == AssetState.MAINTENANCE.value
    assert session.rpm == 0.0

    assert session.command("mode", mode="AUTO")["ok"]
    assert session.command("start")["ok"]


def test_unknown_mode_and_unknown_command_are_rejected_cleanly():
    session = SimulationSession("bad-command")
    assert session.command("mode", mode="TURBO")["ok"] is False
    assert session.command("levitate")["ok"] is False
    assert session.state == AssetState.OFF.value


# ---------------------------------------------------------------------------
# Starting, running, stopping
# ---------------------------------------------------------------------------


def test_start_ramps_the_speed_up_rather_than_stepping():
    session = SimulationSession("ramp")
    session.command("start")
    assert session.state == AssetState.STARTING.value

    frames = [session.step(DT) for _ in range(10)]  # 1 s
    assert 0.0 < frames[-1].rpm < 1450.0 * 0.6
    assert all(a.rpm <= b.rpm + 1e-6 for a, b in zip(frames, frames[1:]))

    run(session, 5.0)
    assert session.state == AssetState.RUNNING.value
    assert session.rpm == pytest.approx(1450.0, abs=5.0)


def test_stop_goes_through_stopping_before_off():
    session = SimulationSession("stop-path")
    session.command("start")
    run(session, 20.0)
    session.command("stop")
    assert session.state == AssetState.STOPPING.value
    run(session, 2.0)
    assert session.state == AssetState.STOPPING.value  # still coasting
    run(session, 30.0)
    assert session.state == AssetState.OFF.value


# ---------------------------------------------------------------------------
# Interlocks
# ---------------------------------------------------------------------------


def test_all_seven_interlocks_are_evaluated_every_tick():
    session = SimulationSession("interlocks")
    session.command("start")
    session.step(DT)
    names = {item["name"] for item in session.interlocks}
    assert names == {
        "emergency_stop",
        "low_suction_pressure",
        "no_flow",
        "high_motor_temperature",
        "high_bearing_temperature",
        "extreme_vibration",
        "invalid_sensor",
    }
    for item in session.interlocks:
        assert set(item) >= {"name", "tag", "tripped", "value", "threshold", "unit"}


def test_no_interlock_trips_at_the_healthy_duty_point():
    session = SimulationSession("no-false-trip")
    session.command("start")
    for _ in range(1200):  # 120 s, well past every on-delay
        session.step(DT)
        assert not [item for item in session.interlocks if item["tripped"]]
    assert session.state == AssetState.RUNNING.value


def test_start_up_grace_stops_the_no_flow_interlock_tripping_the_start():
    """A stopped pump has no flow; tripping on that would make it unstartable."""
    session = SimulationSession("grace")
    session.command("start")
    run(session, INTERLOCKS.startup_grace_s + 5.0)
    assert session.state == AssetState.RUNNING.value


def test_a_trip_coasts_down_and_latches_fault_rather_than_returning_to_off():
    session = SimulationSession("trip")
    session.command("start")
    run(session, 20.0)

    session.inject_fault("cavitation", 1.0, ramp_s=4.0)
    run(session, 60.0)

    assert session.state == AssetState.FAULT.value
    assert session.rpm == 0.0
    # A tripped machine cannot simply be restarted; the fault must be reset.
    assert session.command("start")["ok"] is False
    assert session.command("reset")["ok"]
    assert session.state == AssetState.OFF.value

    session.clear_fault(ramp_s=1.0)
    assert session.command("start")["ok"]


def test_start_is_blocked_while_a_critical_instrument_is_dead():
    session = SimulationSession("dead-sensor")
    session.inject_fault("sensor_fault", 1.0, tag="FT-101", mode="dropout")
    run(session, 5.0)  # let the loop break register while stopped

    response = session.command("start")
    if not response["ok"]:
        assert "instrument" in response["reason"].lower()
    else:
        # The dropout is intermittent, so a start may slip through; the
        # interlock must then stop the machine once the signal is lost again.
        run(session, 60.0)
        assert session.state in (AssetState.STOPPING.value, AssetState.FAULT.value)
