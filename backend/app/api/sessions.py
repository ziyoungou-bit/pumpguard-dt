"""Per-visitor sessions: creation, ticking, eviction.

This is a public URL. Two things follow from that and they are the whole reason
this module exists.

**Isolation.** One visitor injecting cavitation must not appear on anybody
else's screen. Every session owns its own `DataProvider`, which owns its own
`SimulationSession`, which holds every mutable value on the instance -- fault
channels, sensor states, alarm list, RNG. There is no module-level simulation
state anywhere in this codebase, so isolation is structural rather than
something this manager has to police.

**Boundedness.** Browser tabs are closed, not logged out, so an abandoned tab
must expire on its own. Sessions are evicted after `SESSION_IDLE_TIMEOUT_S`
without contact, and the total is capped: when the cap is reached the
least-recently-seen session is evicted to make room. Rejecting the new visitor
instead was considered and rejected -- the demo would appear broken to everyone
arriving after a crawler had filled the table, and an idle session is by
definition the one nobody is watching.

Timekeeping. The tick loop drives simulated time in fixed `dt` steps and never
from wall-clock deltas. A fixed step keeps the physics stable and makes a
session's behaviour reproducible; a session that had been suspended by a slow
host would otherwise jump the integrator forward by whole seconds at once.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass
from typing import Iterator

from ..config.alarm_thresholds import ALARM_STARTUP_INHIBIT_S
from ..contracts import Alarm, DataSource, Telemetry
from ..storage.historian import Historian
from ..storage.replay import ReplayStore
from .providers import DataProvider, build_provider

#: Simulated seconds a new session is advanced before it is handed out, so the
#: first frame a visitor sees is a settled duty point rather than a stopped
#: machine or a mid-ramp transient. Twice the start-up alarm inhibit: past the
#: speed ramp, past the window in which flow and current are legitimately out
#: of limits, and far enough into steady state that the thermal model has
#: stopped moving visibly.
WARM_START_S: float = 2.0 * ALARM_STARTUP_INHIBIT_S


class Session:
    """One visitor's machine: a provider, its clock, and its historian feed."""

    def __init__(
        self,
        session_id: str,
        provider: DataProvider,
        tick_interval_s: float,
        historian: Historian | None = None,
    ) -> None:
        self.id = session_id
        self.provider = provider
        self.tick_interval_s = tick_interval_s
        self.historian = historian
        self.created_at = time.monotonic()
        self.last_seen = self.created_at
        self.tick_count = 0
        #: Simulated seconds spent in RUNNING, which is what an operator means
        #: by operating hours -- not the age of the browser tab.
        self.running_seconds = 0.0

    # -- clock ------------------------------------------------------------

    def touch(self) -> None:
        """Record contact from the visitor. Any request or an open socket counts."""
        self.last_seen = time.monotonic()

    def idle_s(self, now: float | None = None) -> float:
        return (now if now is not None else time.monotonic()) - self.last_seen

    def step(self, dt: float | None = None) -> Telemetry:
        """One tick: advance the provider, then historise the result.

        The historian call is the only I/O on this path and it is a buffered
        append, so a tick stays a few hundred microseconds even at 5 Hz across
        many sessions.
        """
        interval = self.tick_interval_s if dt is None else dt
        telemetry = self.provider.step(interval)
        self.tick_count += 1
        if telemetry.asset_state == "RUNNING":
            self.running_seconds += interval
        if self.historian is not None:
            self.historian.record_tick(self.id, telemetry)
            records = self.provider.alarm_records
            if records:
                self.historian.record_alarms(self.id, records)
        return telemetry

    def advance(self, seconds: float) -> Telemetry:
        """Run forward by `seconds` of simulated time in whole ticks.

        Used by the tests to reach a steady state without sleeping, and by the
        WebSocket to produce a first frame the instant a client connects rather
        than after one tick interval of blank screen.
        """
        frame = self.latest
        steps = max(int(round(seconds / self.tick_interval_s)), 1)
        for _ in range(steps):
            frame = self.step()
        assert frame is not None  # at least one step always ran
        return frame

    # -- queries ----------------------------------------------------------

    @property
    def latest(self) -> Telemetry | None:
        return self.provider.latest

    @property
    def alarms(self) -> list[Alarm]:
        return self.provider.alarms

    @property
    def operating_hours(self) -> float:
        return self.running_seconds / 3600.0

    def close(self) -> None:
        self.provider.close()


@dataclass(frozen=True)
class SessionStats:
    """What `/api/health` reports about the session table."""

    live: int
    capacity: int
    created: int
    evicted_idle: int
    evicted_for_capacity: int


class SessionManager:
    """The session table. Every method is safe to call from any thread.

    A single lock protects the dictionary. It is held only for dictionary work,
    never across a simulation tick, so a slow tick cannot block a new visitor
    from getting a session id.
    """

    def __init__(
        self,
        data_source: DataSource,
        tick_interval_s: float,
        idle_timeout_s: float,
        max_sessions: int,
        historian: Historian | None = None,
        replay_store: ReplayStore | None = None,
    ) -> None:
        self.data_source = data_source
        self.tick_interval_s = tick_interval_s
        self.idle_timeout_s = idle_timeout_s
        self.max_sessions = max_sessions
        self.historian = historian
        self.replay_store = replay_store

        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()
        self._created = 0
        self._evicted_idle = 0
        self._evicted_capacity = 0

    # -- creation and lookup ----------------------------------------------

    def create(self) -> Session:
        """A new session with an opaque id, already running at duty.

        `secrets.token_urlsafe` rather than a counter or a uuid1: the id is the
        only thing standing between one visitor's machine and another's, so it
        must not be guessable from another id.

        The machine is started before the session is handed out. A stopped pump
        is the correct initial state for a plant and the wrong one for a page a
        visitor opens cold: every panel reads zero, and a machine at rest is
        indistinguishable from a site that failed to load. The bundled recording
        was changed for the same reason; leaving the live path stopped would
        have meant the offline fallback looked healthy and connecting to the real
        backend made it worse. Starting is what the visitor would do first
        anyway, and STOP is one click away on the SCADA page.
        """
        session_id = secrets.token_urlsafe(16)
        provider = build_provider(session_id, self.data_source, self.replay_store)
        session = Session(session_id, provider, self.tick_interval_s, self.historian)
        self._warm_start(session)
        with self._lock:
            if len(self._sessions) >= self.max_sessions:
                self._evict_least_recent_locked()
            self._sessions[session_id] = session
            self._created += 1
        return session

    def _warm_start(self, session: Session) -> None:
        """Bring a fresh simulated machine up to a settled duty point.

        Only for SIMULATION. A recorded session is a fixed dataset with its own
        timeline -- advancing it here would silently skip the first twenty
        seconds of somebody's recording -- and the live-device providers do not
        own the machine and must never command it.

        WARM_START_S is past both the speed ramp and the start-up alarm inhibit,
        so the first frame a visitor sees is steady rather than mid-transient
        and carries no start-up alarms. Done outside the lock: it is the only
        slow step in creation, and holding the dictionary lock across it would
        make every new visitor wait for the one before them.
        """
        if self.data_source is not DataSource.SIMULATION:
            return
        outcome = session.provider.command("start")
        if not outcome.accepted:
            # Not fatal: the visitor still gets a session, just a stopped one,
            # and the SCADA page will say why START was refused.
            return
        session.advance(WARM_START_S)

    def get(self, session_id: str | None) -> Session | None:
        if not session_id:
            return None
        with self._lock:
            session = self._sessions.get(session_id)
        if session is not None:
            session.touch()
        return session

    def get_or_create(self, session_id: str | None) -> Session:
        """Resolve an id, or mint one.

        An unknown or expired id yields a *new* session rather than a 404. A
        visitor whose tab was idle over lunch should find a working machine when
        they come back, not an error dialog explaining session lifetimes.
        """
        return self.get(session_id) or self.create()

    # -- eviction ----------------------------------------------------------

    def evict_idle(self) -> list[str]:
        """Drop every session past the idle timeout. Returns the ids dropped."""
        now = time.monotonic()
        with self._lock:
            stale = [sid for sid, session in self._sessions.items() if session.idle_s(now) > self.idle_timeout_s]
            for session_id in stale:
                self._remove_locked(session_id)
            self._evicted_idle += len(stale)
        return stale

    def _evict_least_recent_locked(self) -> str | None:
        if not self._sessions:
            return None
        session_id = min(self._sessions, key=lambda sid: self._sessions[sid].last_seen)
        self._remove_locked(session_id)
        self._evicted_capacity += 1
        return session_id

    def _remove_locked(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return
        session.close()
        if self.historian is not None:
            # The id is the only key into this session's rows, so once it is
            # gone the rows are unreachable and are pure disk cost.
            self.historian.purge_session(session_id)

    def remove(self, session_id: str) -> None:
        with self._lock:
            self._remove_locked(session_id)

    # -- the tick ----------------------------------------------------------

    def tick_all(self) -> int:
        """Advance every live session by one tick. Returns how many ticked.

        Ticks are taken outside the lock, on a snapshot of the session list: a
        session evicted mid-sweep simply ticks one last time into a historian
        buffer that is then discarded, which is harmless.
        """
        for session in self.snapshot():
            session.step()
        return len(self._sessions)

    def snapshot(self) -> list[Session]:
        with self._lock:
            return list(self._sessions.values())

    # -- introspection -----------------------------------------------------

    def stats(self) -> SessionStats:
        with self._lock:
            return SessionStats(
                live=len(self._sessions),
                capacity=self.max_sessions,
                created=self._created,
                evicted_idle=self._evicted_idle,
                evicted_for_capacity=self._evicted_capacity,
            )

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

    def __iter__(self) -> Iterator[Session]:
        return iter(self.snapshot())

    def close(self) -> None:
        with self._lock:
            for session_id in list(self._sessions):
                session = self._sessions.pop(session_id)
                session.close()


__all__ = ["Session", "SessionManager", "SessionStats"]
