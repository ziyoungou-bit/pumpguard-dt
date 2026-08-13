"""Fault dynamics: how a condition develops, not what it looks like.

The distinction this module exists to enforce: injecting a fault does not set
an output. It moves a *physical parameter*, and the physics decides what the
instruments read. A blockage raises the resistance of the circuit, and the
operating point then slides up the pump curve on its own -- flow falls, head
rises, current falls. Nothing here writes a flow or a pressure.

Faults also do not appear instantly. A strainer clogs, a suction line starts
to draw air, a coupling works loose over hours. Every channel therefore ramps
with a first-order lag toward its target severity:

    severity += (target - severity) * (dt / tau)

which is the discrete form of tau * ds/dt = target - s. The default tau of 8 s
is a demonstration compression of a real degradation, chosen so a visitor can
watch the transition rather than see a step.

One channel per fault type, all of them always integrating. Injecting a new
fault sets that channel's target and drives the others to zero, so an operator
switching from cavitation to blockage sees one condition fade as the other
grows rather than a discontinuity.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..contracts import FaultType

#: Default ramp time constant, seconds.
DEFAULT_RAMP_S: float = 8.0
#: Ramps faster than this are indistinguishable from a step at any sane dt.
MIN_RAMP_S: float = 0.25
#: Below this a channel is treated as inactive for reporting purposes.
ACTIVE_THRESHOLD: float = 0.02

#: Fault types that are conditions of the machine. NORMAL is the absence of a
#: fault and SENSOR_FAULT lives entirely in the instrumentation, so neither
#: gets a dynamic channel of its own here.
_PROCESS_FAULTS: tuple[FaultType, ...] = (
    FaultType.IMBALANCE,
    FaultType.MISALIGNMENT,
    FaultType.FLOW_RESTRICTION,
    FaultType.CAVITATION,
    FaultType.DRY_RUN,
)


@dataclass
class _Channel:
    severity: float = 0.0
    target: float = 0.0
    tau_s: float = DEFAULT_RAMP_S


@dataclass(frozen=True)
class FaultEffects:
    """The physical parameters a fault state hands to the physics.

    Every field is an input to a model, never an output of one:

    * `discharge_blockage` goes into `pump_model.system_resistance` and moves
      the operating point along the pump curve.
    * `suction_restriction` goes into `pump_model.suction_pressure_pa`, which
      lowers NPSHa until the margin goes negative on its own.
    * `prime_loss` selects between the wetted and the dry solution of the same
      pump model.
    * `imbalance` and `misalignment` are mechanical, so they act on the
      vibration synthesis and add a little drag.
    """

    discharge_blockage: float = 0.0
    suction_restriction: float = 0.0
    prime_loss: float = 0.0
    imbalance: float = 0.0
    misalignment: float = 0.0
    #: Fractional loss of pump efficiency from mechanical defects. A bent or
    #: loose rotor does not pump quite as well and absorbs more drag.
    efficiency_penalty: float = 0.0


class FaultModel:
    """Per-session fault state. Holds no module-level data of any kind."""

    def __init__(self) -> None:
        self._channels: dict[FaultType, _Channel] = {f: _Channel() for f in _PROCESS_FAULTS}

    # -- commands ---------------------------------------------------------

    def inject(self, fault: FaultType, severity: float, ramp_s: float = DEFAULT_RAMP_S) -> None:
        """Aim one channel at `severity` and every other channel at zero."""
        if fault not in self._channels:
            raise ValueError(f"{fault.value} has no process dynamics; it is not an injectable machine fault")
        target = min(max(float(severity), 0.0), 1.0)
        tau = max(float(ramp_s), MIN_RAMP_S)
        for kind, channel in self._channels.items():
            channel.target = target if kind is fault else 0.0
            channel.tau_s = tau

    def clear(self, ramp_s: float = DEFAULT_RAMP_S) -> None:
        """Ramp every channel back to healthy."""
        tau = max(float(ramp_s), MIN_RAMP_S)
        for channel in self._channels.values():
            channel.target = 0.0
            channel.tau_s = tau

    # -- integration ------------------------------------------------------

    def update(self, dt: float) -> None:
        """Advance every channel by one tick of first-order lag."""
        if dt <= 0.0:
            return
        for channel in self._channels.values():
            # Clamped so a dt larger than tau cannot overshoot the target.
            gain = min(1.0, dt / channel.tau_s)
            channel.severity += (channel.target - channel.severity) * gain
            if channel.severity < 1e-4 and channel.target == 0.0:
                channel.severity = 0.0

    # -- state ------------------------------------------------------------

    def severity_of(self, fault: FaultType) -> float:
        channel = self._channels.get(fault)
        return channel.severity if channel else 0.0

    def dominant(self) -> tuple[FaultType, float]:
        """The fault currently defining the machine's condition."""
        kind, channel = max(self._channels.items(), key=lambda item: item[1].severity)
        if channel.severity < ACTIVE_THRESHOLD:
            return FaultType.NORMAL, 0.0
        return kind, channel.severity

    def effects(self) -> FaultEffects:
        """Translate severities into physical model parameters."""
        imbalance = self._channels[FaultType.IMBALANCE].severity
        misalignment = self._channels[FaultType.MISALIGNMENT].severity
        return FaultEffects(
            discharge_blockage=self._channels[FaultType.FLOW_RESTRICTION].severity,
            suction_restriction=self._channels[FaultType.CAVITATION].severity,
            prime_loss=self._channels[FaultType.DRY_RUN].severity,
            imbalance=imbalance,
            misalignment=misalignment,
            # A few per cent at full severity: measurable on the efficiency
            # trend, not large enough to masquerade as a hydraulic fault.
            efficiency_penalty=0.02 * imbalance + 0.03 * misalignment,
        )

    def snapshot(self) -> dict[str, float]:
        """All channel severities, for diagnostics and tests."""
        return {kind.value: channel.severity for kind, channel in self._channels.items()}
