"""A visitor's first frame must show a machine that is doing something.

A stopped pump is the correct initial state for a plant and the wrong one for a
page opened cold: every panel reads zero, and a machine at rest is
indistinguishable from a site that failed to load. The bundled recording was
changed to open at the duty point for that reason, and this is the same fix on
the live path -- without it, connecting to the real backend made the app look
WORSE than its offline fallback.
"""

from __future__ import annotations

import pytest

from app.api.sessions import WARM_START_S, SessionManager
from app.contracts import AssetState, DataSource


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
