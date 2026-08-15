"""The REST surface. Paths here are the paths the React client is already coded against.

Three rules run through the whole file.

**A refused command is not an error.** START while the emergency stop is
latched, or a fault injection on a read-only recorded session, returns HTTP 200
with `accepted: false` and the reason the protection gave. Returning 4xx or 5xx
would make a working interlock look like a broken server, and an operator
staring at "500 Internal Server Error" learns nothing about why the pump will
not start. A *malformed* request -- an unknown fault name, a severity of 4.0 --
is a different thing entirely and is rejected with 422 by the request models
below.

**Units are converted at the boundary, once, explicitly.** The bearing
calculator is the live example: `bearing.defect_frequencies` takes shaft
frequency in **hertz**, the UI works in **rpm**, and handing it 1450 instead of
24.17 returns a BPFO of 5197 Hz rather than 86.6 Hz -- sixty times too high,
above the Nyquist frequency of the acquisition, and with no error raised
anywhere. So the query parameter is named `shaft_rpm`, not `shaft_speed`, and
the division by 60 happens here in one visible place. `tests/test_api.py` pins
the number.

**Nothing on this layer invents a measurement.** Curves come from
`physics.pump_model`, waveforms and spectra from `signal_processing`, condition
from `ml` or, when the artefacts are absent, from physics rules that are
labelled as such in the payload. No endpoint returns a number it made up to
fill a field.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from ..config.alarm_thresholds import VIBRATION
from ..config.pump_parameters import BEARING, PUMP
from ..contracts import (
    SCHEMA_VERSION,
    Alarm,
    Diagnosis,
    DiagnosisEvidence,
    FaultType,
    Telemetry,
)
from ..physics import pump_model
from ..settings import SERVICE_NAME, SERVICE_VERSION, Settings
from ..signal_processing import (
    bearing,
    compute_spectrum,
    extract_features,
    synthesise,
)
from ..storage.historian import HISTORY_WINDOWS, SIGNAL_UNITS
from .providers import CommandOutcome
from .sessions import Session, SessionManager

router = APIRouter()

#: Samples of the raw waveform returned by `/api/vibration`. A contiguous head
#: of the block at the true sampling rate, NOT a decimation: decimating a
#: 5120 Hz block to fit a chart would alias the high-frequency content into the
#: shaft orders and draw a fault that is not there. 512 samples is 0.1 s, about
#: 2.4 revolutions at 1450 rpm, which is what a waveform display shows anyway.
WAVEFORM_SAMPLES = 512

#: Spectrum bins returned by `/api/fft`, peak-held from the full 2049. Peak-hold
#: rather than averaging or decimation because a discrete order must survive the
#: reduction -- that is what the chart is for.
SPECTRUM_BINS = 512


# --------------------------------------------------------------------------
# Request models. Everything a client can get wrong is rejected here, with 422.
# --------------------------------------------------------------------------


class SessionScoped(BaseModel):
    """Base for every body: the session id may travel in the body as well as in
    the `X-Session-Id` header or the `session_id` query parameter."""

    session_id: str | None = None


class FaultInjectRequest(SessionScoped):
    #: Typed as the enum, so an unknown name is a 422 from pydantic and never
    #: reaches the simulator. The valid values are listed in the error body.
    fault: FaultType
    severity: float = Field(default=0.5, ge=0.0, le=1.0)


class ValveRequest(SessionScoped):
    opening: float = Field(ge=0.0, le=1.0, description="1.0 fully open, 0.0 shut")


class SpeedRequest(SessionScoped):
    #: Upper bound is the drive's limit, 115 % of rated. Asking for more is a
    #: client bug, not an operating point.
    rpm: float = Field(ge=0.0, le=PUMP.rated_speed_rpm * 1.15)


class AcknowledgeRequest(SessionScoped):
    alarm_id: int | None = Field(default=None, description="omit to acknowledge every active alarm")


class ReplayRequest(SessionScoped):
    position_s: float | None = Field(default=None, ge=0.0)
    speed: float | None = Field(default=None, gt=0.0, le=8.0)


# --------------------------------------------------------------------------
# Dependencies
# --------------------------------------------------------------------------


def get_manager(request: Request) -> SessionManager:
    return request.app.state.sessions


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


async def resolve_session(request: Request, response: Response) -> Session:
    """Find the caller's session, or make one.

    Three places are checked, in order of how explicit they are: the
    `X-Session-Id` header, the `session_id` query parameter, then a `session_id`
    field in a JSON body. A bare `curl` with none of them still works -- it just
    gets a fresh machine -- because an endpoint that 400s until you have read
    the docs is a bad public demo.

    The resolved id goes back on every response as `X-Session-Id`, so a client
    that did not have one can adopt it without a separate round trip.
    """
    manager: SessionManager = request.app.state.sessions
    session_id = request.headers.get("X-Session-Id") or request.query_params.get("session_id")

    if not session_id and request.method in ("POST", "PUT", "PATCH"):
        # `Request.body()` caches, so reading it here does not consume the
        # stream that FastAPI is about to parse into the pydantic model.
        raw = await request.body()
        if raw:
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = None
            if isinstance(payload, dict) and payload.get("session_id"):
                session_id = str(payload["session_id"])

    session = manager.get_or_create(session_id)
    response.headers["X-Session-Id"] = session.id
    return session


def _frame(session: Session) -> Telemetry:
    """The current frame, ticking once if the session has never run.

    A first GET on a brand-new session must return data, not nulls; one tick is
    cheap and puts the machine in its true initial state (stopped, no flow)
    rather than an empty object the UI has to special-case.
    """
    return session.latest or session.step()


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------


@router.get("/api/health")
def health(request: Request) -> dict[str, Any]:
    """Liveness plus the three things that can be degraded independently.

    `ml_model: false` is a normal, serviceable state -- the physics and the
    measurements are unaffected and the diagnosis falls back to rules. The
    health check must therefore stay `ok` when the model is missing, or the
    platform will restart a container that is working correctly.
    """
    settings: Settings = request.app.state.settings
    manager: SessionManager = request.app.state.sessions
    gateway: MLGateway = request.app.state.ml
    historian = getattr(request.app.state, "historian", None)

    database: dict[str, Any] = {"connected": False, "url": settings.database_url}
    if historian is not None:
        try:
            database = {
                "connected": True,
                "url": settings.database_url,
                "retained_ticks": historian.tick_count(),
            }
        except Exception as error:  # pragma: no cover - only on a corrupt file
            database = {"connected": False, "url": settings.database_url, "error": str(error)}

    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "schema_version": SCHEMA_VERSION,
        "environment": settings.app_env,
        "simulation_engine": {
            "running": bool(getattr(request.app.state, "ticker_running", False)),
            "data_source": settings.data_source.value,
            "telemetry_rate_hz": settings.telemetry_rate_hz,
            "sessions": asdict(manager.stats()),
        },
        "ml_model": gateway.available,
        "ml_model_detail": gateway.status(),
        "database": database,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------


@router.post("/api/session")
def create_session(response: Response, manager: SessionManager = Depends(get_manager)) -> dict[str, Any]:
    """Mint a session. Always a new one, even if the caller sent an id."""
    session = manager.create()
    response.headers["X-Session-Id"] = session.id
    return {
        "session_id": session.id,
        "data_source": session.provider.data_source.value,
        "tick_interval_s": session.tick_interval_s,
        "schema_version": SCHEMA_VERSION,
    }


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------


@router.get("/api/status")
def status(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Setpoints, provenance and the latest frame in one call.

    The frame is included so the dashboard's first paint needs one request
    rather than two, and so `/api/status` can be read on its own to see whether
    the machine is at a sane duty point.
    """
    provider_status = session.provider.status()
    frame = _frame(session)
    return {
        "asset_state": provider_status.asset_state,
        "data_source": provider_status.data_source,
        "session_id": session.id,
        "operating_hours": round(session.operating_hours, 4),
        "rpm_setpoint": round(provider_status.rpm_setpoint, 1),
        "valve_opening": round(provider_status.valve_opening, 4),
        "auto_mode": provider_status.auto_mode,
        "injected_fault": provider_status.injected_fault,
        "injected_severity": provider_status.injected_severity,
        "blocked_reason": provider_status.blocked_reason,
        "active_alarms": len(session.alarms),
        "elapsed_s": frame.elapsed_s,
        "tick_count": session.tick_count,
        "telemetry": frame.to_dict(),
        "schema_version": SCHEMA_VERSION,
        **provider_status.extra,
    }


@router.get("/api/sensors")
def sensors(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """The latest telemetry frame, exactly as the WebSocket sends it."""
    return _frame(session).to_dict()


@router.get("/api/alarms")
def alarms(
    session: Session = Depends(resolve_session),
    include_cleared: bool = Query(default=False, description="also return alarms that have cleared"),
) -> list[dict[str, Any]]:
    """Active alarms, newest id last. The frontend types this as a bare array."""
    records = session.provider.alarm_records if include_cleared else session.alarms
    return [asdict(alarm) for alarm in records]


@router.get("/api/history")
def history(
    request: Request,
    session: Session = Depends(resolve_session),
    signal: str = Query(default="flow_lpm"),
    window: str = Query(default="5m"),
) -> dict[str, Any]:
    """One signal over one window, from the historian."""
    historian = getattr(request.app.state, "historian", None)
    if historian is None:
        raise HTTPException(status_code=503, detail="historian unavailable")
    try:
        return historian.history(session.id, signal, window).to_dict()
    except KeyError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": str(error),
                "valid_signals": sorted(SIGNAL_UNITS),
                "valid_windows": sorted(HISTORY_WINDOWS),
            },
        ) from error


@router.get("/api/pump-curve")
def pump_curve(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Pump curve, system curve and their intersection, all from `pump_model`.

    Both curves are sampled on the *same* flow axis so the crossing point on the
    chart is the crossing point in the maths. The operating point is the closed
    form solution, not a value read back off the plotted arrays, so it is exact
    and the two agree to floating-point precision.

    Speed is the live shaft speed when the machine is turning and the setpoint
    when it is not: a curve drawn at 0 rpm is a point at the origin and tells a
    reader nothing about the machine they are about to start.
    """
    provider_status = session.provider.status()
    frame = _frame(session)
    rpm = frame.rpm if frame.rpm > 1.0 else provider_status.rpm_setpoint
    valve = provider_status.valve_opening
    blockage = provider_status.discharge_blockage

    operating = pump_model.solve_operating_point(speed_rpm=rpm, valve_opening=valve, blockage=blockage)

    points = pump_model.pump_curve(rpm)
    curve = [
        {
            "flow_lpm": round(point["flow_lpm"], 4),
            "pump_head_m": round(point["head_m"], 4),
            "system_head_m": round(
                pump_model.system_head(
                    pump_model.lpm_to_m3s(point["flow_lpm"]), valve, blockage
                ),
                4,
            ),
            "pump_efficiency": round(pump_model.pump_efficiency(point["flow_lpm"], rpm), 4),
        }
        for point in points
    ]

    return {
        "curve": curve,
        "operating_point": {
            "flow_lpm": round(operating.flow_lpm, 4),
            "pump_head_m": round(operating.head_m, 4),
            "pump_efficiency": round(operating.efficiency, 4),
            "shaft_power_w": round(operating.shaft_power_w, 3),
            "motor_current_a": round(operating.motor_current_a, 4),
        },
        "valve_opening": round(valve, 4),
        "rpm": round(rpm, 1),
        "rpm_source": "shaft" if frame.rpm > 1.0 else "setpoint",
        "discharge_blockage": round(blockage, 4),
        "static_head_m": round(pump_model.system_head(0.0, valve, blockage), 4),
        "basis": (
            "Quadratic pump characteristic intersected with a quadratic system curve; "
            "affinity laws for speed. Noise-free physics, so it will differ slightly "
            "from the instrument readings on the same tick."
        ),
        "schema_version": SCHEMA_VERSION,
    }


@router.get("/api/vibration")
def vibration(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """A real time-domain block and the statistics measured from it.

    The waveform returned is the first `WAVEFORM_SAMPLES` samples of the radial
    horizontal channel at the true 5120 Hz rate. It is a head of the block, not
    a decimation of the whole block, so nothing is aliased into it -- see the
    note on `WAVEFORM_SAMPLES`. The statistics beside it are computed from the
    *complete* block and from the resultant of all three axes, which is the
    overall an ISO 20816 judgement is made on.
    """
    frame = _frame(session)
    waveform = _synthesise_for(session, frame)
    features = extract_features(waveform)

    sample_rate = waveform.sampling.sampling_rate_hz
    trace = waveform.x[:WAVEFORM_SAMPLES]
    return {
        "waveform": [
            {"t_s": round(index / sample_rate, 6), "amplitude_mm_s": round(float(value), 5)}
            for index, value in enumerate(trace)
        ],
        "axis": "x",
        "axis_description": "radial horizontal at the bearing housing",
        "sample_rate_hz": sample_rate,
        "block_size": waveform.sampling.block_size,
        "samples_returned": len(trace),
        "duration_s": round(len(trace) / sample_rate, 6),
        "vibration_rms_mm_s": round(features.vibration_rms_mm_s, 5),
        "vibration_peak_mm_s": round(features.vibration_peak_mm_s, 5),
        "peak_to_peak_mm_s": round(features.peak_to_peak_mm_s, 5),
        "crest_factor": round(features.crest_factor, 5),
        "vibration_x_mm_s": round(features.vibration_x_mm_s, 5),
        "vibration_y_mm_s": round(features.vibration_y_mm_s, 5),
        "vibration_z_mm_s": round(features.vibration_z_mm_s, 5),
        "rotational_frequency_hz": round(features.rotational_frequency_hz, 4),
        "statistics_basis": "resultant of x, y and z over the whole block",
        "schema_version": SCHEMA_VERSION,
    }


@router.get("/api/fft")
def fft(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Amplitude spectrum of the same block, with the shaft orders marked.

    Reduced to `SPECTRUM_BINS` by peak-hold: each output bin reports the tallest
    line in its group at that line's own frequency. Averaging would flatten the
    discrete orders the chart exists to show, and plain decimation would drop
    them entirely. Nothing above Nyquist is returned, because nothing above
    Nyquist exists -- `tests/test_api.py` asserts it.
    """
    frame = _frame(session)
    waveform = _synthesise_for(session, frame)
    features = extract_features(waveform)
    spectrum = compute_spectrum(waveform.x, waveform.sampling.sampling_rate_hz)

    f_r = features.rotational_frequency_hz
    return {
        "spectrum": [
            {"frequency_hz": round(frequency, 4), "amplitude_mm_s": round(amplitude, 6)}
            for frequency, amplitude in _peak_hold(
                spectrum.frequencies_hz, spectrum.amplitudes_mm_s, SPECTRUM_BINS
            )
        ],
        "rotational_frequency_hz": round(f_r, 4),
        "amplitude_1x_mm_s": round(features.amplitude_1x_mm_s, 5),
        "amplitude_2x_mm_s": round(features.amplitude_2x_mm_s, 5),
        "dominant_frequency_hz": round(features.dominant_frequency_hz, 4),
        "high_frequency_energy": round(features.high_frequency_energy, 5),
        # Analysis parameters travel with the data. Resolution is a property of
        # the block, and whether two nearby orders are separable is a question
        # only these numbers answer -- 2x mechanical and line frequency are
        # 1.67 Hz apart on this machine, which df decides.
        "resolution_hz": round(spectrum.resolution_hz, 6),
        "sampling_rate_hz": round(spectrum.sampling_rate_hz, 3),
        "block_size": int(waveform.sampling.block_size),
        "markers": [
            {"label": "1x", "frequency_hz": round(f_r, 4), "amplitude_mm_s": round(features.amplitude_1x_mm_s, 5)},
            {"label": "2x", "frequency_hz": round(2.0 * f_r, 4), "amplitude_mm_s": round(features.amplitude_2x_mm_s, 5)},
            {
                "label": "vane pass",
                "frequency_hz": round(waveform.blade_pass_frequency_hz, 4),
                "amplitude_mm_s": round(spectrum.amplitude_at(waveform.blade_pass_frequency_hz, 3.0), 5),
            },
        ],
        "nyquist_hz": spectrum.nyquist_hz,
        "resolution_hz": round(spectrum.resolution_hz, 4),
        "window": "hann",
        "amplitude_convention": "peak, engineering units (mm/s)",
        "axis": "x",
        "schema_version": SCHEMA_VERSION,
    }


@router.get("/api/bearing-frequencies")
def bearing_frequencies(
    session: Session = Depends(resolve_session),
    shaft_rpm: float | None = Query(
        default=None,
        ge=0.0,
        le=100_000.0,
        description="Shaft speed in REV/MIN. Converted to Hz here; the kinematics take Hz.",
    ),
    rolling_elements: int = Query(default=BEARING.rolling_elements, ge=1, le=200),
    ball_diameter_mm: float = Query(default=BEARING.ball_diameter_mm, gt=0.0, le=1000.0),
    pitch_diameter_mm: float = Query(default=BEARING.pitch_diameter_mm, gt=0.0, le=5000.0),
    contact_angle_deg: float = Query(default=BEARING.contact_angle_deg, gt=-90.0, lt=90.0),
    designation: str = Query(default=BEARING.designation, max_length=64),
) -> dict[str, Any]:
    """Theoretical BPFO/BPFI/BSF/FTF. Calculated, never detected.

    THE UNITS TRAP, stated where it is being avoided: the kinematic formulas
    take **shaft frequency in hertz**. This parameter is **rpm**, because that
    is what the UI has and what an engineer says out loud, and the conversion
    happens on the next line and nowhere else. Passing 1450 straight through
    would report BPFO = 5197 Hz instead of 86.6 Hz: sixty times high, above the
    2560 Hz Nyquist of the acquisition, and completely silent.

    Nothing in this response is a measurement. `basis` and `disclaimer` travel
    with the numbers so a table of four frequencies on a condition-monitoring
    screen cannot be mistaken for four detected defects.
    """
    frame = _frame(session)
    if shaft_rpm is None:
        shaft_rpm = frame.rpm if frame.rpm > 1.0 else PUMP.rated_speed_rpm

    shaft_frequency_hz = shaft_rpm / 60.0  # <-- the conversion, once, explicitly

    try:
        frequencies = bearing.defect_frequencies_from_geometry(
            shaft_frequency_hz=shaft_frequency_hz,
            rolling_elements=rolling_elements,
            ball_diameter_mm=ball_diameter_mm,
            pitch_diameter_mm=pitch_diameter_mm,
            contact_angle_deg=contact_angle_deg,
            designation=designation,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    payload = frequencies.to_dict()
    # The frontend's `BearingFrequencies` type reads `shaft_rpm` and
    # `rotational_frequency_hz`; the dataclass calls them `rotational_speed_rpm`
    # and `shaft_frequency_hz`. Both spellings are sent rather than renaming a
    # field in a module this layer does not own.
    payload["shaft_rpm"] = round(shaft_rpm, 3)
    payload["rotational_frequency_hz"] = shaft_frequency_hz
    payload["schema_version"] = SCHEMA_VERSION
    return payload


@router.get("/api/diagnosis")
def diagnosis(request: Request, session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """What is wrong with the machine, and why.

    Served by the trained model when the artefacts are present, and by physics
    rules when they are not. Either way the payload says which, and the
    evidence lists stay separate so a reader can see where the model and the
    measurements agree.
    """
    gateway: MLGateway = request.app.state.ml
    frame = _frame(session)
    result = gateway.diagnose(frame, session.alarms)
    payload = asdict(result)
    payload["source"] = "model" if gateway.available else "physics"
    return payload


# --------------------------------------------------------------------------
# Control
# --------------------------------------------------------------------------


def _outcome(outcome: CommandOutcome, session: Session) -> dict[str, Any]:
    payload = outcome.to_dict()
    payload["session_id"] = session.id
    payload["asset_state"] = outcome.asset_state or session.provider.status().asset_state
    return payload


@router.post("/api/control/start")
def control_start(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Start the pump, subject to the interlock chain.

    A blocked start is HTTP 200 with `accepted: false` and the permissive that
    failed. See the module docstring.
    """
    return _outcome(session.provider.command("start"), session)


@router.post("/api/control/stop")
def control_stop(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    return _outcome(session.provider.command("stop"), session)


@router.post("/api/control/reset")
def control_reset(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Panel reset: clears the alarm annunciation and lifts a latched fault.

    It cannot lift an emergency stop -- that needs the E-stop device released,
    which is the entire point of one.
    """
    return _outcome(session.provider.command("reset"), session)


@router.post("/api/control/estop")
def control_estop(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Toggle the emergency stop, matching the single button in the UI.

    Latched -> released, anything else -> latched. Modelled on the physical
    device: one mushroom head, pressed to stop and twisted to release.
    """
    latched = session.provider.status().asset_state == "E_STOP"
    return _outcome(session.provider.command("estop", active=not latched), session)


@router.post("/api/control/acknowledge")
def control_acknowledge(
    body: AcknowledgeRequest | None = None,
    session: Session = Depends(resolve_session),
) -> dict[str, Any]:
    """Acknowledge one alarm, or every active alarm when `alarm_id` is omitted.

    Acknowledging never clears an alarm -- the condition is still there and the
    record stays ACTIVE. They are independent actions, as on any real system.
    """
    alarm_id = body.alarm_id if body else None
    return _outcome(session.provider.command("ack", alarm_id=alarm_id), session)


@router.post("/api/alarms/{alarm_id}/acknowledge")
def acknowledge_alarm(alarm_id: int, session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Per-alarm acknowledgement; the shape the alarm list in the UI calls."""
    return _outcome(session.provider.command("ack", alarm_id=alarm_id), session)


@router.post("/api/fault/inject")
def inject_fault(body: FaultInjectRequest, session: Session = Depends(resolve_session)) -> dict[str, Any]:
    """Develop a fault over its ramp. Never snaps a reading to a preset value.

    An unrecognised fault name or a severity outside 0..1 never reaches this
    body -- `FaultInjectRequest` rejects both with 422.
    """
    return _outcome(session.provider.inject_fault(body.fault, body.severity), session)


@router.post("/api/fault/clear")
def clear_fault(session: Session = Depends(resolve_session)) -> dict[str, Any]:
    return _outcome(session.provider.clear_fault(), session)


@router.post("/api/valve")
def set_valve(body: ValveRequest, session: Session = Depends(resolve_session)) -> dict[str, Any]:
    return _outcome(session.provider.set_valve(body.opening), session)


@router.post("/api/speed")
def set_speed(body: SpeedRequest, session: Session = Depends(resolve_session)) -> dict[str, Any]:
    return _outcome(session.provider.set_speed(body.rpm), session)


# --------------------------------------------------------------------------
# Recorded runs
# --------------------------------------------------------------------------


@router.get("/api/replay/runs")
def replay_runs(request: Request) -> dict[str, Any]:
    """Stored runs available for `DATA_SOURCE=RECORDED`."""
    store = getattr(request.app.state, "replay_store", None)
    return {"runs": store.list_runs() if store is not None else []}


@router.post("/api/replay/{action}")
def replay_control(
    action: str,
    body: ReplayRequest | None = None,
    session: Session = Depends(resolve_session),
) -> dict[str, Any]:
    """Transport for a recorded session: play, pause, seek, speed.

    Refused with `accepted: false` on a live simulation, for the same reason a
    blocked start is: asking a live machine to seek is a mistake, not a fault.
    """
    if action not in ("play", "pause", "seek", "speed"):
        raise HTTPException(status_code=422, detail=f"unknown replay action {action!r}")
    kwargs: dict[str, Any] = {}
    if body is not None:
        if body.position_s is not None:
            kwargs["position_s"] = body.position_s
        if body.speed is not None:
            kwargs["speed"] = body.speed
    outcome = _outcome(session.provider.command(action, **kwargs), session)
    outcome["replay"] = session.provider.status().extra.get("replay")
    return outcome


# --------------------------------------------------------------------------
# Waveform helper
# --------------------------------------------------------------------------


def _synthesise_for(session: Session, frame: Telemetry):
    """Synthesise the acquisition block that matches this frame.

    The waveform is generated on demand rather than every tick because it is by
    far the most expensive thing in the service (a 4096-point band-pass filter
    plus three FFTs downstream) and only two endpoints ever want it. This is the
    point at which the vibration sampling rate, 5120 Hz, is decoupled from the
    telemetry push rate of 5 Hz -- as it is on real acquisition hardware, where
    the analyser samples continuously and reports a block occasionally.

    The seed is the session's tick count, so the noise moves between requests
    while the same tick always regenerates the identical block.
    """
    try:
        fault = FaultType(frame.fault_state)
    except ValueError:  # pragma: no cover - fault_state comes from the contract
        fault = FaultType.NORMAL
    return synthesise(
        rotational_speed_rpm=frame.rpm,
        fault=fault,
        severity=frame.severity,
        seed=session.tick_count,
    )


def _peak_hold(
    frequencies: np.ndarray, amplitudes: np.ndarray, target_bins: int
) -> list[tuple[float, float]]:
    """Reduce a spectrum to `target_bins`, keeping the tallest line in each group.

    The reported frequency is the peak line's own frequency, not the group
    centre, so a marked order still lands where it belongs on the axis.
    """
    count = int(frequencies.size)
    if count <= target_bins:
        return [(float(f), float(a)) for f, a in zip(frequencies, amplitudes)]
    edges = np.linspace(0, count, target_bins + 1).astype(int)
    output: list[tuple[float, float]] = []
    for low, high in zip(edges[:-1], edges[1:]):
        if high <= low:
            continue
        index = low + int(np.argmax(amplitudes[low:high]))
        output.append((float(frequencies[index]), float(amplitudes[index])))
    return output


# --------------------------------------------------------------------------
# The ML gateway, and the physics-only diagnosis it falls back to
# --------------------------------------------------------------------------


class MLGateway:
    """The API layer's one point of contact with `app.ml`.

    `app.ml` is written by another agent and may be absent, half-written, or
    present without its trained artefacts. All three are handled the same way:
    catch, record why, and serve physics. The service must boot and stay useful
    in every one of them -- a monitoring product that refuses to start because
    its model file is missing is worse than one that says so and keeps showing
    measurements.
    """

    def __init__(self, model_dir: str = "models") -> None:
        self.model_dir = model_dir
        self._service: Any = None
        self._diagnose: Any = None
        self._importance: Any = None
        self.error: str = "not loaded"

    def load(self) -> None:
        """Import and warm the model once, at startup. Never trains."""
        try:
            from ..ml import inference as ml_inference

            service = ml_inference.get_service(self.model_dir)
            if not service.is_available:
                self._service = None
                self.error = service.load_error or "no artefacts found"
                return
            self._service = service
            self.error = ""
        except Exception as error:
            self._service = None
            self.error = f"{type(error).__name__}: {error}"
            return

        # The diagnosis and explanation modules are optional extras on top of a
        # loaded classifier; losing either degrades the payload, not the service.
        try:
            from ..ml import diagnosis as ml_diagnosis

            self._diagnose = getattr(ml_diagnosis, "diagnose", None) or getattr(
                ml_diagnosis, "build_diagnosis", None
            )
        except Exception:
            self._diagnose = None
        try:
            from ..ml import explain as ml_explain

            self._importance = ml_explain.feature_importance
        except Exception:
            self._importance = None

    @property
    def available(self) -> bool:
        return self._service is not None

    def status(self) -> dict[str, Any]:
        return {
            "loaded": self.available,
            "model_dir": self.model_dir,
            "classes": list(getattr(self._service, "classes", ()) or ()),
            "has_diagnosis_module": self._diagnose is not None,
            "reason": self.error,
        }

    def anomaly_score(self, telemetry: Telemetry) -> float | None:
        if self._service is None:
            return None
        try:
            return float(self._service.anomaly_score(telemetry))
        except Exception:
            return None

    def diagnose(self, telemetry: Telemetry, alarms: list[Alarm]) -> Diagnosis:
        """Model diagnosis when possible, physics rules otherwise.

        The model's own diagnosis module is preferred because it can weigh
        physics and model evidence together. If it is missing but a classifier
        is loaded, the physics diagnosis is annotated with the model's
        prediction so the two can be compared -- including when they disagree,
        which is surfaced rather than hidden.
        """
        if self._diagnose is not None:
            try:
                result = self._diagnose(telemetry)
                if isinstance(result, Diagnosis):
                    return result
            except Exception:
                pass  # fall through to physics; a broken model must not 500

        result = physics_diagnosis(telemetry, alarms)
        if self._service is None:
            return result

        try:
            label, confidence, distribution = self._service.predict(telemetry)
        except Exception:
            return result
        if label is None:
            return result

        result.model_evidence.append(
            DiagnosisEvidence(
                source="model",
                statement=f"classifier predicts {label}",
                measured_value=round(float(confidence), 4),
                unit="probability",
                reference="random forest over contracts.FEATURE_ORDER",
            )
        )
        score = self.anomaly_score(telemetry)
        if score is not None:
            result.anomaly_score = score
            result.model_evidence.append(
                DiagnosisEvidence(
                    source="model",
                    statement="isolation forest novelty",
                    measured_value=round(score, 4),
                    unit="score",
                    reference="0 = as healthy as training normals, 1 = far outside",
                )
            )
        if self._importance is not None:
            try:
                result.feature_importance = self._importance(self._service, 6)
            except Exception:
                pass
        # Disagreement is information. It is reported, never averaged away.
        result.physics_model_conflict = label != result.detected_condition
        if confidence > result.confidence:
            result.confidence = float(confidence)
        _ = distribution
        return result


# -- physics rules ---------------------------------------------------------
#
# Reference duty point, from config/alarm_thresholds.py: 21.0 L/min, 7.59 m,
# 0.563 A, NPSH margin 6.95 m, vibration ~0.75 mm/s RMS. Every threshold below
# is quoted against those and against the ISO 20816-1 Class I bands, so the
# rules can be checked against the commissioning data rather than taken on
# trust.

#: ISO 20816-1 Class I band edges, mm/s RMS.
_ISO_SATISFACTORY = VIBRATION.zone_b_c_mm_s
_ISO_UNSATISFACTORY = VIBRATION.zone_c_d_mm_s
_ISO_UNACCEPTABLE = VIBRATION.trip_mm_s
#: NPSH margin below which cavitation is expected; 0 m is cavitation by definition.
_NPSH_WARNING_M = 1.5
#: Loss-of-load current. A dry-running pump unloads to about 0.42 A.
_NO_LOAD_CURRENT_A = 0.46


def physics_diagnosis(telemetry: Telemetry, alarms: list[Alarm]) -> Diagnosis:
    """Rule-based condition assessment from the measurements alone.

    Deliberately does **not** read `telemetry.fault_state`. That field is the
    simulator's ground truth, and a "diagnosis" that reads the answer off the
    frame it is diagnosing would be a demonstration of nothing at all. Every
    statement below is derived from a value an instrument reported.
    """
    evidence: list[DiagnosisEvidence] = []
    condition = FaultType.NORMAL.value
    confidence = 0.5
    is_sensor_fault = False

    bad_tags = [tag for tag, quality in telemetry.sensor_quality.items() if quality == "BAD"]
    suspect_tags = [tag for tag, quality in telemetry.sensor_quality.items() if quality == "UNCERTAIN"]

    running = telemetry.rpm > PUMP.rated_speed_rpm * 0.5

    # 1. Instrumentation first. A bad measurement makes every rule below it
    #    unreliable, so it has to be reported before, not after, them.
    if bad_tags or suspect_tags:
        condition = FaultType.SENSOR_FAULT.value
        is_sensor_fault = True
        confidence = 0.8 if bad_tags else 0.6
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement=f"instrument quality degraded on {', '.join(bad_tags + suspect_tags)}",
                measured_value=float(len(bad_tags) + len(suspect_tags)),
                unit="tags",
                reference="sensor_quality != GOOD",
            )
        )

    # 2. Suction side. NPSH margin is a computed engineering quantity, not a
    #    flag, so the threshold is the same one the alarm list uses.
    elif running and telemetry.npsh_margin_m < _NPSH_WARNING_M:
        condition = FaultType.CAVITATION.value
        confidence = 0.65 + 0.3 * min(max(-telemetry.npsh_margin_m / 2.0, 0.0), 1.0)
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement="NPSH margin below the cavitation-risk limit",
                measured_value=round(telemetry.npsh_margin_m, 3),
                unit="m",
                reference=f"warning at {_NPSH_WARNING_M} m, cavitating below 0 m",
            )
        )
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement="broadband high-frequency energy raised by bubble collapse",
                measured_value=round(telemetry.high_frequency_energy, 3),
                unit="mm/s",
                reference="healthy baseline about 0.25 mm/s",
            )
        )

    # 3. Loss of prime: no flow with the shaft turning and the motor unloaded.
    #    Current *falling* is the discriminator -- a blocked line raises
    #    discharge pressure and lowers current too, but not to no-load.
    elif running and telemetry.flow_lpm < 2.0 and telemetry.motor_current_a < _NO_LOAD_CURRENT_A:
        condition = FaultType.DRY_RUN.value
        confidence = 0.75
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement="no flow while the shaft is turning, motor at no-load current",
                measured_value=round(telemetry.motor_current_a, 3),
                unit="A",
                reference=f"duty 0.563 A, no-load {_NO_LOAD_CURRENT_A} A",
            )
        )

    # 4. Restriction: the operating point has slid up the pump curve. Flow down
    #    AND head up together is the signature; flow down alone is not.
    elif running and telemetry.flow_lpm < 14.0 and telemetry.pump_head_m > 9.0:
        condition = FaultType.FLOW_RESTRICTION.value
        confidence = 0.7
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement="operating point has moved up the pump curve: flow down, head up",
                measured_value=round(telemetry.flow_lpm, 2),
                unit="L/min",
                reference="duty 21.0 L/min at 7.59 m",
            )
        )

    # 5. Mechanical. 2x above 1x is the classic misalignment signature; a tall
    #    1x with a quiet 2x is imbalance. The order matters: misalignment is
    #    tested first because it also raises 1x.
    elif running and telemetry.amplitude_2x_mm_s > max(telemetry.amplitude_1x_mm_s, 1.0):
        condition = FaultType.MISALIGNMENT.value
        confidence = 0.7
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement="2x exceeds 1x, with axial response",
                measured_value=round(telemetry.amplitude_2x_mm_s, 3),
                unit="mm/s",
                reference=f"1x is {telemetry.amplitude_1x_mm_s:.3f} mm/s",
            )
        )
    elif running and telemetry.amplitude_1x_mm_s > 2.0 and telemetry.amplitude_1x_mm_s > 2.0 * telemetry.amplitude_2x_mm_s:
        condition = FaultType.IMBALANCE.value
        confidence = 0.7
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement="1x dominates the spectrum with 2x near baseline",
                measured_value=round(telemetry.amplitude_1x_mm_s, 3),
                unit="mm/s",
                reference="healthy 1x about 0.55 mm/s",
            )
        )
    else:
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement=(
                    "all monitored quantities within limits"
                    if running
                    else "machine is not running; condition monitoring needs the shaft turning"
                ),
                measured_value=round(telemetry.vibration_rms_mm_s, 3),
                unit="mm/s",
                reference=f"ISO 20816-1 Class I good below {_ISO_SATISFACTORY} mm/s",
            )
        )

    # Always report the overall against the standard, whatever the condition.
    evidence.append(
        DiagnosisEvidence(
            source="physics",
            statement="overall vibration against ISO 20816-1 Class I",
            measured_value=round(telemetry.vibration_rms_mm_s, 3),
            unit="mm/s",
            reference=f"{_ISO_SATISFACTORY} good / {_ISO_UNSATISFACTORY} satisfactory / {_ISO_UNACCEPTABLE} unsatisfactory",
        )
    )
    for alarm in alarms[:5]:
        evidence.append(
            DiagnosisEvidence(
                source="physics",
                statement=f"{alarm.severity}: {alarm.description}",
                measured_value=alarm.value,
                unit=alarm.unit,
                reference=f"limit {alarm.threshold} {alarm.unit}",
            )
        )

    health = _physics_health(telemetry)
    return Diagnosis(
        detected_condition=condition,
        confidence=round(confidence, 3),
        health_index=health,
        severity_label=_severity_label(health),
        physics_evidence=evidence,
        model_evidence=[],
        feature_importance={},
        recommended_actions=_recommended_actions(condition),
        anomaly_score=round(1.0 - health / 100.0, 4),
        is_sensor_fault=is_sensor_fault,
        physics_model_conflict=False,
    )


def _physics_health(telemetry: Telemetry) -> float:
    """0..100 from measurements only, as the worst of several deviations.

    Worst-of rather than an average: a machine that is perfect on four axes and
    cavitating on the fifth is not 80 % healthy, it is in trouble.
    """
    deviations = [
        # Vibration against the ISO trip level.
        (telemetry.vibration_rms_mm_s - _ISO_SATISFACTORY) / (_ISO_UNACCEPTABLE - _ISO_SATISFACTORY),
        # NPSH margin: zero margin is full deviation.
        (_NPSH_WARNING_M - telemetry.npsh_margin_m) / 3.0,
        # Bearing temperature against its trip.
        (telemetry.bearing_temperature_c - 45.0) / (80.0 - 45.0),
        (telemetry.motor_temperature_c - 55.0) / (90.0 - 55.0),
    ]
    if telemetry.rpm > PUMP.rated_speed_rpm * 0.5:
        # Flow shortfall only means anything once the machine is up to speed.
        deviations.append((21.0 - telemetry.flow_lpm) / 21.0)
    worst = min(max(max(deviations), 0.0), 1.0)
    return round(100.0 * (1.0 - worst), 2)


def _severity_label(health_index: float) -> str:
    if health_index >= 90.0:
        return "none"
    if health_index >= 65.0:
        return "minor"
    if health_index >= 35.0:
        return "moderate"
    return "severe"


def _recommended_actions(condition: str) -> list[str]:
    return {
        FaultType.NORMAL.value: ["No action. Continue routine monitoring."],
        FaultType.CAVITATION.value: [
            "Check the suction strainer and suction line for restriction.",
            "Verify reservoir level and that the suction valve is fully open.",
            "Throttle the discharge to reduce flow until the NPSH margin recovers.",
        ],
        FaultType.DRY_RUN.value: [
            "Stop the pump: running dry destroys the mechanical seal within minutes.",
            "Re-prime and confirm the suction line holds liquid before restarting.",
        ],
        FaultType.FLOW_RESTRICTION.value: [
            "Inspect the discharge line and strainer for blockage.",
            "Confirm the discharge valve position matches the commanded opening.",
        ],
        FaultType.MISALIGNMENT.value: [
            "Check coupling alignment cold and hot; record the as-found readings.",
            "Inspect the coupling element and the hold-down bolts for softfoot.",
        ],
        FaultType.IMBALANCE.value: [
            "Inspect the impeller for deposits, erosion or a lost balance weight.",
            "Trim balance the rotor if the 1x amplitude keeps rising.",
        ],
        FaultType.SENSOR_FAULT.value: [
            "Treat the affected readings as unreliable until the loop is checked.",
            "Verify the transmitter loop, wiring and power before acting on a diagnosis.",
        ],
    }.get(condition, ["Investigate the reported condition."])


__all__ = ["MLGateway", "physics_diagnosis", "router"]
