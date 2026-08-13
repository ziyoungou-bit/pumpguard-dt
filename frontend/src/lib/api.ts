/**
 * Thin REST client for the PumpGuard DT backend.
 *
 * Design rule: nothing here throws at the UI. Every call resolves to either the
 * parsed payload or `null`, because the frontend must stay usable when the API
 * is down -- that is the whole point of the recorded-demo fallback. Callers
 * decide what to show; they never have to wrap calls in try/catch.
 */

import { API_BASE_URL } from './env'
import type {
  Alarm,
  BearingFrequencies,
  Diagnosis,
  FftResponse,
  HistoryResponse,
  PumpCurveResponse,
  SystemStatus,
  Telemetry,
  VibrationResponse,
} from '../types/contracts'

const DEFAULT_TIMEOUT_MS = 6000

let sessionId: string | undefined

export function getSessionId(): string | undefined {
  return sessionId
}

export function setSessionId(id: string | undefined): void {
  sessionId = id
}

function withSession(path: string): string {
  if (!sessionId) return `${API_BASE_URL}${path}`
  const separator = path.includes('?') ? '&' : '?'
  return `${API_BASE_URL}${path}${separator}session_id=${encodeURIComponent(sessionId)}`
}

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await fetch(withSession(path), {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) return null
    const text = await response.text()
    if (!text) return null
    return JSON.parse(text) as T
  } catch {
    // Network error, timeout, 404 while the API agent is still building it, or
    // malformed JSON. All of them mean the same thing to the UI: no data.
    return null
  } finally {
    clearTimeout(timer)
  }
}

function post<T>(path: string, body?: unknown): Promise<T | null> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
}

// --------------------------------------------------------------------------
// Session
// --------------------------------------------------------------------------

/**
 * Sessions are per-visitor. The endpoint is treated as optional: if it is
 * absent the app simply runs without a session_id, which is what the shared
 * single-session backend does anyway.
 */
export async function openSession(): Promise<string | undefined> {
  const result = await post<{ session_id?: string }>('/api/session')
  if (result?.session_id) {
    sessionId = result.session_id
    return result.session_id
  }
  return undefined
}

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

export const getHealth = () => request<{ status: string }>('/api/health', { timeoutMs: 3500 })
export const getStatus = () => request<SystemStatus>('/api/status')
export const getSensors = () => request<Telemetry>('/api/sensors')
export const getDiagnosis = () => request<Diagnosis>('/api/diagnosis')
export const getAlarms = () => request<Alarm[]>('/api/alarms')
export const getPumpCurve = () => request<PumpCurveResponse>('/api/pump-curve')
export const getVibration = () => request<VibrationResponse>('/api/vibration')
export const getFft = () => request<FftResponse>('/api/fft')
export const getBearingFrequencies = () => request<BearingFrequencies>('/api/bearing-frequencies')

export const getHistory = (signal: string, windowKey: string) =>
  request<HistoryResponse>(
    `/api/history?signal=${encodeURIComponent(signal)}&window=${encodeURIComponent(windowKey)}`,
  )

// --------------------------------------------------------------------------
// Writes
// --------------------------------------------------------------------------

export type ControlCommand = 'start' | 'stop' | 'reset' | 'estop'

export interface CommandResult {
  accepted: boolean
  asset_state?: string
  blocked_reason?: string
}

export const sendControl = (command: ControlCommand) =>
  post<CommandResult>(`/api/control/${command}`)

export const injectFault = (fault: string, severity: number) =>
  post<CommandResult>('/api/fault/inject', { fault, severity })

export const clearFault = () => post<CommandResult>('/api/fault/clear')

export const setValve = (opening: number) => post<CommandResult>('/api/valve', { opening })

export const setSpeed = (rpm: number) => post<CommandResult>('/api/speed', { rpm })

export const acknowledgeAlarm = (id: number) => post<CommandResult>(`/api/alarms/${id}/acknowledge`)
