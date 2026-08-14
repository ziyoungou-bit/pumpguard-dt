/**
 * The bundled scenario is a script with a job to do: a visitor arriving at any
 * moment must land on a running machine and, within 90 seconds, see a fault
 * develop, cross a severity boundary, raise an alarm, be diagnosed, and clear.
 *
 * These assertions pin that arc. Without them the scenario is a list of numbers
 * that nobody notices has stopped telling the story -- which is what happened
 * when the recording opened on ten seconds of OFF and every panel on the
 * landing screen showed zero.
 */

import { describe, expect, it } from 'vitest'
import { AssetState, FaultType } from '../types/contracts'
import { DEMO_DURATION_S, DEMO_FRAMES, DEMO_TICK_S, demoAlarms, demoDiagnosis } from './recordedDemo'

const at = (seconds: number) =>
  DEMO_FRAMES[Math.min(DEMO_FRAMES.length - 1, Math.round(seconds / DEMO_TICK_S))]

/** ISO 20816-1 Class I zone edges, mm/s RMS. Applied by analogy -- see below. */
const ZONE_AB = 0.71
const ZONE_BC = 1.8

describe('the recording loops in 90 seconds', () => {
  it('is 90 seconds long', () => {
    expect(DEMO_DURATION_S).toBe(90)
    expect((DEMO_FRAMES.length - 1) * DEMO_TICK_S).toBeCloseTo(90, 6)
  })

  it('never contains a stopped machine', () => {
    // The point of the rewrite. A column of zeros on first paint is
    // indistinguishable from a site that failed to load.
    for (const frame of DEMO_FRAMES) {
      expect(frame.asset_state).toBe(AssetState.RUNNING)
      expect(frame.rpm).toBeGreaterThan(1000)
    }
  })

  it('opens at the duty point, not mid-transient', () => {
    const first = at(0)
    expect(first.flow_lpm).toBeGreaterThan(15)
    expect(first.pump_head_m).toBeGreaterThan(6)
    expect(first.vibration_rms_mm_s).toBeLessThanOrEqual(ZONE_AB)
    expect(first.fault_state).toBe(FaultType.NORMAL)
  })

  it('stamps frames with dataset time, not the visitor wall clock', () => {
    // A recorded dataset stamped "now" invites the reader to believe it is
    // live, and no badge outshouts a clock that agrees with their watch.
    const year = new Date(at(0).timestamp).getUTCFullYear()
    expect(year).toBe(2026)
    expect(new Date(at(30).timestamp).getTime() - new Date(at(0).timestamp).getTime()).toBe(30_000)
  })
})

describe('the imbalance arc', () => {
  it('holds a healthy machine for the first minute', () => {
    for (const t of [0, 15, 30, 45, 59]) {
      expect(at(t).fault_state).toBe(FaultType.NORMAL)
      expect(at(t).vibration_rms_mm_s).toBeLessThanOrEqual(ZONE_AB)
    }
  })

  it('ramps rather than steps', () => {
    // A rotor does not become unbalanced between two samples, and a step lets a
    // detector "work" by spotting the discontinuity instead of the signature.
    const during = [62, 66, 70, 74, 78].map((t) => at(t).severity)
    for (let i = 1; i < during.length; i += 1) {
      expect(during[i]).toBeGreaterThan(during[i - 1])
    }
    expect(at(78).severity).toBeCloseTo(0.6, 1)
  })

  it('crosses the Zone A/B boundary early in the ramp', () => {
    expect(at(60).vibration_rms_mm_s).toBeLessThanOrEqual(ZONE_AB + 0.05)
    expect(at(63).vibration_rms_mm_s).toBeGreaterThan(ZONE_AB)
  })

  it('reaches Zone C and raises an alarm', () => {
    const peak = at(82)
    expect(peak.vibration_rms_mm_s).toBeGreaterThan(ZONE_BC)
    expect(demoAlarms(peak).length).toBeGreaterThan(0)
  })

  it('lifts 1x much harder than 2x, which is what makes it imbalance', () => {
    // A residual unbalance is a rotating radial force: it excites once per
    // revolution. The discriminator against misalignment is that 2x barely
    // responds, so what must rise is the 1x/2x RATIO.
    const healthy = at(30)
    const faulted = at(82)
    const ratioHealthy = healthy.amplitude_1x_mm_s / healthy.amplitude_2x_mm_s
    const ratioFaulted = faulted.amplitude_1x_mm_s / faulted.amplitude_2x_mm_s
    expect(ratioFaulted).toBeGreaterThan(2 * ratioHealthy)

    const growth1x = faulted.amplitude_1x_mm_s / healthy.amplitude_1x_mm_s
    const growth2x = faulted.amplitude_2x_mm_s / healthy.amplitude_2x_mm_s
    expect(growth1x).toBeGreaterThan(2 * growth2x)
  })

  it('is diagnosed as imbalance with rising confidence', () => {
    const early = demoDiagnosis(at(66))
    const late = demoDiagnosis(at(82))
    expect(late.detected_condition).toBe(FaultType.IMBALANCE)
    expect(late.confidence).toBeGreaterThan(early.confidence)
  })

  it('degrades health instead of holding a suspiciously round 100', () => {
    expect(at(82).health_index).toBeLessThan(at(30).health_index)
  })

  it('clears and returns to the duty point before the loop repeats', () => {
    const end = at(90)
    expect(end.fault_state).toBe(FaultType.NORMAL)
    expect(end.vibration_rms_mm_s).toBeLessThanOrEqual(ZONE_AB)
    // The loop must close cleanly: the last frame has to look like the first,
    // or the replay visibly jumps every 90 seconds.
    expect(end.vibration_rms_mm_s).toBeCloseTo(at(0).vibration_rms_mm_s, 1)
    expect(end.flow_lpm).toBeCloseTo(at(0).flow_lpm, 0)
  })
})
