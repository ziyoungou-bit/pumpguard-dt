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
  bep_efficiency: 0.62,
  efficiency_span_lpm: 26.0,
  minimum_efficiency: 0.05,
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

export const lpmToM3s = (lpm: number) => lpm / LPM_PER_M3S
export const m3sToLpm = (m3s: number) => m3s * LPM_PER_M3S

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

/** Inverted-parabola efficiency about the BEP, 0..1. */
export function pumpEfficiency(flowLpm: number): number {
  if (flowLpm <= 0) return 0
  const offset = (flowLpm - PUMP.bep_flow_lpm) / PUMP.efficiency_span_lpm
  const eff = PUMP.bep_efficiency * (1 - offset * offset)
  return Math.max(PUMP.minimum_efficiency, Math.min(PUMP.bep_efficiency, eff))
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
 * NPSH available at the suction flange, metres.
 * NPSHa = (P_atm - P_vap)/(rho g) - static lift - suction friction head
 */
export function npshAvailableM(flowM3s: number): number {
  const barometric =
    (FLUID.atmospheric_pressure - FLUID.vapour_pressure) / (FLUID.density * FLUID.gravity)
  const frictionHead = CIRCUIT.suction_resistance * flowM3s * flowM3s
  return barometric - CIRCUIT.suction_lift_m - frictionHead
}

/** NPSH required, rising with flow. Low-order fit typical of a small pump. */
export function npshRequiredM(flowLpm: number): number {
  const ratio = flowLpm / PUMP.duty_flow_lpm
  return 0.6 + 1.4 * ratio * ratio
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
}

/** Full hydraulic solution at a speed and valve opening. */
export function solveOperatingPoint(speedRpm: number, valveOpening: number): OperatingPoint {
  const flowLpm = operatingFlowLpm(speedRpm, valveOpening)
  const flowM3s = lpmToM3s(flowLpm)
  const headM = pumpHead(flowM3s, speedRpm)
  const efficiency = pumpEfficiency(flowLpm)
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
    npsh_margin_m: npshAvailableM(flowM3s) - npshRequiredM(flowLpm),
  }
}

/** Sampled pump + system curves for plotting. */
export function curveSeries(speedRpm: number, valveOpening: number, points = 48) {
  const maxFlowLpm = 34
  const series: {
    flow_lpm: number
    pump_head_m: number
    system_head_m: number
    pump_efficiency: number
  }[] = []
  for (let i = 0; i <= points; i += 1) {
    const flowLpm = (maxFlowLpm * i) / points
    const flowM3s = lpmToM3s(flowLpm)
    series.push({
      flow_lpm: Number(flowLpm.toFixed(2)),
      pump_head_m: Number(pumpHead(flowM3s, speedRpm).toFixed(3)),
      system_head_m: Number(systemHead(flowM3s, valveOpening).toFixed(3)),
      pump_efficiency: Number((pumpEfficiency(flowLpm) * 100).toFixed(2)),
    })
  }
  return series
}
