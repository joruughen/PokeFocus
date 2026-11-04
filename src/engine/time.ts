/**
 * Local-time helpers. Timestamps are epoch milliseconds (numbers, JSON-safe).
 * A `TimeZoneSpec` is either an IANA zone name (resolved with Intl, DST-aware)
 * or a fixed UTC offset in minutes (e.g. -300 for UTC−5).
 */

export type TimeZoneSpec = string | number

export interface LocalTime {
  year: number
  /** 1–12 */
  month: number
  /** 1–31 */
  day: number
  /** 0–23 */
  hour: number
  minute: number
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  /** 'YYYY-MM-DD' */
  dayKey: string
  minuteOfDay: number
}

export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function makeDayKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

function fromUtcFields(d: Date): Omit<LocalTime, 'dayKey' | 'minuteOfDay'> {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  }
}

/** Break a timestamp into local calendar fields. */
export function toLocal(ts: number, tz: TimeZoneSpec): LocalTime {
  let f: Omit<LocalTime, 'dayKey' | 'minuteOfDay'>
  if (typeof tz === 'number') {
    f = fromUtcFields(new Date(ts + tz * MINUTE_MS))
  } else {
    let fmt = formatters.get(tz)
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      })
      formatters.set(tz, fmt)
    }
    const parts: Record<string, number> = {}
    for (const p of fmt.formatToParts(new Date(ts))) if (p.type !== 'literal') parts[p.type] = Number(p.value)
    const year = parts.year ?? 1970
    const month = parts.month ?? 1
    const day = parts.day ?? 1
    f = {
      year,
      month,
      day,
      hour: (parts.hour ?? 0) % 24,
      minute: parts.minute ?? 0,
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    }
  }
  return { ...f, dayKey: makeDayKey(f.year, f.month, f.day), minuteOfDay: f.hour * 60 + f.minute }
}

/** Day key shifted by `delta` days. */
export function addDays(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS)
  return makeDayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number) as [number, number, number]
  const [yb, mb, db] = b.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS)
}

/** Local calendar day key. */
export function dayKeyOf(ts: number, tz: TimeZoneSpec): string {
  return toLocal(ts, tz).dayKey
}

/** Week key: the local Monday ('YYYY-MM-DD') of the week containing `ts` (weeks run Mon 00:00 – Sun 23:59). */
export function weekKeyOf(ts: number, tz: TimeZoneSpec): string {
  const l = toLocal(ts, tz)
  const sinceMonday = (l.weekday + 6) % 7
  return addDays(l.dayKey, -sinceMonday)
}

/** Month key 'YYYY-MM'. */
export function monthKeyOf(ts: number, tz: TimeZoneSpec): string {
  const l = toLocal(ts, tz)
  return `${l.year}-${pad(l.month)}`
}

/** "Energy day" key: the day whose reset (at `resetHour` local) started the current period. */
export function resetDayKeyOf(ts: number, tz: TimeZoneSpec, resetHour: number): string {
  const l = toLocal(ts, tz)
  return l.hour < resetHour ? addDays(l.dayKey, -1) : l.dayKey
}

/** Hour `h` is inside [start, end) — windows may wrap midnight (e.g. [20, 5]). */
export function inHourWindow(h: number, win: readonly [number, number]): boolean {
  const [a, b] = win
  return a <= b ? h >= a && h < b : h >= a || h < b
}
