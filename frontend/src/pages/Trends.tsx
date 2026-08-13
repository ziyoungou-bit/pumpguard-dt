/**
 * Trends.
 *
 * Selected signals are drawn as SMALL MULTIPLES, one chart per signal, rather
 * than overlaid on a shared plot. Vibration in mm/s, flow in L/min and
 * temperature in degC have no common scale; putting them on one pair of axes
 * would either flatten most of them into a line at the bottom or need a second
 * y-axis, which invites a comparison that means nothing.
 */

import { useMemo, useState } from 'react'
import { useAppState } from '../state/AppState'
import type { Telemetry } from '../types/contracts'
import { fmt, fmtDuration } from '../lib/format'
import { Card, DefinitionRow, PageHeading, ProvenanceNote } from '../components/ui'
import { TrendChart } from '../components/charts'
import { ErrorBoundary } from '../components/ErrorBoundary'

interface SignalSpec {
  key: keyof Telemetry
  label: string
  unit: string
  limit?: number
}

/** Field keys are the contract's own names -- no renaming anywhere. */
const SIGNALS: SignalSpec[] = [
  { key: 'vibration_rms_mm_s', label: 'Vibration RMS', unit: 'mm/s', limit: 4.5 },
  { key: 'amplitude_1x_mm_s', label: '1x amplitude', unit: 'mm/s' },
  { key: 'amplitude_2x_mm_s', label: '2x amplitude', unit: 'mm/s' },
  { key: 'high_frequency_energy', label: 'HF band energy', unit: 'mm/s' },
  { key: 'flow_lpm', label: 'Flow', unit: 'L/min' },
  { key: 'pump_head_m', label: 'Pump head', unit: 'm' },
  { key: 'differential_pressure_kpa', label: 'Differential pressure', unit: 'kPa' },
  { key: 'suction_pressure_kpa', label: 'Suction pressure', unit: 'kPa abs' },
  { key: 'motor_current_a', label: 'Motor current', unit: 'A', limit: 1.09 },
  { key: 'motor_temperature_c', label: 'Motor temperature', unit: 'degC', limit: 78 },
  { key: 'bearing_temperature_c', label: 'Bearing temperature', unit: 'degC', limit: 62 },
  { key: 'rpm', label: 'Speed', unit: 'rpm' },
  { key: 'pump_efficiency', label: 'Pump efficiency', unit: '-' },
  { key: 'npsh_margin_m', label: 'NPSH margin', unit: 'm' },
  { key: 'health_index', label: 'Health index', unit: '/100' },
  { key: 'anomaly_score', label: 'Anomaly score', unit: '-' },
]

const WINDOWS = [
  { key: '1m', label: '1 min', seconds: 60 },
  { key: '5m', label: '5 min', seconds: 300 },
  { key: '15m', label: '15 min', seconds: 900 },
  { key: 'run', label: 'Whole run', seconds: Number.POSITIVE_INFINITY },
] as const

export function Trends() {
  const { history, telemetry, connection } = useAppState()
  const [selected, setSelected] = useState<string[]>([
    'vibration_rms_mm_s',
    'flow_lpm',
    'bearing_temperature_c',
    'health_index',
  ])
  const [windowKey, setWindowKey] = useState<string>('5m')

  const windowSpec = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[1]

  const data = useMemo(() => {
    if (history.length === 0) return []
    const latest = history[history.length - 1].elapsed_s
    if (!Number.isFinite(windowSpec.seconds)) return history
    const cutoff = latest - windowSpec.seconds
    return history.filter((frame) => frame.elapsed_s >= cutoff)
  }, [history, windowSpec])

  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )

  const chosen = SIGNALS.filter((signal) => selected.includes(signal.key as string))
  const spanS = data.length > 1 ? data[data.length - 1].elapsed_s - data[0].elapsed_s : 0

  return (
    <div className="space-y-5">
      <PageHeading
        title="Trends"
        description="Historised signals from the rolling telemetry buffer. Each signal keeps its own axis and its own units."
      />

      <Card title="Signal selection">
        <div className="flex flex-wrap items-center gap-2">
          <span className="field-label mr-2">Window</span>
          {WINDOWS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setWindowKey(option.key)}
              className={`btn px-3 py-1.5 text-xs ${
                windowKey === option.key ? 'btn-primary' : 'btn-secondary'
              }`}
              aria-pressed={windowKey === option.key}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <span className="field-label">Signals</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {SIGNALS.map((signal) => {
              const active = selected.includes(signal.key as string)
              return (
                <button
                  key={signal.key as string}
                  type="button"
                  onClick={() => toggle(signal.key as string)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {active ? '✓ ' : ''}
                  {signal.label} ({signal.unit})
                </button>
              )
            })}
          </div>
        </div>

        <dl className="mt-4">
          <DefinitionRow label="Samples in window" value={String(data.length)} />
          <DefinitionRow label="Window span" value={fmtDuration(spanS)} />
          <DefinitionRow label="Buffer depth" value={`${history.length} frames`} />
          <DefinitionRow label="Sample interval" value="0.5 s" />
        </dl>
        <div className="mt-3">
          <ProvenanceNote>
            The buffer holds the frames received since this page was opened, capped at 3600 samples
            (30 minutes). It is not persisted -- a refresh starts a new buffer.
            {connection === 'live'
              ? ''
              : ' Frames are currently coming from the bundled recorded demonstration dataset.'}
          </ProvenanceNote>
        </div>
      </Card>

      {chosen.length === 0 ? (
        <Card title="No signals selected">
          <p className="text-sm text-slate-600">
            Select at least one signal above to plot it. The current frame still reads{' '}
            {fmt(telemetry.vibration_rms_mm_s, 2)} mm/s vibration RMS at {fmt(telemetry.rpm, 0)} rpm.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {chosen.map((signal) => (
            <ErrorBoundary key={signal.key as string} panelName={`${signal.label} trend`} compact>
              <Card
                title={signal.label}
                subtitle={`${signal.unit} -- ${windowSpec.label} window`}
              >
                <TrendChart
                  data={data}
                  dataKey={signal.key as string}
                  name={signal.label}
                  unit={signal.unit}
                  warningLevel={signal.limit}
                />
              </Card>
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  )
}
