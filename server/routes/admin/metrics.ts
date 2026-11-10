/**
 * GET /api/admin/metrics?from&to&granularity (support or admin; docs/admin-plan.md §4-5).
 * Aggregates over session_log by UTC day or week: active players, sessions, minutes,
 * Focus bands, catches/shinies/legendaries and a simple retention (players of the previous
 * bucket who came back). No player ids or names leave the server.
 */
import { and, gte, lt, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  ADMIN_METRICS_MAX_BUCKETS,
  type AdminMetricsBucket,
  type AdminMetricsCounts,
  type AdminMetricsGranularity,
  type AdminMetricsResponse,
} from '../../../src/game/protocol'
import { sessionLog } from '../../db/schema'
import { ApiError, type AppEnv, type Deps } from '../../http'

const DAY = 86_400_000
const DEFAULT_DAYS = 28

const num = (v: unknown): number => Number(v ?? 0)

/** UTC midnight of the bucket start containing `t` (weeks start on Monday, like date_trunc('week')). */
function bucketStart(t: number, g: AdminMetricsGranularity): number {
  const day = Math.floor(t / DAY) * DAY
  if (g === 'day') return day
  const dow = (new Date(day).getUTCDay() + 6) % 7 // Monday = 0
  return day - dow * DAY
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

function parseRange(c: Context<AppEnv>, now: number): { from: number; to: number; granularity: AdminMetricsGranularity } {
  const q = c.req.query()
  const granularity = q.granularity ?? 'day'
  if (granularity !== 'day' && granularity !== 'week') throw new ApiError(400, 'invalid_body')
  const parse = (v: string | undefined, d: number) => {
    if (v === undefined || v === '') return d
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'invalid_body')
    return Math.floor(n)
  }
  const to = parse(q.to, now)
  const from = parse(q.from, to - DEFAULT_DAYS * DAY)
  if (from >= to) throw new ApiError(400, 'invalid_body')
  // Align to whole buckets so the first/last ones are not silently partial.
  const step = granularity === 'day' ? DAY : 7 * DAY
  const start = bucketStart(from, granularity)
  const end = bucketStart(to - 1, granularity) + step
  if ((end - start) / step > ADMIN_METRICS_MAX_BUCKETS) throw new ApiError(400, 'range_too_large')
  return { from: start, to: end, granularity }
}

const emptyCounts = (): AdminMetricsCounts => ({ sessions: 0, minutes: 0, points: 0, wilds: 0, catches: 0, shinies: 0, legendaries: 0, focusLow: 0, focusMid: 0, focusFull: 0 })

export function adminMetricsHandler(deps: Deps) {
  const { db } = deps
  return async (c: Context<AppEnv>) => {
    const now = deps.clock()
    const { from, to, granularity } = parseRange(c, now)
    const step = granularity === 'day' ? DAY : 7 * DAY
    const unit = sql.raw(`'${granularity}'`) // enum-checked above: never user text
    const bucket = sql<string>`to_char(date_trunc(${unit}, ${sessionLog.endedAt} at time zone 'UTC'), 'YYYY-MM-DD')`
    const inRange = (lo: number) => and(gte(sessionLog.endedAt, new Date(lo)), lt(sessionLog.endedAt, new Date(to)))

    const rows = await db
      .select({
        start: bucket,
        activePlayers: sql<number>`count(distinct ${sessionLog.userId})`,
        sessions: sql<number>`count(*)`,
        minutes: sql<number>`coalesce(sum(${sessionLog.minutes}), 0)`,
        points: sql<number>`coalesce(sum(${sessionLog.points}), 0)`,
        wilds: sql<number>`coalesce(sum(${sessionLog.wilds}), 0)`,
        catches: sql<number>`coalesce(sum(${sessionLog.catches}), 0)`,
        shinies: sql<number>`coalesce(sum(${sessionLog.shinies}), 0)`,
        legendaries: sql<number>`coalesce(sum(${sessionLog.legendaries}), 0)`,
        focusLow: sql<number>`count(*) filter (where ${sessionLog.focus} < 0.75)`,
        focusMid: sql<number>`count(*) filter (where ${sessionLog.focus} >= 0.75 and ${sessionLog.focus} < 1)`,
        focusFull: sql<number>`count(*) filter (where ${sessionLog.focus} >= 1)`,
      })
      .from(sessionLog)
      .where(inRange(from))
      .groupBy(bucket)

    // Retention: one extra bucket before the range tells who was active just before it.
    const pairs = await db.selectDistinct({ start: bucket, userId: sessionLog.userId }).from(sessionLog).where(inRange(from - step))
    const players = new Map<string, Set<string>>()
    for (const p of pairs) {
      const set = players.get(p.start) ?? new Set<string>()
      set.add(p.userId)
      players.set(p.start, set)
    }
    const [overall] = await db.select({ n: sql<number>`count(distinct ${sessionLog.userId})` }).from(sessionLog).where(inRange(from))

    const byStart = new Map(rows.map((r) => [r.start, r]))
    const buckets: AdminMetricsBucket[] = []
    const totals = emptyCounts()
    for (let t = from; t < to; t += step) {
      const start = iso(t)
      const r = byStart.get(start)
      const counts: AdminMetricsCounts = r
        ? {
            sessions: num(r.sessions),
            minutes: Math.round(num(r.minutes)),
            points: num(r.points),
            wilds: num(r.wilds),
            catches: num(r.catches),
            shinies: num(r.shinies),
            legendaries: num(r.legendaries),
            focusLow: num(r.focusLow),
            focusMid: num(r.focusMid),
            focusFull: num(r.focusFull),
          }
        : emptyCounts()
      for (const k of Object.keys(totals) as (keyof AdminMetricsCounts)[]) totals[k] += counts[k]
      const prev = players.get(iso(t - step))
      const cur = players.get(start)
      let returned = 0
      if (prev && cur) for (const u of prev) if (cur.has(u)) returned++
      buckets.push({ start, activePlayers: num(r?.activePlayers), ...counts, prevActive: prev?.size ?? 0, returned })
    }
    const body: AdminMetricsResponse = { from, to, granularity, serverNow: now, buckets, totals: { ...totals, activePlayers: num(overall?.n) } }
    return c.json(body)
  }
}
