/**
 * Every chart in the application.
 *
 * Colour rules followed here:
 *   - Categorical hues are assigned in a fixed order and never cycled. Only the
 *     first three slots are used, which is the set that validates on all pairs
 *     for normal vision and for deuteranopia/tritanopia against a white surface.
 *   - There is no dual-axis chart anywhere. Where two quantities have different
 *     units (head vs efficiency, or several trend signals) they are drawn as
 *     separate charts or small multiples rather than sharing a plot with two
 *     y-scales.
 *   - Every series is identified by a legend or a direct label, so identity is
 *     never carried by colour alone.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { formatTick, limitPlacement, trendYAxis } from '../lib/chartDomain'
import { labelRowCount, labelStackTopMargin, layoutLabels, type LabelSlot } from '../lib/chartLabels'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// --------------------------------------------------------------------------
// Theme
// --------------------------------------------------------------------------

export const SERIES = {
  /** slot 1 -- blue */
  primary: '#2a78d6',
  /** slot 2 -- orange */
  secondary: '#eb6834',
  /** slot 3 -- aqua */
  tertiary: '#1baf7a',
} as const

const GRID = '#e1e0d9'
const AXIS = '#898781'
const INK = '#52514e'

/** Matches the YAxis width below, and the space the axis label needs. */
const Y_AXIS_WIDTH = 56

/**
 * Width for a y-axis, from the widest tick it will actually print.
 *
 * A fixed 56px was clipping the leading digits off labels like "115.5" on the
 * flow trend -- the axis had been sized for the two-digit spans of the pump
 * curves. The width is derived from the formatted text instead, so a trend in
 * the hundreds gets the room and a trend in single digits does not pay for it.
 *
 * 7px per character is the advance width of Inter's tabular digits at 11px,
 * rounded up; `numeric` figures are fixed-width, so the estimate is exact for
 * digit strings and generous for anything with a minus sign.
 */
function yAxisWidth(widestTick: string): number {
  return Math.max(28, Math.ceil(widestTick.length * 7 + 12))
}

/**
 * Marker colours for the spectrum panel. The line frequency is deliberately
 * outside the categorical series palette: it is an electrical supply frequency,
 * not a shaft order, and giving it the third series slot would imply it belongs
 * to the same family as 1x and 2x.
 */
const SHELF_2X_COLOUR = '#4a3aa7'
const LINE_FREQUENCY_COLOUR = '#b4501f'

const axisProps = {
  stroke: AXIS,
  tick: { fill: INK, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: '#c3c2b7' },
} as const

interface TooltipRow {
  name?: string | number
  value?: number | string
  color?: string
  unit?: string
}

function ChartTooltip({
  active,
  payload,
  label,
  labelUnit,
  valueUnit,
  digits = 2,
}: {
  active?: boolean
  payload?: TooltipRow[]
  label?: string | number
  labelUnit: string
  valueUnit: string
  digits?: number
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-md">
      <p className="numeric text-xs text-slate-500">
        {typeof label === 'number' ? label.toFixed(2) : label} {labelUnit}
      </p>
      {payload.map((row, index) => (
        <p key={index} className="mt-0.5 flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: row.color }}
            aria-hidden
          />
          <span className="text-slate-600">{row.name}</span>
          <span className="numeric font-semibold text-slate-900">
            {typeof row.value === 'number' ? row.value.toFixed(digits) : row.value} {valueUnit}
          </span>
        </p>
      ))}
    </div>
  )
}

/**
 * Chart container. Reports its own width upward because one chart -- the FFT
 * spectrum -- has to place reference-line labels in pixel space, and Recharts
 * exposes plot width only inside its own render tree. Widening the observer
 * rather than measuring per chart keeps the other charts free of it.
 */
function ChartFrame({
  height,
  children,
  onWidth,
}: {
  height: number
  children: ReactNode
  onWidth?: (width: number) => void
}) {
  const measure = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !onWidth) return
      const report = () => onWidth(node.clientWidth)
      report()
      if (typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(report)
      observer.observe(node)
      return () => observer.disconnect()
    },
    [onWidth],
  )

  return (
    <div ref={measure} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  )
}

const legendStyle = { fontSize: 12, color: INK } as const

/**
 * Bottom band shared by the four stacked panels on the Pump Performance page.
 *
 * Recharts draws an `insideBottom` x-axis label and a bottom `Legend` into the
 * same strip below the plot area, so the two overlap and the axis title lands
 * on top of the legend text ("Pump effi~Flow (L/min)~ciency"). The fix is to
 * reserve enough bottom margin for the axis title and then push the legend
 * below it with padding, so each owns its own row.
 */
const STACKED_MARGIN = { top: 16, right: 28, bottom: 44, left: 8 } as const
const STACKED_LEGEND_STYLE = { ...legendStyle, paddingTop: 26 } as const

/** X-axis title placed in its own row, clear of the legend below it. */
const xAxisLabel = (value: string) => ({
  value,
  position: 'insideBottom' as const,
  offset: -16,
  fill: INK,
  fontSize: 11,
})

const X_AXIS_LABEL = xAxisLabel('Flow (L/min)')

/**
 * Vertical drop line at the operating flow. It does two jobs: it ties the point
 * back to the flow axis without a label sitting on the curve, and because every
 * stacked panel draws it at the same x it visually locks the four panels
 * together as one reading of one machine state.
 */
function OperatingFlowLine({ flowLpm }: { flowLpm: number }) {
  return (
    <ReferenceLine
      x={Number(flowLpm.toFixed(2))}
      stroke="#0b0b0b"
      strokeDasharray="2 3"
      strokeWidth={1}
    />
  )
}

// --------------------------------------------------------------------------
// Vibration time waveform
// --------------------------------------------------------------------------

export function TimeWaveformChart({
  data,
  height = 240,
}: {
  data: { t_s: number; amplitude_mm_s: number }[]
  height?: number
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={STACKED_MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="t_s"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(2)}
          label={xAxisLabel('Time (s)')}
        />
        <YAxis
          {...axisProps}
          width={56}
          label={{
            value: 'Velocity (mm/s)',
            angle: -90,
            position: 'insideLeft',
            fill: INK,
            fontSize: 11,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip content={<ChartTooltip labelUnit="s" valueUnit="mm/s" digits={3} />} />
        <ReferenceLine y={0} stroke="#c3c2b7" />
        <Line
          type="monotone"
          dataKey="amplitude_mm_s"
          name="Vibration velocity"
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
      </LineChart>
    </ChartFrame>
  )
}

// --------------------------------------------------------------------------
// FFT spectrum with 1x / 2x reference lines
// --------------------------------------------------------------------------

export function SpectrumChart({
  data,
  rotationalFrequencyHz,
  bladePassHz,
  lineFrequencyHz,
  height = 280,
}: {
  data: { frequency_hz: number; amplitude_mm_s: number }[]
  rotationalFrequencyHz: number
  bladePassHz?: number
  /** Motor supply frequency. Drawn in its own colour: it is not a shaft order. */
  lineFrequencyHz?: number
  height?: number
}) {
  const [frameWidth, setFrameWidth] = useState(0)

  // Markers get a row each when they would otherwise collide. 2x mechanical and
  // line frequency are 1.67 Hz apart on this machine, which on a 0-1000 Hz axis
  // is 0.17% of the plot -- their labels are guaranteed to overlap, and the
  // shaft-order marker moves with rpm while the 50 Hz one does not, so no fixed
  // offset can keep them apart. layoutLabels decides the rows; the axis title
  // and the legend keep the margins they already had.
  const markers = useMemo(() => {
    const built: { slot: LabelSlot; colour: string }[] = [
      {
        slot: { text: `1x  ${rotationalFrequencyHz.toFixed(2)} Hz`, value: rotationalFrequencyHz },
        colour: SERIES.secondary,
      },
      {
        slot: {
          text: `2x mech  ${(2 * rotationalFrequencyHz).toFixed(2)} Hz`,
          value: 2 * rotationalFrequencyHz,
        },
        colour: SHELF_2X_COLOUR,
      },
    ]
    if (lineFrequencyHz !== undefined) {
      built.push({
        slot: { text: `line  ${lineFrequencyHz.toFixed(2)} Hz`, value: lineFrequencyHz },
        colour: LINE_FREQUENCY_COLOUR,
      })
    }
    if (bladePassHz !== undefined) {
      built.push({
        slot: { text: `BPF  ${bladePassHz.toFixed(0)} Hz`, value: bladePassHz },
        colour: INK,
      })
    }
    return built.sort((a, b) => a.slot.value - b.slot.value)
  }, [rotationalFrequencyHz, lineFrequencyHz, bladePassHz])

  const FONT = 11
  const LINE_HEIGHT = 13

  const dataMax = data.reduce((max, row) => Math.max(max, row.frequency_hz), 0)
  // The blade-pass marker can sit past the last plotted bin, so it is included
  // in the domain; otherwise its label would be clamped in from an off-chart x.
  const domainMax = Math.max(dataMax, bladePassHz ?? 0, 1)
  const domain: [number, number] = [0, domainMax]

  // The plot area begins after the chart's own left margin AND the y-axis, and
  // ends before the right margin. Getting this wrong shifts every label off its
  // own rule by a constant, which on a 0-1000 Hz axis would hide the very
  // 1.67 Hz separation this layout exists to show.
  const plotLeft = STACKED_MARGIN.left + Y_AXIS_WIDTH
  const plotWidth = Math.max(frameWidth - plotLeft - STACKED_MARGIN.right, 0)
  const placements = layoutLabels(
    markers.map((marker) => marker.slot),
    {
      plotWidth,
      left: plotLeft,
      domain,
      fontSize: FONT,
      gap: 6,
    },
  )
  const rows = labelRowCount(placements)

  return (
    <ChartFrame
      height={height}
      onWidth={setFrameWidth}
    >
      <AreaChart
        data={data}
        margin={{ ...STACKED_MARGIN, top: 28 + labelStackTopMargin(rows, LINE_HEIGHT) }}
      >
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="frequency_hz"
          type="number"
          domain={domain}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={xAxisLabel('Frequency (Hz)')}
        />
        <YAxis
          {...axisProps}
          width={56}
          label={{
            value: 'Amplitude (mm/s)',
            angle: -90,
            position: 'insideLeft',
            fill: INK,
            fontSize: 11,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip content={<ChartTooltip labelUnit="Hz" valueUnit="mm/s" digits={3} />} />
        <Area
          type="monotone"
          dataKey="amplitude_mm_s"
          name="Velocity spectrum"
          stroke={SERIES.primary}
          strokeWidth={2}
          fill={SERIES.primary}
          fillOpacity={0.12}
          isAnimationActive={false}
        />
        {markers.map((entry, index) => {
          const placement = placements[index]
          return (
            <ReferenceLine
              key={entry.slot.text}
              x={Number(entry.slot.value.toFixed(2))}
              stroke={entry.colour}
              strokeDasharray="4 3"
              strokeWidth={2}
              label={{
                value: entry.slot.text,
                fill: entry.colour,
                fontSize: FONT,
                fontWeight: 600,
                position: 'top',
                // One row per collision, plus a 12px stem so each label still
                // reads as belonging to its own vertical rule.
                dy: -(placement.row * LINE_HEIGHT + 12),
              }}
            />
          )
        })}
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
      </AreaChart>
    </ChartFrame>
  )
}

// --------------------------------------------------------------------------
// Pump curve + system curve, with the operating point marked
// --------------------------------------------------------------------------

export function PumpCurveChart({
  data,
  operatingFlowLpm,
  operatingHeadM,
  noIntersection = false,
  height = 300,
}: {
  data: { flow_lpm: number; pump_head_m: number; system_head_m: number }[]
  operatingFlowLpm: number
  operatingHeadM: number
  /** Pump head never reaches the static head, so the curves do not cross. */
  noIntersection?: boolean
  height?: number
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={STACKED_MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          {...axisProps}
          dataKey="flow_lpm"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={X_AXIS_LABEL}
        />
        <YAxis
          {...axisProps}
          width={56}
          domain={[0, 14]}
          label={{
            value: 'Head (m)',
            angle: -90,
            position: 'insideLeft',
            fill: INK,
            fontSize: 11,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip content={<ChartTooltip labelUnit="L/min" valueUnit="m" />} />
        <Line
          type="monotone"
          dataKey="pump_head_m"
          name="Pump curve  H = H0 - aQ^2"
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="system_head_m"
          name="System curve  H = Hs + KQ^2"
          stroke={SERIES.secondary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {noIntersection ? (
          <ReferenceLine
            y={0}
            stroke="transparent"
            label={{
              value: 'No intersection -- pump head below static head',
              position: 'center',
              fill: '#b4501f',
              fontSize: 12,
              fontWeight: 600,
            }}
          />
        ) : (
          <>
            <OperatingFlowLine flowLpm={operatingFlowLpm} />
            <ReferenceDot
              x={Number(operatingFlowLpm.toFixed(2))}
              y={Number(operatingHeadM.toFixed(2))}
              r={7}
              fill="#0b0b0b"
              stroke="#ffffff"
              strokeWidth={2}
              // Above the dot rather than beside it: the two curves cross here,
              // so anything placed to the right lands on top of one of them.
              label={{
                value: `${operatingFlowLpm.toFixed(1)} L/min, ${operatingHeadM.toFixed(2)} m`,
                position: 'top',
                offset: 12,
                fill: '#0b0b0b',
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          </>
        )}
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
      </LineChart>
    </ChartFrame>
  )
}

/**
 * Efficiency is drawn as its own chart rather than as a second y-axis on the
 * head chart. A dual-axis plot invites the reader to compare two scales that
 * have no relationship, and the crossing point it produces is meaningless.
 */
export function EfficiencyCurveChart({
  data,
  operatingFlowLpm,
  operatingEfficiencyPct,
  bepFlowLpm,
  peakEfficiencyPct,
  height = 220,
}: {
  data: { flow_lpm: number; pump_efficiency: number }[]
  operatingFlowLpm: number
  operatingEfficiencyPct: number
  /** BEP flow AT THE CURRENT SPEED. Q_BEP ~ N, so this marker moves. */
  bepFlowLpm: number
  peakEfficiencyPct: number
  height?: number
}) {
  // Head room above the peak so the BEP label is never clipped by the top edge.
  const yMax = Math.ceil((peakEfficiencyPct * 1.35) / 10) * 10
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={STACKED_MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          {...axisProps}
          dataKey="flow_lpm"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={X_AXIS_LABEL}
        />
        <YAxis
          {...axisProps}
          width={56}
          domain={[0, yMax]}
          label={{
            value: 'Efficiency (%)',
            angle: -90,
            position: 'insideLeft',
            fill: INK,
            fontSize: 11,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip content={<ChartTooltip labelUnit="L/min" valueUnit="%" />} />
        <ReferenceLine
          x={Number(bepFlowLpm.toFixed(2))}
          stroke={INK}
          strokeDasharray="4 3"
          label={{
            value: `BEP ${bepFlowLpm.toFixed(1)} L/min`,
            position: 'top',
            fill: INK,
            fontSize: 11,
          }}
        />
        <Line
          type="monotone"
          dataKey="pump_efficiency"
          name="Pump efficiency  eta(Q N_rated / N)"
          stroke={SERIES.tertiary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <OperatingFlowLine flowLpm={operatingFlowLpm} />
        <ReferenceDot
          x={Number(operatingFlowLpm.toFixed(2))}
          y={Number(operatingEfficiencyPct.toFixed(2))}
          r={6}
          fill="#0b0b0b"
          stroke="#ffffff"
          strokeWidth={2}
          label={{
            value: `${operatingEfficiencyPct.toFixed(1)} %`,
            position: 'right',
            offset: 10,
            fill: '#0b0b0b',
            fontSize: 11,
            fontWeight: 600,
          }}
        />
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
      </LineChart>
    </ChartFrame>
  )
}

// --------------------------------------------------------------------------
// Shaft power vs flow
// --------------------------------------------------------------------------

/**
 * P-Q on the same flow axis as H-Q and eta-Q.
 *
 * Both the useful power and the shaft power are drawn, because the gap between
 * them IS the efficiency curve expressed in watts, and at low flow that gap is
 * the whole story: hydraulic power collapses toward zero while shaft power
 * does not.
 */
export function PowerCurveChart({
  data,
  operatingFlowLpm,
  operatingShaftPowerW,
  height = 220,
}: {
  data: { flow_lpm: number; hydraulic_power_w: number; shaft_power_w: number }[]
  operatingFlowLpm: number
  operatingShaftPowerW: number
  height?: number
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={STACKED_MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          {...axisProps}
          dataKey="flow_lpm"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={X_AXIS_LABEL}
        />
        <YAxis
          {...axisProps}
          width={56}
          domain={[0, 'auto']}
          label={{
            value: 'Power (W)',
            angle: -90,
            position: 'insideLeft',
            fill: INK,
            fontSize: 11,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip content={<ChartTooltip labelUnit="L/min" valueUnit="W" digits={1} />} />
        <Line
          type="monotone"
          dataKey="shaft_power_w"
          name="Shaft power  P_hyd / eta + drag"
          stroke={SERIES.secondary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="hydraulic_power_w"
          name="Hydraulic power  rho g Q H"
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <OperatingFlowLine flowLpm={operatingFlowLpm} />
        <ReferenceDot
          x={Number(operatingFlowLpm.toFixed(2))}
          y={Number(operatingShaftPowerW.toFixed(2))}
          r={6}
          fill="#0b0b0b"
          stroke="#ffffff"
          strokeWidth={2}
          label={{
            value: `${operatingShaftPowerW.toFixed(1)} W`,
            position: 'top',
            offset: 10,
            fill: '#0b0b0b',
            fontSize: 11,
            fontWeight: 600,
          }}
        />
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
      </LineChart>
    </ChartFrame>
  )
}

// --------------------------------------------------------------------------
// NPSH available vs required -- the cavitation boundary
// --------------------------------------------------------------------------

/**
 * The one panel on this page that reaches the vibration layer.
 *
 * NPSHa falls with flow (suction friction rises as Q^2); NPSHr rises with flow.
 * Where they cross, vapour forms at the impeller eye and collapses in the
 * volute -- and that collapse is broadband mechanical excitation, which is why
 * the cavitation fault shows up as high-frequency energy on the accelerometer
 * rather than as a hydraulic reading alone. Everything to the right of the
 * crossing is shaded, because that is the region where a hydraulic condition
 * becomes a vibration signature.
 */
export function NpshCurveChart({
  data,
  operatingFlowLpm,
  onsetFlowLpm,
  maxFlowLpm,
  height = 240,
}: {
  data: { flow_lpm: number; npsh_available_m: number; npsh_required_m: number }[]
  operatingFlowLpm: number
  /** Flow at which NPSHa = NPSHr, or null when they never meet. */
  onsetFlowLpm: number | null
  maxFlowLpm: number
  height?: number
}) {
  const onsetInRange = onsetFlowLpm !== null && onsetFlowLpm <= maxFlowLpm
  const onsetNpsh =
    onsetInRange && onsetFlowLpm !== null
      ? (data.reduce((closest, row) =>
          Math.abs(row.flow_lpm - onsetFlowLpm) < Math.abs(closest.flow_lpm - onsetFlowLpm)
            ? row
            : closest,
        ).npsh_required_m)
      : 0
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={STACKED_MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          {...axisProps}
          dataKey="flow_lpm"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={X_AXIS_LABEL}
        />
        <YAxis
          {...axisProps}
          width={56}
          domain={[0, 'auto']}
          label={{
            value: 'NPSH (m)',
            angle: -90,
            position: 'insideLeft',
            fill: INK,
            fontSize: 11,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip content={<ChartTooltip labelUnit="L/min" valueUnit="m" />} />
        {onsetInRange && onsetFlowLpm !== null && (
          <ReferenceArea
            x1={Number(onsetFlowLpm.toFixed(2))}
            x2={maxFlowLpm}
            fill="#d03b3b"
            fillOpacity={0.09}
            label={{ value: 'Cavitation risk', fill: '#a12f2f', fontSize: 11, fontWeight: 600 }}
          />
        )}
        <Line
          type="monotone"
          dataKey="npsh_available_m"
          name="NPSH available"
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="npsh_required_m"
          name="NPSH required"
          stroke={SERIES.secondary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <OperatingFlowLine flowLpm={operatingFlowLpm} />
        {onsetInRange && onsetFlowLpm !== null && (
          <ReferenceDot
            x={Number(onsetFlowLpm.toFixed(2))}
            y={Number(onsetNpsh.toFixed(2))}
            r={6}
            fill="#a12f2f"
            stroke="#ffffff"
            strokeWidth={2}
            label={{
              value: `Cavitation onset  ${onsetFlowLpm.toFixed(1)} L/min`,
              position: 'top',
              offset: 10,
              fill: '#a12f2f',
              fontSize: 11,
              fontWeight: 600,
            }}
          />
        )}
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
      </LineChart>
    </ChartFrame>
  )
}

// --------------------------------------------------------------------------
// Throttling vs variable speed on one H-Q plane
// --------------------------------------------------------------------------

/**
 * Two ways to reach the same flow, drawn so the difference is a direction
 * rather than a number.
 *
 * Throttling holds the pump curve still and steepens the system curve, so the
 * operating point climbs UP the rated pump curve to the left. Variable speed
 * holds the system curve still and shrinks the pump curve, so the point slides
 * DOWN to the left. Same flow, opposite directions, and the vertical gap
 * between the two points is the head the throttled case is generating and then
 * destroying across a valve.
 */
export function VsdComparisonChart({
  data,
  throttlePoint,
  vsdPoint,
  height = 340,
}: {
  data: {
    flow_lpm: number
    rated_pump_head_m: number
    vsd_pump_head_m: number
    open_system_head_m: number
    throttled_system_head_m: number
  }[]
  throttlePoint: { flow_lpm: number; head_m: number }
  vsdPoint: { flow_lpm: number; head_m: number }
  height?: number
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={STACKED_MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          {...axisProps}
          dataKey="flow_lpm"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={X_AXIS_LABEL}
        />
        <YAxis
          {...axisProps}
          width={56}
          domain={[0, 14]}
          label={{
            value: 'Head (m)',
            angle: -90,
            position: 'insideLeft',
            fill: INK,
            fontSize: 11,
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip content={<ChartTooltip labelUnit="L/min" valueUnit="m" />} />
        <Line
          type="monotone"
          dataKey="rated_pump_head_m"
          name="Pump curve at rated speed"
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="vsd_pump_head_m"
          name="Pump curve at reduced speed"
          stroke={SERIES.primary}
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="throttled_system_head_m"
          name="System curve, valve throttled"
          stroke={SERIES.secondary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="open_system_head_m"
          name="System curve, valve open"
          stroke={SERIES.secondary}
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          isAnimationActive={false}
        />
        <ReferenceLine
          x={Number(throttlePoint.flow_lpm.toFixed(2))}
          stroke="#0b0b0b"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        <ReferenceDot
          x={Number(throttlePoint.flow_lpm.toFixed(2))}
          y={Number(throttlePoint.head_m.toFixed(2))}
          r={7}
          fill={SERIES.secondary}
          stroke="#ffffff"
          strokeWidth={2}
          label={{
            value: `Throttled  ${throttlePoint.head_m.toFixed(2)} m`,
            position: 'top',
            offset: 12,
            fill: '#a1421a',
            fontSize: 11,
            fontWeight: 600,
          }}
        />
        <ReferenceDot
          x={Number(vsdPoint.flow_lpm.toFixed(2))}
          y={Number(vsdPoint.head_m.toFixed(2))}
          r={7}
          fill={SERIES.primary}
          stroke="#ffffff"
          strokeWidth={2}
          label={{
            value: `Variable speed  ${vsdPoint.head_m.toFixed(2)} m`,
            position: 'bottom',
            offset: 12,
            fill: '#1d5aa3',
            fontSize: 11,
            fontWeight: 600,
          }}
        />
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
      </LineChart>
    </ChartFrame>
  )
}

// --------------------------------------------------------------------------
// Trend -- one signal, one chart. Multiple signals become small multiples.
// --------------------------------------------------------------------------

export function TrendChart({
  data,
  dataKey,
  name,
  unit,
  height = 240,
  warningLevel,
  showLegend = false,
  minSpan,
}: {
  data: { elapsed_s: number }[]
  dataKey: string
  name: string
  unit: string
  height?: number
  warningLevel?: number
  /**
   * Off by default. A single-series chart already names its series in the card
   * title, so a one-entry legend repeats the heading and costs a strip of plot
   * area. Set true only if a second series is ever added to the same axes.
   */
  showLegend?: boolean
  /** Overrides the minimum span declared for this key in TREND_MIN_SPAN. */
  minSpan?: number
}) {
  // The y-axis is computed here rather than left to Recharts, because the
  // default auto-scale fits the axis to the data extremes: steady-state flow on
  // this rig spans 0.16 L/min, and that renders as a full-height sawtooth that
  // reads as instability. See lib/chartDomain.ts.
  const values = data
    .map((row) => (row as Record<string, unknown>)[dataKey])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  const axis = trendYAxis(values, { key: dataKey, minSpanOverride: minSpan })

  // Ticks are formatted at the precision their own step implies, so a 0.5 step
  // prints 115.5 rather than 115.50000000000001. The axis is then widened to fit
  // whatever that formatting produced -- sizing it first and clipping after is
  // what cut the leading digits off every label.
  const tickTexts: string[] = []
  for (let value = axis.low; value <= axis.high + axis.step / 2; value += axis.step) {
    tickTexts.push(formatTick(value, axis.digits))
  }
  const widestTick = tickTexts.reduce((widest, text) => (text.length > widest.length ? text : widest), '')
  const axisWidth = yAxisWidth(widestTick)

  // A limit line inside the domain is drawn where it always was. Outside it, the
  // axis is NOT widened to reach it -- that is what flattened every curve to the
  // floor -- and a marker on the plot's edge says the limit is off-screen and
  // what its value is.
  //
  // Both sides are marked. An unmarked off-screen limit fails silently, and the
  // low side is the more dangerous of the two: the NPSH margin's trip point is
  // -0.5 m, below an axis that floors near zero, so a reader would be shown a
  // margin trend with no indication that it has a cavitation boundary at all.
  const limitSide = warningLevel === undefined ? 'inside' : limitPlacement(warningLevel, axis)
  const showLimitLine = warningLevel !== undefined && limitSide === 'inside'
  const showLimitAbove = warningLevel !== undefined && limitSide === 'above'
  const showLimitBelow = warningLevel !== undefined && limitSide === 'below'
  const showLimitMarker = showLimitAbove || showLimitBelow
  const limitColour = '#d03b3b'

  // Reserve the bottom strip for the legend only when there is one, and the top
  // for the off-screen limit marker when there is one.
  const baseMargin = showLegend ? STACKED_MARGIN : { ...STACKED_MARGIN, bottom: 28 }
  const margin = showLimitMarker ? { ...baseMargin, top: baseMargin.top + 14 } : baseMargin

  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={margin}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="elapsed_s"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => `${v.toFixed(0)}`}
          label={xAxisLabel('Elapsed (s)')}
        />
        <YAxis
          {...axisProps}
          width={axisWidth}
          domain={[axis.low, axis.high]}
          tickCount={Math.round((axis.high - axis.low) / axis.step) + 1}
          tickFormatter={(v: number) => formatTick(v, axis.digits)}
        />
        <Tooltip content={<ChartTooltip labelUnit="s" valueUnit={unit} />} />
        {warningLevel !== undefined && showLimitLine && (
          <ReferenceLine
            y={warningLevel}
            stroke={limitColour}
            strokeDasharray="5 3"
            label={{
              value: `Limit ${formatTick(warningLevel, axis.digits)} ${unit}`,
              position: 'right',
              fill: limitColour,
              fontSize: 10,
            }}
          />
        )}
        {showLimitMarker && warningLevel !== undefined && (
          <ReferenceLine
            // Pinned to the edge the limit is beyond, with an arrow saying which
            // way. The line itself is never drawn, because drawing it would mean
            // widening the axis to reach it.
            y={showLimitAbove ? axis.high : axis.low}
            stroke="none"
            label={{
              value: `Limit ${formatTick(warningLevel, axis.digits)} ${unit} ${showLimitAbove ? '↑' : '↓'}`,
              position: showLimitAbove ? 'top' : 'bottom',
              fill: limitColour,
              fontSize: 10,
              fontWeight: 600,
              dy: showLimitAbove ? -4 : 4,
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey={dataKey}
          name={`${name} (${unit})`}
          stroke={SERIES.primary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {showLegend && <Legend wrapperStyle={STACKED_LEGEND_STYLE} />}
      </LineChart>
    </ChartFrame>
  )
}

// --------------------------------------------------------------------------
// Feature importance -- magnitude by category, one hue, direct labels
// --------------------------------------------------------------------------

export function FeatureImportanceChart({
  data,
  height = 240,
}: {
  data: { feature: string; importance: number }[]
  height?: number
}) {
  // The percentage label is precomputed into the row rather than formatted in a
  // label callback, so the value shown is plain data the table view can reuse.
  const rows = data.map((row) => ({
    ...row,
    importance_label: `${(row.importance * 100).toFixed(0)} %`,
  }))
  return (
    <ChartFrame height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis {...axisProps} type="number" domain={[0, 'dataMax']} hide />
        <YAxis
          {...axisProps}
          type="category"
          dataKey="feature"
          width={190}
          tick={{ fill: INK, fontSize: 11 }}
        />
        <Tooltip content={<ChartTooltip labelUnit="" valueUnit="" digits={3} />} />
        <Bar
          dataKey="importance"
          name="Relative contribution"
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          <LabelList dataKey="importance_label" position="right" fill={INK} fontSize={11} />
          {rows.map((entry) => (
            <Cell key={entry.feature} fill={SERIES.primary} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}
