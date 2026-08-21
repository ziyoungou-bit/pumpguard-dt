/**
 * The Engineering page promises a reader can check the arithmetic by hand.
 * These assertions are what makes that promise mechanical rather than hopeful.
 */

import { describe, expect, it } from 'vitest'
import { PUMP, solveOperatingPoint } from './pumpPhysics'
import { healthBreakdown } from './health'
import sharedCasesRaw from '../../../testdata/health_cases.json?raw'
import backendHealthSourceRaw from '../../../backend/app/health.py?raw'
import { ZONE_A_B_MM_S, ZONE_B_C_MM_S, vibrationHealthPenalty } from './vibration'

// The machine sitting on its own rated duty point, solved rather than typed.
// The efficiency and the suction margin used to be the literals 0.419 and 7.02.
// Both were correct for a 20 L/min rig; after the rescale 0.419 was 86 % of
// eta_BEP, which is below the 0.89 onset, so this fixture would have been
// carrying an efficiency penalty while every test around it called it healthy.
const duty = solveOperatingPoint(PUMP.rated_speed_rpm, 1)

const healthy = {
  running: true,
  vibration_rms_mm_s: 0.612,
  pump_efficiency: duty.pump_efficiency,
  bep_efficiency: PUMP.bep_efficiency,
  npsh_margin_m: duty.npsh_margin_m,
  bearing_temperature_c: 46,
}

interface SharedHealthCase {
  name: string
  running: boolean
  vibration_rms_mm_s: number
  pump_efficiency: number
  bep_efficiency: number
  npsh_margin_m: number
  bearing_temperature_c: number
  expected_health: number
  expected_scored: boolean
}

const sharedCases = JSON.parse(sharedCasesRaw) as SharedHealthCase[]
describe('B1. the printed sum is the applied sum', () => {
  it('adds to exactly what it reports', () => {
    // The check a reader does by hand: subtract every listed term from 100.
    const result = healthBreakdown(healthy)
    const total = result.terms.reduce((sum, term) => sum + term.penalty, 0)
    expect(result.health).toBeCloseTo(100 - total, 9)
  })

  it('lists every term, including the ones scoring zero', () => {
    // A term hidden because it happens to be zero is a term the reader cannot
    // check, and they cannot tell a zero term from a missing one.
    const result = healthBreakdown(healthy)
    expect(result.terms.map((t) => t.label)).toEqual([
      'Vibration',
      'Efficiency',
      'NPSH margin',
      'Bearing temperature',
    ])
    expect(result.terms.filter((t) => t.penalty === 0).length).toBeGreaterThan(0)
  })
})

describe('B2. the health index has no dead band', () => {
  it('scores a healthy machine in 94-99, not a suspiciously round 100', () => {
    const result = healthBreakdown(healthy)
    expect(result.health).toBeGreaterThanOrEqual(94)
    expect(result.health).toBeLessThan(100)
  })

  it('drops clearly below 100 at 0.99 mm/s, which is already out of Zone A', () => {
    // The reported contradiction: "Imbalance / MINOR / severity 0.13" beside
    // "Health 100/100 / no significant degradation". 0.99 mm/s is in Zone B.
    const result = healthBreakdown({ ...healthy, vibration_rms_mm_s: 0.99 })
    expect(result.health).toBeLessThan(96)
    expect(result.health).toBeGreaterThan(85)
  })

  it('starts penalising from zero RMS, not from 1.8 mm/s', () => {
    expect(vibrationHealthPenalty(0)).toBe(0)
    expect(vibrationHealthPenalty(0.5)).toBeGreaterThan(0)
    expect(vibrationHealthPenalty(ZONE_A_B_MM_S)).toBeCloseTo(4 * ZONE_A_B_MM_S, 6)
  })

  it('accelerates through each zone', () => {
    // Equal RMS steps must cost progressively more the further out they are.
    const stepInA = vibrationHealthPenalty(0.6) - vibrationHealthPenalty(0.3)
    const stepInB = vibrationHealthPenalty(1.5) - vibrationHealthPenalty(1.2)
    const stepInC = vibrationHealthPenalty(3.0) - vibrationHealthPenalty(2.7)
    const stepInD = vibrationHealthPenalty(5.5) - vibrationHealthPenalty(5.2)
    expect(stepInB).toBeGreaterThan(stepInA)
    expect(stepInC).toBeGreaterThan(stepInB)
    expect(stepInD).toBeGreaterThan(stepInC)
  })

  it('is continuous across the zone edges', () => {
    // A step at a boundary would make the health index jump on a reading that
    // moved by 0.001 mm/s, which reads as an instrument fault.
    const eps = 1e-6
    for (const edge of [ZONE_A_B_MM_S, ZONE_B_C_MM_S]) {
      expect(vibrationHealthPenalty(edge + eps)).toBeCloseTo(vibrationHealthPenalty(edge - eps), 4)
    }
  })
})

describe('B2. the stopped guard is a guard, not a silent 100', () => {
  it('does not score a stopped machine', () => {
    const result = healthBreakdown({ ...healthy, running: false })
    expect(result.scored).toBe(false)
    expect(result.health).toBe(100)
    expect(result.guard).toMatch(/stopped guard/i)
  })

  it('would give 67, not 100, if the sum were applied to a stopped machine', () => {
    // The reader's objection, reproduced. Substituting eta = 0 into the
    // efficiency term costs 33 points, so a formula printed without the guard
    // and a displayed 100 cannot both be right. The page now prints the guard.
    const asIfScored = healthBreakdown({
      ...healthy,
      running: true,
      vibration_rms_mm_s: 0,
      pump_efficiency: 0,
      npsh_margin_m: 0,
      bearing_temperature_c: 23,
    })
    expect(asIfScored.health).toBeGreaterThan(60)
    expect(asIfScored.health).toBeLessThan(75)
  })
})

describe('the efficiency term is relative, not absolute', () => {
  it('does not penalise a machine running at its own BEP', () => {
    const atBep = healthBreakdown({
      ...healthy,
      pump_efficiency: PUMP.bep_efficiency,
    })
    expect(atBep.terms.find((t) => t.label === 'Efficiency')?.penalty).toBe(0)
  })

  it('stays zero if the peak efficiency of the machine is corrected again', () => {
    // The regression that made the old absolute 0.55 threshold an always-on
    // penalty the moment eta_BEP was corrected downwards. The sweep spans
    // well below and well above every value eta_BEP has ever held here.
    for (const peak of [0.3, 0.42, 0.62, 0.85]) {
      const result = healthBreakdown({
        ...healthy,
        pump_efficiency: peak,
        bep_efficiency: peak,
      })
      expect(result.terms.find((t) => t.label === 'Efficiency')?.penalty).toBe(0)
    }
  })
})

// This is a sampled lock for one coefficient, not a complete cross-language
// consistency test. It catches someone changing the vibration penalty slope
// literal. It does not catch formula rewrites that preserve this text by moving
// the arithmetic elsewhere, changes to other zone slopes, zone boundaries, NPSH
// penalties, or temperature penalties. Complete coverage requires both sides to
// assert all outputs for the same fixture set; health_cases.json already does
// that semantic check on both sides, and this source sentinel is an extra layer.
// Known weak point: it matches source text, so formatting-only changes can cause
// false positives. If that happens, update the matched string; do not delete the
// test.
describe('backend health source contract', () => {
  it('keeps the backend vibration penalty coefficients aligned with TypeScript', () => {
    expect(backendHealthSourceRaw).toContain(
      'return 4.0 * in_zone_a + 11.0 * in_zone_b + 22.0 * in_zone_c + 40.0 * in_zone_d',
    )
  })
})
describe('shared health fixture', () => {
  for (const item of sharedCases) {
    it(item.name, () => {
      const result = healthBreakdown(item)
      expect(result.scored).toBe(item.expected_scored)
      expect(result.health).toBeCloseTo(item.expected_health, 6)
    })
  }
})
