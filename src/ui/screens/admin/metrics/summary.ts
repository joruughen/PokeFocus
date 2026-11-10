/** Derived numbers of the admin metrics panel (pure; the server sends sums only). */
import type { AdminMetricsBucket, AdminMetricsResponse } from '../../../../game/protocol'

/** a / b, 0 when b is 0. */
export const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0)

export interface MetricsSummary {
  players: number
  sessions: number
  hours: number
  sessionsPerPlayer: number
  catchesPerSession: number
  shiniesPer100: number
  legendariesPer100: number
  focus: { full: number; mid: number; low: number }
}

export function summarize(m: AdminMetricsResponse): MetricsSummary {
  const t = m.totals
  return {
    players: t.activePlayers,
    sessions: t.sessions,
    hours: t.minutes / 60,
    sessionsPerPlayer: ratio(t.sessions, t.activePlayers),
    catchesPerSession: ratio(t.catches, t.sessions),
    shiniesPer100: ratio(t.shinies, t.sessions) * 100,
    legendariesPer100: ratio(t.legendaries, t.sessions) * 100,
    focus: { full: ratio(t.focusFull, t.sessions), mid: ratio(t.focusMid, t.sessions), low: ratio(t.focusLow, t.sessions) },
  }
}

/** Share of the previous bucket's players who came back; null when nobody was there to come back. */
export const retention = (b: AdminMetricsBucket): number | null => (b.prevActive > 0 ? b.returned / b.prevActive : null)

/** `2026-11-04` -> `11-04` (chart axis). */
export const shortDay = (start: string): string => start.slice(5)
