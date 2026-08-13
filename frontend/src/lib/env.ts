/**
 * The ONLY module in the frontend allowed to mention a host or a port.
 *
 * Everything else imports API_BASE_URL / WS_URL from here. The localhost values
 * below are dev fallbacks for when no .env is present; in any deployed build
 * VITE_API_BASE_URL and VITE_WS_URL are expected to be set.
 */

function readEnv(key: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/** Dev fallback only. Never referenced outside this module. */
const DEV_API_FALLBACK = 'http://localhost:8000'
const DEV_WS_FALLBACK = 'ws://localhost:8000'

export const API_BASE_URL = stripTrailingSlash(readEnv('VITE_API_BASE_URL') ?? DEV_API_FALLBACK)

export const WS_URL = stripTrailingSlash(readEnv('VITE_WS_URL') ?? DEV_WS_FALLBACK)

/** Full websocket endpoint for the realtime telemetry stream. */
export function realtimeSocketUrl(sessionId?: string): string {
  const base = `${WS_URL}/ws/realtime`
  return sessionId ? `${base}?session_id=${encodeURIComponent(sessionId)}` : base
}

export const GITHUB_URL = readEnv('VITE_GITHUB_URL') ?? 'https://github.com/'
