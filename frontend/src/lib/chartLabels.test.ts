/**
 * C1. No two labels on a shared row may overlap.
 *
 * The failure this guards is the one on the FFT panel: 2x mechanical (48.33 Hz)
 * and line frequency (50.00 Hz) are 1.67 Hz apart on a 0-1000 Hz axis, so their
 * markers are about 0.17% of the plot apart and their labels collide by
 * construction. The old code nudged one of them down a fixed 16 px, which was
 * correct at one shaft speed and wrong at every other.
 */

import { describe, expect, it } from 'vitest'
import {
  estimateTextWidth,
  labelRowCount,
  labelStackTopMargin,
  layoutLabels,
  type LabelSlot,
} from './chartLabels'

const OPTIONS = { plotWidth: 800, left: 56, domain: [0, 1000] as [number, number], fontSize: 11, gap: 6 }

function overlaps(a: LabelSlot, b: LabelSlot, placements: ReturnType<typeof layoutLabels>) {
  const [ca, cb] = placements
  if (ca.row !== cb.row) return false
  const halfA = estimateTextWidth(a.text, OPTIONS.fontSize) / 2
  const halfB = estimateTextWidth(b.text, OPTIONS.fontSize) / 2
  return ca.x + halfA > cb.x - halfB && cb.x + halfB > ca.x - halfA
}

describe('C1. crowded frequency markers get separate rows', () => {
  it('separates 2x mechanical from line frequency on a 0-1000 Hz axis', () => {
    const slots: LabelSlot[] = [
      { text: '1x  24.17 Hz', value: 24.17 },
      { text: '2x mech  48.33 Hz', value: 48.33 },
      { text: 'line  50.00 Hz', value: 50.0 },
      { text: 'BPF  145 Hz', value: 145 },
    ]
    const placements = layoutLabels(slots, OPTIONS)

    expect(placements[1].row).not.toBe(placements[2].row)
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        expect(overlaps(slots[i], slots[j], [placements[i], placements[j]])).toBe(false)
      }
    }
  })

  it('holds the separation at every shaft speed, including a coincident pair', () => {
    // 2x sweeps across the fixed 50 Hz line as speed changes; at about 1500 rpm
    // the two markers land on top of each other exactly.
    for (const rpm of [1450, 1470, 1490, 1500, 1510, 1530]) {
      const oneX = rpm / 60
      const slots: LabelSlot[] = [
        { text: `1x  ${oneX.toFixed(2)} Hz`, value: oneX },
        { text: `2x mech  ${(2 * oneX).toFixed(2)} Hz`, value: 2 * oneX },
        { text: 'line  50.00 Hz', value: 50 },
        { text: 'BPF  145 Hz', value: 6 * oneX },
      ]
      const placements = layoutLabels(slots, OPTIONS)
      for (let i = 0; i < slots.length; i += 1) {
        for (let j = i + 1; j < slots.length; j += 1) {
          expect(overlaps(slots[i], slots[j], [placements[i], placements[j]])).toBe(false)
        }
      }
    }
  })

  it('leaves labels in clear air on one row', () => {
    const slots: LabelSlot[] = [
      { text: '1x  24.17 Hz', value: 100 },
      { text: 'BPF  145 Hz', value: 800 },
    ]
    expect(labelRowCount(layoutLabels(slots, OPTIONS))).toBe(1)
  })
})

describe('C2. labels stay inside the plot', () => {
  it('shifts a label off the left edge inward', () => {
    const slots: LabelSlot[] = [{ text: '1x  0.00 Hz', value: 0 }]
    const [placement] = layoutLabels(slots, OPTIONS)
    const half = estimateTextWidth(slots[0].text, OPTIONS.fontSize) / 2
    expect(placement.x - half).toBeGreaterThanOrEqual(OPTIONS.left)
  })

  it('shifts a label off the right edge inward', () => {
    const slots: LabelSlot[] = [{ text: 'BPF  1000 Hz', value: 1000 }]
    const [placement] = layoutLabels(slots, OPTIONS)
    const half = estimateTextWidth(slots[0].text, OPTIONS.fontSize) / 2
    expect(placement.x + half).toBeLessThanOrEqual(OPTIONS.left + OPTIONS.plotWidth)
  })
})

describe('C3. text width errs high', () => {
  it('scales with length and font size', () => {
    expect(estimateTextWidth('abcd', 10)).toBeGreaterThan(estimateTextWidth('abc', 10))
    expect(estimateTextWidth('abcd', 20)).toBeCloseTo(estimateTextWidth('abcd', 10) * 2)
  })

  it('never returns zero for an empty string', () => {
    expect(estimateTextWidth('', 11)).toBeGreaterThan(0)
  })
})

describe('C4. the top margin is derived from the row count', () => {
  it('reserves one row per stack level', () => {
    expect(labelStackTopMargin(0, 15)).toBe(0)
    expect(labelStackTopMargin(2, 15)).toBe(30)
  })
})
