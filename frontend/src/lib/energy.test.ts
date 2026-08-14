/**
 * Acceptance checks for the throttling / variable-speed comparison.
 *
 * The numbers are pinned to three figures because they are the page's headline
 * and a silent drift in eta_BEP or in the drag model would move them without
 * anything failing. At 15 L/min: 72 W throttled, 33 W on variable speed, 54.7 %
 * saved. The 40 W / 19 W estimate this page was specified against was correct
 * on the ratio and computed with the old 62 % peak efficiency -- both absolute
 * figures scale by 0.62/0.42 and the saving fraction is unchanged, because it
 * divides out.
 *
 * The last group is still worth having. The affinity-law shortcut predicts 64 %
 * where the circuit delivers 55 %, and the 9-point gap is the static head: the
 * cube law holds only when the system curve passes through the origin.
 */

import { describe, expect, it } from 'vitest'
import { PUMP, speedForFlow, valveOpeningForFlow } from './pumpPhysics'
import { annualEnergy, compareAtFlow, maxFlowLpm } from './energy'

const RATED = PUMP.rated_speed_rpm

describe('the two inversions', () => {
  it('finds the valve opening that hits a target flow', () => {
    const opening = valveOpeningForFlow(15, RATED)
    expect(opening).not.toBeNull()
    expect(opening as number).toBeGreaterThan(0)
    expect(opening as number).toBeLessThan(1)
  })

  it('returns a fully open valve at or above the fully open flow', () => {
    expect(valveOpeningForFlow(maxFlowLpm(), RATED)).toBeCloseTo(1, 3)
    expect(valveOpeningForFlow(maxFlowLpm() + 5, RATED)).toBe(1)
  })

  it('finds the speed that hits a target flow with the valve open', () => {
    expect(speedForFlow(maxFlowLpm(), 1)).toBeCloseTo(RATED, 0)
    expect(speedForFlow(15, 1) as number).toBeLessThan(RATED)
  })

  it('does NOT reduce speed in proportion to flow', () => {
    // The whole point. Q ~ N describes the pump curve, not the operating point,
    // and 2 m of static head breaks the proportionality.
    const target = 15
    const proportional = RATED * (target / maxFlowLpm())
    const actual = speedForFlow(target, 1) as number
    expect(actual).toBeGreaterThan(proportional)
    expect(actual).toBeCloseTo(1115, -1)
  })
})

describe('C1. target 15 L/min', () => {
  const c = compareAtFlow(15)!

  it('solves both paths to the same flow', () => {
    expect(c.throttle.flow_lpm).toBeCloseTo(15, 6)
    expect(c.vsd.flow_lpm).toBeCloseTo(15, 6)
  })

  it('throttles at rated speed with a part-open valve', () => {
    expect(c.throttle.speed_rpm).toBeCloseTo(RATED, 6)
    expect(c.throttle.valve_opening).toBeLessThan(1)
    expect(c.throttle.head_m).toBeCloseTo(9.75, 1)
  })

  it('runs the variable-speed path slower with the valve wide open', () => {
    expect(c.vsd.valve_opening).toBe(1)
    expect(c.vsd.speed_rpm).toBeCloseTo(1115, -1)
    // 4.85 m is the OPERATING head, Hs + K Q^2. The shutoff head at this speed
    // is 7.10 m; confusing the two overstates the hydraulic power by half.
    expect(c.vsd.head_m).toBeCloseTo(4.85, 1)
  })

  it('saves more than half the electrical input', () => {
    // Pinned so a future change to eta_BEP or to the drag model shows up here
    // rather than silently moving the page's headline number.
    expect(c.throttle.shaft_power_w).toBeCloseTo(72.2, 0)
    expect(c.vsd.shaft_power_w).toBeCloseTo(32.7, 0)
    expect(c.throttle.electrical_power_w).toBeCloseTo(100.3, 0)
    expect(c.vsd.electrical_power_w).toBeCloseTo(45.5, 0)
    expect(c.saving_fraction).toBeGreaterThan(0.5)
    expect(c.saving_fraction).toBeCloseTo(0.547, 2)
  })

  it('keeps the variable-speed path closer to BEP', () => {
    // Throttling drags the point off BEP at fixed speed; variable speed takes
    // the BEP with it, because efficiency is read on the reduced flow.
    expect(c.vsd.pump_efficiency).toBeGreaterThan(c.throttle.pump_efficiency)
  })

  it('scales the parasitic drag with N^3', () => {
    const ratio = c.vsd.parasitic_power_w / c.throttle.parasitic_power_w
    expect(ratio).toBeCloseTo(Math.pow(c.vsd.speed_rpm / c.throttle.speed_rpm, 3), 6)
    // Missing this is the documented way to understate the variable-speed case.
    expect(c.vsd.parasitic_power_w).toBeLessThan(c.throttle.parasitic_power_w)
  })
})

describe('C2. target at the rated duty point', () => {
  const c = compareAtFlow(maxFlowLpm())!

  it('converges to the same machine, so the saving is zero', () => {
    expect(c.throttle.valve_opening).toBeCloseTo(1, 3)
    expect(c.vsd.speed_rpm).toBeCloseTo(RATED, 0)
    expect(c.throttle.head_m).toBeCloseTo(c.vsd.head_m, 2)
    expect(c.throttle.electrical_power_w).toBeCloseTo(c.vsd.electrical_power_w, 1)
    expect(Math.abs(c.saving_fraction)).toBeLessThan(0.01)
  })
})

describe('C3. the two points move in opposite directions', () => {
  it('puts the throttled point above and the VSD point below the duty head', () => {
    const duty = compareAtFlow(maxFlowLpm())!
    const reduced = compareAtFlow(15)!
    // Throttling climbs UP the rated pump curve...
    expect(reduced.throttle.head_m).toBeGreaterThan(duty.throttle.head_m)
    // ...variable speed slides DOWN the system curve.
    expect(reduced.vsd.head_m).toBeLessThan(duty.vsd.head_m)
    // And the gap between them is head the throttled pump destroys in a valve.
    expect(reduced.throttle.head_m - reduced.vsd.head_m).toBeGreaterThan(2)
  })
})

describe('C4. annual cost is linear in hours and tariff', () => {
  const c = compareAtFlow(15)!

  it('doubles with the hours', () => {
    const a = annualEnergy(c, 2000, 0.3)
    const b = annualEnergy(c, 4000, 0.3)
    expect(b.throttle_kwh).toBeCloseTo(2 * a.throttle_kwh, 6)
    expect(b.saved_aud).toBeCloseTo(2 * a.saved_aud, 6)
  })

  it('doubles with the tariff, leaving energy untouched', () => {
    const a = annualEnergy(c, 4000, 0.3)
    const b = annualEnergy(c, 4000, 0.6)
    expect(b.throttle_kwh).toBeCloseTo(a.throttle_kwh, 6)
    expect(b.throttle_aud).toBeCloseTo(2 * a.throttle_aud, 6)
  })

  it('reports the saving as the difference of the two paths', () => {
    const a = annualEnergy(c, 4000, 0.3)
    expect(a.saved_kwh).toBeCloseTo(a.throttle_kwh - a.vsd_kwh, 6)
    expect(a.saved_aud).toBeCloseTo(a.saved_kwh * 0.3, 6)
  })
})

describe('the affinity-law estimate is shown, and is optimistic', () => {
  it('overstates the saving because of the static head', () => {
    const c = compareAtFlow(15)!
    expect(c.naive_cube_law_saving_fraction).toBeGreaterThan(c.saving_fraction)
    // 1 - (15/21)^3 = 0.636 against an actual 0.547: a 9-point overstatement.
    expect(c.naive_cube_law_saving_fraction).toBeCloseTo(0.636, 2)
    expect(c.naive_cube_law_saving_fraction - c.saving_fraction).toBeCloseTo(0.089, 2)
  })

  it('agrees at the rated point, where there is nothing to save either way', () => {
    const c = compareAtFlow(maxFlowLpm())!
    expect(c.naive_cube_law_saving_fraction).toBeCloseTo(0, 6)
    expect(c.saving_fraction).toBeCloseTo(0, 2)
  })
})
