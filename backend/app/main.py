"""The ASGI application. `uvicorn app.main:app` -- this is what the Dockerfile runs.

Startup does four things and none of them is expensive:

  1. read the environment once into `Settings`;
  2. open the historian (SQLite, created on first use);
  3. **load** the ML artefacts -- load, never train. Training is a build step in
     the Dockerfile. Fitting a forest on boot would add tens of seconds to every
     cold start and, worse, each instance would fit its own, so two replicas
     would disagree about the same input;
  4. start one background task that ticks every live session.

If step 3 finds nothing, the service starts anyway and `/api/health` reports
`ml_model: false`. That is a deliberate product decision: a condition-monitoring
backend that refuses to boot because a model file is missing is strictly worse
than one that boots, says so, and keeps serving measurements and physics-based
diagnosis.

One tick loop for the whole process, not one per socket. Sessions are ticked in
a single pass so a session with three browser tabs on it advances once per
interval, not three times. The loop is scheduled on a monotonic deadline rather
than `sleep(interval)` after the work, so a slow tick does not make the whole
stream drift late; if the process falls far behind, it drops the missed ticks
instead of trying to catch up in a burst, which would step the physics several
times in one instant.

CORS comes from `BACKEND_CORS_ORIGINS` and is a list of exact origins. Never
`*`: the browser refuses a wildcard on any credentialed request, and a wildcard
would also let an arbitrary site drive this API from a visitor's machine.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import routes, websocket
from .api.providers import record_reference_run
from .api.sessions import SessionManager
from .contracts import DataSource
from .settings import SERVICE_NAME, SERVICE_VERSION, get_settings
from .storage.historian import open_historian
from .storage.replay import ReplayStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("pumpguard")

#: How often the housekeeping pass runs: idle-session eviction, historian flush
#: and retention. Every 30 s is far more often than the 900 s idle timeout needs
#: and far less often than it would cost anything.
HOUSEKEEPING_INTERVAL_S = 30.0


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Wire everything up, run, then shut down without losing buffered data."""
    settings = get_settings()
    app.state.settings = settings
    app.state.websocket_connections = 0
    app.state.ticker_running = False

    historian = open_historian(settings.sqlite_path)
    replay_store = ReplayStore(historian)
    app.state.historian = historian
    app.state.replay_store = replay_store

    gateway = routes.MLGateway(settings.model_dir)
    gateway.load()
    app.state.ml = gateway
    logger.info("ml artefacts: %s", "loaded" if gateway.available else f"absent ({gateway.error})")

    if settings.data_source is DataSource.RECORDED and replay_store.latest() is None:
        # RECORDED with an empty store would have nothing to serve. Producing
        # the run here keeps the mode honest: these frames really are recorded
        # simulator output, stored before anybody reads them back.
        logger.info("no recorded run stored; capturing a reference run")
        run = record_reference_run(replay_store)
        logger.info("recorded run %s: %d frames", run.run_id, run.frame_count)

    app.state.sessions = SessionManager(
        data_source=settings.data_source,
        tick_interval_s=settings.tick_interval_s,
        idle_timeout_s=settings.session_idle_timeout_s,
        max_sessions=settings.max_sessions,
        single_instance=settings.single_instance_sessions,
        historian=historian,
        replay_store=replay_store,
    )

    ticker = asyncio.create_task(_tick_loop(app), name="simulation-ticker")
    housekeeper = asyncio.create_task(_housekeeping_loop(app), name="housekeeping")
    logger.info(
        "%s %s up: %s at %.1f Hz, %d origins allowed",
        SERVICE_NAME,
        SERVICE_VERSION,
        settings.data_source.value,
        settings.telemetry_rate_hz,
        len(settings.cors_origins),
    )

    try:
        yield
    finally:
        for task in (ticker, housekeeper):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        app.state.ticker_running = False
        app.state.sessions.close()
        # Flush before closing: the last few seconds of a run are the ones
        # somebody was watching when they hit Ctrl-C.
        historian.close()
        logger.info("shutdown complete")


async def _tick_loop(app: FastAPI) -> None:
    """Advance every live session once per interval, forever.

    Scheduled against a monotonic deadline. If a pass overruns -- a hundred
    sessions on a cold free-tier instance -- the missed ticks are dropped rather
    than replayed back to back, because stepping the physics five times inside
    one millisecond is not a recovery, it is a different simulation.
    """
    settings = app.state.settings
    manager: SessionManager = app.state.sessions
    interval = settings.tick_interval_s
    app.state.ticker_running = True
    deadline = time.monotonic()

    while True:
        deadline += interval
        delay = deadline - time.monotonic()
        if delay < 0:
            deadline = time.monotonic()
            delay = 0.0
        await asyncio.sleep(delay)
        try:
            manager.tick_all()
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - one bad session must not stop the loop
            logger.exception("simulation tick failed")


async def _housekeeping_loop(app: FastAPI) -> None:
    """Evict idle sessions, flush the write buffer, and enforce retention."""
    settings = app.state.settings
    manager: SessionManager = app.state.sessions
    historian = app.state.historian

    while True:
        await asyncio.sleep(HOUSEKEEPING_INTERVAL_S)
        try:
            evicted = manager.evict_idle()
            if evicted:
                logger.info("evicted %d idle session(s)", len(evicted))
            historian.flush()
            removed = historian.prune(
                settings.history_max_ticks_per_session, settings.history_max_ticks_total
            )
            if removed:
                logger.info("retention pruned %d tick row(s)", removed)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover
            logger.exception("housekeeping pass failed")


def create_app() -> FastAPI:
    """Build the application. A function, so tests can build an isolated one."""
    settings = get_settings()
    app = FastAPI(
        title="PumpGuard DT API",
        version=SERVICE_VERSION,
        description=(
            "Digital twin of a centrifugal pump: physics-based simulation, vibration "
            "signal processing, alarm and interlock logic, and ML fault diagnosis. "
            "All process data is SIMULATED unless data_source says otherwise."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Session-Id"],
        expose_headers=["X-Session-Id"],
    )

    app.include_router(routes.router)
    app.include_router(websocket.router)
    return app


app = create_app()


@app.get("/")
def root() -> dict[str, str]:
    """A pointer, not a landing page: the UI is a separate static deployment."""
    return {
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "docs": "/docs",
        "health": "/api/health",
        "realtime": "/ws/realtime",
    }


__all__ = ["app", "create_app"]
