"""Recorded runs: freeze a fault as it happened, then replay it.

Why this exists at all. A live simulation is the right thing to show most of
the time, but it is a poor way to show a *specific* event: a cavitation
inception takes ninety seconds to develop and a visitor will not wait, and two
visitors watching the same fault see slightly different noise. A recorded run
is a fixed sequence of frames -- the same event, every time, seekable -- which
is what a demo, a regression test and a briefing all actually want.

It is also the honest way to demonstrate the `RECORDED` data source: the frames
really were produced by the simulator and stored, and nothing is regenerated on
playback. `data_source` on every replayed frame stays whatever it was when the
frame was recorded, so the UI's provenance banner cannot be fooled by a replay.

Storage is two tables next to the historian's own (see `historian._SCHEMA`):
`recorded_runs` for the header and `recorded_frames` for the frames. Capturing a
run is a copy from `telemetry_ticks` into `recorded_frames` -- so a run is
exactly what was historised, not a re-simulation of it.

Playback is a cursor, not a thread. `advance(dt)` moves a position along the
recorded timeline and returns the frame at that position; play, pause, seek and
speed are all just arithmetic on that position. Nothing here sleeps, nothing
here owns a task, and a paused cursor costs nothing.
"""

from __future__ import annotations

import json
import uuid
from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .historian import Historian


@dataclass
class RecordedRun:
    """A completed run: a header plus its frames, oldest first."""

    run_id: str
    label: str
    fault: str
    severity: float
    created_at: str
    frames: list[dict[str, Any]] = field(default_factory=list)

    @property
    def frame_count(self) -> int:
        return len(self.frames)

    @property
    def duration_s(self) -> float:
        if not self.frames:
            return 0.0
        return float(self.frames[-1].get("elapsed_s", 0.0)) - float(self.frames[0].get("elapsed_s", 0.0))

    def header(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "label": self.label,
            "fault": self.fault,
            "severity": self.severity,
            "created_at": self.created_at,
            "frame_count": self.frame_count,
            "duration_s": round(self.duration_s, 3),
        }


class ReplayStore:
    """Reads and writes recorded runs on the historian's connection."""

    def __init__(self, historian: Historian) -> None:
        self._historian = historian

    # -- writing ----------------------------------------------------------

    def save(self, run: RecordedRun) -> RecordedRun:
        """Persist a run and its frames in one transaction."""
        connection = self._historian.connection
        with self._historian.lock:
            connection.execute(
                "INSERT OR REPLACE INTO recorded_runs "
                "(run_id, label, fault, severity, created_at, frame_count, duration_s) "
                "VALUES (?,?,?,?,?,?,?)",
                (
                    run.run_id,
                    run.label,
                    run.fault,
                    float(run.severity),
                    run.created_at,
                    run.frame_count,
                    run.duration_s,
                ),
            )
            connection.execute("DELETE FROM recorded_frames WHERE run_id = ?", (run.run_id,))
            connection.executemany(
                "INSERT INTO recorded_frames (run_id, seq, elapsed_s, payload) VALUES (?,?,?,?)",
                [
                    (
                        run.run_id,
                        index,
                        float(frame.get("elapsed_s", index)),
                        json.dumps(frame, separators=(",", ":")),
                    )
                    for index, frame in enumerate(run.frames)
                ],
            )
            connection.commit()
        return run

    def capture(
        self,
        session_id: str,
        label: str,
        fault: str = "",
        severity: float = 0.0,
    ) -> RecordedRun:
        """Freeze everything the historian still holds for a session.

        The run is capped by whatever retention has already left in place; a
        run captured after the per-session cap has bitten is the last hour, not
        the whole day, and its `duration_s` says so.
        """
        frames = self._historian.frames(session_id)
        if not fault and frames:
            # Label the run with the condition that dominated it, taken from
            # the frames themselves rather than from a caller's claim.
            worst = max(frames, key=lambda frame: float(frame.get("severity", 0.0)))
            fault = str(worst.get("fault_state", "normal"))
            severity = float(worst.get("severity", 0.0))
        run = RecordedRun(
            run_id=uuid.uuid4().hex[:12],
            label=label,
            fault=fault or "normal",
            severity=severity,
            created_at=datetime.now(timezone.utc).isoformat(),
            frames=frames,
        )
        return self.save(run)

    # -- reading ----------------------------------------------------------

    def list_runs(self) -> list[dict[str, Any]]:
        with self._historian.lock:
            rows = self._historian.connection.execute(
                "SELECT run_id, label, fault, severity, created_at, frame_count, duration_s "
                "  FROM recorded_runs ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def load(self, run_id: str) -> RecordedRun | None:
        with self._historian.lock:
            header = self._historian.connection.execute(
                "SELECT run_id, label, fault, severity, created_at FROM recorded_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if header is None:
                return None
            rows = self._historian.connection.execute(
                "SELECT payload FROM recorded_frames WHERE run_id = ? ORDER BY seq ASC", (run_id,)
            ).fetchall()
        return RecordedRun(
            run_id=header["run_id"],
            label=header["label"],
            fault=header["fault"],
            severity=float(header["severity"]),
            created_at=header["created_at"],
            frames=[json.loads(row["payload"]) for row in rows],
        )

    def latest(self) -> RecordedRun | None:
        """The most recently stored run, which is what `DATA_SOURCE=RECORDED` serves."""
        with self._historian.lock:
            row = self._historian.connection.execute(
                "SELECT run_id FROM recorded_runs ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
        return self.load(row["run_id"]) if row else None


class ReplayCursor:
    """A position on a recorded timeline, with transport controls.

    Time is the run's own `elapsed_s`, so seeking to 45 s means the frame the
    simulator produced 45 s into the run whatever rate it is being replayed at.
    """

    #: Bounds on the transport speed. Below 0.1x nothing appears to move; above
    #: 8x the frames go past faster than the browser paints and it is a waste
    #: of bandwidth rather than a faster demo.
    MIN_SPEED = 0.1
    MAX_SPEED = 8.0

    def __init__(self, run: RecordedRun, loop: bool = True) -> None:
        if not run.frames:
            raise ValueError(f"recorded run {run.run_id!r} has no frames to replay")
        self.run = run
        self.loop = loop
        self.playing = True
        self.speed = 1.0
        self._start_s = float(run.frames[0].get("elapsed_s", 0.0))
        self._times = [float(frame.get("elapsed_s", index)) - self._start_s for index, frame in enumerate(run.frames)]
        self.position_s = 0.0

    # -- transport --------------------------------------------------------

    def play(self) -> None:
        self.playing = True

    def pause(self) -> None:
        self.playing = False

    def seek(self, seconds: float) -> float:
        """Jump to a position, clamped to the run. Returns where it landed."""
        self.position_s = min(max(float(seconds), 0.0), self.duration_s)
        return self.position_s

    def set_speed(self, speed: float) -> float:
        self.speed = min(max(float(speed), self.MIN_SPEED), self.MAX_SPEED)
        return self.speed

    # -- playback ---------------------------------------------------------

    def advance(self, dt: float) -> dict[str, Any]:
        """Move by `dt` of wall time and return the frame now under the cursor.

        A paused cursor still returns its current frame: the UI must keep
        showing the frame it is paused on, not go blank.
        """
        if self.playing and dt > 0.0:
            self.position_s += float(dt) * self.speed
            if self.position_s > self.duration_s:
                if self.loop:
                    span = self.duration_s
                    self.position_s = self.position_s % span if span > 0.0 else 0.0
                else:
                    self.position_s = self.duration_s
                    self.playing = False
        return self.frame()

    def frame(self) -> dict[str, Any]:
        """The last frame at or before the cursor."""
        index = max(bisect_right(self._times, self.position_s) - 1, 0)
        return self.run.frames[index]

    # -- queries ----------------------------------------------------------

    @property
    def duration_s(self) -> float:
        return self._times[-1] if self._times else 0.0

    def transport(self) -> dict[str, Any]:
        return {
            "run_id": self.run.run_id,
            "label": self.run.label,
            "fault": self.run.fault,
            "playing": self.playing,
            "speed": self.speed,
            "position_s": round(self.position_s, 3),
            "duration_s": round(self.duration_s, 3),
            "frame_count": self.run.frame_count,
            "looping": self.loop,
        }


__all__ = ["RecordedRun", "ReplayCursor", "ReplayStore"]
