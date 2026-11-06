import type { TimeZoneSpec } from '../../engine'

const nf = new Map<string, Intl.NumberFormat>()

/** 12345 → "12,345" (en) / "12 345" (es). */
export function fmtInt(n: number, lng: string): string {
  let f = nf.get(lng)
  if (!f) {
    f = new Intl.NumberFormat(lng, { maximumFractionDigits: 0 })
    nf.set(lng, f)
  }
  return f.format(Math.round(n))
}

export function fmtPct(f: number, lng: string): string {
  return new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: 0 }).format(f)
}

/** Remaining ms → "24:59" (or "1:04:59"). Rounds up so "0:00" only shows at the end. */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

function intlZone(tz: TimeZoneSpec): string | undefined {
  if (typeof tz === 'string') return tz
  // Fixed offsets: Etc/GMT signs are inverted.
  if (tz % 60 !== 0) return undefined
  const h = -tz / 60
  return h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '+' : ''}${h}`
}

/** Local clock "14:35" in the profile's time zone. */
export function fmtClock(ts: number, tz: TimeZoneSpec, lng: string): string {
  try {
    return new Intl.DateTimeFormat(lng, { hour: '2-digit', minute: '2-digit', timeZone: intlZone(tz) }).format(ts)
  } catch {
    return new Intl.DateTimeFormat(lng, { hour: '2-digit', minute: '2-digit' }).format(ts)
  }
}

/** "martes" / "Tuesday" in the profile's time zone. */
export function fmtWeekday(ts: number, tz: TimeZoneSpec, lng: string): string {
  try {
    return new Intl.DateTimeFormat(lng, { weekday: 'long', timeZone: intlZone(tz) }).format(ts)
  } catch {
    return new Intl.DateTimeFormat(lng, { weekday: 'long' }).format(ts)
  }
}

/** "5 de noviembre" / "November 5" in the profile's time zone. */
export function fmtDate(ts: number, tz: TimeZoneSpec, lng: string): string {
  try {
    return new Intl.DateTimeFormat(lng, { day: 'numeric', month: 'long', timeZone: intlZone(tz) }).format(ts)
  } catch {
    return new Intl.DateTimeFormat(lng, { day: 'numeric', month: 'long' }).format(ts)
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function allTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (fn) return fn('timeZone')
  } catch {
    /* fall through */
  }
  return ['UTC', 'America/Lima', 'America/Bogota', 'America/Mexico_City', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'Europe/Madrid', 'America/New_York']
}

/**
 * Minutes typed in a free number field → a whole number inside [min, max]. An empty or non-numeric
 * draft falls back to `fallback`. Used on blur, so typing "45" never gets clamped halfway ("4" → 15).
 */
export function clampMinutes(raw: string, fallback: number, min: number, max: number): number {
  const n = raw.trim() === '' ? NaN : Number(raw)
  const v = Number.isFinite(n) ? Math.round(n) : fallback
  return Math.max(min, Math.min(max, v))
}
