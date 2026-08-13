/**
 * Shared presentational primitives.
 *
 * Small, dumb and deliberately un-clever: these exist so a stat tile on the
 * dashboard and a stat tile on the vibration page cannot drift apart, not to
 * build a component framework.
 */

import type { ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Info,
  OctagonAlert,
} from 'lucide-react'
import { TONE_BADGE, TONE_BAR, TONE_TEXT, type StatusDescriptor, type Tone } from '../lib/status'

// --------------------------------------------------------------------------
// Icons -- status is always colour + text + icon, never colour alone
// --------------------------------------------------------------------------

export function ToneIcon({ tone, className = 'h-4 w-4' }: { tone: Tone; className?: string }) {
  switch (tone) {
    case 'ok':
      return <CheckCircle2 className={className} aria-hidden />
    case 'warn':
      return <AlertTriangle className={className} aria-hidden />
    case 'alarm':
      return <OctagonAlert className={className} aria-hidden />
    case 'info':
      return <Info className={className} aria-hidden />
    default:
      return <CircleDot className={className} aria-hidden />
  }
}

// --------------------------------------------------------------------------
// Card
// --------------------------------------------------------------------------

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div className="min-w-0">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

// --------------------------------------------------------------------------
// Status badge
// --------------------------------------------------------------------------

export function StatusBadge({
  status,
  size = 'md',
  showIcon = true,
}: {
  status: StatusDescriptor
  size?: 'sm' | 'md'
  showIcon?: boolean
}) {
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border font-semibold tracking-wide uppercase ${padding} ${TONE_BADGE[status.tone]}`}
      title={status.detail}
    >
      {showIcon && <ToneIcon tone={status.tone} className="h-3.5 w-3.5" />}
      {status.label}
    </span>
  )
}

// --------------------------------------------------------------------------
// Stat tile -- a value with its unit. There are no unitless numbers in this UI.
// --------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  unit,
  tag,
  status,
  hint,
}: {
  label: string
  value: string
  unit: string
  tag?: string
  status?: StatusDescriptor
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {label}
        </span>
        {tag && <span className="numeric text-[10px] text-slate-400">{tag}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="numeric text-2xl leading-none font-semibold text-slate-900">{value}</span>
        <span className="text-sm text-slate-500">{unit}</span>
      </div>
      {status && (
        <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${TONE_TEXT[status.tone]}`}>
          <ToneIcon tone={status.tone} className="h-3.5 w-3.5" />
          <span>{status.label}</span>
        </div>
      )}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

// --------------------------------------------------------------------------
// Horizontal meter (health index and similar 0..100 quantities)
// --------------------------------------------------------------------------

export function Meter({
  value,
  max = 100,
  tone,
  label,
}: {
  value: number
  max?: number
  tone: Tone
  label?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? 'value'}
      >
        <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Range slider with a value readout
// --------------------------------------------------------------------------

export function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
  help,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (value: number) => void
  disabled?: boolean
  help?: string
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="field-label">{label}</span>
        <span className="numeric text-sm font-semibold text-slate-900">
          {value.toFixed(step < 1 ? 2 : 0)} {unit}
        </span>
      </span>
      <input
        type="range"
        className="mt-2 w-full accent-blue-700 disabled:opacity-50"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
    </label>
  )
}

// --------------------------------------------------------------------------
// Toggle
// --------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          checked ? 'border-blue-700 bg-blue-700' : 'border-slate-300 bg-slate-200'
        }`}
      >
        <span
          className={`ml-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  )
}

// --------------------------------------------------------------------------
// Notices
// --------------------------------------------------------------------------

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone
  title?: string
  children: ReactNode
}) {
  return (
    <div className={`flex gap-2.5 rounded-md border p-3 text-sm ${TONE_BADGE[tone]}`}>
      <ToneIcon tone={tone} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  )
}

/**
 * The honesty label. Anywhere a number could be mistaken for a real measurement
 * off a real machine, this says what it actually is.
 */
export function ProvenanceNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-slate-500">
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

// --------------------------------------------------------------------------
// Formula block for the Engineering page
// --------------------------------------------------------------------------

export function Formula({
  expression,
  where,
  note,
}: {
  expression: string
  where?: string
  note?: string
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <code className="numeric block text-sm whitespace-pre-wrap text-slate-900">{expression}</code>
      {where && <p className="mt-2 text-xs text-slate-600">{where}</p>}
      {note && <p className="mt-1 text-xs text-slate-500 italic">{note}</p>}
    </div>
  )
}

// --------------------------------------------------------------------------
// Definition row -- label / value pairs in a dense list
// --------------------------------------------------------------------------

export function DefinitionRow({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: Tone
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className={`numeric text-sm font-medium ${tone ? TONE_TEXT[tone] : 'text-slate-900'}`}>
        {value}
      </dd>
    </div>
  )
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
      {children}
    </span>
  )
}

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
