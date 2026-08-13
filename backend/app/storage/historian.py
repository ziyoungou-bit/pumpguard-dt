"""The process historian: telemetry ticks and alarm events, on a rolling window.

Shape of the store
------------------
One row per tick, carrying the whole frame as a JSON document, plus the three
columns anything is ever queried by (session, elapsed time, wall clock).

The alternative -- a row per field, the "tag/value/timestamp" EAV shape that
looks like a real historian -- was rejected. At 5 Hz with forty fields it is two
hundred inserts a second per visitor to answer a question ("give me flow for the
last five minutes") that a single JSON row answers with one read. A wide table
with one column per field was also rejected: it duplicates `contracts.Telemetry`
in DDL, so adding a field to the contract silently stops being recorded until
somebody remembers to write a migration. The JSON document cannot drift from the
contract, because it *is* the contract.

Writes are batched. Ticks accumulate in memory and go to disk in one
`executemany` inside one transaction, so a 5 Hz stream costs one commit every
few seconds rather than five a second. A crash loses at most one buffer of
demonstration data, which is the right trade for a demo and is stated here
rather than discovered.

Alarms are written as *events*, not as state samples: a row is written when an
alarm appears, escalates or clears, so a fault standing for ten minutes is a
handful of rows and not thirty thousand.

Retention
---------
This runs on a public URL with an ephemeral 1 GB disk, so the store is capped in
rows, not in days: `history_max_ticks_per_session` bounds one abusive tab and
`history_max_ticks_total` bounds the whole file. Pruning is oldest-first and
happens on flush, so the file reaches a steady size and stays there. A demo that
fills its own disk on day four is worse than one that only remembers the last
hour and says so.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass, fields as dataclass_fields
from pathlib import Path
from typing import Any, Iterable

from ..contracts import Alarm, Telemetry

#: Windows the UI offers, in seconds. `run` is "everything retained".
HISTORY_WINDOWS: dict[str, float | None] = {
    "1m": 60.0,
    "5m": 300.0,
    "15m": 900.0,
    "run": None,
    "all": None,
}

#: Unit for every signal the trend page can plot. Derived from the field names
#: in `contracts.Telemetry`, which carry their unit -- so this table cannot
#: disagree with the wire format about what a number means.
SIGNAL_UNITS: dict[str, str] = {
    "rpm": "rpm",
    "flow_lpm": "L/min",
    "pump_head_m": "m",
    "suction_pressure_kpa": "kPa",
    "discharge_pressure_kpa": "kPa",
    "differential_pressure_kpa": "kPa",
    "motor_current_a": "A",
    "motor_temperature_c": "C",
    "bearing_temperature_c": "C",
    "vibration_x_mm_s": "mm/s",
    "vibration_y_mm_s": "mm/s",
    "vibration_z_mm_s": "mm/s",
    "vibration_rms_mm_s": "mm/s",
    "vibration_peak_mm_s": "mm/s",
    "crest_factor": "",
    "amplitude_1x_mm_s": "mm/s",
    "amplitude_2x_mm_s": "mm/s",
    "high_frequency_energy": "mm/s",
    "dominant_frequency_hz": "Hz",
    "rotational_frequency_hz": "Hz",
    "pump_efficiency": "fraction",
    "hydraulic_power_w": "W",
    "shaft_power_w": "W",
    "electrical_power_w": "W",
    "health_index": "index",
    "anomaly_score": "score",
    "severity": "fraction",
    "npsh_margin_m": "m",
    "elapsed_s": "s",
}

#: Points returned for one window. A 15-minute window at 5 Hz holds 4 500 ticks
#: and no chart can draw that many; decimating here keeps the payload small
#: without pretending to a resolution the screen does not have.
MAX_HISTORY_POINTS = 600

#: Ticks buffered before a flush is forced. 50 ticks is ten seconds at 5 Hz.
FLUSH_EVERY_TICKS = 50


_SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry_ticks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    elapsed_s   REAL    NOT NULL,
    timestamp   TEXT    NOT NULL,
    payload     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ticks_session_elapsed
    ON telemetry_ticks (session_id, elapsed_s);

CREATE TABLE IF NOT EXISTS alarm_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    alarm_id    INTEGER NOT NULL,
    timestamp   TEXT    NOT NULL,
    tag         TEXT    NOT NULL,
    description TEXT    NOT NULL,
    severity    TEXT    NOT NULL,
    value       REAL    NOT NULL,
    threshold   REAL    NOT NULL,
    unit        TEXT    NOT NULL,
    state       TEXT    NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_alarms_session
    ON alarm_events (session_id, id);

CREATE TABLE IF NOT EXISTS recorded_runs (
    run_id      TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    fault       TEXT NOT NULL,
    severity    REAL NOT NULL,
    created_at  TEXT NOT NULL,
    frame_count INTEGER NOT NULL,
    duration_s  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS recorded_frames (
    run_id   TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    elapsed_s REAL NOT NULL,
    payload  TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
);
"""

_TELEMETRY_FIELDS = {field.name for field in dataclass_fields(Telemetry)}


@dataclass(frozen=True)
class HistoryWindow:
    """The answer to `/api/history`, in the frontend's `HistoryResponse` shape."""

    signal: str
    window: str
    unit: str
    points: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "signal": self.signal,
            "window": self.window,
            "unit": self.unit,
            "points": self.points,
        }


class Historian:
    """Batched writer and windowed reader over one SQLite file.

    One instance per process. It is used from the event loop and from
    FastAPI's thread pool, so every statement is taken under a lock and the
    connection is opened with `check_same_thread=False` -- SQLite serialises
    writers anyway, and the lock makes the buffer handling atomic too.
    """

    def __init__(self, database: str | Path) -> None:
        self.database = str(database)
        if self.database != ":memory:":
            Path(self.database).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.database, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        # WAL lets the reader that serves /api/history run while the tick
        # buffer is being flushed, instead of blocking on the writer.
        if self.database != ":memory:":
            self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA synchronous=NORMAL")
        self._connection.executescript(_SCHEMA)
        self._connection.commit()

        self._tick_buffer: list[tuple[str, float, str, str]] = []
        #: Last (severity, state, acknowledged) written per (session, alarm id),
        #: so an unchanged alarm is not rewritten on every tick.
        self._alarm_state: dict[tuple[str, int], tuple[str, str, bool]] = {}
        self._writes_since_prune = 0

    # -- lifecycle --------------------------------------------------------

    @property
    def connection(self) -> sqlite3.Connection:
        """The shared connection, for `replay.py`. Take `lock` around any use."""
        return self._connection

    @property
    def lock(self) -> threading.RLock:
        return self._lock

    def close(self) -> None:
        with self._lock:
            self._flush_locked()
            self._connection.close()

    # -- writing ----------------------------------------------------------

    def record_tick(self, session_id: str, telemetry: Telemetry) -> None:
        """Buffer one frame. Cheap: a JSON dump and a list append."""
        with self._lock:
            self._tick_buffer.append(
                (
                    session_id,
                    float(telemetry.elapsed_s),
                    telemetry.timestamp,
                    json.dumps(telemetry.to_dict(), separators=(",", ":")),
                )
            )
            if len(self._tick_buffer) >= FLUSH_EVERY_TICKS:
                self._flush_locked()

    def record_alarms(self, session_id: str, alarms: Iterable[Alarm]) -> int:
        """Write a row for every alarm that appeared, escalated, cleared or was acknowledged.

        Returns the number of rows written, which is zero on the overwhelming
        majority of ticks. This is what keeps the alarm table an event log
        rather than a second copy of the telemetry stream.
        """
        rows = []
        with self._lock:
            for alarm in alarms:
                key = (session_id, alarm.id)
                signature = (alarm.severity, alarm.state, alarm.acknowledged)
                if self._alarm_state.get(key) == signature:
                    continue
                self._alarm_state[key] = signature
                rows.append(
                    (
                        session_id,
                        alarm.id,
                        alarm.timestamp,
                        alarm.tag,
                        alarm.description,
                        alarm.severity,
                        float(alarm.value),
                        float(alarm.threshold),
                        alarm.unit,
                        alarm.state,
                        int(alarm.acknowledged),
                    )
                )
            if rows:
                self._connection.executemany(
                    "INSERT INTO alarm_events "
                    "(session_id, alarm_id, timestamp, tag, description, severity, value, "
                    " threshold, unit, state, acknowledged) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    rows,
                )
                self._connection.commit()
        return len(rows)

    def flush(self) -> int:
        """Force the buffer to disk. Returns the number of rows written."""
        with self._lock:
            return self._flush_locked()

    def _flush_locked(self) -> int:
        if not self._tick_buffer:
            return 0
        rows = self._tick_buffer
        self._tick_buffer = []
        self._connection.executemany(
            "INSERT INTO telemetry_ticks (session_id, elapsed_s, timestamp, payload) "
            "VALUES (?,?,?,?)",
            rows,
        )
        self._connection.commit()
        self._writes_since_prune += len(rows)
        return len(rows)

    # -- retention --------------------------------------------------------

    def prune(self, max_per_session: int, max_total: int) -> int:
        """Drop the oldest ticks beyond the caps. Returns rows deleted.

        Per-session first, then global. The per-session cap is what stops one
        tab that has been open all day from evicting everybody else's history;
        the global cap is what stops the disk filling.
        """
        with self._lock:
            self._flush_locked()
            deleted = self._connection.execute(
                """
                DELETE FROM telemetry_ticks
                 WHERE id IN (
                    SELECT id FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (
                                   PARTITION BY session_id ORDER BY id DESC
                               ) AS position
                          FROM telemetry_ticks
                    ) WHERE position > ?
                 )
                """,
                (max_per_session,),
            ).rowcount
            deleted += self._connection.execute(
                """
                DELETE FROM telemetry_ticks
                 WHERE id <= (
                    SELECT COALESCE(MAX(id), 0) FROM (
                        SELECT id FROM telemetry_ticks ORDER BY id DESC LIMIT 1 OFFSET ?
                    )
                 )
                """,
                (max_total,),
            ).rowcount
            self._connection.commit()
            self._writes_since_prune = 0
            return max(deleted, 0)

    def purge_session(self, session_id: str) -> None:
        """Forget one session entirely, called when it is evicted.

        Its rows can no longer be reached through the API -- the session id is
        the only key -- so keeping them would be pure disk cost. A run that was
        worth keeping has already been copied into `recorded_runs`.
        """
        with self._lock:
            self._flush_locked()
            self._connection.execute("DELETE FROM telemetry_ticks WHERE session_id = ?", (session_id,))
            self._connection.execute("DELETE FROM alarm_events WHERE session_id = ?", (session_id,))
            self._connection.commit()
            for key in [k for k in self._alarm_state if k[0] == session_id]:
                del self._alarm_state[key]

    # -- reading ----------------------------------------------------------

    def history(self, session_id: str, signal: str, window: str) -> HistoryWindow:
        """One signal over one window, decimated to `MAX_HISTORY_POINTS`.

        Raises KeyError for an unknown signal or window so the route can turn
        it into a 422. Returning an empty series for a misspelt signal would
        look exactly like "the machine has not run yet", which is the kind of
        ambiguity that costs an afternoon.
        """
        if signal not in SIGNAL_UNITS or signal not in _TELEMETRY_FIELDS:
            raise KeyError(f"unknown signal {signal!r}")
        if window not in HISTORY_WINDOWS:
            raise KeyError(f"unknown window {window!r}")

        span_s = HISTORY_WINDOWS[window]
        with self._lock:
            self._flush_locked()
            latest = self._connection.execute(
                "SELECT MAX(elapsed_s) AS latest FROM telemetry_ticks WHERE session_id = ?",
                (session_id,),
            ).fetchone()["latest"]
            if latest is None:
                return HistoryWindow(signal, window, SIGNAL_UNITS[signal], [])
            floor = -1.0 if span_s is None else float(latest) - span_s
            rows = self._connection.execute(
                "SELECT elapsed_s, timestamp, payload FROM telemetry_ticks "
                " WHERE session_id = ? AND elapsed_s >= ? ORDER BY id ASC",
                (session_id, floor),
            ).fetchall()

        points = [
            {
                "elapsed_s": round(float(row["elapsed_s"]), 3),
                "timestamp": row["timestamp"],
                "value": float(json.loads(row["payload"]).get(signal, 0.0)),
            }
            for row in _decimate(rows, MAX_HISTORY_POINTS)
        ]
        return HistoryWindow(signal, window, SIGNAL_UNITS[signal], points)

    def alarm_events(self, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        """The alarm event log for one session, newest first."""
        with self._lock:
            rows = self._connection.execute(
                "SELECT alarm_id, timestamp, tag, description, severity, value, threshold, "
                "       unit, state, acknowledged "
                "  FROM alarm_events WHERE session_id = ? ORDER BY id DESC LIMIT ?",
                (session_id, int(limit)),
            ).fetchall()
        return [
            {
                "id": row["alarm_id"],
                "timestamp": row["timestamp"],
                "tag": row["tag"],
                "description": row["description"],
                "severity": row["severity"],
                "value": row["value"],
                "threshold": row["threshold"],
                "unit": row["unit"],
                "state": row["state"],
                "acknowledged": bool(row["acknowledged"]),
            }
            for row in rows
        ]

    def tick_count(self, session_id: str | None = None) -> int:
        """Rows currently retained, for the health endpoint and the tests."""
        with self._lock:
            self._flush_locked()
            if session_id is None:
                row = self._connection.execute("SELECT COUNT(*) AS n FROM telemetry_ticks").fetchone()
            else:
                row = self._connection.execute(
                    "SELECT COUNT(*) AS n FROM telemetry_ticks WHERE session_id = ?", (session_id,)
                ).fetchone()
        return int(row["n"])

    def frames(self, session_id: str, limit: int | None = None) -> list[dict[str, Any]]:
        """Every retained frame for a session, oldest first. Used to capture a run."""
        with self._lock:
            self._flush_locked()
            sql = (
                "SELECT payload FROM telemetry_ticks WHERE session_id = ? ORDER BY id ASC"
            )
            parameters: tuple[Any, ...] = (session_id,)
            if limit is not None:
                sql += " LIMIT ?"
                parameters = (session_id, int(limit))
            rows = self._connection.execute(sql, parameters).fetchall()
        return [json.loads(row["payload"]) for row in rows]


def _decimate(rows: list[sqlite3.Row], limit: int) -> list[sqlite3.Row]:
    """Even decimation that always keeps the newest sample.

    The newest sample matters more than an even spacing: a trend whose right
    edge is up to a second stale looks like the stream has stalled.
    """
    if len(rows) <= limit:
        return rows
    step = len(rows) / float(limit)
    picked = [rows[min(int(index * step), len(rows) - 1)] for index in range(limit)]
    if picked[-1] is not rows[-1]:
        picked[-1] = rows[-1]
    return picked


def open_historian(database: str | Path) -> Historian:
    """Factory, so callers never import sqlite3 themselves."""
    return Historian(database)


__all__ = [
    "FLUSH_EVERY_TICKS",
    "HISTORY_WINDOWS",
    "MAX_HISTORY_POINTS",
    "SIGNAL_UNITS",
    "Historian",
    "HistoryWindow",
    "open_historian",
]
