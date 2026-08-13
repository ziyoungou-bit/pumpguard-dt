"""SCADA-side logic: the state machine, the interlock chain, the alarm list.

Kept apart from `simulation` on purpose. These modules would be the same if
the process values arrived from a real PLC instead of a model, and none of
them may read the true process state -- only what the instruments report.
"""

from .alarms import ACTIVE, CLEARED, AlarmManager
from .interlocks import InterlockChain, InterlockResult, ProcessSnapshot
from .state_machine import TRANSITIONS, Event, PumpStateMachine, TransitionResult

__all__ = [
    "AlarmManager",
    "ACTIVE",
    "CLEARED",
    "InterlockChain",
    "InterlockResult",
    "ProcessSnapshot",
    "PumpStateMachine",
    "Event",
    "TRANSITIONS",
    "TransitionResult",
]
