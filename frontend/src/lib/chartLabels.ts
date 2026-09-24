/**
 * Top-of-plot label placement.
 *
 * The FFT panel marks four frequencies -- 1x, 2x mechanical, line frequency and
 * blade pass -- and on this machine two of them are 1.67 Hz apart on a 0-1000 Hz
 * axis. Two dashed verticals 0.17% of the axis apart are visually one line, so
 * four labels centred on their own markers necessarily print on top of each
 * other. The earlier attempt nudged one label down by a fixed 16 px, which only
 * worked at one shaft speed: 2x moves with rpm, the 50 Hz line does not.
 *
 * So placement is computed rather than tuned. Each label is measured, assigned
 * to the lowest row on which it does not touch a label already placed, and the
 * whole stack is shifted inward when a label would hang off the plot's left or
 * right edge. Row count drives the chart's top margin, so the axis grows to fit
 * the labels instead of the labels being squeezed to fit the axis.
 *
 * Nothing here touches the frequency values themselves. The markers stay where
 * the physics puts them; only the text moves.
 */

export interface LabelSlot {
  /** Label text, used only to estimate its width. */
  text: string
  /** Position along the axis, in axis units -- Hz for the spectrum. */
  value: number
}

export interface LabelPlacement {
  /** Horizontal centre of the text, in plot pixels. */
  x: number
  /** Row index, 0 being the row nearest the plot. */
  row: number
}

export interface LabelLayoutOptions {
  /** Width of the plot area in pixels. Recharts calls this margin-box width. */
  plotWidth: number
  /** Left margin before the plot area begins. */
  left: number
  /** Axis domain; both ends inclusive. */
  domain: [number, number]
  fontSize: number
  /** Minimum clear space between two labels sharing a row, in pixels. */
  gap: number
}

/**
 * Width of a label in pixels.
 *
 * Recharts cannot measure text before it is laid out, and a real measurement
 * needs a ResizeObserver pass on every frame. The character-count estimate is
 * used instead, and it errs high: `emPerChar` is the average advance width of
 * Inter at weight 600, and these labels are mostly digits and spaces, which are
 * narrower than the letters. Overestimating costs an extra row; underestimating
 * puts two labels on top of each other, which is the bug being fixed. When in
 * doubt this rounds up.
 */
export function estimateTextWidth(text: string, fontSize: number, emPerChar = 0.62): number {
  return Math.max(text.length, 1) * emPerChar * fontSize
}

/**
 * Place labels for markers on a linear axis.
 *
 * Slots must be sorted ascending by `value`. Greedy first-fit is sufficient and
 * is what shelf-packing wants here: labels arrive in x order, so packing left to
 * right yields the fewest rows for that order.
 *
 * The x positions are computed from the axis domain rather than spread evenly,
 * because frequency markers are not evenly spaced -- on this machine 1x, 2x and
 * the line frequency fall inside the first 7% of a 0-1000 Hz axis, and the blade
 * pass marker sits at 145 Hz.
 */
export function layoutLabels(
  slots: LabelSlot[],
  options: LabelLayoutOptions,
): LabelPlacement[] {
  const { plotWidth, left, domain, fontSize, gap } = options
  const [min, max] = domain

  if (plotWidth <= 0 || !(max > min)) return slots.map(() => ({ x: left, row: 0 }))

  // Clamp BEFORE assigning rows. A label centred on a marker hard against the
  // edge has to be shifted inward, and if that happens afterwards two labels can
  // be moved onto the same x and the row check never sees it.
  const positions = slots.map((slot) => {
    const fraction = (slot.value - min) / (max - min)
    const half = estimateTextWidth(slot.text, fontSize) / 2
    return {
      raw: left + fraction * plotWidth,
      half,
    }
  })

  const room = positions.reduce(
    (available, position) => Math.min(available, position.half),
    plotWidth / 2,
  )
  const lowEdge = left + room
  const highEdge = left + plotWidth - room

  const rowRightEdge: number[] = []

  return positions.map((position) => {
    const left3 = Math.min(Math.max(position.raw, lowEdge), Math.max(highEdge, lowEdge))

    let row = 0
    for (;;) {
      const right = rowRightEdge[row]
      if (right === undefined || left3 - position.half >= right + gap) break
      row += 1
    }
    rowRightEdge[row] = left3 + position.half

    return { x: left3, row }
  })
}

/** Number of rows a placement uses, i.e. the tallest stack plus one. */
export function labelRowCount(placements: LabelPlacement[]): number {
  return placements.reduce((count, placement) => Math.max(count, placement.row + 1), 0)
}

/** Vertical space to reserve above the plot area for `rows` stacked label rows. */
export function labelStackTopMargin(rows: number, lineHeight: number): number {
  return rows <= 0 ? 0 : rows * lineHeight
}
