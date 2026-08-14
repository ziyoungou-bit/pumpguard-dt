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

import type { ReactNode } from 'react'
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

function ChartFrame({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div style={{ width: '100%', height }}>
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
  // Markers alternate label height so that 2x and line frequency -- only 1.67 Hz
  // apart on this machine -- do not print on top of each other.
  const marker = (freq: number, text: string, colour: string, dy = 0) => (
    <ReferenceLine
      key={text}
      x={Number(freq.toFixed(2))}
      stroke={colour}
      strokeDasharray="4 3"
      strokeWidth={2}
      label={{
        value: text,
        position: 'top',
        fill: colour,
        fontSize: 11,
        fontWeight: 600,
        dy,
      }}
    />
  )

  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ ...STACKED_MARGIN, top: 28 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="frequency_hz"
          type="number"
          domain={[0, 'dataMax']}
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
        {marker(rotationalFrequencyHz, `1x  ${rotationalFrequencyHz.toFixed(2)} Hz`, SERIES.secondary)}
        {marker(
          2 * rotationalFrequencyHz,
          `2x mech  ${(2 * rotationalFrequencyHz).toFixed(2)} Hz`,
          '#4a3aa7',
        )}
        {lineFrequencyHz
          ? marker(lineFrequencyHz, `line  ${lineFrequencyHz.toFixed(2)} Hz`, '#b4501f', 16)
          : null}
        {bladePassHz ? marker(bladePassHz, `BPF  ${bladePassHz.toFixed(0)} Hz`, INK) : null}
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
// Trend -- one signal, one chart. Multiple signals become small multiples.
// --------------------------------------------------------------------------

export function TrendChart({
  data,
  dataKey,
  name,
  unit,
  height = 180,
  warningLevel,
}: {
  data: { elapsed_s: number }[]
  dataKey: string
  name: string
  unit: string
  height?: number
  warningLevel?: number
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={STACKED_MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="elapsed_s"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => `${v.toFixed(0)}`}
          label={xAxisLabel('Elapsed (s)')}
        />
        <YAxis {...axisProps} width={56} domain={['auto', 'auto']} />
        <Tooltip content={<ChartTooltip labelUnit="s" valueUnit={unit} />} />
        {warningLevel !== undefined && (
          <ReferenceLine
            y={warningLevel}
            stroke="#d03b3b"
            strokeDasharray="5 3"
            label={{
              value: `Limit ${warningLevel} ${unit}`,
              position: 'right',
              fill: '#d03b3b',
              fontSize: 10,
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
        <Legend wrapperStyle={STACKED_LEGEND_STYLE} />
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
