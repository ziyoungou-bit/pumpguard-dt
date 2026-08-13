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
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="t_s"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(2)}
          label={{ value: 'Time (s)', position: 'insideBottom', offset: -12, fill: INK, fontSize: 11 }}
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
        <Legend wrapperStyle={legendStyle} />
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
  height = 280,
}: {
  data: { frequency_hz: number; amplitude_mm_s: number }[]
  rotationalFrequencyHz: number
  bladePassHz?: number
  height?: number
}) {
  const marker = (freq: number, text: string, colour: string) => (
    <ReferenceLine
      key={text}
      x={Number(freq.toFixed(1))}
      stroke={colour}
      strokeDasharray="4 3"
      strokeWidth={2}
      label={{
        value: text,
        position: 'top',
        fill: colour,
        fontSize: 11,
        fontWeight: 600,
      }}
    />
  )

  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 24, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="frequency_hz"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={{
            value: 'Frequency (Hz)',
            position: 'insideBottom',
            offset: -12,
            fill: INK,
            fontSize: 11,
          }}
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
        {marker(rotationalFrequencyHz, `1x  ${rotationalFrequencyHz.toFixed(1)} Hz`, SERIES.secondary)}
        {marker(2 * rotationalFrequencyHz, `2x  ${(2 * rotationalFrequencyHz).toFixed(1)} Hz`, '#4a3aa7')}
        {bladePassHz
          ? marker(bladePassHz, `BPF  ${bladePassHz.toFixed(0)} Hz`, INK)
          : null}
        <Legend wrapperStyle={legendStyle} />
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
  height = 300,
}: {
  data: { flow_lpm: number; pump_head_m: number; system_head_m: number }[]
  operatingFlowLpm: number
  operatingHeadM: number
  height?: number
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          {...axisProps}
          dataKey="flow_lpm"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={{ value: 'Flow (L/min)', position: 'insideBottom', offset: -12, fill: INK, fontSize: 11 }}
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
        <ReferenceDot
          x={Number(operatingFlowLpm.toFixed(2))}
          y={Number(operatingHeadM.toFixed(2))}
          r={7}
          fill="#0b0b0b"
          stroke="#ffffff"
          strokeWidth={2}
          label={{
            value: `Operating point  ${operatingFlowLpm.toFixed(1)} L/min, ${operatingHeadM.toFixed(2)} m`,
            position: 'right',
            fill: '#0b0b0b',
            fontSize: 11,
            fontWeight: 600,
          }}
        />
        <Legend wrapperStyle={legendStyle} />
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
  height = 220,
}: {
  data: { flow_lpm: number; pump_efficiency: number }[]
  operatingFlowLpm: number
  operatingEfficiencyPct: number
  bepFlowLpm: number
  height?: number
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          {...axisProps}
          dataKey="flow_lpm"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={{ value: 'Flow (L/min)', position: 'insideBottom', offset: -12, fill: INK, fontSize: 11 }}
        />
        <YAxis
          {...axisProps}
          width={56}
          domain={[0, 70]}
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
          x={bepFlowLpm}
          stroke={INK}
          strokeDasharray="4 3"
          label={{ value: `BEP ${bepFlowLpm} L/min`, position: 'top', fill: INK, fontSize: 11 }}
        />
        <Line
          type="monotone"
          dataKey="pump_efficiency"
          name="Pump efficiency"
          stroke={SERIES.tertiary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <ReferenceDot
          x={Number(operatingFlowLpm.toFixed(2))}
          y={Number(operatingEfficiencyPct.toFixed(2))}
          r={6}
          fill="#0b0b0b"
          stroke="#ffffff"
          strokeWidth={2}
          label={{
            value: `${operatingEfficiencyPct.toFixed(1)} %`,
            position: 'top',
            fill: '#0b0b0b',
            fontSize: 11,
            fontWeight: 600,
          }}
        />
        <Legend wrapperStyle={legendStyle} />
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
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          {...axisProps}
          dataKey="elapsed_s"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => `${v.toFixed(0)}`}
          label={{
            value: 'Elapsed (s)',
            position: 'insideBottom',
            offset: -10,
            fill: INK,
            fontSize: 11,
          }}
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
        <Legend wrapperStyle={legendStyle} />
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
