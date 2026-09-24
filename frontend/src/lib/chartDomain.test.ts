/**
 * D1. Steady-state noise must not fill the plot.
 *
 * The measured case: flow on this rig sits inside 115.44-115.60 L/min. Fitted
 * to its own extremes that 0.16 L/min band renders as a full-height sawtooth and
 * reads as violent instability. Against the declared minimum span it is a flat
 * line, which is what a machine holding 115.5 L/min actually looks like.
 *
 * D2. A limit line must stay on screen. A vibration trend whose job is to show
 * distance-to-alarm cannot crop the alarm out of frame to make the curve look
 * calmer.
 *
 * D3. Physical bounds are not negotiable. A negative vibration velocity on an
 * axis is worse than a noisy one.
 */

import { describe, expect, it } from 'vitest'
import { TREND_MIN_SPAN, trendDomain } from './chartDomain'

describe('D1. the minimum span holds a quiet signal flat', () => {
  it('gives the measured flow band a span near 8 L/min, not 0.16', () => {
    const quiet = Array.from({ length: 60 }, (_, i) => 115.44 + (i % 5) * 0.04)
    const [low, high] = trendDomain(quiet, { key: 'flow_lpm' })
    expect(high - low).toBeGreaterThanOrEqual(TREND_MIN_SPAN.flow_lpm.minSpan)
    // The curve now occupies well under a fifth of the plot height.
    expect((Math.max(...quiet) - Math.min(...quiet)) / (high - low)).toBeLessThan(0.2)
  })

  it('lets a real excursion expand the axis past the minimum', () => {
    // A 12 L/min swing is wider than the 8 L/min minimum, so the axis follows it.
    const [low, high] = trendDomain([110, 122], { key: 'flow_lpm' })
    expect(high - low).toBeGreaterThan(8)
    expect(low).toBeLessThan(110)
    expect(high).toBeGreaterThan(122)
  })

  it('follows the data when cheap, and never returns a zero-width domain', () => {
    const [low, high] = trendDomain([100, 100], { key: 'flow_lpm' })
    expect(high - low).toBeGreaterThan(0)
    expect(low).toBeGreaterThanOrEqual(0)
  })

  it('falls back to a usable domain for an empty series', () => {
    const [low, high] = trendDomain([], { key: 'flow_lpm' })
    expect(high).toBeGreaterThan(low)
  })
})

describe('D2. limit lines are kept in frame', () => {
  it('raises the upper bound to the vibration trip line', () => {
    const quiet = [0.2, 0.25, 0.3, 0.22]
    const [low, high] = trendDomain(quiet, { key: 'vibration_rms_mm_s', referenceLevels: [4.5] })
    expect(high).toBeGreaterThan(4.5)
    // The trace is consequently compressed, which is the acknowledged
    // trade-off: the reader learns the machine is quiet AND far from trip.
    expect(low).toBeGreaterThanOrEqual(0)
  })

  it('expands downward for a low-side limit', () => {
    const [low] = trendDomain([1.8, 1.9], { key: 'npsh_margin_m', referenceLevels: [-0.5] })
    expect(low).toBeLessThan(-0.5)
  })
})

describe('D3. physical bounds are clamped', () => {
  it('never shows a negative span for a non-negative quantity', () => {
    const keys = [
      'vibration_rms_mm_s',
      'amplitude_1x_mm_s',
      'amplitude_2x_mm_s',
      'high_frequency_energy',
      'flow_lpm',
      'pump_head_m',
      'rpm',
      'pump_efficiency',
      'health_index',
      'anomaly_score',
    ]
    for (const key of keys) {
      // Values hugging the bottom of the range: the case where centring the
      // span would have pushed the domain below zero.
      const [low] = trendDomain([0.02, 0.03], { key })
      expect(low).toBeGreaterThanOrEqual(0)
    }
  })

  it('caps a bounded quantity at its ceiling', () => {
    const [low, high] = trendDomain([0.97, 0.99], { key: 'pump_efficiency' })
    expect(high).toBeLessThanOrEqual(1)
    expect(low).toBeGreaterThanOrEqual(0)
    // The data itself must stay inside the axis even after the clamp.
    expect(low).toBeLessThanOrEqual(0.97)
  })

  it('keeps the health index inside 0..100', () => {
    const [, high] = trendDomain([98, 99], { key: 'health_index' })
    expect(high).toBeLessThanOrEqual(100)
  })
})

describe('D4. a clamped quantity still gets a usable span', () => {
  it('does not collapse the span against the floor', () => {
    // Regression: centring a 1.0 mm/s span on 0.25 mm/s and then clamping to 0
    // left a 0.55 mm/s axis, so the noise filled it again. The span must grow
    // upward from the floor instead.
    //
    // The curve consequently sits against the top of the axis -- the 10%
    // headroom applies to the data's own extent, and a span floored at zero has
    // nowhere below to go. That is the accepted trade: the alternative is a
    // negative velocity axis, which costs more.
    const [low, high] = trendDomain([0.2, 0.3], { key: 'vibration_rms_mm_s' })
    expect(low).toBe(0)
    expect(high).toBeGreaterThanOrEqual(TREND_MIN_SPAN.vibration_rms_mm_s.minSpan)
    expect(high).toBeGreaterThanOrEqual(0.3)
  })

  it('honours an explicit per-chart override over the table', () => {
    const quiet = [115.4, 115.6]
    const [lowOverride, highOverride] = trendDomain(quiet, { key: 'flow_lpm', minSpanOverride: 40 })
    const [lowDefault, highDefault] = trendDomain(quiet, { key: 'flow_lpm' })

    // The override widens the axis beyond both the table value and the data.
    expect(highOverride - lowOverride).toBeGreaterThanOrEqual(40)
    expect(highDefault - lowDefault).toBeLessThan(highOverride - lowOverride)
    // Widening must not move the data outside the axis.
    expect(lowOverride).toBeLessThanOrEqual(115.4)
    expect(highOverride).toBeGreaterThanOrEqual(115.6)
  })
})

describe('D5. the table itself', () => {
  it('declares a span and sane bounds for every trend signal', () => {
    for (const [key, bounds] of Object.entries(TREND_MIN_SPAN)) {
      expect(bounds.minSpan, `${key} needs a positive span`).toBeGreaterThan(0)
      if (bounds.floor !== undefined && bounds.ceiling !== undefined) {
        expect(bounds.ceiling, `${key} ceiling must exceed floor`).toBeGreaterThan(bounds.floor)
      }
    }
  })

  it('keeps health_index and anomaly_score at the same 1:10 proportion', () => {
    expect(TREND_MIN_SPAN.health_index.minSpan).toBe(10)
    expect(TREND_MIN_SPAN.anomaly_score.minSpan).toBe(0.1)
    expect(TREND_MIN_SPAN.health_index.ceiling).toBe(100)
    expect(TREND_MIN_SPAN.anomaly_score.ceiling).toBe(1)
  })
})
