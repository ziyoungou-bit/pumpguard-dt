/**
 * Acceptance checks for the throttling / variable-speed comparison.
 *
 * The numbers are pinned to three figures because they are the page's headline
 * and a silent drift in eta_BEP would move them without anything failing. At
 * 82.5 L/min -- 71.4 % of the fully-open flow, the same RELATIVE point this
 * suite has always used -- 299 W throttled, 136 W on variable speed, 54.7 %
 * saved.
 *
 * The absolute watts moved when the duty point was reset from 20 to 110 L/min;
 * the percentages did not, and that is the point of pinning both. Every
 * resistance was scaled by (20/110)^2, which leaves head, efficiency and every
 * ratio invariant while moving flow by 5.5x. If a future edit is a genuine
 * rescaling, the watts move and the fractions hold. If it is a mistake, the
 * fractions move too.
 *
 * The last group is still worth having. The affinity-law shortcut predicts 64 %
 * where the circuit delivers 55 %, and the 9-point gap is the static head: the
 * cube law holds only when the system curve passes through the origin.
 */

import { describe, expect, it } from 'vitest'
import { PUMP, speedForFlow, valveOpeningForFlow } from './pumpPhysics'
import { annualEnergy, compareAtFlow, maxFlowLpm } from './energy'

const RATED = PUMP.rated_speed_rpm
/**
 * The reduced-flow case every group below is written against: 82.5 L/min, or
 * 71.4 % of the fully-open 115.5. Stated as an absolute figure rather than as a
 * fraction of maxFlowLpm() so that a change to the circuit shows up as a moved
 * number here instead of silently sliding the test's own target with it.
 */
const TARGET = 82.5

describe('the two inversions', () => {
  it('finds the valve opening that hits a target flow', () => {
    const opening = valveOpeningForFlow(TARGET, RATED)
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
    expect(speedForFlow(TARGET, 1) as number).toBeLessThan(RATED)
  })

  it('does NOT reduce speed in proportion to flow', () => {
    // The whole point. Q ~ N describes the pump curve, not the operating point,
    // and 2 m of static head breaks the proportionality.
    const target = TARGET
    const proportional = RATED * (target / maxFlowLpm())
    const actual = speedForFlow(target, 1) as number
    expect(actual).toBeGreaterThan(proportional)
    expect(actual).toBeCloseTo(1115, -1)
  })
})

describe('C1. target 82.5 L/min', () => {
  const c = compareAtFlow(TARGET)!

  it('solves both paths to the same flow', () => {
    expect(c.throttle.flow_lpm).toBeCloseTo(TARGET, 6)
    expect(c.vsd.flow_lpm).toBeCloseTo(TARGET, 6)
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
    // Pinned so a future change to eta_BEP shows up here rather than silently
    // moving the page's headline number. The watts are 5.5x what they were at
    // the 20 L/min duty point; the fractions below are not, and must not be.
    expect(c.throttle.shaft_power_w).toBeCloseTo(299.3, 0)
    expect(c.vsd.shaft_power_w).toBeCloseTo(135.6, 0)
    expect(c.throttle.electrical_power_w).toBeCloseTo(415.8, 0)
    expect(c.vsd.electrical_power_w).toBeCloseTo(188.3, 0)
    expect(c.saving_fraction).toBeGreaterThan(0.5)
    expect(c.saving_fraction).toBeCloseTo(0.547, 2)
  })

  it('keeps the variable-speed path closer to BEP', () => {
    // Throttling drags the point off BEP at fixed speed; variable speed takes
    // the BEP with it, because efficiency is read on the reduced flow.
    expect(c.vsd.pump_efficiency).toBeGreaterThan(c.throttle.pump_efficiency)
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
    const reduced = compareAtFlow(TARGET)!
    // Throttling climbs UP the rated pump curve...
    expect(reduced.throttle.head_m).toBeGreaterThan(duty.throttle.head_m)
    // ...variable speed slides DOWN the system curve.
    expect(reduced.vsd.head_m).toBeLessThan(duty.vsd.head_m)
    // And the gap between them is head the throttled pump destroys in a valve.
    expect(reduced.throttle.head_m - reduced.vsd.head_m).toBeGreaterThan(2)
  })
})

describe('C4. annual cost is linear in hours and tariff', () => {
  const c = compareAtFlow(TARGET)!

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

  it('puts the annual saving in hundreds of dollars, not tens', () => {
    // Pinned because the Energy page's "Scale, stated plainly" note argues
    // FROM this magnitude. At 20 L/min the saving was about 50 AUD/yr and the
    // note could say no drive would ever be fitted for it; at 110 L/min it is
    // several hundred, which is a different sentence. The note must not go on
    // claiming tens of dollars, and it must not start claiming payback either
    // -- the drive still costs more than this and the rig is still a bench.
    const a = annualEnergy(c, 4000, 0.3)
    expect(a.throttle_kwh).toBeCloseTo(1664.5, 0)
    expect(a.vsd_kwh).toBeCloseTo(753.9, 0)
    expect(a.saved_kwh).toBeCloseTo(910.6, 0)
    expect(a.saved_aud).toBeCloseTo(273.2, 0)
  })
})

describe('the affinity-law estimate is shown, and is optimistic', () => {
  it('overstates the saving because of the static head', () => {
    const c = compareAtFlow(TARGET)!
    expect(c.naive_cube_law_saving_fraction).toBeGreaterThan(c.saving_fraction)
    // 1 - (82.5/115.5)^3 = 0.636 against an actual 0.547: a 9-point
    // overstatement. Both figures are unchanged from the 20 L/min duty point,
    // because the ratio 82.5/115.5 is.
    expect(c.naive_cube_law_saving_fraction).toBeCloseTo(0.636, 2)
    expect(c.naive_cube_law_saving_fraction - c.saving_fraction).toBeCloseTo(0.089, 2)
  })

  it('agrees at the rated point, where there is nothing to save either way', () => {
    const c = compareAtFlow(maxFlowLpm())!
    expect(c.naive_cube_law_saving_fraction).toBeCloseTo(0, 6)
    expect(c.saving_fraction).toBeCloseTo(0, 2)
  })
})
