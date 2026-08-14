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
 * The constants are copied from backend/app/config/pump_parameters.py. They are
 * duplicated across a language boundary, which is the one place duplication is
 * unavoidable; if the backend parameters change, this file must be updated with
 * them. Nothing here is used when the live API is connected -- the backend's
 * numbers always win.
 *
 *     Pump:    H_p(Q) = H0(N) - a * Q^2
 *     System:  H_s(Q) = H_static + K(valve) * Q^2
 *     Operate: Q* = sqrt((H0 - H_static) / (a + K))
 */

export const LPM_PER_M3S = 60000

export const FLUID = {
  density: 998.2, // kg/m^3
  gravity: 9.80665, // m/s^2
  vapour_pressure: 2339.0, // Pa abs
  atmospheric_pressure: 101325.0, // Pa abs
}

export const PUMP = {
  tag: 'P-101',
  rated_speed_rpm: 1450.0,
  shutoff_head_m: 12.0,
  duty_flow_lpm: 20.0,
  duty_head_m: 8.0,
  bep_flow_lpm: 22.0,
  /**
   * Peak efficiency at the BEP. Set from the specific speed, not from a
   * catalogue guess -- see SPECIFIC_SPEED_NQ below.
   */
  bep_efficiency: 0.42,
  impeller_diameter_m: 0.105,
  suction_diameter_m: 0.025,
  discharge_diameter_m: 0.02,
  impeller_vanes: 6,
}

export const MOTOR = {
  tag: 'MTR-101',
  rated_power_w: 120.0,
  rated_speed_rpm: 1450.0,
  synchronous_speed_rpm: 1500.0,
  supply_frequency_hz: 50.0,
  poles: 4,
  rated_voltage_v: 230.0,
  phases: 1,
  power_factor: 0.82,
  efficiency: 0.72,
  no_load_current_a: 0.42,
  rated_current_a: 0.95,
  parasitic_loss_at_rated_w: 9.0,
}

export const CIRCUIT = {
  static_head_m: 2.0,
  pipe_resistance: 4.26e7,
  valve_resistance_open: 0.3e7,
  valve_resistance_closed: 4.0e9,
  suction_resistance: 0.45e7,
  suction_lift_m: 1.2,
  reservoir_level_m: 0.8,
}

export const BEARING = {
  designation: '6205',
  rolling_elements: 9,
  ball_diameter_mm: 7.94,
  pitch_diameter_mm: 39.04,
  contact_angle_deg: 0.0,
}

export const THERMAL = {
  ambient_c: 23.0,
  motor_rise_at_rated_c: 42.0,
  bearing_rise_at_rated_c: 28.0,
}

export const ASSET_TAGS = {
  motor: 'MTR-101',
  pump: 'P-101',
  accelerometer: 'ACC-101',
  motor_temperature: 'TT-101',
  bearing_temperature: 'TT-102',
  suction_pressure: 'PT-101',
  discharge_pressure: 'PT-102',
  flow: 'FT-101',
  current: 'CT-101',
  speed: 'RPM-101',
} as const

/** a in H = H0 - a Q^2, m/(m^3/s)^2, derived from the two catalogue points. */
export const HEAD_COEFFICIENT =
  (PUMP.shutoff_head_m - PUMP.duty_head_m) / Math.pow(PUMP.duty_flow_lpm / LPM_PER_M3S, 2)

/**
 * Specific speed n_q = N * sqrt(Q) / H^0.75, evaluated at the rated duty point
 * with N in rpm, Q in m^3/s and H in m. Computed, never typed in, so it always
 * agrees with the three numbers above.
 *
 *     n_q = 1450 * sqrt(3.333e-4) / 8^0.75 = 5.6
 *
 * This is the number that fixes PUMP.bep_efficiency. Conventional centrifugal
 * impellers sit at n_q 10-80; below about 10 the impeller passage is so narrow
 * that disc friction on the shroud faces and volumetric leakage past the wear
 * ring dominate the loss budget, and measured peak efficiency for this size and
 * shape falls in the 35-45 % band (Gulich, Centrifugal Pumps, ch. 3.6-3.7,
 * efficiency-vs-n_q correlation). 42 % is the middle of that band.
 *
 * The previous 62 % was a value borrowed from a mid-n_q machine. It understated
 * shaft power by a third, which propagated straight through to motor loading
 * and the thermal model.
 */
export const SPECIFIC_SPEED_NQ =
  (PUMP.rated_speed_rpm * Math.sqrt(PUMP.duty_flow_lpm / LPM_PER_M3S)) /
  Math.pow(PUMP.duty_head_m, 0.75)

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
 * 22 L/min, so at half speed the pump is reported as running far off BEP when
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

/** P_hyd = rho * g * Q * H, watts. */
export function hydraulicPowerW(flowM3s: number, headM: number): number {
  return FLUID.density * FLUID.gravity * flowM3s * headM
}

/** Shaft power = hydraulic / pump efficiency, plus parasitic drag. */
export function shaftPowerW(hydraulicW: number, efficiency: number, speedRpm: number): number {
  const speedRatio = speedRpm / MOTOR.rated_speed_rpm
  const parasitic = MOTOR.parasitic_loss_at_rated_w * Math.pow(Math.max(0, speedRatio), 3)
  if (efficiency <= 0) return parasitic
  return hydraulicW / efficiency + parasitic
}

/** Electrical input = shaft / motor efficiency. */
export function electricalPowerW(shaftW: number): number {
  return shaftW / MOTOR.efficiency
}

/** Single-phase line current implied by the electrical power. */
export function motorCurrentA(electricalW: number): number {
  const denominator = MOTOR.rated_voltage_v * MOTOR.power_factor
  const load = electricalW / denominator
  return Math.max(MOTOR.no_load_current_a, load)
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
  const shaft = shaftPowerW(hydraulic, efficiency, speedRpm)
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
      shaft_power_w: Number(shaftPowerW(hydraulic, efficiency, speedRpm).toFixed(2)),
      npsh_available_m: Number(npshAvailableM(flowM3s, suctionRestriction).toFixed(3)),
      npsh_required_m: Number(npshRequiredM(flowLpm, speedRpm).toFixed(3)),
    })
  }
  return series
}
