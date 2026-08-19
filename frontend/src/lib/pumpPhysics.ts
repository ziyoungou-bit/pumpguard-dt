/**
 * Client-side port of the pump hydraulics in backend/app/physics/pump_model.py.
 *
 * Why this exists at all, given the backend owns the physics:
 *   1. The Engineering page shows the actual formulas and must evaluate them to
 *      draw the curves it is explaining.
 *   2. The recorded-demo fallback (src/data/recordedDemo.ts) has to produce a
 *      physically coherent dataset when the API is unreachable. Replaying
 *      random numbers on a page that claims to model a pump would be dishonest.
 *
 * The CONSTANTS are not written here. They are generated from
 * backend/app/config/pump_parameters.py into ./pumpParameters.generated.ts by
 * scripts/export_parameters.py, and re-exported below so every existing import
 * of PUMP / CIRCUIT / MOTOR from this module keeps working. They used to be
 * hand-copied, with a comment claiming the duplication was unavoidable and had
 * to be maintained by hand. It was not: this file subtracted the full 1.2 m
 * suction lift where the backend subtracted the net 0.4 m, so every NPSH figure
 * in the UI was 0.8 m out against the backend that supposedly owned the physics.
 * A test now fails if the generated file goes stale.
 *
 * The FUNCTIONS below are a genuine port -- the same equations written twice in
 * two languages -- because the browser must evaluate them with no backend.
 * Behaviour cannot be projected the way data can. Nothing here is used when the
 * live API is connected: the backend's numbers always win.
 *
 *     Pump:    H_p(Q) = H0(N) - a * Q^2
 *     System:  H_s(Q) = H_static + K(valve) * Q^2
 *     Operate: Q* = sqrt((H0 - H_static) / (a + K))
 */

export {
  ASSET_TAGS,
  BEARING,
  BEP_HEAD_M,
  CIRCUIT,
  FLUID,
  HEAD_COEFFICIENT,
  LPM_PER_M3S,
  MOTOR,
  PUMP,
  SPECIFIC_SPEED_NS,
  TEMPERATURE,
  THERMAL,
} from './pumpParameters.generated'

import {
  CIRCUIT,
  FLUID,
  HEAD_COEFFICIENT,
  LPM_PER_M3S,
  MOTOR,
  PUMP,
} from './pumpParameters.generated'


export const lpmToM3s = (lpm: number) => lpm / LPM_PER_M3S
export const m3sToLpm = (m3s: number) => m3s * LPM_PER_M3S

/** Flow at which the pump curve reaches zero head, L/min. The right-hand edge. */
export function runoutFlowLpm(speedRpm: number): number {
  if (speedRpm <= 0) return 0
  const shutoff = PUMP.shutoff_head_m * Math.pow(speedRpm / PUMP.rated_speed_rpm, 2)
  return m3sToLpm(Math.sqrt(shutoff / HEAD_COEFFICIENT))
}

/** BEP flow at a speed. Affinity law Q ~ N moves the peak; it is not fixed. */
export function bepFlowLpm(speedRpm: number): number {
  return (PUMP.bep_flow_lpm * speedRpm) / PUMP.rated_speed_rpm
}

/** Induction-motor slip, 0..1, from the synchronous speed. */
export function motorSlip(speedRpm: number): number {
  return (MOTOR.synchronous_speed_rpm - speedRpm) / MOTOR.synchronous_speed_rpm
}

/** Head developed at a given flow and speed, in metres. Clamped at zero. */
export function pumpHead(flowM3s: number, speedRpm: number): number {
  if (speedRpm <= 0) return 0
  const speedRatio = speedRpm / PUMP.rated_speed_rpm
  const shutoff = PUMP.shutoff_head_m * speedRatio * speedRatio
  return Math.max(0, shutoff - HEAD_COEFFICIENT * flowM3s * flowM3s)
}

/**
 * Control valve resistance. Opening 1.0 = fully open, 0.0 = shut.
 * Interpolated on 1/opening^2 because a valve's resistance rises roughly as the
 * inverse square of the flow area.
 */
export function valveResistance(valveOpening: number): number {
  const opening = Math.min(1, Math.max(0.0, valveOpening))
  if (opening <= 0.01) return CIRCUIT.valve_resistance_closed
  const inverseArea = 1 / (opening * opening)
  const scaled = CIRCUIT.valve_resistance_open * inverseArea
  return Math.min(CIRCUIT.valve_resistance_closed, scaled)
}

export function systemResistance(valveOpening: number): number {
  return CIRCUIT.pipe_resistance + valveResistance(valveOpening)
}

/** System curve head at a flow, in metres. */
export function systemHead(flowM3s: number, valveOpening: number): number {
  return CIRCUIT.static_head_m + systemResistance(valveOpening) * flowM3s * flowM3s
}

/** Closed-form intersection of the two quadratics. Returns flow in L/min. */
export function operatingFlowLpm(speedRpm: number, valveOpening: number): number {
  if (speedRpm <= 0) return 0
  const speedRatio = speedRpm / PUMP.rated_speed_rpm
  const shutoff = PUMP.shutoff_head_m * speedRatio * speedRatio
  if (shutoff <= CIRCUIT.static_head_m) return 0
  const denominator = HEAD_COEFFICIENT + systemResistance(valveOpening)
  return m3sToLpm(Math.sqrt((shutoff - CIRCUIT.static_head_m) / denominator))
}

/**
 * Efficiency, 0..1, looked up on the REDUCED flow.
 *
 *     Q_reduced = Q * N_rated / N        eta = eta_BEP [ 2x - x^2 ],  x = Q_red / Q_BEP
 *
 * Why reduced flow and not absolute flow. The affinity laws say that a change of
 * speed maps every point on the characteristic onto a homologous point:
 * Q ~ N, H ~ N^2, P ~ N^3, and eta is invariant along that mapping. So the
 * efficiency of the machine is a function of WHERE ON ITS OWN CURVE it is
 * sitting, not of how many litres per minute are coming out. Dividing the
 * absolute flow back to rated speed is exactly the "where on its own curve"
 * coordinate. Looking eta up on absolute flow instead nails the BEP to a fixed
 * 121 L/min, so at half speed the pump is reported as running far off BEP when
 * it is in fact sitting precisely on it.
 *
 * The parabola is the standard one: it vanishes at Q = 0 and at Q = 2 Q_BEP,
 * and peaks at eta_BEP. It has no free width parameter and no floor. A floor
 * would be the more damaging of the two: hydraulic power rho g Q H goes to zero
 * with Q while disc friction and mechanical loss do not, so efficiency near
 * shutoff really is a single-digit number, and a 5 % floor made the dangerous
 * low-flow region (recirculation, temperature rise, radial load) look mild.
 */
export function pumpEfficiency(flowLpm: number, speedRpm: number): number {
  if (flowLpm <= 0 || speedRpm <= 0) return 0
  const reducedFlowLpm = (flowLpm * PUMP.rated_speed_rpm) / speedRpm
  const x = reducedFlowLpm / PUMP.bep_flow_lpm
  if (x >= 2) return 0
  return Math.max(0, PUMP.bep_efficiency * (2 * x - x * x))
}

/**
 * Coefficient C of the Annex III minimum-efficiency correlation, for the one
 * machine class this asset belongs to: ESOB (end-suction own-bearing), 1450
 * rpm, MEI >= 0.40. The regulation tabulates a different C for every
 * (type, speed, MEI) combination; only the applicable one is written down here,
 * because a table of the others would be eight numbers this project never uses.
 *
 * Source: Commission Regulation (EU) No 547/2012, Annex III.
 * OJ L 165/34, 26.6.2012.
 */
export const ANNEX_III_C_ESOB_1450_MEI_040 = 128.07

/** Term-by-term evaluation of the Annex III correlation, for display. */
export interface MinimumEfficiencyTerms {
  /** ln(n_s), with n_s computed from Q in m^3/s. */
  x: number
  /** ln(Q_BEP in m^3/h). NOT the same flow unit as x. See below. */
  y: number
  /** eta_BEP,min as a fraction, 0..1. */
  efficiency: number
}

/**
 * (eta_BEP)min,requ from Commission Regulation (EU) No 547/2012, Annex III:
 *
 *     eta % = 88.59 x + 13.46 y - 11.48 x^2 - 0.85 y^2 - 0.38 x y - C
 *     x = ln(n_s)        y = ln(Q_BEP in m^3/h)
 *
 * UNIT TRAP, and it is the regulation's own rather than a slip here: n_s is
 * defined with Q in m^3/s, while y is the natural log of Q in m^3/h. The two
 * flows are therefore passed in separately and must never be folded into one
 * argument -- unifying them moves the answer by about 14 points.
 *
 * This is a MINIMUM efficiency, not a measured one. Using it as the modelled
 * eta_BEP is the deliberate choice this project makes instead of inventing a
 * catalogue figure: it is externally sourced, it is reproducible from the
 * geometry already fixed elsewhere, and it errs conservatively.
 */
export function annexIIIMinimumEfficiency(
  specificSpeedNs: number,
  bepFlowM3h: number,
): MinimumEfficiencyTerms {
  const x = Math.log(specificSpeedNs)
  const y = Math.log(bepFlowM3h)
  const percent =
    88.59 * x +
    13.46 * y -
    11.48 * x * x -
    0.85 * y * y -
    0.38 * x * y -
    ANNEX_III_C_ESOB_1450_MEI_040
  return { x, y, efficiency: percent / 100 }
}

/**
 * The part-load and overload points of Annex I, and the derating the regulation
 * allows at each. A pump must reach 0.947 of its BEP minimum at 75 % of BEP
 * flow and 0.985 of it at 110 %.
 *
 * They are here to be checked AGAINST this site's efficiency model, not to feed
 * it: eta(Q)/eta_BEP = 2x - x^2 was chosen as a curve shape long before the
 * regulation entered this project, so the agreement between the two is
 * evidence rather than construction. See the Pump Performance page.
 */
export const ANNEX_I_PART_LOAD = { flowFraction: 0.75, efficiencyFactor: 0.947 } as const
export const ANNEX_I_OVERLOAD = { flowFraction: 1.1, efficiencyFactor: 0.985 } as const

/** P_hyd = rho * g * Q * H, watts. */
export function hydraulicPowerW(flowM3s: number, headM: number): number {
  return FLUID.density * FLUID.gravity * flowM3s * headM
}

/**
 * Shaft power = hydraulic power / OVERALL pump efficiency.
 *
 *     P_shaft = P_hyd / eta_pump
 *
 * eta_pump is the overall pump efficiency of Commission Regulation (EU) No
 * 547/2012 Annex I(4): hydraulic power out over shaft power in. Disc friction,
 * wear-ring leakage and mechanical loss are already inside that denominator.
 * This function used to add a separate parasitic drag term on top, which
 * counted the same losses a second time.
 */
export function shaftPowerW(hydraulicW: number, efficiency: number): number {
  if (efficiency <= 0) return 0
  return hydraulicW / efficiency
}

/** Electrical input = shaft / motor efficiency. */
export function electricalPowerW(shaftW: number): number {
  return shaftW / MOTOR.efficiency
}

/**
 * Shaft power at the rated duty point, watts.
 *
 * The single figure any prose has to quote when it needs to say how big this
 * machine is -- the ISO scope note being the reason it exists. Computed from
 * the duty point rather than written down, so a change to the duty flow or
 * head moves every sentence that cites it. The backend's
 * `physics.pump_model.duty_shaft_power_w` is the same expression.
 */
export const DUTY_SHAFT_POWER_W = shaftPowerW(
  hydraulicPowerW(lpmToM3s(PUMP.duty_flow_lpm), PUMP.duty_head_m),
  pumpEfficiency(PUMP.duty_flow_lpm, PUMP.rated_speed_rpm),
)

/**
 * Single-phase line current implied by the electrical power.
 *
 *     I = P_elec / (V * pf)
 *
 * One formula, no floor. This port used to floor the result at a magnetising
 * current while the backend added that current in quadrature, so the two
 * halves reported different currents at every operating point -- and the
 * Engineering page printed this quotient as its label while displaying the
 * backend's quadrature value, so the arithmetic on screen did not close.
 */
export function motorCurrentA(electricalW: number): number {
  if (electricalW <= 0) return 0
  return electricalW / (MOTOR.rated_voltage_v * MOTOR.power_factor)
}

/** Rotational frequency, Hz. The single most used derived quantity. */
export const rotationalFrequencyHz = (rpm: number) => rpm / 60

/** Blade-pass frequency = vanes * shaft frequency. */
export const bladePassFrequencyHz = (rpm: number) => PUMP.impeller_vanes * rotationalFrequencyHz(rpm)

/**
 * Suction-line resistance, m/(m^3/s)^2. `restriction` (0..1) is a partly
 * clogged strainer or foot valve: it acts on the suction side only, which is
 * the physical route to cavitation. Mirrors suction_pressure_pa() in the
 * backend, including the 60x multiplier.
 */
export function suctionResistance(restriction = 0): number {
  const severity = Math.min(1, Math.max(0, restriction))
  return CIRCUIT.suction_resistance * (1 + 60 * severity * severity)
}

/**
 * NPSH available at the suction flange, metres.
 *
 *     NPSHa = (P_atm - P_vap)/(rho g) + z_s - h_f,suction
 *
 * z_s is the NET static head at the flange: the pump sits suction_lift above
 * the reservoir floor but the liquid stands reservoir_level deep, so the lift
 * actually seen is (1.2 - 0.8) = 0.4 m and z_s = -0.4 m. This port previously
 * subtracted the full 1.2 m, disagreeing with the backend it mirrors by 0.8 m.
 */
export function npshAvailableM(flowM3s: number, suctionRestriction = 0): number {
  const barometric =
    (FLUID.atmospheric_pressure - FLUID.vapour_pressure) / (FLUID.density * FLUID.gravity)
  const netLift = CIRCUIT.suction_lift_m - CIRCUIT.reservoir_level_m
  const frictionHead = suctionResistance(suctionRestriction) * flowM3s * flowM3s
  return barometric - netLift - frictionHead
}

/**
 * NPSH required, metres. Low-order fit typical of a small pump, anchored at
 * 2.0 m at the rated duty flow.
 *
 * Speed enters the same way it does for efficiency: NPSHr is a homologous
 * quantity, NPSHr(Q, N) = (N/N_rated)^2 * NPSHr_rated(Q * N_rated / N). The
 * shutoff term therefore scales with N^2 while the quadratic term, once the
 * reduced flow is substituted back, is speed-invariant in absolute flow.
 */
export function npshRequiredM(flowLpm: number, speedRpm: number): number {
  if (speedRpm <= 0) return 0
  const speedRatio = speedRpm / PUMP.rated_speed_rpm
  const reducedRatio = (flowLpm * PUMP.rated_speed_rpm) / speedRpm / PUMP.duty_flow_lpm
  return speedRatio * speedRatio * (0.6 + 1.4 * reducedRatio * reducedRatio)
}

/**
 * Flow at which NPSHa falls to NPSHr -- the cavitation boundary. Closed form,
 * because both curves are quadratic in Q with no linear term:
 *
 *     B - z_net - R_s Q^2 = 0.6 r^2 + 1.4 Q^2 / Q_duty^2
 *     Q = sqrt( (B - z_net - 0.6 r^2) / (R_s + 1.4 / Q_duty^2) )
 *
 * Returns L/min, or null when the suction head is so poor that the pump is
 * already below NPSHr at zero flow.
 */
export function cavitationOnsetFlowLpm(speedRpm: number, suctionRestriction = 0): number | null {
  if (speedRpm <= 0) return null
  const barometric =
    (FLUID.atmospheric_pressure - FLUID.vapour_pressure) / (FLUID.density * FLUID.gravity)
  const netLift = CIRCUIT.suction_lift_m - CIRCUIT.reservoir_level_m
  const speedRatio = speedRpm / PUMP.rated_speed_rpm
  const numerator = barometric - netLift - 0.6 * speedRatio * speedRatio
  if (numerator <= 0) return null
  const dutyM3s = lpmToM3s(PUMP.duty_flow_lpm)
  const denominator = suctionResistance(suctionRestriction) + 1.4 / (dutyM3s * dutyM3s)
  return m3sToLpm(Math.sqrt(numerator / denominator))
}

export interface OperatingPoint {
  flow_lpm: number
  pump_head_m: number
  pump_efficiency: number
  hydraulic_power_w: number
  shaft_power_w: number
  electrical_power_w: number
  motor_current_a: number
  npsh_margin_m: number
  /** True when H0(N) never reaches the static head, so the curves do not cross. */
  no_intersection: boolean
}

/** Full hydraulic solution at a speed and valve opening. */
export function solveOperatingPoint(
  speedRpm: number,
  valveOpening: number,
  suctionRestriction = 0,
): OperatingPoint {
  const shutoff = PUMP.shutoff_head_m * Math.pow(Math.max(0, speedRpm) / PUMP.rated_speed_rpm, 2)
  const flowLpm = operatingFlowLpm(speedRpm, valveOpening)
  const flowM3s = lpmToM3s(flowLpm)
  const headM = pumpHead(flowM3s, speedRpm)
  const efficiency = pumpEfficiency(flowLpm, speedRpm)
  const hydraulic = hydraulicPowerW(flowM3s, headM)
  const shaft = shaftPowerW(hydraulic, efficiency)
  const electrical = electricalPowerW(shaft)
  return {
    flow_lpm: flowLpm,
    pump_head_m: headM,
    pump_efficiency: efficiency,
    hydraulic_power_w: hydraulic,
    shaft_power_w: shaft,
    electrical_power_w: electrical,
    motor_current_a: motorCurrentA(electrical),
    npsh_margin_m:
      npshAvailableM(flowM3s, suctionRestriction) - npshRequiredM(flowLpm, speedRpm),
    no_intersection: speedRpm > 0 && shutoff <= CIRCUIT.static_head_m,
  }
}

/**
 * Flow axis shared by every panel on the Pump Performance page. Fixed at the
 * runout flow of the RATED curve rather than of the current one, so that
 * dropping the speed visibly shrinks the characteristic instead of silently
 * rescaling the axis under it.
 */
export const CURVE_MAX_FLOW_LPM = Math.ceil(runoutFlowLpm(PUMP.rated_speed_rpm))

export interface CurveSample {
  flow_lpm: number
  pump_head_m: number
  system_head_m: number
  pump_efficiency: number
  hydraulic_power_w: number
  shaft_power_w: number
  npsh_available_m: number
  npsh_required_m: number
}

/**
 * Valve opening that throttles the pump to a target flow at a given speed, or
 * null when the target is unreachable.
 *
 * Inverts the intersection. Q* = sqrt((H0 - Hs)/(a + K)) rearranges to
 *
 *     K_total = (H0 - Hs)/Q*^2 - a
 *
 * and the valve part follows from valveResistance's 1/opening^2 form:
 *
 *     opening = sqrt(R_open / K_valve)
 *
 * Returns null above the fully-open flow -- a valve can only add resistance, so
 * no opening produces more flow than having it wide open.
 */
export function valveOpeningForFlow(targetFlowLpm: number, speedRpm: number): number | null {
  if (targetFlowLpm <= 0 || speedRpm <= 0) return null
  const shutoff = PUMP.shutoff_head_m * Math.pow(speedRpm / PUMP.rated_speed_rpm, 2)
  if (shutoff <= CIRCUIT.static_head_m) return null
  const flowM3s = lpmToM3s(targetFlowLpm)
  const totalResistance = (shutoff - CIRCUIT.static_head_m) / (flowM3s * flowM3s) - HEAD_COEFFICIENT
  const valvePart = totalResistance - CIRCUIT.pipe_resistance
  if (valvePart <= CIRCUIT.valve_resistance_open) return 1
  const opening = Math.sqrt(CIRCUIT.valve_resistance_open / valvePart)
  return Math.min(1, Math.max(0.01, opening))
}

/**
 * Speed that delivers a target flow at a given valve opening, or null when the
 * target is unreachable.
 *
 *     H_required = Hs + (a + K) Q*^2        (both curves at the target flow)
 *     N = N_rated sqrt(H_required / H0_rated)
 *
 * Note what this is NOT: it is not N_rated * (Q/Q_rated). The affinity law
 * Q ~ N describes points on the PUMP curve, and the operating point only
 * follows it when the system curve passes through the origin. This circuit has
 * 2 m of static head, so the pump must still produce that 2 m at any speed and
 * the required speed falls more slowly than the flow does. Using the affinity
 * shortcut here is the single most common error in a variable-speed retrofit
 * business case, and it always errs on the optimistic side.
 */
export function speedForFlow(targetFlowLpm: number, valveOpening: number): number | null {
  if (targetFlowLpm <= 0) return null
  const flowM3s = lpmToM3s(targetFlowLpm)
  const requiredHead =
    CIRCUIT.static_head_m +
    (HEAD_COEFFICIENT + systemResistance(valveOpening)) * flowM3s * flowM3s
  const speed = PUMP.rated_speed_rpm * Math.sqrt(requiredHead / PUMP.shutoff_head_m)
  return Number.isFinite(speed) && speed > 0 ? speed : null
}

/** Sampled pump, system, efficiency, power and NPSH curves for plotting. */
export function curveSeries(
  speedRpm: number,
  valveOpening: number,
  suctionRestriction = 0,
  points = 96,
): CurveSample[] {
  const series: CurveSample[] = []
  for (let i = 0; i <= points; i += 1) {
    const flowLpm = (CURVE_MAX_FLOW_LPM * i) / points
    const flowM3s = lpmToM3s(flowLpm)
    const headM = pumpHead(flowM3s, speedRpm)
    const efficiency = pumpEfficiency(flowLpm, speedRpm)
    const hydraulic = hydraulicPowerW(flowM3s, headM)
    series.push({
      flow_lpm: Number(flowLpm.toFixed(2)),
      pump_head_m: Number(headM.toFixed(3)),
      system_head_m: Number(systemHead(flowM3s, valveOpening).toFixed(3)),
      pump_efficiency: Number((efficiency * 100).toFixed(2)),
      hydraulic_power_w: Number(hydraulic.toFixed(2)),
      shaft_power_w: Number(shaftPowerW(hydraulic, efficiency).toFixed(2)),
      npsh_available_m: Number(npshAvailableM(flowM3s, suctionRestriction).toFixed(3)),
      npsh_required_m: Number(npshRequiredM(flowLpm, speedRpm).toFixed(3)),
    })
  }
  return series
}
