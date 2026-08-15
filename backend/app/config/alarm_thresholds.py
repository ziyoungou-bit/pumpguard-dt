"""Alarm limits and protective interlock settings.

Nothing in `alarms.py` or `interlocks.py` contains a number. They contain the
logic; this module contains the setpoints, so the whole protection philosophy
of the asset can be read and challenged in one place.

Every limit is placed against the verified healthy duty point (1450 rpm, valve
fully open), which is the reference a commissioning engineer would use:

    flow            21.0 L/min        suction pressure    92.0 kPa a
    head            7.59 m            discharge pressure 166.3 kPa a
    efficiency      41.9 %            current             0.671 A
    NPSH margin     7.02 m            vibration RMS      ~0.80 mm/s
    motor temp      ~48 C steady      bearing temp       ~40 C steady

Those last two rows moved when the peak efficiency was corrected from 62 % to
42 % on the specific-speed argument in pump_parameters.py. Shaft power at duty
rose from 51 W to 71 W, so the motor sits at about 59 % of its 120 W rating
instead of 43 %, and the steady winding temperature rose with it. The 65 C
warning has roughly 17 C of headroom. Load fraction here is SHAFT power over
the rating -- a motor's rated power is its shaft output, so dividing electrical
input by it would double-count the motor's own losses and read 82 %.

The rule applied throughout: the nearest limit sits at least ten healthy
standard deviations, and a visible engineering margin, away from the duty
value. A machine in good order must sit silent, otherwise operators learn to
ignore the alarm list -- which is how real plants lose their protection.

Vibration limits use the ISO 20816-1 Class I rigid-support zone edges:
0.71 mm/s (A/B, newly commissioned), 1.8 mm/s (B/C, end of unrestricted
long-term operation), 4.5 mm/s (C/D, damage may occur). Those are the published
band edges, used unchanged, over a 10-1000 Hz band.

SCOPE, stated because it matters and because omitting it would be borrowing
authority this asset has not earned. ISO 10816-3 -- which an earlier version of
this file cited -- has been withdrawn and replaced by ISO 20816-3. More to the
point, neither ISO 20816-3 (rated power above 15 kW) nor ISO 20816-7
(rotodynamic pumps, roughly 1 kW and above) covers a machine developing about
51 W at the shaft. This asset falls below the scope of every ISO
vibration-severity standard there is. The numbers are right; the citation was
not. They are applied BY ANALOGY, not by certification, and every surface that
displays them says so. Do not remove that statement to tidy a layout.
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


@dataclass(frozen=True)
class VibrationSeverityBands:
    """ISO 20816-1 Class I zone boundaries, and the operational limits derived
    from them.

    Class I is machines up to 15 kW on rigid supports. The three boundaries are
    the published ones and are used unchanged:

        A/B  0.71 mm/s   newly commissioned
        B/C  1.8  mm/s   unrestricted long-term operation
        C/D  4.5  mm/s   restricted operation; above this, damage may occur

    TRIP is not a fourth boundary -- the standard does not define one, because
    zone D is open-ended. It comes instead from ISO 20816-1's guidance on
    setting operational limits, which recommends that the TRIP value does not
    exceed 1.25 times the upper limit of zone C. So it is DERIVED here rather
    than written down: 1.25 x 4.5 = 5.625 mm/s.

    That replaces an `extreme_vibration_mm_s = 18.0` which appeared in exactly
    one place, was four times the zone C/D boundary, and had no source at all.
    A number with no provenance is not a conservative limit, it is an unexamined
    one.

    SCOPE, unchanged and deliberate: at ~51 W shaft power this asset is below
    the scope of ISO 20816-3 (>15 kW) and ISO 20816-7 (rotodynamic pumps). The
    boundaries are correct and are applied BY ANALOGY, not by certification.
    """

    zone_a_b_mm_s: float = 0.71
    zone_b_c_mm_s: float = 1.8
    zone_c_d_mm_s: float = 4.5

    #: ISO 20816-1: TRIP should not exceed this multiple of the zone C limit.
    trip_factor_of_zone_c: float = 1.25

    #: Every velocity RMS on this platform is measured over this band.
    band_low_hz: float = 10.0
    band_high_hz: float = 1000.0

    @property
    def trip_mm_s(self) -> float:
        """Derived, never typed in. See the class docstring for the citation."""
        return self.trip_factor_of_zone_c * self.zone_c_d_mm_s


@dataclass(frozen=True)
class TemperatureLimits:
    """One warning and one alarm per measurement point, with the basis stated.

    These were previously four different opinions each: the backend warned on
    the motor at 65 C, the dashboard coloured its tile at 70, the demo alarm
    fired at 78 and the trend line was drawn at 78. The values below are the
    backend's, nominated as the single source; the divergent UI sites are marked
    TODO(RECONCILE) and converge in Step 3.

    Motor winding
        Steady duty is about 48 C at this rig's 23 C ambient. Warning at 65 C is
        the duty value plus a visible margin, which is the commissioning
        practice this whole module follows -- limits placed against a verified
        healthy point rather than against a catalogue. The TRIP is the one
        anchored externally: IEC 60034-1 insulation Class B permits a 130 C
        hot spot, and 90 C at a winding-embedded detector leaves 40 K for the
        hot-spot gradient and for sensor placement.

    Bearing
        Steady duty is about 40 C. Warning at 55 C on the same basis. The TRIP
        at 80 C comes from grease life rather than from metal: mineral-oil
        lithium grease loses roughly half its life for every 15 K above 70 C
        (the standard rolling-bearing rule, e.g. SKF's grease-life diagram), so
        sustained operation above 80 C is a maintenance decision, not a normal
        condition.
    """

    motor_warning_c: float = 65.0
    motor_alarm_c: float = 75.0
    motor_trip_c: float = 90.0

    bearing_warning_c: float = 55.0
    bearing_alarm_c: float = 65.0
    bearing_trip_c: float = 80.0


@dataclass(frozen=True)
class VibrationBlock:
    """One named vibration acquisition configuration.

    There are two of these, and they are deliberately different. Naming both
    here is the alternative to an exemption list: a difference that can be given
    a name and a reason is not a magic number, and a difference that cannot be
    named was never deliberate and should be removed instead of suppressed.

    Resolution is fs / N and nothing improves it -- zero padding interpolates,
    it does not resolve.
    """

    name: str
    sampling_rate_hz: float
    block_size: int
    purpose: str

    @property
    def resolution_hz(self) -> float:
        return self.sampling_rate_hz / self.block_size

    @property
    def duration_s(self) -> float:
        return self.block_size / self.sampling_rate_hz


#: The acquisition the backend measures features from, and the one the ML
#: model was trained against. 5120 Hz is 2.56 x a 2000 Hz analysis range, the
#: standard condition-monitoring choice with the usual anti-alias margin;
#: 4096 samples is 0.8 s at 1.25 Hz resolution, which separates 1x, 2x, 3x and
#: the 145 Hz vane pass comfortably. Changing either shifts every ML feature
#: and obliges a retrain, which is why it is not simply raised to match the
#: display block below.
ACQUISITION = VibrationBlock(
    name="acquisition",
    sampling_rate_hz=5120.0,
    block_size=4096,
    purpose="feature extraction and ML input; 1.25 Hz resolution",
)

#: The acquisition the browser synthesises for the Vibration page. Longer and
#: slower: 2560 Hz over 8192 samples is 3.2 s at 0.3125 Hz. The resolution is
#: the whole reason it differs. The most confusable pair on this machine is 2x
#: mechanical at 48.33 Hz against line frequency at 50.0 Hz -- 1.67 Hz apart,
#: which is 5.3 bins here and separable, but only 1.33 bins in ACQUISITION and
#: not separable at all. Mistaking one for the other is the difference between
#: "the rotor is unbalanced" and "the motor has an electrical asymmetry".
DISPLAY_BLOCK = VibrationBlock(
    name="display",
    sampling_rate_hz=2560.0,
    block_size=8192,
    purpose="browser-side spectrum; 0.3125 Hz resolution, separates 2x from line frequency",
)


VIBRATION = VibrationSeverityBands()
TEMPERATURE = TemperatureLimits()


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
        # Basis in TemperatureLimits.
        warning=TEMPERATURE.motor_warning_c,
        alarm=TEMPERATURE.motor_alarm_c,
        trip=TEMPERATURE.motor_trip_c,
        deadband=2.0,
    ),
    AlarmLimit(
        key="bearing_temperature_high",
        tag=ASSET.bearing_temperature,
        description="High bearing temperature",
        unit="C",
        direction="high",
        # Basis in TemperatureLimits.
        warning=TEMPERATURE.bearing_warning_c,
        alarm=TEMPERATURE.bearing_alarm_c,
        trip=TEMPERATURE.bearing_trip_c,
        deadband=2.0,
    ),
    AlarmLimit(
        key="vibration_high",
        tag=ASSET.accelerometer,
        description=(
            f"High vibration (ISO 20816-1 Class I band edges, "
            f"{VIBRATION.band_low_hz:.0f}-{VIBRATION.band_high_hz:.0f} Hz)"
        ),
        unit="mm/s",
        direction="high",
        # Escalation mapped onto the zone edges rather than sitting inside one
        # of them. Warning at the B/C edge is the point the standard calls the
        # end of unrestricted long-term operation; alarm at C/D is where damage
        # becomes possible.
        #
        # There is no CRITICAL step. It used to be 11.2 mm/s, which is not a
        # boundary in any standard -- zone D is open-ended, so a fourth level
        # would have had to be invented. TRIP is derived from ISO 20816-1's
        # operational-limit rule instead; see VibrationSeverityBands.
        warning=VIBRATION.zone_b_c_mm_s,
        alarm=VIBRATION.zone_c_d_mm_s,
        trip=VIBRATION.trip_mm_s,
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

    high_motor_temperature_c: float = TEMPERATURE.motor_trip_c
    high_bearing_temperature_c: float = TEMPERATURE.bearing_trip_c

    #: ISO 20816-1's own operational-limit rule: TRIP should not exceed 1.25
    #: times the upper limit of zone C. Derived, so it cannot drift from the
    #: bands. Replaces a hardcoded 18.0 which had no source at all.
    extreme_vibration_mm_s: float = VIBRATION.trip_mm_s
    vibration_delay_s: float = 2.0

    #: How long a critical sensor may be dead before the machine is stopped.
    invalid_sensor_delay_s: float = 3.0


INTERLOCKS = InterlockSettings()
