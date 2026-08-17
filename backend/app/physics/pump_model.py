"""Centrifugal pump hydraulics: pump curve, system curve, operating point.

This module is the reason the platform is an engineering tool rather than a
chart generator. Nothing here produces a flow or a pressure by drawing a random
number: flow is found by intersecting the pump characteristic with the system
characteristic, and every other hydraulic and electrical quantity follows from
that intersection.

    Pump:    H_p(Q) = H0(N) - a(N) * Q^2
    System:  H_s(Q) = H_static + K(valve) * Q^2
    Operate: H_p(Q*) = H_s(Q*)

Because both curves are quadratic in Q, the intersection has a closed form and
needs no iteration:

    H0 - a Q^2 = H_static + K Q^2
    Q* = sqrt( (H0 - H_static) / (a + K) )        when H0 > H_static
    Q* = 0                                         otherwise (pump cannot lift)

Speed is handled with the affinity laws, so a VFD-style speed change moves the
whole characteristic rather than scaling the answer afterwards:

    Q ~ N,  H ~ N^2,  P ~ N^3   =>   H0(N) = H0_rated * (N/N_rated)^2
                                     a(N)  = a_rated  (a is speed-invariant in
                                             this form, since H ~ N^2 and Q ~ N
                                             give H/Q^2 constant)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..config.pump_parameters import (
    CIRCUIT,
    FLUID,
    MOTOR,
    PUMP,
    HydraulicCircuit,
    MotorParameters,
    PumpParameters,
)

LPM_PER_M3S = 60000.0

#: Shaft power a dry-running pump still absorbs, as a fraction of the wetted
#: duty shaft power. An impeller spinning in air churns and windmills but
#: carries no hydraulic load, so the motor unloads to roughly a fifth of duty.
#: Expressed as a fraction rather than as watts so that it follows the duty
#: point instead of having to be retuned whenever the machine is rescaled.
DRY_RUN_SHAFT_POWER_FRACTION = 0.20


def lpm_to_m3s(flow_lpm: float) -> float:
    return flow_lpm / LPM_PER_M3S


def m3s_to_lpm(flow_m3s: float) -> float:
    return flow_m3s * LPM_PER_M3S


def duty_shaft_power_w(
    motor: MotorParameters = MOTOR, pump: PumpParameters = PUMP
) -> float:
    """Shaft power at the rated duty point. The reference the dry-run and the
    thermal load fraction are both taken against, so neither carries a watt
    figure of its own."""
    duty_flow_m3s = lpm_to_m3s(pump.duty_flow_lpm)
    hydraulic = FLUID.density * FLUID.gravity * duty_flow_m3s * pump.duty_head_m
    efficiency = pump_efficiency(pump.duty_flow_lpm, pump.rated_speed_rpm, pump)
    return hydraulic / efficiency if efficiency > 0.0 else 0.0


# --------------------------------------------------------------------------
# Characteristics
# --------------------------------------------------------------------------


def pump_head(flow_m3s: float, speed_rpm: float, pump: PumpParameters = PUMP) -> float:
    """Head developed at a given flow and speed, in metres.

    Clamped at zero: the quadratic form goes negative far past runout, which is
    outside the validity of the fit and would otherwise feed a negative head
    into the power calculation.
    """
    if speed_rpm <= 0:
        return 0.0
    speed_ratio = speed_rpm / pump.rated_speed_rpm
    shutoff = pump.shutoff_head_m * speed_ratio**2
    head = shutoff - pump.head_coefficient * flow_m3s**2
    return max(0.0, head)


def valve_resistance(valve_opening: float, circuit: HydraulicCircuit = CIRCUIT) -> float:
    """Resistance of the control valve, m/(m^3/s)^2.

    Opening is 1.0 fully open, 0.0 shut. A valve's resistance rises roughly as
    the inverse square of the flow area, so the interpolation is done on
    1/opening^2 rather than linearly -- a linear ramp would make the first 10 %
    of closure far too aggressive and the last 10 % far too gentle.
    """
    opening = min(max(valve_opening, 0.0), 1.0)
    if opening <= 0.0:
        return circuit.valve_resistance_closed
    inverse_area_squared = 1.0 / (opening**2)
    resistance = circuit.valve_resistance_open * inverse_area_squared
    return min(resistance, circuit.valve_resistance_closed)


def system_resistance(
    valve_opening: float,
    blockage: float = 0.0,
    circuit: HydraulicCircuit = CIRCUIT,
) -> float:
    """Total system resistance K, m/(m^3/s)^2.

    `blockage` (0..1) is an independent restriction -- a partly clogged
    strainer or fouled line -- which adds resistance in the same way a closing
    valve does. Modelling it as resistance rather than as a flow penalty is
    what makes the operating point move correctly along the pump curve.
    """
    severity = min(max(blockage, 0.0), 1.0)
    # At full severity the blockage dominates the circuit; the multiplier is
    # bounded so the solver stays well conditioned.
    blockage_multiplier = 1.0 + 45.0 * severity**2
    return circuit.pipe_resistance * blockage_multiplier + valve_resistance(valve_opening, circuit)


def system_head(
    flow_m3s: float,
    valve_opening: float,
    blockage: float = 0.0,
    circuit: HydraulicCircuit = CIRCUIT,
) -> float:
    """Head the system demands at a given flow, in metres."""
    return circuit.static_head_m + system_resistance(valve_opening, blockage, circuit) * flow_m3s**2


# --------------------------------------------------------------------------
# Operating point
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class OperatingPoint:
    flow_m3s: float
    flow_lpm: float
    head_m: float
    speed_rpm: float
    efficiency: float
    hydraulic_power_w: float
    shaft_power_w: float
    electrical_power_w: float
    motor_current_a: float
    system_resistance: float

    @property
    def differential_pressure_pa(self) -> float:
        """dP = rho g H."""
        return FLUID.density * FLUID.gravity * self.head_m


def solve_operating_point(
    speed_rpm: float,
    valve_opening: float,
    blockage: float = 0.0,
    dry_run: bool = False,
    pump: PumpParameters = PUMP,
    circuit: HydraulicCircuit = CIRCUIT,
    motor: MotorParameters = MOTOR,
) -> OperatingPoint:
    """Intersect the pump and system curves, then derive power and current.

    Closed form rather than a numerical root find: both curves are quadratic in
    Q with no linear term, so equating them gives Q directly. This is exact,
    cannot fail to converge, and is fast enough to run every simulation tick.
    """
    if speed_rpm <= 1.0:
        return _stopped_point(speed_rpm, valve_opening, blockage, circuit)

    speed_ratio = speed_rpm / pump.rated_speed_rpm
    shutoff = pump.shutoff_head_m * speed_ratio**2
    resistance = system_resistance(valve_opening, blockage, circuit)

    if dry_run or shutoff <= circuit.static_head_m:
        # Either no liquid to move, or the pump cannot overcome the static
        # lift, so it churns against a closed column: zero flow, head equal to
        # whatever it can generate.
        flow_m3s = 0.0
        head = shutoff
    else:
        flow_m3s = math.sqrt((shutoff - circuit.static_head_m) / (pump.head_coefficient + resistance))
        head = pump_head(flow_m3s, speed_rpm, pump)

    efficiency = pump_efficiency(m3s_to_lpm(flow_m3s), speed_rpm, pump)
    hydraulic_power = FLUID.density * FLUID.gravity * flow_m3s * head

    shaft_power = _shaft_power(hydraulic_power, efficiency, speed_rpm, dry_run, motor, pump)
    electrical_power = shaft_power / motor.efficiency if shaft_power > 0 else 0.0
    current = motor_current(electrical_power, motor)

    return OperatingPoint(
        flow_m3s=flow_m3s,
        flow_lpm=m3s_to_lpm(flow_m3s),
        head_m=head,
        speed_rpm=speed_rpm,
        efficiency=efficiency,
        hydraulic_power_w=hydraulic_power,
        shaft_power_w=shaft_power,
        electrical_power_w=electrical_power,
        motor_current_a=current,
        system_resistance=resistance,
    )


def _stopped_point(
    speed_rpm: float, valve_opening: float, blockage: float, circuit: HydraulicCircuit
) -> OperatingPoint:
    return OperatingPoint(
        flow_m3s=0.0,
        flow_lpm=0.0,
        head_m=0.0,
        speed_rpm=max(0.0, speed_rpm),
        efficiency=0.0,
        hydraulic_power_w=0.0,
        shaft_power_w=0.0,
        electrical_power_w=0.0,
        motor_current_a=0.0,
        system_resistance=system_resistance(valve_opening, blockage, circuit),
    )


def _shaft_power(
    hydraulic_power_w: float,
    efficiency: float,
    speed_rpm: float,
    dry_run: bool,
    motor: MotorParameters,
    pump: PumpParameters,
) -> float:
    """Shaft power = hydraulic power / OVERALL pump efficiency.

        P_shaft = P_hyd / eta_pump

    eta_pump here is the overall pump efficiency as Commission Regulation (EU)
    No 547/2012 Annex I(4) defines it: hydraulic power out over shaft power in.
    Disc friction, wear-ring leakage and mechanical loss are already inside
    that denominator. This function previously added a separate parasitic drag
    term on top, which counted those same losses twice.

    Dry run. With no liquid the hydraulic load disappears and the motor
    unloads -- current falls rather than rises, which is the electrical
    signature the dry-run diagnosis keys on. That residual load is the churning
    and windage of an impeller spinning in air, taken as a fraction of the
    wetted duty shaft power rather than as a constant, so it scales with the
    machine instead of having to be re-tuned whenever the duty point moves.
    """
    if dry_run:
        speed_ratio = max(0.0, speed_rpm) / pump.rated_speed_rpm
        return DRY_RUN_SHAFT_POWER_FRACTION * duty_shaft_power_w(motor, pump) * speed_ratio**3
    if efficiency <= 0.0 or hydraulic_power_w <= 0.0:
        return 0.0
    return hydraulic_power_w / efficiency


def pump_efficiency(flow_lpm: float, speed_rpm: float, pump: PumpParameters = PUMP) -> float:
    """Standard parabola looked up on the REDUCED flow.

        Q_reduced = Q * N_rated / N
        eta       = eta_BEP [ 2x - x^2 ],   x = Q_reduced / Q_BEP

    Why reduced flow and not absolute flow. The affinity laws map every point on
    the characteristic onto a homologous point at another speed -- Q ~ N,
    H ~ N^2, P ~ N^3 -- with efficiency invariant along that mapping. So what
    fixes the efficiency of the machine is where it sits on its OWN curve, not
    how many litres per minute leave the discharge. Dividing the absolute flow
    back to rated speed is exactly that coordinate. Looking eta up on absolute
    flow instead nails the BEP to one fixed litres-per-minute figure, the value
    it happens to have at rated speed, so at half speed the pump is reported as
    running far off BEP when it is in fact sitting precisely on it.

    The parabola vanishes at Q = 0 and at 2 Q_BEP. There is deliberately no
    floor: hydraulic power rho g Q H goes to zero with Q while disc friction and
    mechanical loss do not, so efficiency near shutoff really is a single-digit
    number, and eta(0) is 0.

    Stopped guard: eta = 0 when speed_rpm = 0 -- there is no operating point to
    be efficient at. This branch is printed on the Engineering page rather than
    hidden, because a guard that silently improves a number is how a formula
    stops matching its own display.
    """
    if flow_lpm <= 0.0 or speed_rpm <= 0.0:
        return 0.0
    reduced_flow_lpm = flow_lpm * pump.rated_speed_rpm / speed_rpm
    x = reduced_flow_lpm / pump.bep_flow_lpm
    if x >= 2.0:
        return 0.0
    return max(0.0, pump.bep_efficiency * (2.0 * x - x * x))


def motor_current(electrical_power_w: float, motor: MotorParameters = MOTOR) -> float:
    """Motor line current.

        P = V * I * pf            (single phase)
        P = sqrt(3) * V * I * pf  (three phase)

    Rearranged: I = P_elec / (V * pf). One formula, no floor and no quadrature
    correction.

    Both of those were here before and both were wrong for this model. A max()
    floor at the magnetising current made current constant at every hydraulic
    condition, silently removing a diagnostic sensor. Adding the magnetising
    component in quadrature was the fix for that, and it is the right physics
    for a real induction motor -- but the magnetising current it needed was a
    nameplate quantity this model never had a source for, and the frontend
    implemented the floor while the backend implemented the quadrature, so the
    two halves disagreed about the current at every operating point. What the
    model does have a source for is the power chain, and P_elec / (V * pf) is
    exactly the relationship the Engineering page prints. Current is now that
    quotient in both languages and nothing else.
    """
    if electrical_power_w <= 0.0:
        return 0.0
    root_three = math.sqrt(3.0) if motor.phases == 3 else 1.0
    denominator = root_three * motor.rated_voltage_v * motor.power_factor
    return electrical_power_w / denominator


# --------------------------------------------------------------------------
# Suction side and cavitation margin
# --------------------------------------------------------------------------


def suction_pressure_pa(
    flow_m3s: float,
    blockage: float = 0.0,
    circuit: HydraulicCircuit = CIRCUIT,
) -> float:
    """Absolute pressure at the pump suction.

    p_suction = p_atm - rho*g*(lift) - rho*g*(friction losses)

    Suction friction rises with the square of flow, and a suction-side
    restriction raises it further -- which is the physical route to cavitation
    rather than a flag that switches a fault on.
    """
    severity = min(max(blockage, 0.0), 1.0)
    resistance = circuit.suction_resistance * (1.0 + 60.0 * severity**2)
    friction_head = resistance * flow_m3s**2
    static = circuit.suction_lift_m - circuit.reservoir_level_m
    total_head_loss = static + friction_head
    ideal = FLUID.atmospheric_pressure - FLUID.density * FLUID.gravity * total_head_loss

    # A liquid cannot sustain an absolute pressure below its vapour pressure:
    # the column breaks and vapour forms -- which is cavitation, the very fault
    # being modelled. The unclamped equation returned -331 kPa absolute at high
    # suction restriction, which is not a pressure that can exist and would have
    # been displayed on the SCADA screen as a real reading.
    return max(FLUID.vapour_pressure, ideal)


def npsh_available(flow_m3s: float, blockage: float = 0.0, circuit: HydraulicCircuit = CIRCUIT) -> float:
    """NPSHa in metres of liquid.

        NPSHa = (p_suction - p_vapour) / (rho g)

    This is a simplified margin indicator for a demonstration rig, not a
    certified NPSH calculation: it omits velocity head at the suction flange
    and any transient effects.
    """
    suction = suction_pressure_pa(flow_m3s, blockage, circuit)
    return (suction - FLUID.vapour_pressure) / (FLUID.density * FLUID.gravity)


def npsh_required(
    flow_m3s: float, speed_rpm: float = PUMP.rated_speed_rpm, pump: PumpParameters = PUMP
) -> float:
    """First-order NPSHr, rising with the square of flow.

        NPSHr(Q, N) = (N/N_rated)^2 [ 0.6 + 1.4 (Q_reduced / Q_duty)^2 ]

    Anchored so that NPSHr at the rated duty flow is a plausible 2.0 m for a
    pump of this size, with a non-zero shutoff term because a real impeller
    still requires some suction head at zero flow. Marked clearly as a model,
    not a manufacturer curve.

    Speed enters the same way it does for efficiency: NPSHr is a homologous
    quantity, so it is evaluated at the reduced flow and scaled by N^2. Note
    that once the reduced flow is substituted back, the quadratic term is
    speed-invariant in absolute flow and only the shutoff term carries N^2.
    """
    duty = lpm_to_m3s(pump.duty_flow_lpm)
    if duty <= 0 or speed_rpm <= 0:
        return 0.0
    speed_ratio = speed_rpm / pump.rated_speed_rpm
    reduced_ratio = (flow_m3s / speed_ratio) / duty
    return speed_ratio**2 * (0.6 + 1.4 * reduced_ratio**2)


def cavitation_margin(
    flow_m3s: float, blockage: float = 0.0, speed_rpm: float = PUMP.rated_speed_rpm
) -> float:
    """NPSHa - NPSHr. Negative means cavitation is expected."""
    return npsh_available(flow_m3s, blockage) - npsh_required(flow_m3s, speed_rpm)


# --------------------------------------------------------------------------
# Curves for plotting
# --------------------------------------------------------------------------


def runout_flow_lpm(speed_rpm: float, pump: PumpParameters = PUMP) -> float:
    """Flow at which the pump curve reaches zero head -- the right-hand edge.

    Extracted because two callers need it: the pump curve's own flow axis, and
    the system curve's, which must span far enough to cross it.
    """
    speed_ratio = max(speed_rpm, 1.0) / pump.rated_speed_rpm
    shutoff = pump.shutoff_head_m * speed_ratio**2
    if shutoff <= 0.0:
        return 0.0
    return m3s_to_lpm(math.sqrt(shutoff / pump.head_coefficient))


def pump_curve(speed_rpm: float, points: int = 40, pump: PumpParameters = PUMP) -> list[dict[str, float]]:
    """Head vs flow, from shutoff to the point where head reaches zero."""
    max_flow = lpm_to_m3s(runout_flow_lpm(speed_rpm, pump))
    return [
        {
            "flow_lpm": m3s_to_lpm(max_flow * i / (points - 1)),
            "head_m": pump_head(max_flow * i / (points - 1), speed_rpm, pump),
        }
        for i in range(points)
    ]


def system_curve(
    valve_opening: float,
    blockage: float = 0.0,
    max_flow_lpm: float | None = None,
    points: int = 40,
) -> list[dict[str, float]]:
    """Required head vs flow for the current valve and blockage state.

    The flow axis defaults to the runout flow of the rated pump curve, so the
    system curve always spans far enough to cross it. A fixed literal here goes
    stale the moment the duty point moves, and a system curve that stops short
    of the intersection is a chart with no operating point on it.
    """
    if max_flow_lpm is None:
        max_flow_lpm = runout_flow_lpm(PUMP.rated_speed_rpm)
    return [
        {
            "flow_lpm": max_flow_lpm * i / (points - 1),
            "head_m": system_head(lpm_to_m3s(max_flow_lpm * i / (points - 1)), valve_opening, blockage),
        }
        for i in range(points)
    ]
