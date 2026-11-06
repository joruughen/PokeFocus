/**
 * Pure helpers for the maintenance banner: which notice to show and how to
 * write its dates. Times are absolute instants; they are shown in the
 * viewer's own time zone (with its short name, e.g. "GMT-5"), so nobody has to
 * convert from the admin's zone.
 */
import type { MaintenanceNotice } from '../../game/protocol'

export type NoticePhase = 'upcoming' | 'active'

export interface NoticeView {
  notice: MaintenanceNotice
  phase: NoticePhase
}

/**
 * The one notice to show now. A running window always wins (earliest end first)
 * and cannot be dismissed; otherwise the soonest upcoming one that was not dismissed.
 * Ended windows never show.
 */
export function pickNotice(list: readonly MaintenanceNotice[], now: number, dismissed: ReadonlySet<string> = new Set()): NoticeView | null {
  const live = list.filter((n) => n.endsAt > now)
  const active = live.filter((n) => n.startsAt <= now).sort((a, b) => a.endsAt - b.endsAt)[0]
  if (active) return { notice: active, phase: 'active' }
  const upcoming = live.filter((n) => !dismissed.has(n.id)).sort((a, b) => a.startsAt - b.startsAt)[0]
  return upcoming ? { notice: upcoming, phase: 'upcoming' } : null
}

function dayKey(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(ts)
}

function dayLabel(ts: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(ts)
}

function timeLabel(ts: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(ts)
}

function zoneName(ts: number, locale: string, timeZone?: string): string {
  const part = new Intl.DateTimeFormat(locale, { timeZoneName: 'short', timeZone }).formatToParts(ts).find((p) => p.type === 'timeZoneName')
  return part?.value ?? ''
}

/** A moment with its day: "sáb, 7 nov, 02:00 GMT-5". */
export function formatInstant(ts: number, locale: string, timeZone?: string): string {
  return `${dayLabel(ts, locale, timeZone)}, ${timeLabel(ts, locale, timeZone)} ${zoneName(ts, locale, timeZone)}`.trim()
}

/**
 * The whole window in one line. Same day: "sáb, 7 nov, 02:00 – 04:00 GMT-5".
 * Several days: "vie, 6 nov, 22:00 – sáb, 7 nov, 04:00 GMT-5".
 */
export function formatWindow(startsAt: number, endsAt: number, locale: string, timeZone?: string): string {
  const zone = zoneName(endsAt, locale, timeZone)
  const start = `${dayLabel(startsAt, locale, timeZone)}, ${timeLabel(startsAt, locale, timeZone)}`
  const sameDay = dayKey(startsAt, timeZone) === dayKey(endsAt, timeZone)
  const end = sameDay ? timeLabel(endsAt, locale, timeZone) : `${dayLabel(endsAt, locale, timeZone)}, ${timeLabel(endsAt, locale, timeZone)}`
  return `${start} – ${end} ${zone}`.trim()
}

/** "in 25 minutes" / "dentro de 3 horas" / "mañana": rounded to the biggest sensible unit. */
export function formatRelative(ms: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 48) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

/** `<input type="datetime-local">` value ("2026-11-07T02:00") for a timestamp, in the browser's zone. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Inverse of `toLocalInput`: the instant for what the admin typed (NaN when empty or invalid). */
export function fromLocalInput(value: string): number {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? new Date(value).getTime() : Number.NaN
}
