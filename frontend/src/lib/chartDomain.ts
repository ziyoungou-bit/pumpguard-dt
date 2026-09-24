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

/**
 * Compute a y-axis domain for a trend.
 *
 * `values` are the plotted series; `referenceLevels` are the horizontal limit
 * lines. A limit line widens the domain, because a chart whose job is to show
 * distance-to-alarm must keep the alarm on screen -- a span that quietly crops
 * the 4.5 mm/s trip line out of a vibration trend is worse than a noisy plot.
 * The line adds a margin rather than stretching the axis to a multiple of
 * itself, so a limit far from the data does not rescale everything under it.
 */
export function trendDomain(
  values: number[],
  options: {
    key: string
    referenceLevels?: number[]
    minSpanOverride?: number
  },
): [number, number] {
  const bounds = TREND_MIN_SPAN[options.key] ?? { minSpan: 0 }
  const minSpan = Math.max(options.minSpanOverride ?? 0, bounds.minSpan)

  const finite = values.filter((value) => Number.isFinite(value))
  const levels = (options.referenceLevels ?? []).filter((value) => Number.isFinite(value))

  if (finite.length === 0 && levels.length === 0) {
    const low = bounds.floor ?? 0
    return [low, low + Math.max(minSpan, 1)]
  }

  // Where the axis may not go. A quantity is non-negative unless it says
  // otherwise, so the absence of a declared floor is not permission to draw a
  // negative axis: flow, speed and the vibration amplitudes all default to a
  // floor of zero here rather than relying on the clamp to catch a span that
  // wandered below it. Only a quantity that can genuinely read negative sets
  // `floor` itself -- the NPSH margin is the only one on this page.
  const clampLow =
    bounds.floor ?? (bounds.nonNegative === false ? Number.NEGATIVE_INFINITY : 0)
  const clampHigh = bounds.ceiling ?? Number.POSITIVE_INFINITY
  const dataLow = finite.length > 0 ? Math.min(...finite) : clampLow
  const dataHigh = finite.length > 0 ? Math.max(...finite) : clampHigh
  const dataSpan = Math.max(dataHigh - dataLow, 0)

  // Two different reasons for an axis to be wider than the data.
  //
  // The span itself is always about the data: the declared minimum, or the
  // data's own extent plus 20% of margin for it to move in. It is then centred
  // on the data. Centring is not decoration -- a flow holding 115.5 L/min drawn
  // on a 0-8 L/min axis is a line pinned to the top edge, which reads as a
  // worse fault than the one this module exists to remove.
  //
  // The declared floor is a clamp on the result, not the place the span starts.
  // Anchoring at the floor is only correct for a quantity that actually
  // operates near it, and this rig does not: its flow is 115, its temperatures
  // are 40, and its speed is 1450.
  const target = dataSpan >= minSpan ? dataSpan * 1.2 : minSpan * 1.2
  const centre = (dataLow + dataHigh) / 2
  let low = centre - target / 2
  let high = centre + target / 2

  // Against a floor, slide the window up rather than truncating it: the span is
  // what keeps noise from filling the plot, so it is worth preserving.
  if (low < clampLow) {
    high += clampLow - low
    low = clampLow
  }
  if (clampHigh !== Number.POSITIVE_INFINITY && high > clampHigh) {
    low -= high - clampHigh
    high = clampHigh
  }

  // Limit lines are pulled inside the domain, with an additive margin: a
  // multiplicative one shrinks a negative bound toward zero, which puts a
  // low-side limit like the -0.5 m NPSH trip line outside the axis.
  if (levels.length > 0) {
    const margin = Math.max((high - low) * 0.1, Number.EPSILON)
    const limitTop = Math.max(...levels)
    const limitBottom = Math.min(...levels)
    if (limitBottom < low) low = limitBottom - margin
    if (limitTop > high) high = limitTop + margin
  }

  // Final clamp, then make sure the data itself is still in frame. An axis that
  // respects the physical floor must not end up above its own readings.
  low = Math.max(low, clampLow)
  high = Math.min(high, clampHigh)
  if (finite.length > 0) {
    if (low > dataLow) low = Math.max(dataLow, clampLow)
    if (high < dataHigh) high = Math.min(dataHigh, clampHigh)
  }

  return [low, high]
}
