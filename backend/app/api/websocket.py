"""`/ws/realtime`: the telemetry stream.

What this endpoint does *not* do is the important part: it does not run the
simulation. One background task in `main.py` ticks every live session, and each
socket is a reader of its session's most recent frame. The alternative --
stepping the simulator inside the send loop -- looks simpler and is wrong: two
browser tabs on the same session would advance one machine at twice the rate,
and their frames would interleave into two inconsistent halves of one run.

Rates are independent by design. The socket pushes at `TELEMETRY_RATE_HZ`
(5 Hz by default) because that is what a browser can paint and a human can
read. The vibration waveform behind `/api/vibration` is sampled at 5120 Hz and
generated on demand. Neither rate constrains the other, exactly as on real
acquisition hardware where the analyser samples continuously and reports
occasionally.

Disconnects. A browser tab is closed, not logged out, so the disconnect path is
the *normal* path and has to be free of leaks:

  * one receiver task per connection, cancelled in `finally` -- so a dropped
    client cannot leave a coroutine parked on `receive()` forever;
  * every send is guarded, because a client can vanish between the check and
    the write and a half-open socket does not fail until it is written to;
  * the session is *not* destroyed when the socket closes. The visitor may just
    be reloading the page, and their machine should still be there. Idle
    eviction in `sessions.py` is what eventually reclaims it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..contracts import SCHEMA_VERSION
from .sessions import Session, SessionManager

logger = logging.getLogger(__name__)

router = APIRouter()

#: Errors that all mean "the client is gone". Caught by class rather than by
#: message because the exact exception depends on which websocket library
#: uvicorn is running (websockets vs wsproto) and on how the peer went away.
_DISCONNECTED = (WebSocketDisconnect, ConnectionError, RuntimeError, asyncio.CancelledError)


@router.websocket("/ws/realtime")
async def realtime(websocket: WebSocket, session_id: str | None = Query(default=None)) -> None:
    """Stream `contracts.Telemetry` as JSON at the configured rate.

    The session id is a query parameter because the browser's WebSocket API
    cannot set request headers. An absent or expired id gets a fresh session
    rather than a refusal, so the socket a reconnecting tab opens always works.
    """
    manager: SessionManager = websocket.app.state.sessions
    interval = 1.0 / websocket.app.state.settings.telemetry_rate_hz

    await websocket.accept()
    session = manager.get_or_create(session_id)

    # Tell the client which session it actually landed on. Without this a client
    # that reconnected with a stale id would silently be watching a different
    # machine from the one its REST calls are driving.
    if not await _send(websocket, {
        "type": "session",
        "session_id": session.id,
        "data_source": session.provider.data_source.value,
        "telemetry_rate_hz": websocket.app.state.settings.telemetry_rate_hz,
        "schema_version": SCHEMA_VERSION,
    }):
        return

    websocket.app.state.websocket_connections += 1
    reader = asyncio.create_task(_drain(websocket))
    try:
        await _stream(websocket, session, interval, reader)
    except _DISCONNECTED:
        pass
    except Exception:  # pragma: no cover - defensive; one bad socket must not
        logger.exception("realtime socket failed for session %s", session.id)
    finally:
        reader.cancel()
        with contextlib.suppress(BaseException):
            await reader
        websocket.app.state.websocket_connections -= 1
        with contextlib.suppress(BaseException):
            if websocket.client_state is not WebSocketState.DISCONNECTED:
                await websocket.close()


async def _stream(websocket: WebSocket, session: Session, interval: float, reader: asyncio.Task) -> None:
    """Push the session's latest frame until either side goes away.

    The first frame is sent immediately, ticking the session once if it has
    never run, so a connecting client sees data now instead of after a full
    interval of blank chart.
    """
    frame = session.latest or session.step()
    if not await _send(websocket, frame.to_dict()):
        return

    last_elapsed = frame.elapsed_s
    while True:
        await asyncio.sleep(interval)
        if reader.done():
            # The reader only finishes when the peer closed or errored.
            return
        session.touch()  # an open socket is contact; do not evict this session

        frame = session.latest
        if frame is None or frame.elapsed_s == last_elapsed:
            # No background tick has landed since the last push. Either the
            # ticker is not running or it is slower than this socket; step here
            # so the client is never starved. Stepping is idempotent in effect:
            # the ticker and this path advance the same single session object.
            frame = session.step()
        last_elapsed = frame.elapsed_s

        if not await _send(websocket, frame.to_dict()):
            return


async def _send(websocket: WebSocket, payload: dict[str, Any]) -> bool:
    """Send one JSON message. False means the client is gone; never raises."""
    if websocket.client_state is not WebSocketState.CONNECTED:
        return False
    try:
        await websocket.send_json(payload)
        return True
    except _DISCONNECTED:
        return False
    except Exception:  # pragma: no cover - unexpected transport failure
        logger.debug("dropping realtime client after a send failure", exc_info=True)
        return False


async def _drain(websocket: WebSocket) -> None:
    """Consume anything the client sends, and finish when it disconnects.

    Two jobs. It answers `{"type": "ping"}` with a pong, so a client behind a
    proxy that times out idle connections can keep the socket open. And it is
    the disconnect detector: a socket nobody ever reads from will not notice a
    closed peer until the next write fails, which on a half-open connection can
    be never.

    This task is cancelled in the endpoint's `finally`, so exactly one exists
    per live connection and none survives it.
    """
    while True:
        try:
            # The raw ASGI message, so a client that sends something that is not
            # JSON is ignored rather than throwing the loop out of step.
            message = await websocket.receive()
        except _DISCONNECTED:
            return
        except Exception:  # pragma: no cover - transport level failure
            return
        if message.get("type") == "websocket.disconnect":
            return
        text = message.get("text") or ""
        if '"ping"' in text and not await _send(websocket, {"type": "pong"}):
            return


__all__ = ["router"]
