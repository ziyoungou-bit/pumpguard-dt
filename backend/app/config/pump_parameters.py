"""Centrifugal pump, motor and hydraulic circuit parameters for P-101 / MTR-101.

Every number the physics uses lives here. Nothing downstream may invent a
coefficient: if a value is not in this module it does not exist in the model.

The machine modelled is a small single-stage end-suction centrifugal pump on a
4-pole induction motor, of the size used on a laboratory test rig -- roughly
20 L/min at 8 m head. That scale is chosen deliberately so the numbers stay
checkable by hand and so the future physical rig in docs/hardware_roadmap.md
can use the same parameter set.

Sources of the model forms (not of the specific numbers, which are chosen to
suit this asset):
  - Quadratic pump curve  H = H0 - a*Q^2, the standard low-order fit to a
    centrifugal characteristic near BEP (Gulich, Centrifugal Pumps, ch. 4).
  - Quadratic system curve H = H_static + K*Q^2, Darcy-Weisbach losses lumped
    into a single resistance coefficient K.
  - Affinity laws for speed scaling: Q ~ N, H ~ N^2, P ~ N^3.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Fluid and environment
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class FluidProperties:
    """Water at ~20 C."""

    density: float = 998.2  # kg/m^3
    gravity: float = 9.80665  # m/s^2
    vapour_pressure: float = 2339.0  # Pa absolute, water at 20 C
    atmospheric_pressure: float = 101325.0  # Pa absolute


# --------------------------------------------------------------------------
# Pump P-101
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PumpParameters:
    """Quadratic head-flow characteristic at the rated speed.

    H(Q) = shutoff_head - head_coefficient * Q^2      [m, with Q in m^3/s]

    The coefficient is derived from two catalogue-style points rather than
    typed in blind: shutoff at 12.0 m and 8.0 m at the duty flow of 20 L/min.

        a = (H0 - H_duty) / Q_duty^2
          = (12.0 - 8.0) / (20/60000)^2
          = 4.0 / (3.3333e-4)^2
          = 3.60e7  m / (m^3/s)^2

    Efficiency is modelled as an inverted parabola peaking at the best
    efficiency point, which is the usual first-order shape.
    """

    tag: str = "P-101"
    rated_speed_rpm: float = 1450.0
    shutoff_head_m: float = 12.0
    duty_flow_lpm: float = 20.0
    duty_head_m: float = 8.0

    # Best efficiency point.
    bep_flow_lpm: float = 22.0
    bep_efficiency: float = 0.62
    # Width of the efficiency parabola: efficiency falls to zero this far from
    # BEP in either direction, in L/min.
    efficiency_span_lpm: float = 26.0
    minimum_efficiency: float = 0.05

    impeller_diameter_m: float = 0.105
    suction_diameter_m: float = 0.025
    discharge_diameter_m: float = 0.020
    # Vane count sets the blade-pass frequency: f_bpf = vanes * f_rotational.
    impeller_vanes: int = 6

    @property
    def head_coefficient(self) -> float:
        """`a` in H = H0 - a Q^2, in m/(m^3/s)^2, derived from the two points."""
        duty_flow_m3s = self.duty_flow_lpm / 60000.0
        return (self.shutoff_head_m - self.duty_head_m) / (duty_flow_m3s**2)


# --------------------------------------------------------------------------
# Motor MTR-101
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class MotorParameters:
    """4-pole induction motor, 50 Hz, single-phase 230 V.

    Synchronous speed = 120 * 50 / 4 = 1500 rpm; 1450 rpm rated implies
    slip = (1500 - 1450) / 1500 = 3.3 %, which is typical for this size.

    Sizing note. This was first written as a 0.75 kW 415 V three-phase motor,
    which is wrong for this pump and broke the model: the duty hydraulic power
    is only about 26 W, so the computed line current sat permanently on the
    no-load floor and carried no information about the hydraulic state. Current
    is one of the diagnostic signals, so a motor whose current never moves makes
    blockage and dry-run undetectable electrically. A 0.37 kW single-phase motor
    is both realistic for a 20 L/min rig and leaves current responsive to load.
    """

    tag: str = "MTR-101"
    # Duty shaft power is ~42 W (26 W hydraulic at 62 % pump efficiency), so a
    # 370 W motor would run at 11 % load where current is almost entirely
    # magnetising and barely responds to the hydraulics. 120 W puts the duty
    # point near 40 % load, which is a sensible margin and keeps current
    # diagnostic.
    rated_power_w: float = 120.0
    rated_speed_rpm: float = 1450.0
    synchronous_speed_rpm: float = 1500.0
    supply_frequency_hz: float = 50.0
    poles: int = 4
    rated_voltage_v: float = 230.0
    phases: int = 1
    power_factor: float = 0.82
    efficiency: float = 0.72  # small single-phase motors are not efficient
    # Magnetising current with no mechanical load.
    no_load_current_a: float = 0.42
    rated_current_a: float = 0.95
    service_factor: float = 1.15
    # Mechanical drag at rated speed: bearings, seal and windage, absorbed
    # whatever the hydraulic load. Sized as a realistic fraction of a small
    # pump's shaft power rather than of the motor rating -- deriving it from
    # the motor rating made parasitic loss four times the hydraulic power and
    # swamped every hydraulic effect.
    parasitic_loss_at_rated_w: float = 9.0


# --------------------------------------------------------------------------
# Hydraulic circuit: suction line, discharge line, control valve
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class HydraulicCircuit:
    """System curve H = H_static + K(valve) * Q^2.

    K is split into a fixed pipe-friction part and a valve part so that closing
    the valve changes the system resistance -- and therefore moves the
    operating point along the pump curve -- instead of subtracting a number
    from the flow.
    """

    static_head_m: float = 2.0  # geometric lift, reservoir to discharge
    # Fixed friction of pipework and fittings, m/(m^3/s)^2.
    #
    # Chosen so the fully-open operating point lands near the best efficiency
    # point rather than out at runout. Solving the intersection backwards for a
    # target duty flow of 21 L/min:
    #     a + K = (H0 - H_static) / Q*^2 = (12 - 2) / (21/60000)^2 = 8.16e7
    #     K     = 8.16e7 - 3.60e7 = 4.56e7
    #     pipe  = K - valve_open = 4.56e7 - 0.30e7 = 4.26e7
    # A small-bore rig with several metres of 20 mm tubing and fittings really
    # does have a resistance this high.
    pipe_resistance: float = 4.26e7
    # Additional resistance at 100 % open. A real valve is never lossless.
    valve_resistance_open: float = 0.30e7
    # Resistance approached as the valve shuts. Not infinite: a shut valve
    # still leaks slightly, and an infinite value makes the solver ill-posed.
    valve_resistance_closed: float = 4.0e9
    # Suction-side friction, used for the suction pressure and NPSH estimate.
    suction_resistance: float = 0.45e7
    suction_lift_m: float = 1.2  # pump above reservoir surface
    reservoir_level_m: float = 0.8


# --------------------------------------------------------------------------
# Rolling-element bearing geometry (for BPFO/BPFI/BSF/FTF)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class BearingGeometry:
    """A 6205-size deep-groove ball bearing, the usual small-pump bearing."""

    designation: str = "6205"
    rolling_elements: int = 9
    ball_diameter_mm: float = 7.94
    pitch_diameter_mm: float = 39.04
    contact_angle_deg: float = 0.0


# --------------------------------------------------------------------------
# Thermal model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ThermalParameters:
    """First-order thermal rise toward a load-dependent steady state.

    T(t) -> T_ambient + rise_at_rated * load_fraction, with time constant tau.
    Motor and bearing warm at different rates, which is why they are separate.
    """

    ambient_c: float = 23.0
    motor_rise_at_rated_c: float = 42.0
    motor_time_constant_s: float = 420.0
    bearing_rise_at_rated_c: float = 28.0
    bearing_time_constant_s: float = 300.0
    # Loss of hydraulic cooling (dry run) adds this much on top, slowly.
    dry_run_extra_rise_c: float = 55.0
    dry_run_time_constant_s: float = 180.0


PUMP = PumpParameters()
MOTOR = MotorParameters()
FLUID = FluidProperties()
CIRCUIT = HydraulicCircuit()
BEARING = BearingGeometry()
THERMAL = ThermalParameters()


@dataclass(frozen=True)
class AssetIdentity:
    """Equipment tags, used consistently across API, UI and alarms."""

    motor: str = "MTR-101"
    pump: str = "P-101"
    accelerometer: str = "ACC-101"
    motor_temperature: str = "TT-101"
    bearing_temperature: str = "TT-102"
    suction_pressure: str = "PT-101"
    discharge_pressure: str = "PT-102"
    flow: str = "FT-101"
    current: str = "CT-101"
    speed: str = "RPM-101"
    tags: tuple[str, ...] = field(
        default_factory=lambda: (
            "MTR-101",
            "P-101",
            "ACC-101",
            "TT-101",
            "TT-102",
            "PT-101",
            "PT-102",
            "FT-101",
            "CT-101",
            "RPM-101",
        )
    )


ASSET = AssetIdentity()
