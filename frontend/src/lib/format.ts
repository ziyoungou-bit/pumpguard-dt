/** Presentation helpers. No engineering decisions live here -- formatting only. */

export function fmt(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return value.toFixed(digits)
}

/** Value + unit, always together. No bare numbers anywhere in the UI. */
export function fmtUnit(value: number | null | undefined, unit: string, digits = 1): string {
  return `${fmt(value, digits)} ${unit}`
}

export function fmtPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '--'
  return `${(fraction * 100).toFixed(digits)} %`
}

export function fmtClock(iso: string | undefined): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour12: false })
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString([], { hour12: false })
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

/** "flow_restriction" -> "Flow Restriction" */
export function humanise(key: string | undefined): string {
  if (!key) return '--'
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
