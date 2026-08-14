/**
 * Acceptance checks for the pump hydraulics.
 *
 * These are the cases that caught the three physics errors and the two port
 * drifts, written down so they cannot come back. Each one states the number it
 * expects and why, because a test that only asserts "close to what it returned
 * last time" pins a bug just as firmly as it pins a fix.
 */

import { describe, expect, it } from 'vitest'
import {
  MOTOR,
  PUMP,
  SPECIFIC_SPEED_NQ,
  bepFlowLpm,
  cavitationOnsetFlowLpm,
  lpmToM3s,
  motorSlip,
  npshAvailableM,
  npshRequiredM,
  pumpEfficiency,
  runoutFlowLpm,
  solveOperatingPoint,
} from './pumpPhysics'

const RATED = PUMP.rated_speed_rpm // 1450

describe('specific speed sets the efficiency band', () => {
  it('computes n_q from the rated duty point rather than storing it', () => {
    // 1450 * sqrt(20/60000) / 8^0.75
    expect(SPECIFIC_SPEED_NQ).toBeCloseTo(5.57, 2)
  })

  it('peaks at an efficiency consistent with a low-n_q impeller', () => {
    // n_q 5.6 is far below the conventional 10-80 band; measured peak
    // efficiency for this size and shape sits at 35-45 %.
    expect(PUMP.bep_efficiency).toBeGreaterThanOrEqual(0.35)
    expect(PUMP.bep_efficiency).toBeLessThanOrEqual(0.45)
  })
})

describe('1. default duty point', () => {
  it('lands on the rated duty point at 1450 rpm with the valve fully open', () => {
    const point = solveOperatingPoint(RATED, 1)
    expect(point.flow_lpm).toBeCloseTo(21.0, 1)
    expect(point.pump_head_m).toBeCloseTo(7.59, 2)
    expect(point.flow_lpm).toBeGreaterThan(0)
    expect(point.no_intersection).toBe(false)
  })

  it('reports 3.3 % slip at the rated speed', () => {
    expect(motorSlip(RATED) * 100).toBeCloseTo(3.33, 2)
    expect(MOTOR.synchronous_speed_rpm).toBe(1500)
  })
})

describe('2. halving the speed', () => {
  const full = solveOperatingPoint(RATED, 1)
  const half = solveOperatingPoint(RATED / 2, 1)

  it('scales the pump CURVE by the affinity laws exactly', () => {
    // Shutoff head is the curve's own anchor: H0 ~ N^2, so half speed is a
    // quarter head. Runout flow is the other anchor: Q ~ N, so half.
    const shutoffFull = PUMP.shutoff_head_m
    const shutoffHalf = PUMP.shutoff_head_m * 0.25
    expect(shutoffHalf / shutoffFull).toBeCloseTo(0.25, 6)
    expect(runoutFlowLpm(RATED / 2) / runoutFlowLpm(RATED)).toBeCloseTo(0.5, 6)
  })

  it('does NOT halve the operating point, because static head does not scale', () => {
    // This is the part the affinity laws do not cover and the acceptance note
    // got wrong. Q* = sqrt((H0(N) - H_static) / (a + K)). H0 scales with N^2
    // but H_static is a fixed 2 m geometric lift, so subtracting it before the
    // square root breaks the proportionality. At half speed H0 falls 12 -> 3 m
    // and the 2 m static head eats two thirds of what is left.
    expect(half.flow_lpm / full.flow_lpm).toBeCloseTo(0.316, 2)
    expect(half.pump_head_m / full.pump_head_m).toBeCloseTo(0.337, 2)
    // Recorded explicitly so nobody "fixes" this back to 0.5 later.
    expect(half.flow_lpm).toBeCloseTo(6.64, 1)
    expect(half.pump_head_m).toBeCloseTo(2.56, 1)
  })

  it('keeps the PEAK of the efficiency curve unchanged', () => {
    // eta is invariant along the homologous mapping, so the peak value does not
    // move with speed even though the operating point slides off it.
    expect(pumpEfficiency(bepFlowLpm(RATED), RATED)).toBeCloseTo(PUMP.bep_efficiency, 6)
    expect(pumpEfficiency(bepFlowLpm(RATED / 2), RATED / 2)).toBeCloseTo(PUMP.bep_efficiency, 6)
  })
})

describe('3. BEP flow tracks speed', () => {
  it('moves the BEP to 11 L/min at 725 rpm', () => {
    expect(bepFlowLpm(725)).toBeCloseTo(11.0, 3)
    expect(bepFlowLpm(RATED)).toBeCloseTo(22.0, 3)
  })

  it('reads efficiency on reduced flow, not absolute flow', () => {
    // 11 L/min at 725 rpm is the same homologous point as 22 L/min at 1450.
    // Looking eta up on absolute flow would report this as far off BEP.
    expect(pumpEfficiency(11, 725)).toBeCloseTo(pumpEfficiency(22, RATED), 6)
  })
})

describe('4. near shutoff', () => {
  it('gives single-digit efficiency at 5 % of BEP flow', () => {
    // x = 1/22 = 0.04545; eta = 0.42 (2x - x^2) = 3.73 %.
    // The old span-plus-floor parabola returned 21.6 % here.
    expect(pumpEfficiency(1, RATED) * 100).toBeCloseTo(3.73, 2)
    expect(pumpEfficiency(1, RATED) * 100).toBeLessThan(5)
  })

  it('forces eta(0) = 0 with no floor', () => {
    expect(pumpEfficiency(0, RATED)).toBe(0)
  })

  it('returns 0 rather than NaN when stopped', () => {
    expect(pumpEfficiency(10, 0)).toBe(0)
  })
})

describe('5. peak efficiency', () => {
  it('sits in the 40-45 % band', () => {
    const peak = pumpEfficiency(bepFlowLpm(RATED), RATED)
    expect(peak).toBeGreaterThanOrEqual(0.4)
    expect(peak).toBeLessThanOrEqual(0.45)
  })
})

describe('7. throttling the valve', () => {
  const open = solveOperatingPoint(RATED, 1)
  const shut = solveOperatingPoint(RATED, 0.3)

  it('moves the operating point up and to the left', () => {
    // The counter-intuitive part: closing a valve RAISES discharge pressure.
    expect(shut.flow_lpm).toBeLessThan(open.flow_lpm)
    expect(shut.pump_head_m).toBeGreaterThan(open.pump_head_m)
    expect(shut.flow_lpm).toBeCloseTo(17.93, 1)
    expect(shut.pump_head_m).toBeCloseTo(8.78, 1)
  })

  it('barely changes shaft power between 100 % and 30 % open', () => {
    // Not the ">30 % open reduces power" the acceptance note expected. Between
    // these two openings the hydraulic power falls only 1.2 % (flow down 15 %,
    // head up 16 %) while efficiency falls 3.2 % as the point leaves BEP, so
    // the quotient rises slightly. P_shaft(Q) for this pump has a shallow
    // maximum near 0.75 Q_BEP and 100 % / 30 % straddle it.
    expect(shut.shaft_power_w / open.shaft_power_w).toBeCloseTo(1.018, 2)
  })

  it('does reduce shaft power once throttled hard', () => {
    // The low-n_q rising P-Q characteristic is real; it just needs a wider
    // lever than 30 % to show. At 10 % open the point is at 0.44 Q_BEP.
    const hard = solveOperatingPoint(RATED, 0.1)
    expect(hard.flow_lpm).toBeCloseTo(9.75, 1)
    expect(hard.shaft_power_w).toBeLessThan(open.shaft_power_w)
  })
})

describe('8. below the static head', () => {
  it('clamps to zero flow and flags no intersection instead of throwing', () => {
    const point = solveOperatingPoint(1, 1)
    expect(point.no_intersection).toBe(true)
    expect(point.flow_lpm).toBe(0)
    expect(Number.isNaN(point.pump_head_m)).toBe(false)
    expect(Number.isNaN(point.shaft_power_w)).toBe(false)
    expect(point.pump_efficiency).toBe(0)
  })
})

describe('NPSH, after the port drift was closed', () => {
  it('uses the NET suction lift, matching the backend', () => {
    // barometric 10.111 m, net lift 0.4 m (1.2 standing in 0.8 of liquid),
    // friction 0.551 m at 21 L/min. The old port subtracted the full 1.2 m.
    const point = solveOperatingPoint(RATED, 1)
    expect(npshAvailableM(lpmToM3s(point.flow_lpm))).toBeCloseTo(9.16, 2)
  })

  it('scales NPSHr as a homologous quantity', () => {
    expect(npshRequiredM(21.0, RATED)).toBeCloseTo(2.1435, 4)
    // Same homologous point at half speed: quarter of the requirement.
    expect(npshRequiredM(10.5, RATED / 2)).toBeCloseTo(2.1435 / 4, 4)
  })

  it('puts the clean-suction cavitation boundary beyond runout', () => {
    // Honest result for this rig: at clean suction, flow alone cannot cavitate
    // it. The route in is suction restriction, which is where the fault model
    // puts it.
    const onset = cavitationOnsetFlowLpm(RATED, 0)
    expect(onset).not.toBeNull()
    expect(onset as number).toBeGreaterThan(runoutFlowLpm(RATED))
  })

  it('brings the boundary onto the chart once the suction is restricted', () => {
    const onset = cavitationOnsetFlowLpm(RATED, 0.5)
    expect(onset as number).toBeLessThan(runoutFlowLpm(RATED))
    expect(onset as number).toBeCloseTo(19.7, 0)
  })
})
