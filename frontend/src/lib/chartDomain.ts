/**
 * Trend y-axis domains.
 *
 * Why this exists. A trend chart that auto-scales to the data extremes shows the
 * right answer to the wrong question. Steady-state flow on this rig sits inside
 * 115.44-115.60 L/min -- a 0.16 L/min band around a 115 L/min reading, or about
 * 0.14% -- and a y-axis fitted to those extremes renders that as a full-height
 * sawtooth. Nothing is wrong with the machine; the axis is amplifying sensor
 * noise into a story about instability. The same curve drawn against a span the
 * instrument could actually justify is a flat line, which is the truth.
 *
 * So each quantity declares a minimum span: the smallest change worth looking
 * at. Where the data moves more than that, the axis follows the data as it
 * always did. Where it moves less, the axis holds the minimum span and the
 * curve reads flat.
 *
 * The anchor for every number below is one of three things, in this order of
 * preference:
 *
 *   1. the alarm deadband, because a deadband is the project's own written
 *      statement of "this much change does not matter";
 *   2. the ISO 20816-1 Class I zone width, for the vibration quantities;
 *   3. a stated fraction of the full scale, for the dimensionless scores that
 *      have neither.
 *
 * It is deliberately NOT the instrument resolution. A deadband is engineering
 * margin against nuisance alarms; resolution is the smallest thing the hardware
 * can see. Setting a display span to the resolution would let noise fill the
 * plot again, which is the bug being fixed.
 */

/** Upper and lower bounds a quantity cannot physically cross. */
interface Bounds {
  floor?: number
  ceiling?: number
  /** Smallest span to hold open, in the quantity's own unit. */
  minSpan: number
  /**
   * True when the quantity cannot go below zero. Defaults to true, and that
   * default is deliberate: of the sixteen signals on the Trends page, only the
   * NPSH margin can legitimately read negative. Leaving this unset for a
   * temperature or a flow is not a licence to draw a negative axis -- it is the
   * same statement as an explicit `floor: 0`, written once. Temperature is the
   * one case where it is a choice rather than a law: 0 degC is not a physical
   * limit, but a trend axis in negative degrees would be, so the floor applies.
   */
  nonNegative?: boolean
}

/**
 * Keyed by the telemetry field name, so the same quantity gets the same axis on
 * every page. TrendChart looks its data key up here; a caller can still override
 * with an explicit `minSpan` prop for one-off charts.
 */
export const TREND_MIN_SPAN: Record<string, Bounds> = {
  // 8 L/min: the flow_low deadband is 5.5 L/min. Against a 110 L/min duty point
  // this is a 7% band, which still shows a real flow excursion.
  flow_lpm: { floor: 0, minSpan: 8 },

  // 1.0 mm/s: ISO 20816-1 Class I rigid-support zones are 0.71 / 1.8 / 4.5 mm/s,
  // so the A/B band alone is about 1.1 mm/s wide. A span narrower than one zone
  // cannot show which zone the machine is in.
  vibration_rms_mm_s: { floor: 0, minSpan: 1.0 },
  amplitude_1x_mm_s: { floor: 0, minSpan: 0.5 },
  amplitude_2x_mm_s: { floor: 0, minSpan: 0.5 },
  high_frequency_energy: { floor: 0, minSpan: 0.5 },

  // 0.5 m against an 8 m duty head, about 6%.
  pump_head_m: { floor: 0, minSpan: 0.5 },

  // 5 kPa: deadbands are 4.0 kPa (discharge high) and 3.0 kPa (suction low).
  differential_pressure_kpa: { floor: 0, minSpan: 5 },
  suction_pressure_kpa: { floor: 0, minSpan: 5 },

  // 0.1 A against a 2.72 A rated current; deadband is 0.08 A.
  motor_current_a: { floor: 0, minSpan: 0.1 },

  // 2 K on both windings; the deadbands are 2.0 K. The span is set equal to the
  // deadband here rather than above it, because a temperature in K is not
  // comparable to the fractions used elsewhere and 2 K is roughly the smallest
  // sustained rise that indicates a developing fault.
  motor_temperature_c: { minSpan: 2 },
  bearing_temperature_c: { minSpan: 2 },

  // 10 rpm on a 1450 rpm machine, about 0.7%. The speed readout is what changes
  // first when a VSD moves or a belt slips.
  rpm: { floor: 0, minSpan: 10 },

  // 0.02 on a dimensionless efficiency near 0.49, about 4% relative.
  pump_efficiency: { floor: 0, ceiling: 1, minSpan: 0.02 },

  // 0.5 m: the npsh_margin_low deadband is 0.3 m. Margin is the distance to the
  // cavitation boundary, so it is the one quantity where a small move matters.
  // The only signal on the page that may legitimately read negative -- the
  // margin is negative once the pump is cavitating -- so it is the only entry
  // that opts out of the default non-negative floor.
  npsh_margin_m: { nonNegative: false, minSpan: 0.5 },

  // 10 points. This is not derived from a deadband; it is a judgement that one
  // point on a 0-100 headline number is not actionable, and that a span of 2
  // (the first proposal) would let steady-running noise fill the plot -- which
  // is precisely the effect this module exists to remove.
  health_index: { floor: 0, ceiling: 100, minSpan: 10 },

  // 0.1. The model card carries no operating threshold for the anomaly score, so
  // there is no documented deadband to anchor to. The value is taken as 10% of
  // the 0-1 range, matching health_index's 10/100. ASSUMPTION, not a documented
  // threshold -- if the anomaly detector's operating point is ever written down,
  // replace this with a span derived from it.
  anomaly_score: { floor: 0, ceiling: 1, minSpan: 0.1 },
}

/** A y-axis domain. Tick positions are multiples of `step` from `low` to `high`. */
export interface YAxis {
  low: number
  high: number
  step: number
  /** Decimal places implied by `step`, and the only precision ticks may print. */
  digits: number
}

/**
 * Nice step: the 1/2/5 x 10^n ladder.
 *
 * Ticks at arbitrary float positions are unreadable -- a bearing temperature
 * axis that reads 22.495 / 37.495 / 52.495 is the symptom. Snapping the span to
 * this ladder means every tick lands on a number a person would have chosen.
 */
export function niceStep(range: number, targetTicks = 5): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1
  const rough = range / Math.max(targetTicks, 1)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalised = rough / magnitude
  const ladder = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10
  return ladder * magnitude
}

/**
 * Decimal places a step needs, so labels print no more precision than the step
 * carries. A step of 0.5 needs one place; a step of 2 needs none. Computed by
 * string inspection rather than by log10, because log10(0.001) is not exactly
 * -3 in binary floating point and the error shows up in the label.
 */
export function stepDigits(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  let text = step.toFixed(10)
  if (text.includes('e') || text.includes('E')) text = step.toPrecision(12)
  text = text.replace(/0+$/, '')
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/** Format a tick at the precision its own step implies. */
export function formatTick(value: number, digits: number): string {
  // toFixed, not toPrecision: toPrecision switches to exponential notation for
  // small magnitudes, and "1.2e-7" is not a tick label anyone wants.
  return value.toFixed(Math.min(Math.max(digits, 0), 20))
}

/**
 * Round a domain outward onto the step ladder.
 *
 * Rounding outward rather than inward matters: an inward round can push a data
 * point off the plot, and a trend chart that hides its own readings is worse
 * than one with a slightly loose axis.
 */
function alignToStep(low: number, high: number, step: number): { low: number; high: number } {
  const lowAligned = Math.floor(low / step) * step
  const highAligned = Math.ceil(high / step) * step
  return { low: lowAligned, high: highAligned }
}

/**
 * Compute a y-axis for a trend.
 *
 * The span is decided by the data and the declared minimum, and by nothing else.
 * A limit line does not widen it: a vibration trend whose data sits at 0.5-1.8
 * mm/s, stretched to reach a 4.5 mm/s trip line, draws the machine as a flat
 * line pinned to the floor -- which is the same defect as the noise-filled axis
 * this module was written to remove, with the sign flipped. Distance-to-alarm is
 * carried by a marker above the plot instead; see `limitPlacement`.
 */
export function trendYAxis(
  values: number[],
  options: { key: string; minSpanOverride?: number },
): YAxis {
  const bounds = TREND_MIN_SPAN[options.key] ?? { minSpan: 0 }
  const minSpan = Math.max(options.minSpanOverride ?? 0, bounds.minSpan)

  const clampLow = bounds.floor ?? (bounds.nonNegative === false ? Number.NEGATIVE_INFINITY : 0)
  const clampHigh = bounds.ceiling ?? Number.POSITIVE_INFINITY

  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) {
    const low = Number.isFinite(clampLow) ? clampLow : 0
    const step = niceStep(Math.max(minSpan, 1))
    return { low, high: low + step * 5, step, digits: stepDigits(step) }
  }

  const dataLow = Math.min(...finite)
  const dataHigh = Math.max(...finite)
  const dataSpan = dataHigh - dataLow

  // Two reasons for an axis wider than the data. The span is always about the
  // data: the declared minimum, or the data's own extent plus 20% of margin for
  // it to move in. It is then centred, because a flow holding 115.5 L/min on a
  // 0-8 L/min axis is a line pinned to the top edge -- as unreadable as one
  // pinned to the bottom.
  const span = dataSpan >= minSpan ? dataSpan * 1.2 : minSpan * 1.2
  const centre = (dataLow + dataHigh) / 2
  let low = centre - span / 2
  let high = centre + span / 2

  // Against a floor, slide the window up rather than truncating it. The span is
  // what keeps noise from filling the plot, so it is worth preserving.
  if (Number.isFinite(clampLow) && low < clampLow) {
    high += clampLow - low
    low = clampLow
  }
  if (Number.isFinite(clampHigh) && high > clampHigh) {
    low -= high - clampHigh
    high = clampHigh
  }

  // Snap outward onto the step ladder, then re-apply the bounds. Order matters:
  // the snap is what removes the float residue (115.50000000000001 becomes 115.5
  // on a 0.5 step), but it can also push an endpoint past a floor or a ceiling,
  // so the clamp has to come after it rather than before.
  const step = niceStep(high - low)
  const aligned = alignToStep(low, high, step)

  let finalLow = aligned.low
  let finalHigh = aligned.high

  if (Number.isFinite(clampLow) && finalLow < clampLow) finalLow = clampLow
  if (Number.isFinite(clampHigh) && finalHigh > clampHigh) finalHigh = clampHigh

  // Last: whatever the snap or the clamp did, the readings stay in frame. The
  // snap can round the axis inward past a data point, and a trend chart that
  // hides its own readings is worse than one with a loose axis.
  if (finalLow > dataLow) finalLow = Math.max(dataLow, clampLow)
  if (finalHigh < dataHigh) finalHigh = Math.min(dataHigh, clampHigh)

  return { low: finalLow, high: finalHigh, step, digits: stepDigits(step) }
}

/**
 * Where a limit line sits relative to the axis.
 *
 * Outside the domain the line is not drawn and the axis is not widened; the
 * caller places a marker on the plot edge instead, so the reader learns both
 * that the limit is off-screen and which way.
 *
 * The marker answers three questions and no others: is the limit off-screen,
 * in which direction, and what is its value. It deliberately does not report
 * the distance to the limit. A reader who wants that subtraction has both
 * numbers on the chart -- the axis endpoint on one side, the limit in the
 * marker -- and can do it themselves. Expressing it in the marker would mean
 * compressing the axis or introducing a scale break, which shrinks the curve
 * again: the exact defect these rounds have been removing.
 *
 * The underlying trade, stated once: a trend chart's job is to show how the
 * data itself is moving, not how far it is from its limit. Distance-to-limit
 * belongs to the status tiles and the health index, which already carry it. And
 * a limit sitting well off the axis is itself information -- it says the
 * machine is running comfortably, which is a thing the reader is entitled to
 * see without a number attached to it.
 *
 * No consumer reaches the 'below' branch today: Trends.tsx configures no limit
 * for the one signal that can produce it. It is implemented rather than left
 * out because the failure would be silent -- line not drawn, marker not drawn,
 * nothing said -- and because a low-side limit goes below the axis far more
 * often than a high-side one goes above it. Any signal running well above its
 * alarm shows 'below', not 'inside'.
 */
export function limitPlacement(limit: number, axis: YAxis): 'inside' | 'above' | 'below' {
  if (limit > axis.high) return 'above'
  if (limit < axis.low) return 'below'
  return 'inside'
}
