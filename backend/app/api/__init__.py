"""The HTTP and WebSocket layer.

    providers.py   where a frame comes from (simulation, recording, or a device)
    sessions.py    one machine per visitor, created, ticked and evicted
    routes.py      the REST surface the React client is coded against
    websocket.py   /ws/realtime, a reader of the tick loop

Dependencies run one way: `routes` and `websocket` depend on `sessions`, which
depends on `providers`, which depends on `simulation` and `storage`. Nothing
below this package imports anything from it, so the whole API layer can be
replaced without touching the physics, the signal processing or the model.
"""

from __future__ import annotations

from .providers import (
    CommandOutcome,
    DataProvider,
    ProviderStatus,
    RecordedDataProvider,
    SimulationDataProvider,
    build_provider,
    record_reference_run,
)
from .sessions import Session, SessionManager

__all__ = [
    "CommandOutcome",
    "DataProvider",
    "ProviderStatus",
    "RecordedDataProvider",
    "Session",
    "SessionManager",
    "SimulationDataProvider",
    "build_provider",
    "record_reference_run",
]
