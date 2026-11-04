/** Aggregation of many simulated players into the figures the report prints. */
import { ALL_TYPES, type LeagueId, type TypeSlug } from '../../src/engine/index.ts'
import type { ProfileId } from './profiles.ts'
import type { PlayerMetrics, Tally } from './types.ts'
import { mean, median, quantile, sum } from './util.ts'

export interface ProfileAgg {
  profile: ProfileId
  n: number
  weeks: number
  runs: PlayerMetrics[]
  /** [week] → quantiles over seeds. */
  weekly: { p25: number; p50: number; p75: number; mean: number; p90: number }[]
  /** Pooled weekly points over seeds for weeks ≥ steadyFromWeek (1-based). */
  steadyPool: number[]
  /** Fraction of (seed, week) pairs that reach each league, and median weekday (0 = Mon) of the first crossing. */
  leagueReach: Record<LeagueId, { share: number; medianWeekday: number | null }>
  /** Same, weeks ≥ steadyFromWeek only. */
  leagueReachSteady: Record<LeagueId, { share: number; medianWeekday: number | null }>
  tallyMean: Tally
  meanSessionsPerSeed: number
  minutesPerDay: number
}

export const STEADY_FROM_WEEK = 4

function meanTally(runs: PlayerMetrics[]): Tally {
  const out = JSON.parse(JSON.stringify(runs[0]!.tally)) as Tally
  const keys = Object.keys(out) as (keyof Tally)[]
  for (const k of keys) {
    const v = out[k]
    if (typeof v === 'number') (out[k] as number) = mean(runs.map((r) => r.tally[k] as number))
    else {
      const o = v as Record<string, number>
      for (const kk of Object.keys(o)) o[kk] = mean(runs.map((r) => (r.tally[k] as Record<string, number>)[kk] as number))
    }
  }
  return out
}

export function aggregateProfile(profile: ProfileId, runs: PlayerMetrics[]): ProfileAgg {
  const weeks = runs[0]?.weeks ?? 0
  const weekly = Array.from({ length: weeks }, (_, w) => {
    const xs = runs.map((r) => r.weeklyPoints[w] ?? 0)
    return { p25: quantile(xs, 0.25), p50: quantile(xs, 0.5), p75: quantile(xs, 0.75), p90: quantile(xs, 0.9), mean: mean(xs) }
  })
  const steadyPool: number[] = []
  for (const r of runs) for (let w = STEADY_FROM_WEEK - 1; w < weeks; w++) steadyPool.push(r.weeklyPoints[w] ?? 0)
  const reach = (fromWeek: number) => {
    const out = {} as Record<LeagueId, { share: number; medianWeekday: number | null }>
    for (const lg of ['base', 'super', 'ultra', 'master'] as LeagueId[]) {
      let total = 0
      let hit = 0
      const days: number[] = []
      for (const r of runs)
        for (let w = fromWeek - 1; w < weeks; w++) {
          total++
          const d = r.weeklyLeagueDay[w]?.[lg]
          if (d !== null && d !== undefined) {
            hit++
            days.push(d)
          }
        }
      out[lg] = { share: total ? hit / total : 0, medianWeekday: days.length ? median(days) : null }
    }
    return out
  }
  const totalDays = weeks * 7
  return {
    profile,
    n: runs.length,
    weeks,
    runs,
    weekly,
    steadyPool,
    leagueReach: reach(1),
    leagueReachSteady: reach(STEADY_FROM_WEEK),
    tallyMean: meanTally(runs),
    meanSessionsPerSeed: mean(runs.map((r) => r.tally.sessionsTotal)),
    minutesPerDay: mean(runs.map((r) => sum(r.weeklyMinutes))) / totalDays,
  }
}

// ---------------------------------------------------------------------------
// Leveling
// ---------------------------------------------------------------------------

/** Day (1-based) at which the metric first reaches `target`, per run; Infinity if never. */
export function daysToReach(runs: PlayerMetrics[], pick: (d: PlayerMetrics['days'][number]) => number, target: number): number[] {
  return runs.map((r) => {
    const d = r.days.find((x) => pick(x) >= target)
    return d ? d.day + 1 : Infinity
  })
}

export function medianFinite(xs: number[]): { value: number | null; reached: number } {
  const fin = xs.filter(Number.isFinite)
  if (fin.length < xs.length / 2) return { value: null, reached: fin.length / xs.length }
  // Median over all runs treating "never" as +Infinity.
  const m = median(xs)
  return { value: Number.isFinite(m) ? m : null, reached: fin.length / xs.length }
}

/** Median across runs of a per-day metric, at the given 0-based day indices. */
export function dayMedians(runs: PlayerMetrics[], pick: (d: PlayerMetrics['days'][number]) => number, days: number[]): number[] {
  return days.map((d) => median(runs.map((r) => pick(r.days[Math.min(d, r.days.length - 1)] as PlayerMetrics['days'][number]))))
}

// ---------------------------------------------------------------------------
// Coverage of type conditions
// ---------------------------------------------------------------------------

export interface CoverageRow {
  type: TypeSlug
  /** Mean condition multiplier over sessions (1.0 when inactive). */
  mean: number
  /** Share of sessions where the multiplier is > 1. */
  active: number
  /** Share of sessions where the condition is on, per profile. */
  byProfile: Partial<Record<ProfileId, number>>
}

export function coverage(profiles: ProfileAgg[]): CoverageRow[] {
  const rows: CoverageRow[] = []
  ALL_TYPES.forEach((type, i) => {
    const byProfile: Partial<Record<ProfileId, number>> = {}
    const means: number[] = []
    const actives: number[] = []
    for (const p of profiles) {
      if (p.profile === 'grinder') continue
      const recs = p.runs.flatMap((r) => r.sessions.filter((s) => s.rewarded))
      if (recs.length === 0) continue
      const ms = recs.map((s) => s.condMult[i] as number)
      byProfile[p.profile] = ms.filter((x) => x > 1).length / ms.length
      means.push(mean(ms))
      actives.push(byProfile[p.profile] as number)
    }
    rows.push({ type, mean: mean(means), active: mean(actives), byProfile })
  })
  return rows
}
