/**
 * Throttling versus variable speed, for one target flow.
 *
 * The classic pump-energy question, and the one a building-services engineer
 * is asked to answer on every retrofit: to get the flow down to what the
 * building actually needs, do you close a valve or slow the pump?
 *
 * Nothing here is a new model. Both paths are solved with the same hydraulics
 * every other page uses -- the intersection of the pump and system curves and
 * the efficiency read on reduced flow. Only the QUESTION is new: instead of
 * "what does this machine do", it is "what would this machine cost, two ways".
 *
 * The result that matters is not the saving. It is WHY the saving is smaller
 * than the affinity laws suggest, which `naiveCubeLawSavingFraction` exists to
 * make visible -- see its comment.
 */

import {
  PUMP,
  electricalPowerW,
  hydraulicPowerW,
  lpmToM3s,
  motorCurrentA,
  operatingFlowLpm,
  pumpEfficiency,
  pumpHead,
  shaftPowerW,
  speedForFlow,
  valveOpeningForFlow,
} from './pumpPhysics'

export interface OperatingPath {
  /** 'throttle' or 'vsd'. */
  key: 'throttle' | 'vsd'
  label: string
  speed_rpm: number
  valve_opening: number
  flow_lpm: number
  head_m: number
  pump_efficiency: number
  /** Wire-to-water: hydraulic power over electrical input. */
  overall_efficiency: number
  hydraulic_power_w: number
  shaft_power_w: number
  electrical_power_w: number
  motor_current_a: number
  reachable: boolean
}

function buildPath(
  key: OperatingPath['key'],
  label: string,
  flowLpm: number,
  speedRpm: number,
  valveOpening: number,
): OperatingPath {
  const flowM3s = lpmToM3s(flowLpm)
  const headM = pumpHead(flowM3s, speedRpm)
  const efficiency = pumpEfficiency(flowLpm, speedRpm)
  const hydraulic = hydraulicPowerW(flowM3s, headM)
  const shaft = shaftPowerW(hydraulic, efficiency)
  const electrical = electricalPowerW(shaft)
  return {
    key,
    label,
    speed_rpm: speedRpm,
    valve_opening: valveOpening,
    flow_lpm: flowLpm,
    head_m: headM,
    pump_efficiency: efficiency,
    overall_efficiency: electrical > 0 ? hydraulic / electrical : 0,
    hydraulic_power_w: hydraulic,
    shaft_power_w: shaft,
    electrical_power_w: electrical,
    motor_current_a: motorCurrentA(electrical),
    reachable: true,
  }
}

export interface EnergyComparison {
  target_flow_lpm: number
  throttle: OperatingPath
  vsd: OperatingPath
  /** Fraction of electrical input saved by the variable-speed path, 0..1. */
  saving_fraction: number
  /**
   * What the affinity laws alone would predict, for contrast.
   *
   * P ~ N^3 with N ~ Q gives a saving of 1 - (Q/Q_rated)^3, which at 82.5 out
   * of 115.5 L/min is 63.6 % -- against the 54.7 % the circuit actually
   * delivers. The 9-point gap is the 2 m of static head: the affinity laws
   * describe points on the PUMP curve, and the operating point only travels
   * along them when the system curve passes through the origin. A pump with a
   * geometric lift in front of it must still generate that lift at any speed,
   * so the speed cannot fall in proportion to the flow and the cube never
   * applies exactly.
   *
   * Nine points is modest here because static head is only 2 m out of about
   * 9.75. The reason to show it anyway is that the error grows with the static
   * fraction, and it grows in the optimistic direction: on a tall riser, where
   * static head is most of the duty, sizing a variable-speed retrofit on the
   * cube law is how the business case ends up promising savings the system
   * cannot deliver.
   */
  naive_cube_law_saving_fraction: number
}

export function compareAtFlow(targetFlowLpm: number): EnergyComparison | null {
  const valveOpening = valveOpeningForFlow(targetFlowLpm, PUMP.rated_speed_rpm)
  const vsdSpeed = speedForFlow(targetFlowLpm, 1)
  if (valveOpening === null || vsdSpeed === null) return null

  const throttle = buildPath(
    'throttle',
    'Throttling',
    targetFlowLpm,
    PUMP.rated_speed_rpm,
    valveOpening,
  )
  const vsd = buildPath('vsd', 'Variable speed', targetFlowLpm, vsdSpeed, 1)

  const saving =
    throttle.electrical_power_w > 0
      ? (throttle.electrical_power_w - vsd.electrical_power_w) / throttle.electrical_power_w
      : 0

  const ratedFlow = maxFlowLpm()
  const flowRatio = ratedFlow > 0 ? targetFlowLpm / ratedFlow : 1

  return {
    target_flow_lpm: targetFlowLpm,
    throttle,
    vsd,
    saving_fraction: saving,
    naive_cube_law_saving_fraction: Math.max(0, 1 - Math.pow(flowRatio, 3)),
  }
}

/**
 * Flow with the valve wide open at rated speed: the top of the slider, and the
 * point at which the two paths must converge because there is nothing left to
 * throttle and no reason to slow down.
 */
export function maxFlowLpm(): number {
  return operatingFlowLpm(PUMP.rated_speed_rpm, 1)
}

export interface AnnualEnergy {
  hours_per_year: number
  tariff_aud_per_kwh: number
  throttle_kwh: number
  vsd_kwh: number
  throttle_aud: number
  vsd_aud: number
  saved_kwh: number
  saved_aud: number
}

/**
 * Annual energy and cost. Linear in both inputs by construction -- there is no
 * load profile, no diversity factor and no demand charge, and pretending
 * otherwise on a laboratory-scale demonstration would be inventing precision.
 */
export function annualEnergy(
  comparison: EnergyComparison,
  hoursPerYear: number,
  tariffAudPerKwh: number,
): AnnualEnergy {
  const throttleKwh = (comparison.throttle.electrical_power_w / 1000) * hoursPerYear
  const vsdKwh = (comparison.vsd.electrical_power_w / 1000) * hoursPerYear
  return {
    hours_per_year: hoursPerYear,
    tariff_aud_per_kwh: tariffAudPerKwh,
    throttle_kwh: throttleKwh,
    vsd_kwh: vsdKwh,
    throttle_aud: throttleKwh * tariffAudPerKwh,
    vsd_aud: vsdKwh * tariffAudPerKwh,
    saved_kwh: throttleKwh - vsdKwh,
    saved_aud: (throttleKwh - vsdKwh) * tariffAudPerKwh,
  }
}
