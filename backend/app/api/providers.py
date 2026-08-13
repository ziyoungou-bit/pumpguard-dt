"""Where a frame comes from. The one seam that keeps this service off synthetic data.

Everything above this module -- routes, WebSocket, historian, diagnosis -- deals
in `contracts.Telemetry` and a `DataProvider`. None of it knows whether the
frame was simulated a millisecond ago, read back off a recorded run, or polled
out of a PLC over Modbus. That is the whole point: a condition-monitoring
backend that can only ever consume its own simulator is a demo, and rewiring it
to a real asset later would mean rewriting the business logic rather than adding
a class here.

Two providers are real:

    SimulationDataProvider   drives a `simulation.SimulationSession`
    RecordedDataProvider     plays a stored run through a `storage.ReplayCursor`

and three are declared and deliberately not written:

    ModbusDataProvider  OPCUADataProvider  MQTTDataProvider

They raise `NotImplementedError` with the specific thing that is missing (a
register map, a node-id map, a topic map -- none of which can be invented, they
belong to a particular installation). They are here as an interface commitment,
not as a stub to be quietly filled in with fake data: an empty class that
returned plausible numbers would be far worse than one that refuses.

Commands are part of the interface, not an afterthought, because every one of
these sources has a write path in real life -- a Modbus coil, an OPC UA method
call. A provider that cannot honour a command answers with
`CommandOutcome(accepted=False, reason=...)`. Note that a *refused* command is
an ordinary answer here, never an exception: the interlock chain refusing a
start is normal operation, and it must not reach the HTTP layer as an error.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..config.pump_parameters import PUMP
from ..contracts import Alarm, DataSource, FaultType, Telemetry
from ..simulation.engine import SimulationSession
from ..storage.replay import RecordedRun, ReplayCursor, ReplayStore


@dataclass(frozen=True)
class CommandOutcome:
    """The answer to every command: did it happen, why not, and where are we now.

    This is the shape the REST layer returns with HTTP 200 even when
    `accepted` is False. A blocked interlock is the protection system doing its
    job, and reporting it as a 5xx would make a working safety function look
    like a broken server.
    """

    accepted: bool
    reason: str
    asset_state: str = ""

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"accepted": self.accepted, "asset_state": self.asset_state}
        if self.accepted:
            payload["reason"] = self.reason
        else:
            # The frontend's CommandResult reads `blocked_reason`; keep `reason`
            # alongside it so a curl user sees the same text.
            payload["blocked_reason"] = self.reason
            payload["reason"] = self.reason
        return payload


@dataclass(frozen=True)
class ProviderStatus:
    """Everything `/api/status` needs that is not on the telemetry frame itself."""

    asset_state: str
    data_source: str
    valve_opening: float
    rpm_setpoint: float
    injected_fault: str
    injected_severity: float
    auto_mode: bool
    blocked_reason: str = ""
    #: Discharge-side blockage severity, 0..1. The system curve needs it, and it
    #: is a model input rather than a measurement, so it cannot be read off the
    #: telemetry frame.
    discharge_blockage: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)


class DataProvider(ABC):
    """One source of telemetry for one session."""

    #: Stamped onto `/api/status` and shown in the UI's provenance banner.
    data_source: DataSource = DataSource.SIMULATION

    # -- the stream -------------------------------------------------------

    @abstractmethod
    def step(self, dt: float) -> Telemetry:
        """Advance by `dt` seconds and return the frame for that instant."""

    @property
    @abstractmethod
    def latest(self) -> Telemetry | None:
        """The most recent frame, or None before the first step."""

    @property
    @abstractmethod
    def alarms(self) -> list[Alarm]:
        """Currently active alarms."""

    @property
    @abstractmethod
    def alarm_records(self) -> list[Alarm]:
        """Active and cleared alarms together, for the alarm page and historian."""

    @abstractmethod
    def status(self) -> ProviderStatus:
        """Setpoints and provenance, for `/api/status` and `/api/pump-curve`."""

    # -- the write path ---------------------------------------------------

    @abstractmethod
    def command(self, name: str, **kwargs: Any) -> CommandOutcome:
        """start / stop / reset / estop / ack, or a provider-specific verb."""

    @abstractmethod
    def inject_fault(self, fault: FaultType, severity: float) -> CommandOutcome:
        ...

    @abstractmethod
    def clear_fault(self) -> CommandOutcome:
        ...

    @abstractmethod
    def set_valve(self, opening: float) -> CommandOutcome:
        ...

    @abstractmethod
    def set_speed(self, rpm: float) -> CommandOutcome:
        ...

    def close(self) -> None:
        """Release anything the provider holds. A no-op for the in-memory ones."""


# --------------------------------------------------------------------------
# Simulation
# --------------------------------------------------------------------------


class SimulationDataProvider(DataProvider):
    """The digital twin itself: one `SimulationSession` per visitor.

    A thin adapter on purpose. The session already refuses illegal commands with
    a reason and already keeps every visitor's state on its own instance, so
    wrapping it in policy here would duplicate the state machine badly.
    """

    data_source = DataSource.SIMULATION

    def __init__(self, session_id: str) -> None:
        self.session = SimulationSession(session_id)
        # Mirrored here rather than read off the state machine: the setpoint is
        # an operator input this provider owns, and the session exposes only the
        # *actual* shaft speed. Reaching into `session._machine` for it would
        # couple the API layer to the simulator's internals.
        self.rpm_setpoint = PUMP.rated_speed_rpm
        self.last_refusal = ""

    def step(self, dt: float) -> Telemetry:
        return self.session.step(dt)

    @property
    def latest(self) -> Telemetry | None:
        return self.session.last_telemetry

    @property
    def alarms(self) -> list[Alarm]:
        return self.session.alarms

    @property
    def alarm_records(self) -> list[Alarm]:
        return self.session.alarm_records

    def status(self) -> ProviderStatus:
        severities = self.session.fault_severities
        frame = self.session.last_telemetry
        if frame is not None:
            # The frame's `fault_state` is the authority: it also covers
            # sensor_fault, which has no process-dynamics channel to read.
            fault, severity = frame.fault_state, frame.severity
        else:
            fault, severity = max(severities.items(), key=lambda item: item[1], default=("normal", 0.0))
            if severity < 0.02:
                fault, severity = FaultType.NORMAL.value, 0.0
        return ProviderStatus(
            asset_state=self.session.state,
            data_source=self.data_source.value,
            valve_opening=self.session.valve_opening,
            rpm_setpoint=self.rpm_setpoint,
            injected_fault=fault,
            injected_severity=round(float(severity), 4),
            auto_mode=self.session.state != "MAINTENANCE",
            blocked_reason=self.last_refusal,
            discharge_blockage=severities.get(FaultType.FLOW_RESTRICTION.value, 0.0),
            extra={"interlocks": self.session.interlocks, "fault_severities": severities},
        )

    def command(self, name: str, **kwargs: Any) -> CommandOutcome:
        result = self.session.command(name, **kwargs)
        outcome = CommandOutcome(
            accepted=bool(result["ok"]),
            reason=str(result["reason"]),
            asset_state=str(result["state"]),
        )
        # Kept so `/api/status` can still explain why the machine will not
        # start after the operator has clicked away from the command response.
        self.last_refusal = "" if outcome.accepted else outcome.reason
        return outcome

    def inject_fault(self, fault: FaultType, severity: float) -> CommandOutcome:
        self.session.inject_fault(fault.value, severity)
        return CommandOutcome(
            accepted=True,
            reason=f"{fault.value} ramping to severity {severity:.2f}",
            asset_state=self.session.state,
        )

    def clear_fault(self) -> CommandOutcome:
        self.session.clear_fault()
        return CommandOutcome(True, "all faults ramping back to healthy", self.session.state)

    def set_valve(self, opening: float) -> CommandOutcome:
        self.session.set_valve(opening)
        return CommandOutcome(
            True, f"valve opening set to {self.session.valve_opening:.2f}", self.session.state
        )

    def set_speed(self, rpm: float) -> CommandOutcome:
        self.session.set_speed(rpm)
        # The drive clamps to 0..115 % of rated, so mirror the same clamp rather
        # than reporting a setpoint the machine will not honour.
        self.rpm_setpoint = min(max(float(rpm), 0.0), PUMP.rated_speed_rpm * 1.15)
        return CommandOutcome(True, f"speed setpoint set to {self.rpm_setpoint:.0f} rpm", self.session.state)


# --------------------------------------------------------------------------
# Recorded playback
# --------------------------------------------------------------------------


#: Refusal text shared by every write on a recorded source. Written once so the
#: UI can match on it and so the reason cannot drift between endpoints.
READ_ONLY_REASON = (
    "this session is replaying a recorded run and is read-only; "
    "set DATA_SOURCE=SIMULATION to control the asset"
)


class RecordedDataProvider(DataProvider):
    """Replays a stored run. Every frame really was recorded; none is regenerated.

    The transport verbs (`play`, `pause`, `seek`, `speed`) go through the same
    `command` entry point as `start`/`stop`, so the API surface does not grow a
    second command mechanism for playback.
    """

    data_source = DataSource.RECORDED

    def __init__(self, run: RecordedRun, loop: bool = True) -> None:
        self.cursor = ReplayCursor(run, loop=loop)
        self._latest: Telemetry | None = None
        self._latest = self._as_telemetry(self.cursor.frame())

    def step(self, dt: float) -> Telemetry:
        self._latest = self._as_telemetry(self.cursor.advance(dt))
        return self._latest

    @property
    def latest(self) -> Telemetry | None:
        return self._latest

    @property
    def alarms(self) -> list[Alarm]:
        # Alarm records were not part of the frame contract, so a replay shows
        # the process values and leaves the alarm list empty rather than
        # inventing alarms that were never raised.
        return []

    @property
    def alarm_records(self) -> list[Alarm]:
        return []

    def status(self) -> ProviderStatus:
        frame = self._latest
        return ProviderStatus(
            asset_state=frame.asset_state if frame else "OFF",
            data_source=self.data_source.value,
            valve_opening=1.0,
            rpm_setpoint=frame.rpm if frame else 0.0,
            injected_fault=frame.fault_state if frame else FaultType.NORMAL.value,
            injected_severity=frame.severity if frame else 0.0,
            auto_mode=False,
            blocked_reason=READ_ONLY_REASON,
            discharge_blockage=(
                frame.severity if frame and frame.fault_state == FaultType.FLOW_RESTRICTION.value else 0.0
            ),
            extra={"replay": self.cursor.transport()},
        )

    def command(self, name: str, **kwargs: Any) -> CommandOutcome:
        action = str(name).strip().lower()
        if action == "play":
            self.cursor.play()
        elif action == "pause":
            self.cursor.pause()
        elif action == "seek":
            self.cursor.seek(float(kwargs.get("position_s", 0.0)))
        elif action == "speed":
            self.cursor.set_speed(float(kwargs.get("speed", 1.0)))
        else:
            return CommandOutcome(False, READ_ONLY_REASON, self.status().asset_state)
        return CommandOutcome(True, f"replay {action}", self.status().asset_state)

    def inject_fault(self, fault: FaultType, severity: float) -> CommandOutcome:
        return CommandOutcome(False, READ_ONLY_REASON, self.status().asset_state)

    def clear_fault(self) -> CommandOutcome:
        return CommandOutcome(False, READ_ONLY_REASON, self.status().asset_state)

    def set_valve(self, opening: float) -> CommandOutcome:
        return CommandOutcome(False, READ_ONLY_REASON, self.status().asset_state)

    def set_speed(self, rpm: float) -> CommandOutcome:
        return CommandOutcome(False, READ_ONLY_REASON, self.status().asset_state)

    @staticmethod
    def _as_telemetry(frame: dict[str, Any]) -> Telemetry:
        """Rebuild the dataclass, dropping keys the contract has since removed.

        A run recorded against an older schema must not crash the replay. Fields
        the contract has added since are left at their defaults, and the frame's
        own `schema_version` travels with it so the UI can see the difference.
        """
        allowed = Telemetry.__dataclass_fields__
        return Telemetry(**{key: value for key, value in frame.items() if key in allowed})


# --------------------------------------------------------------------------
# Future sources -- declared, not implemented
# --------------------------------------------------------------------------


class _UnimplementedProvider(DataProvider):
    """Shared refusal for the field-protocol providers.

    Each of them needs one thing that cannot be guessed and is specific to an
    installation -- a register map, a node-id map, a topic map. Shipping a class
    that connects and returns zeros would put fabricated plant data behind a
    `LIVE_DEVICE` badge, which is the single worst thing this codebase could do.
    """

    data_source = DataSource.LIVE_DEVICE
    protocol = "unspecified"
    missing = "a point map"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._refuse()

    def _refuse(self) -> None:
        raise NotImplementedError(
            f"{self.protocol} support is declared but not implemented: it needs {self.missing}, "
            "which is specific to the installation and cannot be inferred. "
            "Implement this class against the real asset before selecting it with DATA_SOURCE."
        )

    def step(self, dt: float) -> Telemetry:
        self._refuse()

    @property
    def latest(self) -> Telemetry | None:
        self._refuse()

    @property
    def alarms(self) -> list[Alarm]:
        self._refuse()

    @property
    def alarm_records(self) -> list[Alarm]:
        self._refuse()

    def status(self) -> ProviderStatus:
        self._refuse()

    def command(self, name: str, **kwargs: Any) -> CommandOutcome:
        self._refuse()

    def inject_fault(self, fault: FaultType, severity: float) -> CommandOutcome:
        self._refuse()

    def clear_fault(self) -> CommandOutcome:
        self._refuse()

    def set_valve(self, opening: float) -> CommandOutcome:
        self._refuse()

    def set_speed(self, rpm: float) -> CommandOutcome:
        self._refuse()


class ModbusDataProvider(_UnimplementedProvider):
    """FUTURE: poll holding registers over Modbus TCP (pymodbus).

    Needs the register map for this asset -- address, word order, scaling and
    engineering unit per point. A wrong word order reads a plausible number, so
    the map has to come from the device documentation, not from experiment.
    """

    protocol = "Modbus TCP"
    missing = "a register map (address, word order, scaling and unit per point)"


class OPCUADataProvider(_UnimplementedProvider):
    """FUTURE: subscribe to an OPC UA server (asyncua).

    Needs the node ids for each measurement, plus the security policy and
    certificate for the connection.
    """

    protocol = "OPC UA"
    missing = "node ids for each measurement and the connection's security policy"


class MQTTDataProvider(_UnimplementedProvider):
    """FUTURE: subscribe to an MQTT broker, most likely Sparkplug B (paho-mqtt).

    Needs the topic map and the payload encoding; Sparkplug metric aliases are
    assigned at birth, so the birth certificate has to be handled too.
    """

    protocol = "MQTT"
    missing = "a topic map and the payload encoding (Sparkplug B birth certificate)"


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------


def build_provider(
    session_id: str,
    data_source: DataSource,
    replay_store: ReplayStore | None = None,
) -> DataProvider:
    """The provider for one new session, chosen by `DATA_SOURCE`.

    `RECORDED` falls back to a live simulation when the store holds no run --
    with a plain simulation provider, so `data_source` on the frames says
    SIMULATION and the UI's provenance banner stays truthful. Serving simulated
    frames under a RECORDED badge would be a lie about where data came from.
    """
    if data_source is DataSource.RECORDED and replay_store is not None:
        run = replay_store.latest()
        if run is not None and run.frames:
            return RecordedDataProvider(run)
    if data_source is DataSource.LIVE_DEVICE:
        raise NotImplementedError(
            "DATA_SOURCE=LIVE_DEVICE requires one of the field-protocol providers, "
            "none of which is implemented. See ModbusDataProvider."
        )
    return SimulationDataProvider(session_id)


def record_reference_run(
    replay_store: ReplayStore,
    label: str = "cavitation inception",
    fault: FaultType = FaultType.CAVITATION,
    severity: float = 0.8,
    dt: float = 0.2,
    healthy_s: float = 20.0,
    fault_s: float = 100.0,
) -> RecordedRun:
    """Drive a headless simulation through one fault and store the result.

    This is how a recorded run gets made in the first place, and it lives here
    rather than in `storage` on purpose: the store's job is to keep frames, not
    to know how to produce them. Deterministic -- the session id seeds the
    simulator -- so the same call always yields the same run.
    """
    session = SimulationSession(f"reference-{fault.value}")
    session.command("start")
    frames: list[dict[str, Any]] = []
    for _ in range(int(healthy_s / dt)):
        frames.append(session.step(dt).to_dict())
    session.inject_fault(fault.value, severity)
    for _ in range(int(fault_s / dt)):
        frames.append(session.step(dt).to_dict())

    run = RecordedRun(
        run_id=uuid.uuid4().hex[:12],
        label=label,
        fault=fault.value,
        severity=severity,
        created_at=datetime.now(timezone.utc).isoformat(),
        frames=frames,
    )
    return replay_store.save(run)


__all__ = [
    "READ_ONLY_REASON",
    "CommandOutcome",
    "DataProvider",
    "MQTTDataProvider",
    "ModbusDataProvider",
    "OPCUADataProvider",
    "ProviderStatus",
    "RecordedDataProvider",
    "SimulationDataProvider",
    "build_provider",
    "record_reference_run",
]
