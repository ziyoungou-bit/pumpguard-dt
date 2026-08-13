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


def lpm_to_m3s(flow_lpm: float) -> float:
    return flow_lpm / LPM_PER_M3S


def m3s_to_lpm(flow_m3s: float) -> float:
    return flow_m3s * LPM_PER_M3S


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
    """Shaft power = hydraulic power / pump efficiency, plus parasitic losses.

    The parasitic term matters: at zero flow the hydraulic power is zero, but a
    real pump still absorbs power churning liquid and turning bearings and
    seals. Without it a closed-valve or dry-run condition would report zero
    shaft power and zero motor current, which is wrong and would make the
    dry-run fault undetectable on the electrical signal.
    """
    speed_ratio = speed_rpm / pump.rated_speed_rpm
    # Windage and friction scale roughly with speed cubed.
    parasitic = motor.parasitic_loss_at_rated_w * speed_ratio**3
    if dry_run:
        # No liquid: hydraulic load disappears, so the motor unloads. This is
        # the electrical signature of a dry run -- current falls rather than rises.
        return parasitic * 0.75
    if efficiency <= 0.0 or hydraulic_power_w <= 0.0:
        return parasitic
    return hydraulic_power_w / efficiency + parasitic


def pump_efficiency(flow_lpm: float, speed_rpm: float, pump: PumpParameters = PUMP) -> float:
    """Inverted parabola centred on the best efficiency point.

    BEP flow shifts with speed by the affinity law Q ~ N, so running slower
    moves the peak rather than keeping it fixed.
    """
    if flow_lpm <= 0.0 or speed_rpm <= 0.0:
        return 0.0
    speed_ratio = speed_rpm / pump.rated_speed_rpm
    bep = pump.bep_flow_lpm * speed_ratio
    span = pump.efficiency_span_lpm * speed_ratio
    if span <= 0.0:
        return 0.0
    normalised = (flow_lpm - bep) / span
    efficiency = pump.bep_efficiency * (1.0 - normalised**2)
    return max(pump.minimum_efficiency, min(pump.bep_efficiency, efficiency))


def motor_current(electrical_power_w: float, motor: MotorParameters = MOTOR) -> float:
    """Motor line current.

        P = V * I * pf            (single phase)
        P = sqrt(3) * V * I * pf  (three phase)

    Magnetising and load current are combined in quadrature, not by taking the
    larger of the two:

        I_total = sqrt(I_magnetising^2 + I_load^2)

    In an induction motor the magnetising component lags the voltage by ~90
    degrees while the load component is nearly in phase, so they add as vectors.
    A max() floor was used first and it made current constant at every hydraulic
    condition -- the load component sat below the floor at all times, so current
    reported nothing about flow, blockage or dry running. Since current is one
    of the diagnostic inputs, that silently removed a whole sensor from the
    fault model.
    """
    if electrical_power_w <= 0.0:
        return 0.0
    root_three = math.sqrt(3.0) if motor.phases == 3 else 1.0
    denominator = root_three * motor.rated_voltage_v * motor.power_factor
    load_current = electrical_power_w / denominator
    return math.sqrt(motor.no_load_current_a**2 + load_current**2)


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


def npsh_required(flow_m3s: float, pump: PumpParameters = PUMP) -> float:
    """First-order NPSHr, rising with the square of flow.

    Anchored so that NPSHr at the duty flow is a plausible 2.0 m for a pump of
    this size. Marked clearly as a model, not a manufacturer curve.
    """
    duty = lpm_to_m3s(pump.duty_flow_lpm)
    if duty <= 0:
        return 0.0
    return 2.0 * (flow_m3s / duty) ** 2


def cavitation_margin(flow_m3s: float, blockage: float = 0.0) -> float:
    """NPSHa - NPSHr. Negative means cavitation is expected."""
    return npsh_available(flow_m3s, blockage) - npsh_required(flow_m3s)


# --------------------------------------------------------------------------
# Curves for plotting
# --------------------------------------------------------------------------


def pump_curve(speed_rpm: float, points: int = 40, pump: PumpParameters = PUMP) -> list[dict[str, float]]:
    """Head vs flow, from shutoff to the point where head reaches zero."""
    speed_ratio = max(speed_rpm, 1.0) / pump.rated_speed_rpm
    shutoff = pump.shutoff_head_m * speed_ratio**2
    max_flow = math.sqrt(shutoff / pump.head_coefficient) if shutoff > 0 else 0.0
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
    max_flow_lpm: float = 40.0,
    points: int = 40,
) -> list[dict[str, float]]:
    """Required head vs flow for the current valve and blockage state."""
    return [
        {
            "flow_lpm": max_flow_lpm * i / (points - 1),
            "head_m": system_head(lpm_to_m3s(max_flow_lpm * i / (points - 1)), valve_opening, blockage),
        }
        for i in range(points)
    ]
