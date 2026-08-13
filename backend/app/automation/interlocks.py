"""Protective interlocks: the conditions that stop the machine without asking.

An alarm asks an operator to look at something. An interlock takes the asset
off line. They are separate objects in this codebase because they are separate
things in a plant, and conflating them is how you end up with either a
nuisance-tripping machine or an unprotected one.

Each interlock is evaluated on the *measured* values -- the same numbers the
operator sees -- not on the true process state. Protection that reads the
physics directly would be a simulation cheat: real protection can be fooled by
a bad instrument, and demonstrating that is part of the point of this project.

Every check carries its own on-delay. A pressure wave when a valve moves, or a
momentary loss of prime, must not stop a healthy pump; a sustained condition
must. The delays are in `config/alarm_thresholds.InterlockSettings` with the
reasoning for each.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..config.alarm_thresholds import INTERLOCKS, InterlockSettings
from ..config.pump_parameters import ASSET
from ..contracts import AssetState


@dataclass(frozen=True)
class InterlockResult:
    """One evaluated protective condition, ready to display or to log."""

    name: str
    tag: str
    description: str
    tripped: bool
    value: float
    threshold: float
    unit: str
    #: How long the condition has been present, against its on-delay.
    elapsed_s: float = 0.0

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "tag": self.tag,
            "description": self.description,
            "tripped": self.tripped,
            "value": round(self.value, 3),
            "threshold": self.threshold,
            "unit": self.unit,
            "elapsed_s": round(self.elapsed_s, 2),
        }


@dataclass
class ProcessSnapshot:
    """Everything the interlock chain is allowed to see.

    Deliberately a flat structure of measured values: the chain cannot reach
    into the simulator for a true value even if a future author wanted it to.
    """

    state: AssetState
    running_time_s: float
    estop_active: bool
    flow_lpm: float
    suction_pressure_kpa: float
    motor_temperature_c: float
    bearing_temperature_c: float
    vibration_rms_mm_s: float
    bad_sensor_tags: list[str] = field(default_factory=list)


class InterlockChain:
    """The protection scheme for one asset. One instance per session."""

    def __init__(self, settings: InterlockSettings = INTERLOCKS) -> None:
        self._s = settings
        self._timers: dict[str, float] = {}
        self._results: list[InterlockResult] = []

    # -- evaluation -------------------------------------------------------

    def evaluate(self, dt: float, snapshot: ProcessSnapshot) -> list[InterlockResult]:
        """Run every check and return the results, tripped ones included."""
        s = self._s
        # Process interlocks only apply once the machine is up and the line
        # has had time to fill. Before that the readings are meaningless.
        live = snapshot.state is AssetState.RUNNING and snapshot.running_time_s >= s.startup_grace_s
        energised = snapshot.state in (AssetState.STARTING, AssetState.RUNNING)

        results = [
            self._check(
                "emergency_stop",
                ASSET.motor,
                "Emergency stop",
                condition=snapshot.estop_active,
                value=1.0 if snapshot.estop_active else 0.0,
                threshold=1.0,
                unit="",
                delay_s=0.0,
                dt=dt,
            ),
            self._check(
                "low_suction_pressure",
                ASSET.suction_pressure,
                "Low suction pressure",
                condition=live and snapshot.suction_pressure_kpa < s.low_suction_pressure_kpa,
                value=snapshot.suction_pressure_kpa,
                threshold=s.low_suction_pressure_kpa,
                unit="kPa",
                delay_s=s.low_suction_delay_s,
                dt=dt,
            ),
            self._check(
                "no_flow",
                ASSET.flow,
                "No flow (loss of prime / dry running)",
                condition=live and snapshot.flow_lpm < s.no_flow_lpm,
                value=snapshot.flow_lpm,
                threshold=s.no_flow_lpm,
                unit="L/min",
                delay_s=s.no_flow_delay_s,
                dt=dt,
            ),
            self._check(
                "high_motor_temperature",
                ASSET.motor_temperature,
                "High motor winding temperature",
                condition=energised and snapshot.motor_temperature_c > s.high_motor_temperature_c,
                value=snapshot.motor_temperature_c,
                threshold=s.high_motor_temperature_c,
                unit="C",
                delay_s=0.0,
                dt=dt,
            ),
            self._check(
                "high_bearing_temperature",
                ASSET.bearing_temperature,
                "High bearing temperature",
                condition=energised and snapshot.bearing_temperature_c > s.high_bearing_temperature_c,
                value=snapshot.bearing_temperature_c,
                threshold=s.high_bearing_temperature_c,
                unit="C",
                delay_s=0.0,
                dt=dt,
            ),
            self._check(
                "extreme_vibration",
                ASSET.accelerometer,
                "Extreme vibration",
                condition=energised and snapshot.vibration_rms_mm_s > s.extreme_vibration_mm_s,
                value=snapshot.vibration_rms_mm_s,
                threshold=s.extreme_vibration_mm_s,
                unit="mm/s",
                delay_s=s.vibration_delay_s,
                dt=dt,
            ),
            self._check(
                "invalid_sensor",
                ",".join(snapshot.bad_sensor_tags) or ASSET.motor,
                "Critical instrument signal lost",
                condition=energised and bool(snapshot.bad_sensor_tags),
                value=float(len(snapshot.bad_sensor_tags)),
                threshold=1.0,
                unit="count",
                delay_s=s.invalid_sensor_delay_s,
                dt=dt,
            ),
        ]
        self._results = results
        return results

    def _check(
        self,
        name: str,
        tag: str,
        description: str,
        *,
        condition: bool,
        value: float,
        threshold: float,
        unit: str,
        delay_s: float,
        dt: float,
    ) -> InterlockResult:
        elapsed = self._timers.get(name, 0.0)
        elapsed = elapsed + dt if condition else 0.0
        self._timers[name] = elapsed
        return InterlockResult(
            name=name,
            tag=tag,
            description=description,
            tripped=condition and elapsed >= delay_s,
            value=value,
            threshold=threshold,
            unit=unit,
            elapsed_s=elapsed,
        )

    # -- queries ----------------------------------------------------------

    @property
    def results(self) -> list[InterlockResult]:
        return list(self._results)

    @property
    def tripped(self) -> list[InterlockResult]:
        return [r for r in self._results if r.tripped]

    def trip_reason(self) -> str:
        tripped = self.tripped
        if not tripped:
            return ""
        first = tripped[0]
        return f"{first.description} ({first.value:.2f} {first.unit} vs {first.threshold:.2f})".strip()

    def start_permissive(self, snapshot: ProcessSnapshot) -> str:
        """Empty string means the start is allowed; otherwise the reason it is not.

        Only conditions that are meaningful on a stopped machine are checked.
        Flow and suction pressure are not: a stopped pump has neither, and
        blocking a start on them would make the asset unstartable.
        """
        s = self._s
        if snapshot.estop_active:
            return "emergency stop active"
        if snapshot.motor_temperature_c > s.high_motor_temperature_c:
            return f"motor temperature {snapshot.motor_temperature_c:.1f} C above {s.high_motor_temperature_c:.0f} C"
        if snapshot.bearing_temperature_c > s.high_bearing_temperature_c:
            return f"bearing temperature {snapshot.bearing_temperature_c:.1f} C above {s.high_bearing_temperature_c:.0f} C"
        if snapshot.bad_sensor_tags:
            return f"critical instrument unavailable: {', '.join(snapshot.bad_sensor_tags)}"
        return ""

    def reset(self) -> None:
        self._timers.clear()
        self._results = []
