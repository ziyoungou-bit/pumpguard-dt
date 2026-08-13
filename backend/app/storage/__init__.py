"""Persistence: the historian and the replay store, both on one SQLite file.

    historian.py   every telemetry tick and alarm event, as a rolling window
    replay.py      a completed fault run, frozen and replayable

They share a connection because they share a database file and because a
recorded run is *made out of* historian rows -- capturing a run is a copy from
one table to another inside a single transaction, not an export and re-import.

Nothing above this package knows it is SQLite. The API layer holds a
`Historian` and asks it for a window; swapping the engine changes this package
and nothing else.
"""

from __future__ import annotations

from .historian import (
    HISTORY_WINDOWS,
    Historian,
    SIGNAL_UNITS,
    open_historian,
)
from .replay import RecordedRun, ReplayCursor, ReplayStore

__all__ = [
    "HISTORY_WINDOWS",
    "SIGNAL_UNITS",
    "Historian",
    "RecordedRun",
    "ReplayCursor",
    "ReplayStore",
    "open_historian",
]
