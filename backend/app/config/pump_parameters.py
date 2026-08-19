"""Centrifugal pump, motor and hydraulic circuit parameters for P-101 / MTR-101.

Every number the physics uses lives here. Nothing downstream may invent a
coefficient: if a value is not in this module it does not exist in the model.

The machine modelled is a small single-stage end-suction centrifugal pump on a
4-pole induction motor, of the size used on a laboratory test rig -- roughly
110 L/min at 8 m head. That scale is chosen deliberately so the numbers stay
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

import math
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
    typed in blind: shutoff at 12.0 m and 8.0 m at the duty flow of 110 L/min.

        a = (H0 - H_duty) / Q_duty^2
          = (12.0 - 8.0) / (110/60000)^2
          = 4.0 / (1.8333e-3)^2
          = 1.1901e6  m / (m^3/s)^2

    Efficiency is the standard parabola about the best efficiency point,

        eta(Q) = eta_BEP [ 2x - x^2 ],   x = Q_reduced / Q_BEP

    which vanishes at Q = 0 and at 2 Q_BEP and peaks at eta_BEP. It carries no
    width parameter and no floor. An earlier version had both -- a span of
    26 L/min against a BEP flow of 22, plus a 5 % floor -- and the two together
    put the efficiency at 5 % of BEP flow at 21 %, where the standard shape
    gives under 4 %. That made the low-flow region (recirculation, temperature
    rise, radial load) look far milder than it is.

    eta_BEP is NOT a parameter. It is computed from the regulatory minimum
    efficiency correlation -- see `bep_efficiency` -- so that no peak efficiency
    figure is ever typed into this project.
    """

    tag: str = "P-101"
    rated_speed_rpm: float = 1450.0
    shutoff_head_m: float = 12.0
    duty_flow_lpm: float = 110.0
    duty_head_m: float = 8.0

    #: BEP sits 10 % above the rated duty flow, the usual selection margin.
    bep_flow_lpm: float = 121.0

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

    @property
    def bep_head_m(self) -> float:
        """Head on the rated curve at the BEP flow. H_BEP = H0 - a Q_BEP^2."""
        bep_flow_m3s = self.bep_flow_lpm / 60000.0
        return self.shutoff_head_m - self.head_coefficient * bep_flow_m3s**2

    @property
    def specific_speed_nq(self) -> float:
        """n_s = N sqrt(Q_BEP) / (H_BEP / i)^0.75, the regulation's definition.

        Commission Regulation (EU) No 547/2012, Annex III: N in rpm, Q at BEP
        in m^3/s, H at BEP in m, i the number of stages (1 here). Specific
        speed is defined AT the best efficiency point, not at the duty point --
        an earlier version evaluated it at duty and got a different number for
        the same machine.
        """
        bep_flow_m3s = self.bep_flow_lpm / 60000.0
        return self.rated_speed_rpm * math.sqrt(bep_flow_m3s) / self.bep_head_m**0.75

    @property
    def bep_efficiency(self) -> float:
        """Peak efficiency, computed -- never typed in.

        The minimum-efficiency correlation of Commission Regulation (EU) No
        547/2012, Annex III (OJ L 165/34, 26.6.2012):

            (eta_BEP)min,requ = 88.59 x + 13.46 y
                              - 11.48 x^2 - 0.85 y^2 - 0.38 x y - C

            x = ln(n_s)
            y = ln(Q_BEP)
            C = 128.07   for ESOB at 1450 rpm with MEI >= 0.40

        UNIT TRAP, and it is the regulation's own, not a slip here: n_s is
        defined with Q in m^3/s, while y is the natural log of Q in m^3/h. The
        two flows are therefore named separately below and must never be folded
        into one variable. Unifying them changes eta_BEP by about 14 points.

        This replaces a hand-set 0.42 justified by a specific-speed band
        argument that cited no external source. The regulation is a source: it
        is the legal minimum a water pump of this specific speed and size may
        have, and using it means the model claims no efficiency better than the
        floor the machine would have to clear to be sold.
        """
        # Q at BEP in m^3/h -- the unit the regulation's y term uses.
        bep_flow_m3h = self.bep_flow_lpm * 60.0 / 1000.0
        x = math.log(self.specific_speed_nq)
        y = math.log(bep_flow_m3h)
        c_esob_1450_mei_040 = 128.07
        eta_percent = (
            88.59 * x
            + 13.46 * y
            - 11.48 * x**2
            - 0.85 * y**2
            - 0.38 * x * y
            - c_esob_1450_mei_040
        )
        return eta_percent / 100.0


# --------------------------------------------------------------------------
# Motor MTR-101
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class MotorParameters:
    """4-pole induction motor, 50 Hz, single-phase 230 V.

    Synchronous speed = 120 * 50 / 4 = 1500 rpm; 1450 rpm rated implies
    slip = (1500 - 1450) / 1500 = 3.3 %, which is typical for this size.

    Sizing note. The rating follows the duty point and has been resized with
    it. At 110 L/min and 8 m the pump absorbs 294 W at the shaft, so the 120 W
    motor this file previously specified would have been loaded to 245 % of its
    rating -- the machine would not run. 370 W is the standard frame above it
    and puts the duty point at 79 % load, which is where a correctly selected
    motor sits: enough margin for the runout end of the curve, close enough to
    rating that line current still moves with the hydraulic state.

    That last point is the constraint that decides the rating. Current is one
    of the diagnostic inputs, so a motor oversized to the next frame again
    would sit near its magnetising current at every hydraulic condition and
    report nothing about blockage or dry running.
    """

    tag: str = "MTR-101"
    rated_power_w: float = 370.0
    rated_speed_rpm: float = 1450.0
    synchronous_speed_rpm: float = 1500.0
    supply_frequency_hz: float = 50.0
    poles: int = 4
    rated_voltage_v: float = 230.0
    phases: int = 1
    power_factor: float = 0.82
    efficiency: float = 0.72  # small single-phase motors are not efficient
    #: Nameplate current at rated shaft power: 370 / (0.72 * 230 * 0.82).
    rated_current_a: float = 2.72
    service_factor: float = 1.15


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
    # target duty flow of 115.5 L/min:
    #     a + K = (H0 - H_static) / Q*^2 = (12 - 2) / (115.5/60000)^2 = 2.698e6
    #     K     = 2.698e6 - 1.190e6 = 1.508e6
    #     pipe  = K - valve_open = 1.508e6 - 9.917e4 = 1.4083e6
    #
    # Every coefficient in this class is the previous rig's value scaled by
    # (20/110)^2 = 0.033058. That is what makes the duty-point move a SIMILARITY
    # transform: head, efficiency and every dimensionless energy ratio on this
    # platform are unchanged by it, and only the flow scale moves. The three
    # percentages on the Energy page were verified to move by under 0.03 points.
    pipe_resistance: float = 1.4083e6
    # Additional resistance at 100 % open. A real valve is never lossless.
    valve_resistance_open: float = 9.9174e4
    # Resistance approached as the valve shuts. Not infinite: a shut valve
    # still leaks slightly, and an infinite value makes the solver ill-posed.
    valve_resistance_closed: float = 1.3223e8
    # Suction-side friction, used for the suction pressure and NPSH estimate.
    # Set from the adjudicated NPSHa of 9.165 m at duty, which the plain
    # (20/110)^2 scaling of the old 0.45e7 would miss by 5 mm.
    suction_resistance: float = 1.4744e5
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
    dry_run_extra_rise_c: float = 60.0
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
