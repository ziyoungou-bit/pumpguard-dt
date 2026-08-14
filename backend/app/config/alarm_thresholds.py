"""Alarm limits and protective interlock settings.

Nothing in `alarms.py` or `interlocks.py` contains a number. They contain the
logic; this module contains the setpoints, so the whole protection philosophy
of the asset can be read and challenged in one place.

Every limit is placed against the verified healthy duty point (1450 rpm, valve
fully open), which is the reference a commissioning engineer would use:

    flow            21.0 L/min        suction pressure    92.0 kPa a
    head            7.59 m            discharge pressure 166.3 kPa a
    efficiency      41.9 %            current             0.671 A
    NPSH margin     7.02 m            vibration RMS      ~0.75 mm/s
    motor temp      ~58 C steady      bearing temp       ~46 C steady

Those last two rows moved a long way when the peak efficiency was corrected
from 62 % to 42 % on the specific-speed argument in pump_parameters.py. Shaft
power at duty rose from 51 W to 71 W, so the motor now sits at about 82 % of
its 120 W rating instead of 59 %, and the steady winding temperature rose with
it. The 65 C warning limit below therefore has roughly 7 C of headroom rather
than 24 C. That is thin but genuine: it is what this motor does at this duty,
and the previous comfortable margin was an artefact of understated shaft power,
not of a well-chosen motor. Resizing the motor is a design decision, not a
threshold decision, so the limits are left where the insulation class puts them.

The rule applied throughout: the nearest limit sits at least ten healthy
standard deviations, and a visible engineering margin, away from the duty
value. A machine in good order must sit silent, otherwise operators learn to
ignore the alarm list -- which is how real plants lose their protection.

Vibration limits follow ISO 10816-1 Class I (small machines below 15 kW):
1.8 mm/s good, 4.5 mm/s satisfactory, 7.1 mm/s unsatisfactory, above that
unacceptable. Those are the published band edges, used unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass

from .pump_parameters import ASSET


@dataclass(frozen=True)
class AlarmLimit:
    """One monitored condition with a three-step escalation.

    `direction` is "high" when exceeding the number is bad and "low" when
    falling below it is bad. `deadband` is applied on the clearing side only,
    so a reading sitting exactly on a limit does not chatter the alarm list.
    """

    key: str
    tag: str
    description: str
    unit: str
    direction: str  # "high" | "low"
    warning: float
    alarm: float
    trip: float
    deadband: float
    critical: float | None = None


ALARM_LIMITS: tuple[AlarmLimit, ...] = (
    AlarmLimit(
        key="flow_low",
        tag=ASSET.flow,
        description="Low discharge flow",
        unit="L/min",
        direction="low",
        # Duty 21.0. 14 L/min is a third below duty -- well outside any
        # legitimate operating point at full valve opening, and 78 sigma
        # away from the healthy reading.
        warning=14.0,
        alarm=9.0,
        trip=4.0,
        deadband=1.0,
    ),
    AlarmLimit(
        key="suction_pressure_low",
        tag=ASSET.suction_pressure,
        description="Low suction pressure",
        unit="kPa",
        direction="low",
        # Duty 92.0 kPa a. Below ~55 kPa a the NPSH margin is being eaten
        # rapidly; below 40 kPa a the pump is close to flashing.
        warning=70.0,
        alarm=55.0,
        trip=40.0,
        deadband=3.0,
    ),
    AlarmLimit(
        key="discharge_pressure_high",
        tag=ASSET.discharge_pressure,
        description="High discharge pressure",
        unit="kPa",
        direction="high",
        # Duty 166.3 kPa a; shutoff against a fully blocked line is about
        # 213 kPa a, so 215 flags a genuinely deadheaded pump only.
        warning=215.0,
        alarm=235.0,
        trip=260.0,
        deadband=4.0,
    ),
    AlarmLimit(
        key="motor_current_high",
        tag=ASSET.current,
        description="High motor current",
        unit="A",
        direction="high",
        # Motor rated 0.95 A, service factor 1.15 -> 1.09 A.
        warning=0.95,
        alarm=1.09,
        trip=1.30,
        deadband=0.03,
    ),
    AlarmLimit(
        key="motor_current_low",
        tag=ASSET.current,
        description="Low motor current (loss of load)",
        unit="A",
        direction="low",
        # Duty 0.563 A; a dry-running pump unloads to 0.423 A, which is the
        # electrical signature of losing prime. 0.46 A sits between the two
        # with 25 sigma of clearance from duty.
        warning=0.46,
        alarm=0.44,
        trip=0.43,
        deadband=0.02,
    ),
    AlarmLimit(
        key="motor_temperature_high",
        tag=ASSET.motor_temperature,
        description="High motor winding temperature",
        unit="C",
        direction="high",
        # Steady duty ~41 C. Class B insulation tolerates 130 C hot spot;
        # 90 C at the winding sensor is a conservative trip for this rig.
        warning=65.0,
        alarm=75.0,
        trip=90.0,
        deadband=2.0,
    ),
    AlarmLimit(
        key="bearing_temperature_high",
        tag=ASSET.bearing_temperature,
        description="High bearing temperature",
        unit="C",
        direction="high",
        # Steady duty ~35 C. Grease life halves every 15 C above 70 C.
        warning=55.0,
        alarm=65.0,
        trip=80.0,
        deadband=2.0,
    ),
    AlarmLimit(
        key="vibration_high",
        tag=ASSET.accelerometer,
        description="High vibration (ISO 10816-1 Class I)",
        unit="mm/s",
        direction="high",
        warning=4.5,
        alarm=7.1,
        trip=11.2,
        critical=18.0,
        deadband=0.4,
    ),
    AlarmLimit(
        key="npsh_margin_low",
        tag=ASSET.pump,
        description="Low NPSH margin (cavitation risk)",
        unit="m",
        direction="low",
        # Duty margin 6.95 m. Below 1.5 m the margin is inside normal
        # engineering practice (1 m or 10 % of NPSHr, whichever is larger);
        # below zero the pump is cavitating by definition.
        warning=1.5,
        alarm=0.5,
        trip=-0.5,
        deadband=0.3,
    ),
)

#: Process alarms are inhibited until the machine has been running steadily
#: for this long. Flow, current and pressure are all legitimately out of
#: limits during a start ramp; alarming on them would train operators to
#: acknowledge blindly.
ALARM_STARTUP_INHIBIT_S: float = 10.0


@dataclass(frozen=True)
class InterlockSettings:
    """Protective trip settings.

    These are deliberately looser than the alarm limits above. An alarm asks
    an operator to look; an interlock takes the machine off line without
    asking. The delays exist so that a transient -- a pressure wave on valve
    movement, a momentary loss of prime that self-recovers -- does not stop a
    healthy pump.
    """

    #: Below this suction pressure the liquid is close to flashing.
    low_suction_pressure_kpa: float = 35.0
    #: Long enough to see the condition develop and be displayed, short
    #: enough that the pump is not run in hard cavitation for minutes.
    low_suction_delay_s: float = 10.0

    #: Dry-run / loss-of-prime protection.
    no_flow_lpm: float = 2.0
    #: Dry-run protection is conventionally slow (tens of seconds): a pump
    #: that briefly loses prime usually regains it, and a fast trip on flow
    #: makes the machine impossible to start against a full line.
    no_flow_delay_s: float = 30.0

    #: Flow, current and pressure are meaningless until the pump is up to
    #: speed and the line is full.
    startup_grace_s: float = 10.0
    #: A start that never reaches speed is a mechanical problem.
    start_timeout_s: float = 15.0

    high_motor_temperature_c: float = 90.0
    high_bearing_temperature_c: float = 80.0

    #: Beyond ISO 10816 Class I "unacceptable" by a factor of ~1.6.
    extreme_vibration_mm_s: float = 18.0
    vibration_delay_s: float = 2.0

    #: How long a critical sensor may be dead before the machine is stopped.
    invalid_sensor_delay_s: float = 3.0


INTERLOCKS = InterlockSettings()
