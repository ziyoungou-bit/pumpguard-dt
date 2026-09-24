/**
 * E1. Axis endpoints and ticks are exactly the numbers they are meant to be.
 *
 * The first version of this computed a span as `centre +/- span/2` scaled by
 * 1.1, so the endpoints carried binary float residue and the labels printed
 * 115.50000000000001 and 1.2000000000000002. Alignment onto a 1/2/5 x 10^n step
 * ladder is what removes it, and the assertions below compare strings, because
 * toBe() on 115.5 would pass even when the axis holds 115.50000000000001.
 *
 * E2. Ticks print no more precision than their own step carries.
 *
 * A bearing temperature axis reading 22.495 / 37.495 / 52.495 is the symptom of
 * deriving decimals from the raw float instead of from the step.
 *
 * E3. A limit line off the axis does not widen the axis.
 *
 * Stretching a 0.5-1.8 mm/s vibration trend to reach a 4.5 mm/s trip line drew
 * the machine as a flat line on the floor -- the same defect as the
 * noise-filled axis this module exists to remove, with the sign flipped.
 */

import { describe, expect, it } from 'vitest'
import {
  TREND_MIN_SPAN,
  formatTick,
  limitPlacement,
  niceStep,
  stepDigits,
  trendYAxis,
} from './chartDomain'

describe('E1. endpoints sit exactly on the step ladder', () => {
  it('produces no float residue on a flow trend in the hundreds', () => {
    const quiet = Array.from({ length: 60 }, (_, i) => 115.44 + (i % 5) * 0.04)
    const axis = trendYAxis(quiet, { key: 'flow_lpm' })
    expect(String(axis.low)).toBe(formatTick(axis.low, axis.digits))
    expect(String(axis.high)).toBe(formatTick(axis.high, axis.digits))
    expect(formatTick(axis.low, axis.digits)).not.toContain('0000000')
    expect(formatTick(axis.high, axis.digits)).not.toContain('0000000')
  })

  it('produces no float residue on a sub-unit vibration trend', () => {
    const axis = trendYAxis([0.2, 0.3], { key: 'vibration_rms_mm_s' })
    expect(formatTick(axis.low, axis.digits)).not.toContain('0000000')
    expect(formatTick(axis.high, axis.digits)).not.toContain('0000000')
    // 1.2000000000000002 was the value that exposed this.
    expect(formatTick(axis.high, axis.digits)).toBe(String(axis.high))
  })

  it('places every step multiple on the ladder', () => {
    for (const key of Object.keys(TREND_MIN_SPAN)) {
      const axis = trendYAxis([1, 2, 3], { key })
      const lowestMultiple = Math.round(axis.low / axis.step) * axis.step
      const highestMultiple = Math.round(axis.high / axis.step) * axis.step
      expect(formatTick(lowestMultiple, axis.digits)).toBe(formatTick(axis.low, axis.digits))
      expect(formatTick(highestMultiple, axis.digits)).toBe(formatTick(axis.high, axis.digits))
    }
  })

  it('uses a 1/2/5 x 10^n step', () => {
    for (const range of [0.016, 0.16, 1.6, 16, 160, 1600, 0.00016]) {
      const step = niceStep(range)
      const mantissa = step / 10 ** Math.floor(Math.log10(step))
      expect([1, 2, 5, 10]).toContain(Number(mantissa.toFixed(6)))
    }
  })
})

describe('E2. tick precision follows the step', () => {
  it('prints a 0.5 step to one decimal', () => {
    expect(stepDigits(0.5)).toBe(1)
    expect(formatTick(115.5, 1)).toBe('115.5')
  })

  it('prints a 2 step with no decimals', () => {
    expect(stepDigits(2)).toBe(0)
    expect(formatTick(26, 0)).toBe('26')
  })

  it('prints a 0.001 step to three decimals', () => {
    expect(stepDigits(0.001)).toBe(3)
    expect(formatTick(0.123, 3)).toBe('0.123')
  })

  it('never prints more decimals than the step needs, on any signal', () => {
    for (const key of Object.keys(TREND_MIN_SPAN)) {
      const axis = trendYAxis([1.234567, 2.345678], { key })
      const allowed = stepDigits(axis.step)
      for (let value = axis.low; value <= axis.high + axis.step / 2; value += axis.step) {
        const text = formatTick(value, axis.digits)
        const decimals = text.includes('.') ? text.split('.')[1].length : 0
        expect(decimals, `${key} tick ${text}`).toBeLessThanOrEqual(allowed)
        // And the printed label must read back as the number it names, so the
        // reader is not shown one value where the axis holds another.
        expect(Number(text), `${key} tick ${text}`).toBeCloseTo(value, allowed)
      }
    }
  })

  it('keeps the bearing temperature axis on round numbers', () => {
    // The reported symptom: 22.495 / 37.495 / 52.495.
    const axis = trendYAxis([22.1, 27.4], { key: 'bearing_temperature_c' })
    const ticks: string[] = []
    for (let value = axis.low; value <= axis.high + axis.step / 2; value += axis.step) {
      ticks.push(formatTick(value, axis.digits))
    }
    for (const tick of ticks) {
      expect(tick).not.toContain('495')
      expect(Number(tick) % axis.step).toBeCloseTo(0, 6)
    }
  })
})

describe('E3. an off-axis limit does not widen the axis', () => {
  it('leaves the vibration axis near the data, not near the 4.5 mm/s trip', () => {
    const axis = trendYAxis([0.5, 1.8], { key: 'vibration_rms_mm_s' })
    expect(axis.high).toBeLessThan(4.5)
    expect(limitPlacement(4.5, axis)).toBe('above')
  })

  it('leaves the bearing temperature axis near the data, not near the 80 degC alarm', () => {
    const axis = trendYAxis([22.1, 27.4], { key: 'bearing_temperature_c' })
    expect(axis.high).toBeLessThan(80)
    expect(limitPlacement(80, axis)).toBe('above')
  })

  it('reports a limit inside the axis as inside', () => {
    const axis = trendYAxis([4.0, 5.2], { key: 'vibration_rms_mm_s' })
    expect(limitPlacement(4.5, axis)).toBe('inside')
  })

  it('reports a low-side limit below the axis', () => {
    const axis = trendYAxis([1.8, 1.9], { key: 'npsh_margin_m' })
    expect(limitPlacement(-0.5, axis)).toBe('below')
  })

  it('gives a wide excursion an axis that follows it', () => {
    const axis = trendYAxis([110, 122], { key: 'flow_lpm' })
    expect(axis.low).toBeLessThan(110)
    expect(axis.high).toBeGreaterThan(122)
  })
})

describe('E4. physical bounds still hold', () => {
  it('never shows a negative axis for a non-negative quantity', () => {
    for (const key of [
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
    ]) {
      const axis = trendYAxis([0.02, 0.03], { key })
      expect(axis.low, key).toBeGreaterThanOrEqual(0)
    }
  })

  it('caps a bounded quantity at its ceiling', () => {
    const axis = trendYAxis([0.97, 0.99], { key: 'pump_efficiency' })
    expect(axis.high).toBeLessThanOrEqual(1)
    expect(axis.low).toBeLessThanOrEqual(0.97)
  })

  it('allows a negative axis for the NPSH margin, and only there', () => {
    // Margin goes negative when the pump cavitates; that is the whole point of
    // the signal. Data has to approach zero for the axis to reach below it --
    // `nonNegative: false` permits a negative axis, it does not require one.
    const axis = trendYAxis([0.05, 0.2], { key: 'npsh_margin_m' })
    expect(axis.low).toBeLessThan(0)
    // And the same data on a quantity that cannot go negative stays non-negative.
    const positive = trendYAxis([0.05, 0.2], { key: 'pump_head_m' })
    expect(positive.low).toBeGreaterThanOrEqual(0)
  })

  it('keeps the readings inside the axis on every signal', () => {
    // Each signal is exercised with data inside its own physical bounds, since
    // an out-of-bounds reading is a contract violation rather than an axis bug.
    for (const key of Object.keys(TREND_MIN_SPAN)) {
      const bounds = TREND_MIN_SPAN[key]
      const low = bounds.floor ?? 0.2
      const high = bounds.ceiling === undefined ? low + 1.4 : Math.min(bounds.ceiling, low + 1.4)
      const axis = trendYAxis([low, high], { key })
      expect(axis.low, key).toBeLessThanOrEqual(low)
      expect(axis.high, key).toBeGreaterThanOrEqual(high)
      expect(axis.high, key).toBeGreaterThan(axis.low)
      expect(axis.step, key).toBeGreaterThan(0)
    }
  })

  it('gives up the physical ceiling before it gives up the axis', () => {
    // An out-of-bounds reading is a contract violation, not an axis case. The
    // ceiling wins: an efficiency axis labelled 4.7 would present broken data as
    // legitimate. The reading goes off the top of the plot, which is the visible
    // failure the reader should see.
    const axis = trendYAxis([1.3, 4.7], { key: 'pump_efficiency' })
    expect(axis.high).toBeLessThanOrEqual(1)
    expect(axis.low).toBeLessThanOrEqual(1.3)
    expect(axis.high).toBeGreaterThan(axis.low)
  })
})

describe('E5. the minimum span is what keeps a quiet signal flat', () => {
  it('gives the measured flow band a span near 8 L/min, not 0.16', () => {
    const quiet = Array.from({ length: 60 }, (_, i) => 115.44 + (i % 5) * 0.04)
    const axis = trendYAxis(quiet, { key: 'flow_lpm' })
    expect(axis.high - axis.low).toBeGreaterThanOrEqual(TREND_MIN_SPAN.flow_lpm.minSpan)
    expect((Math.max(...quiet) - Math.min(...quiet)) / (axis.high - axis.low)).toBeLessThan(0.2)
  })

  it('holds a span against the floor instead of collapsing onto it', () => {
    const axis = trendYAxis([0.2, 0.3], { key: 'vibration_rms_mm_s' })
    expect(axis.low).toBe(0)
    expect(axis.high).toBeGreaterThanOrEqual(TREND_MIN_SPAN.vibration_rms_mm_s.minSpan)
    expect(axis.high).toBeGreaterThanOrEqual(0.3)
  })

  it('honours an explicit per-chart override over the table', () => {
    const quiet = [115.4, 115.6]
    const wide = trendYAxis(quiet, { key: 'flow_lpm', minSpanOverride: 40 })
    const normal = trendYAxis(quiet, { key: 'flow_lpm' })
    expect(wide.high - wide.low).toBeGreaterThanOrEqual(40)
    expect(normal.high - normal.low).toBeLessThan(wide.high - wide.low)
    expect(wide.low).toBeLessThanOrEqual(115.4)
    expect(wide.high).toBeGreaterThanOrEqual(115.6)
  })

  it('falls back to a usable axis for an empty series', () => {
    for (const key of Object.keys(TREND_MIN_SPAN)) {
      const axis = trendYAxis([], { key })
      expect(axis.high, key).toBeGreaterThan(axis.low)
      expect(axis.step, key).toBeGreaterThan(0)
    }
  })
})

describe('E6. the table itself', () => {
  it('declares a positive span for every signal', () => {
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
