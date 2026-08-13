"""Alarm management: raise once, escalate in place, clear with a deadband.

Built to the shape of ISA-18.2 / EEMUA 191 alarm management, because the
failure mode this module exists to prevent is the one those standards were
written for: an alarm system that produces more messages than a human can
read is not a safety system, it is noise.

Three rules do most of the work:

  1. **One record per condition.** A condition is `(tag, direction)` -- "flow
     low", "vibration high". While it stays present the record stays ACTIVE
     and its value is updated in place. It is never re-raised, so a fault
     lasting ten minutes at 10 Hz produces one row, not six thousand.
  2. **Escalation is not a new alarm.** When low flow becomes very low flow the
     existing record's severity is raised from WARNING to ALARM. An operator
     watching one line change colour is better informed than one watching a
     list grow.
  3. **Clearing has a deadband.** A reading sitting exactly on a limit would
     otherwise flap the alarm on and off every tick.

Acknowledgement never clears an alarm and clearing never acknowledges one:
they are independent, as they are in every real system.
"""

from __future__ import annotations

from ..config.alarm_thresholds import ALARM_LIMITS, AlarmLimit
from ..contracts import Alarm, AlarmSeverity

ACTIVE = "ACTIVE"
CLEARED = "CLEARED"


class AlarmManager:
    """Alarm state for one asset. One instance per session, no shared state."""

    def __init__(self, limits: tuple[AlarmLimit, ...] = ALARM_LIMITS) -> None:
        self._limits = limits
        self._active: dict[str, Alarm] = {}
        self._history: list[Alarm] = []
        self._next_id = 1

    # -- evaluation -------------------------------------------------------

    def evaluate(self, timestamp: str, readings: dict[str, float], enabled: bool = True) -> None:
        """Compare every configured limit against the current readings.

        `enabled` False (start inhibit, machine stopped) freezes the alarm
        list: nothing new is raised and nothing already raised is thrown away.
        Alarms survive the shutdown they caused, which is what an operator
        investigating a trip needs.
        """
        if not enabled:
            return
        for limit in self._limits:
            if limit.key not in readings:
                continue
            self._apply(timestamp, limit, readings[limit.key])

    def _apply(self, timestamp: str, limit: AlarmLimit, value: float) -> None:
        severity = _severity_for(limit, value)
        existing = self._active.get(limit.key)

        if severity is None:
            if existing is not None and _has_cleared(limit, value):
                existing.state = CLEARED
                existing.value = round(value, 3)
                self._history.append(existing)
                del self._active[limit.key]
            return

        if existing is None:
            self._active[limit.key] = Alarm(
                id=self._next_id,
                timestamp=timestamp,
                tag=limit.tag,
                description=limit.description,
                severity=severity.value,
                value=round(value, 3),
                threshold=_threshold_for(limit, severity),
                unit=limit.unit,
                state=ACTIVE,
            )
            self._next_id += 1
            return

        # Already active: update in place. Only escalation changes severity --
        # an alarm that has been at TRIP does not quietly demote itself to
        # WARNING while the condition is still there.
        existing.value = round(value, 3)
        if _rank(severity) > _rank(AlarmSeverity(existing.severity)):
            existing.severity = severity.value
            existing.threshold = _threshold_for(limit, severity)
            existing.timestamp = timestamp
            existing.acknowledged = False
            existing.acknowledged_at = ""

    # -- operator actions -------------------------------------------------

    def acknowledge(self, timestamp: str, alarm_id: int | None = None) -> int:
        """Acknowledge one alarm, or all of them. Returns how many changed."""
        changed = 0
        for alarm in self._active.values():
            if alarm_id is not None and alarm.id != alarm_id:
                continue
            if not alarm.acknowledged:
                alarm.acknowledged = True
                alarm.acknowledged_at = timestamp
                changed += 1
        return changed

    def reset(self) -> int:
        """Clear every active alarm, as a fault reset does on a real panel.

        The records are kept in history: a reset removes the annunciation, not
        the evidence.
        """
        count = len(self._active)
        for alarm in self._active.values():
            alarm.state = CLEARED
            self._history.append(alarm)
        self._active.clear()
        return count

    # -- queries ----------------------------------------------------------

    @property
    def active(self) -> list[Alarm]:
        return sorted(self._active.values(), key=lambda a: a.id)

    @property
    def history(self) -> list[Alarm]:
        return list(self._history)

    @property
    def all_records(self) -> list[Alarm]:
        return sorted(self._history + list(self._active.values()), key=lambda a: a.id)

    @property
    def highest_severity(self) -> AlarmSeverity | None:
        if not self._active:
            return None
        return max((AlarmSeverity(a.severity) for a in self._active.values()), key=_rank)


_RANKS: dict[AlarmSeverity, int] = {
    AlarmSeverity.WARNING: 1,
    AlarmSeverity.ALARM: 2,
    AlarmSeverity.TRIP: 3,
    AlarmSeverity.CRITICAL: 4,
}


def _rank(severity: AlarmSeverity) -> int:
    return _RANKS[severity]


def _severity_for(limit: AlarmLimit, value: float) -> AlarmSeverity | None:
    """Highest severity band the value has entered, or None if it is healthy."""
    steps: list[tuple[float, AlarmSeverity]] = [
        (limit.warning, AlarmSeverity.WARNING),
        (limit.alarm, AlarmSeverity.ALARM),
        (limit.trip, AlarmSeverity.TRIP),
    ]
    if limit.critical is not None:
        steps.append((limit.critical, AlarmSeverity.CRITICAL))

    worst: AlarmSeverity | None = None
    for threshold, severity in steps:
        exceeded = value >= threshold if limit.direction == "high" else value <= threshold
        if exceeded:
            worst = severity
    return worst


def _threshold_for(limit: AlarmLimit, severity: AlarmSeverity) -> float:
    return {
        AlarmSeverity.WARNING: limit.warning,
        AlarmSeverity.ALARM: limit.alarm,
        AlarmSeverity.TRIP: limit.trip,
        AlarmSeverity.CRITICAL: limit.critical if limit.critical is not None else limit.trip,
    }[severity]


def _has_cleared(limit: AlarmLimit, value: float) -> bool:
    if limit.direction == "high":
        return value < limit.warning - limit.deadband
    return value > limit.warning + limit.deadband
