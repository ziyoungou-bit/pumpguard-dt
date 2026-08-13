"""SCADA state machine for the motor-pump set.

Modelled on how a real motor control block behaves (the Rockwell/Siemens
"motor object" pattern, and ISA-88's OFF/RUNNING/STOPPING/ABORTED shape):
every transition is a table entry, an event that is not in the table for the
current state is *rejected with a reason* rather than raising, and the caller
gets that reason back so the HMI can display "START rejected: emergency stop
active" instead of silently doing nothing.

    OFF ---------START--------> STARTING ---START_COMPLETE--> RUNNING
     ^                             |                             |
     |                             +---------STOP/TRIP-----------+
     |                                          |
     |                                          v
     +------STOP_COMPLETE------------------- STOPPING ---FAULT_LATCHED--> FAULT
                                                                            |
     +------------------------------RESET-----------------------------------+

Two rules override everything and are the reason this is a state machine and
not a boolean:

  * E_STOP is reachable from every state and can only be left by an explicit
    reset of the emergency stop itself. START is never legal from E_STOP.
  * A trip does not stop the motor dead. It commands STOPPING, the shaft
    coasts down, and only when it has stopped does the machine latch FAULT,
    so a tripped machine is distinguishable from one an operator stopped.

Speed is part of this object because it is part of the state: STARTING is
defined by the ramp, and a stopped pump does not teleport to zero rpm -- it
coasts on its own inertia, and the hydraulics follow the speed down.
"""

from __future__ import annotations

import math
from enum import Enum
from typing import NamedTuple

from ..contracts import AssetState


class Event(str, Enum):
    START = "START"
    STOP = "STOP"
    START_COMPLETE = "START_COMPLETE"
    STOP_COMPLETE = "STOP_COMPLETE"
    TRIP = "TRIP"
    FAULT_LATCHED = "FAULT_LATCHED"
    ESTOP = "ESTOP"
    ESTOP_RESET = "ESTOP_RESET"
    RESET = "RESET"
    ENTER_MAINTENANCE = "ENTER_MAINTENANCE"
    EXIT_MAINTENANCE = "EXIT_MAINTENANCE"


#: The whole legal transition space. Anything absent is illegal by definition;
#: there is no fall-through and no "if it looks safe" branch anywhere else.
TRANSITIONS: dict[AssetState, dict[Event, AssetState]] = {
    AssetState.OFF: {
        Event.START: AssetState.STARTING,
        Event.TRIP: AssetState.FAULT,
        Event.ESTOP: AssetState.E_STOP,
        Event.ENTER_MAINTENANCE: AssetState.MAINTENANCE,
    },
    AssetState.STARTING: {
        Event.START_COMPLETE: AssetState.RUNNING,
        Event.STOP: AssetState.STOPPING,
        Event.TRIP: AssetState.STOPPING,
        Event.ESTOP: AssetState.E_STOP,
    },
    AssetState.RUNNING: {
        Event.STOP: AssetState.STOPPING,
        Event.TRIP: AssetState.STOPPING,
        Event.ESTOP: AssetState.E_STOP,
    },
    AssetState.STOPPING: {
        Event.STOP_COMPLETE: AssetState.OFF,
        Event.FAULT_LATCHED: AssetState.FAULT,
        Event.ESTOP: AssetState.E_STOP,
    },
    AssetState.FAULT: {
        Event.RESET: AssetState.OFF,
        Event.ESTOP: AssetState.E_STOP,
        Event.ENTER_MAINTENANCE: AssetState.MAINTENANCE,
    },
    # Deliberately minimal: an emergency stop is left only by resetting the
    # emergency stop. No start, no maintenance, no reset shortcut.
    AssetState.E_STOP: {
        Event.ESTOP_RESET: AssetState.OFF,
    },
    # No START entry: the asset is under someone else's control and an
    # automatic start would be a safety incident.
    AssetState.MAINTENANCE: {
        Event.EXIT_MAINTENANCE: AssetState.OFF,
        Event.ESTOP: AssetState.E_STOP,
    },
}

#: States in which the drive is energised and the shaft is being driven.
DRIVEN_STATES: frozenset[AssetState] = frozenset({AssetState.STARTING, AssetState.RUNNING})


class TransitionResult(NamedTuple):
    """The answer to every command: did it happen, and if not why not."""

    accepted: bool
    reason: str


class PumpStateMachine:
    """State, speed and the rules that connect them. One per session."""

    #: Time to ramp from standstill to the speed setpoint.
    START_RAMP_S: float = 3.0
    #: Coast-down time constant of the rotating assembly, free-wheeling.
    COAST_TAU_S: float = 2.0
    #: An emergency stop brakes rather than coasts.
    ESTOP_COAST_TAU_S: float = 0.6
    #: Below this the shaft is considered stopped.
    ZERO_SPEED_RPM: float = 5.0
    #: Fraction of setpoint at which the start is declared complete.
    AT_SPEED_FRACTION: float = 0.98

    def __init__(self, rated_speed_rpm: float, start_timeout_s: float) -> None:
        self.state: AssetState = AssetState.OFF
        self.rpm: float = 0.0
        self.speed_setpoint_rpm: float = rated_speed_rpm
        self._rated_rpm = rated_speed_rpm
        self._start_timeout_s = start_timeout_s
        self.running_time_s: float = 0.0
        self.starting_time_s: float = 0.0
        self.estop_active: bool = False
        self.trip_reason: str = ""
        self._trip_latched: bool = False
        self.last_reason: str = ""

    # -- events -----------------------------------------------------------

    def fire(self, event: Event, reason: str = "") -> TransitionResult:
        """Apply an event, or reject it with an explanation."""
        allowed = TRANSITIONS[self.state]
        if event not in allowed:
            message = f"{event.value} rejected in state {self.state.value}"
            if self.state is AssetState.E_STOP:
                message += ": emergency stop active, reset it first"
            elif self.state is AssetState.MAINTENANCE:
                message += ": asset is under maintenance"
            elif self.state is AssetState.FAULT:
                message += ": fault must be reset first"
            self.last_reason = message
            return TransitionResult(False, message)

        target = allowed[event]
        if event is Event.TRIP:
            self._trip_latched = True
            self.trip_reason = reason
        elif event is Event.START:
            self.starting_time_s = 0.0
            self._trip_latched = False
            self.trip_reason = ""
        elif event is Event.RESET:
            self._trip_latched = False
            self.trip_reason = ""
        elif event is Event.ESTOP:
            self.estop_active = True
        elif event is Event.ESTOP_RESET:
            self.estop_active = False
            self._trip_latched = False
            self.trip_reason = ""

        self.state = target
        self.last_reason = f"{event.value}: {self.state.value}" + (f" ({reason})" if reason else "")
        return TransitionResult(True, self.last_reason)

    def request_start(self, permissive_reason: str = "") -> TransitionResult:
        """Start, subject to the permissive supplied by the interlock chain."""
        if self.estop_active:
            message = "START rejected: emergency stop active"
            self.last_reason = message
            return TransitionResult(False, message)
        if permissive_reason:
            message = f"START rejected: {permissive_reason}"
            self.last_reason = message
            return TransitionResult(False, message)
        return self.fire(Event.START)

    def request_estop(self, active: bool) -> TransitionResult:
        if active:
            return self.fire(Event.ESTOP, "emergency stop pressed")
        if self.state is not AssetState.E_STOP:
            self.estop_active = False
            self.last_reason = "emergency stop already released"
            return TransitionResult(True, self.last_reason)
        return self.fire(Event.ESTOP_RESET)

    def set_speed(self, rpm: float) -> float:
        """Speed setpoint, clamped to the drive's usable range."""
        self.speed_setpoint_rpm = min(max(float(rpm), 0.0), self._rated_rpm * 1.15)
        return self.speed_setpoint_rpm

    # -- time -------------------------------------------------------------

    def update(self, dt: float) -> None:
        """Advance the shaft speed and fire any automatic transitions."""
        if dt <= 0.0:
            return

        if self.state in DRIVEN_STATES:
            self._drive(dt)
        else:
            self._coast(dt)

        if self.state is AssetState.RUNNING:
            self.running_time_s += dt
        else:
            self.running_time_s = 0.0

    def _drive(self, dt: float) -> None:
        ramp_rate = self._rated_rpm / self.START_RAMP_S
        delta = self.speed_setpoint_rpm - self.rpm
        step = min(abs(delta), ramp_rate * dt)
        self.rpm += step if delta > 0 else -step

        if self.state is AssetState.STARTING:
            self.starting_time_s += dt
            if self.rpm >= self.speed_setpoint_rpm * self.AT_SPEED_FRACTION and self.speed_setpoint_rpm > 0:
                self.fire(Event.START_COMPLETE)
            elif self.starting_time_s > self._start_timeout_s:
                self.fire(Event.TRIP, "failed to reach speed within the start timeout")

    def _coast(self, dt: float) -> None:
        if self.rpm > 0.0:
            tau = self.ESTOP_COAST_TAU_S if self.state is AssetState.E_STOP else self.COAST_TAU_S
            # Free-wheeling deceleration is exponential: the retarding torque
            # (windage, fluid drag, bearing friction) falls with speed.
            self.rpm *= math.exp(-dt / tau)
            if self.rpm < self.ZERO_SPEED_RPM:
                self.rpm = 0.0

        if self.state is AssetState.STOPPING and self.rpm == 0.0:
            self.fire(Event.FAULT_LATCHED if self._trip_latched else Event.STOP_COMPLETE)

    # -- queries ----------------------------------------------------------

    @property
    def is_driven(self) -> bool:
        return self.state in DRIVEN_STATES

    @property
    def is_rotating(self) -> bool:
        return self.rpm > 0.0
