/**
 * Status semantics in one place.
 *
 * Colour is never the only carrier of meaning in this UI: every helper returns a
 * `label` alongside its `tone`, and the components that use them always render
 * an icon too. Tone -> Tailwind class mapping lives here so a status can never
 * be styled one way on the dashboard and another way on the alarm list.
 */

import { AssetState, SensorQuality } from '../types/contracts'

export type Tone = 'ok' | 'warn' | 'alarm' | 'info' | 'idle'

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-green-700',
  warn: 'text-amber-700',
  alarm: 'text-red-700',
  info: 'text-blue-700',
  idle: 'text-slate-600',
}

export const TONE_BADGE: Record<Tone, string> = {
  ok: 'bg-green-50 text-green-800 border-green-300',
  warn: 'bg-amber-50 text-amber-900 border-amber-300',
  alarm: 'bg-red-50 text-red-800 border-red-300',
  info: 'bg-blue-50 text-blue-800 border-blue-300',
  idle: 'bg-slate-100 text-slate-700 border-slate-300',
}

export const TONE_BAR: Record<Tone, string> = {
  ok: 'bg-green-600',
  warn: 'bg-amber-600',
  alarm: 'bg-red-600',
  info: 'bg-blue-600',
  idle: 'bg-slate-500',
}

export const TONE_STROKE: Record<Tone, string> = {
  ok: '#15803d',
  warn: '#b45309',
  alarm: '#b91c1c',
  info: '#1d4ed8',
  idle: '#475569',
}

export interface StatusDescriptor {
  tone: Tone
  label: string
  /** One line explaining what the state means, for a reader who is not a plant operator. */
  detail: string
}

export function assetStateStatus(state: string): StatusDescriptor {
  switch (state) {
    case AssetState.RUNNING:
      return { tone: 'ok', label: 'RUNNING', detail: 'Asset is running normally' }
    case AssetState.STARTING:
      return { tone: 'info', label: 'STARTING', detail: 'Start sequence in progress' }
    case AssetState.STOPPING:
      return { tone: 'info', label: 'STOPPING', detail: 'Controlled stop in progress' }
    case AssetState.OFF:
      return { tone: 'idle', label: 'OFF', detail: 'Asset is stopped and available to start' }
    case AssetState.FAULT:
      return { tone: 'alarm', label: 'FAULT', detail: 'Protection tripped -- reset required' }
    case AssetState.E_STOP:
      return { tone: 'alarm', label: 'E-STOP', detail: 'Emergency stop latched' }
    case AssetState.MAINTENANCE:
      return { tone: 'warn', label: 'MAINTENANCE', detail: 'Locked out for maintenance' }
    default:
      return { tone: 'idle', label: state || 'UNKNOWN', detail: 'State not reported' }
  }
}

/** Health index banding, 0..100. */
export function healthStatus(health: number): StatusDescriptor {
  if (health >= 85) return { tone: 'ok', label: 'GOOD', detail: 'No significant degradation' }
  if (health >= 65)
    return { tone: 'warn', label: 'DEGRADED', detail: 'Condition worsening -- investigate' }
  if (health >= 40)
    return { tone: 'alarm', label: 'POOR', detail: 'Significant degradation -- plan intervention' }
  return { tone: 'alarm', label: 'CRITICAL', detail: 'Intervention required now' }
}

export function severityStatus(label: string): StatusDescriptor {
  switch (label) {
    case 'none':
      return { tone: 'ok', label: 'NONE', detail: 'No fault severity assigned' }
    case 'minor':
      return { tone: 'warn', label: 'MINOR', detail: 'Early-stage indication' }
    case 'moderate':
      return { tone: 'warn', label: 'MODERATE', detail: 'Clearly developed, act at next opportunity' }
    case 'severe':
      return { tone: 'alarm', label: 'SEVERE', detail: 'Advanced -- act now' }
    default:
      return { tone: 'idle', label: (label || 'UNKNOWN').toUpperCase(), detail: '' }
  }
}

export function alarmSeverityStatus(severity: string): StatusDescriptor {
  switch (severity) {
    case 'WARNING':
      return { tone: 'warn', label: 'WARNING', detail: 'Above the warning threshold' }
    case 'ALARM':
      return { tone: 'alarm', label: 'ALARM', detail: 'Above the alarm threshold' }
    case 'TRIP':
      return { tone: 'alarm', label: 'TRIP', detail: 'Protection limit -- machine will trip' }
    case 'CRITICAL':
      return { tone: 'alarm', label: 'CRITICAL', detail: 'Immediate danger to the asset' }
    default:
      return { tone: 'idle', label: severity || 'INFO', detail: '' }
  }
}

export function sensorQualityStatus(quality: string | undefined): StatusDescriptor {
  switch (quality) {
    case SensorQuality.GOOD:
      return { tone: 'ok', label: 'GOOD', detail: 'Signal is trustworthy' }
    case SensorQuality.UNCERTAIN:
      return { tone: 'warn', label: 'UNCERTAIN', detail: 'Signal is questionable -- verify' }
    case SensorQuality.BAD:
      return { tone: 'alarm', label: 'BAD', detail: 'Signal must not be relied on' }
    default:
      return { tone: 'idle', label: 'NOT REPORTED', detail: 'No quality flag from the source' }
  }
}

/** Compares a reading against a high limit and describes where it sits. */
export function limitStatus(
  value: number,
  warnAt: number,
  alarmAt: number,
): StatusDescriptor {
  if (value >= alarmAt) return { tone: 'alarm', label: 'ALARM', detail: `At or above ${alarmAt}` }
  if (value >= warnAt) return { tone: 'warn', label: 'HIGH', detail: `At or above ${warnAt}` }
  return { tone: 'ok', label: 'NORMAL', detail: `Below ${warnAt}` }
}
