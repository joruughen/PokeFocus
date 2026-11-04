/** Derived measurements shared by the recommendations and the report. */
import type { GameConfig, LeagueId } from '../../src/engine/index.ts'
import type { ProfileAgg } from './aggregate.ts'
import type { LegendaryEncounter, PlayerMetrics, Tally } from './types.ts'
import { mean, median, quantile } from './util.ts'

export const LEAGUES: LeagueId[] = ['base', 'super', 'ultra', 'master']

export interface Thresholds {
  super: number
  ultra: number
  master: number
}

export function thresholdsOf(cfg: GameConfig): Thresholds {
  const t = cfg.leagues.weeklyThresholds
  return { super: t.super, ultra: t.ultra, master: t.master }
}

/** Round to a readable number: 500 below 10k, 1000 below 50k, 2500 below 200k, else 5000. */
export function nice(x: number): number {
  const step = x < 10_000 ? 500 : x < 50_000 ? 1000 : x < 200_000 ? 2500 : 5000
  return Math.max(step, Math.round(x / step) * step)
}

export interface Reach {
  /** Share of (seed, week) pairs reaching the threshold. */
  share: number
  /** Median weekday (0 = Mon … 6 = Sun) at which it is first reached, among those that reach. */
  medianWeekday: number | null
}

/** Re-evaluate league reach for arbitrary thresholds from the recorded daily points. */
export function leagueReach(runs: PlayerMetrics[], thresholds: Thresholds, fromWeek: number): Record<'super' | 'ultra' | 'master', Reach> {
  const out = {} as Record<'super' | 'ultra' | 'master', Reach>
  for (const lg of ['super', 'ultra', 'master'] as const) {
    let total = 0
    let hit = 0
    const days: number[] = []
    for (const r of runs) {
      for (let w = fromWeek - 1; w < r.weeks; w++) {
        total++
        let cum = 0
        for (let d = 0; d < 7; d++) {
          cum += r.dailyPoints[w * 7 + d] ?? 0
          if (cum >= thresholds[lg]) {
            hit++
            days.push(d)
            break
          }
        }
      }
    }
    out[lg] = { share: total ? hit / total : 0, medianWeekday: days.length ? median(days) : null }
  }
  return out
}

export const WEEKDAY_ES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

export function fmtReach(r: Reach): string {
  if (r.share === 0) return '0%'
  const wd = r.medianWeekday === null ? '' : ` (${WEEKDAY_ES[Math.round(r.medianWeekday)]})`
  return `${Math.round(r.share * 100)}%${wd}`
}

/** Thresholds from steady-state quantiles (see the rules in the report, section 1). */
export function proposeThresholds(casual: ProfileAgg, constant: ProfileAgg): Thresholds {
  const superT = nice(quantile(casual.steadyPool, 0.35))
  const ultraT = nice(quantile(constant.steadyPool, 0.15))
  const masterT = nice(quantile(constant.steadyPool, 0.75))
  const ultra = Math.max(ultraT, superT * 2)
  return { super: superT, ultra, master: Math.max(masterT, ultra * 1.2) }
}

// ---------------------------------------------------------------------------
// Leveling
// ---------------------------------------------------------------------------

export interface DayCross {
  target: number
  /** Median day (1-based) over runs at which the metric first reaches the target, null if fewer than half do within the horizon. */
  day: number | null
  reached: number
}

export function crossingDays(runs: PlayerMetrics[], pick: (d: PlayerMetrics['days'][number]) => number, targets: number[]): DayCross[] {
  return targets.map((target) => {
    const ds = runs.map((r) => {
      const d = r.days.find((x) => pick(x) >= target)
      return d ? d.day + 1 : Infinity
    })
    const fin = ds.filter(Number.isFinite)
    const m = median(ds)
    return { target, day: Number.isFinite(m) ? m : null, reached: fin.length / Math.max(1, ds.length) }
  })
}

export function atDays(runs: PlayerMetrics[], pick: (d: PlayerMetrics['days'][number]) => number, days: number[]): number[] {
  return days.map((d) => median(runs.map((r) => pick(r.days[Math.min(d - 1, r.days.length - 1)] as PlayerMetrics['days'][number]))))
}

/** GDD §12.1 targets for the reference run (Pokémon always in the team, no candies). */
export const LEVEL_TARGETS: { level: number; day: number; note: string }[] = [
  { level: 10, day: 1, note: '≈ día 1' },
  { level: 30, day: 21, note: '≈ 3 semanas' },
  { level: 50, day: 91, note: '≈ 3 meses' },
]

// ---------------------------------------------------------------------------
// Misc aggregates
// ---------------------------------------------------------------------------

/** Rewarded sessions of a profile. */
export function rewardedSessions(a: ProfileAgg) {
  return a.runs.flatMap((r) => r.sessions.filter((s) => s.rewarded))
}

export function steadyRatios(a: ProfileAgg, fromWeek = 4): number[] {
  return a.runs.flatMap((r) => r.dmgRatioByWeek.slice(fromWeek - 1).flat())
}

export function ratiosOfWeek(a: ProfileAgg, week: number): number[] {
  return a.runs.flatMap((r) => r.dmgRatioByWeek[week - 1] ?? [])
}

export function meanOf(a: ProfileAgg, f: (r: PlayerMetrics) => number): number {
  return mean(a.runs.map(f))
}

export interface LegendaryFigures {
  /** Legendaries met for the first time (roaming re-appearances excluded). */
  fresh: number
  roaming: number
  caught: number
  freshCaught: number
  /** Captured in the first encounter. */
  firstShare: number
  /** Ended up in the box (retries on roaming re-appearances count). */
  finalShare: number
}

export function legendaryFigures(t: Tally): LegendaryFigures {
  const fresh = t.legendarySeen - t.legendaryRoamingSeen
  return {
    fresh,
    roaming: t.legendaryRoamingSeen,
    caught: t.legendaryCaught,
    freshCaught: t.legendaryFreshCaught,
    firstShare: fresh > 0 ? t.legendaryFreshCaught / fresh : NaN,
    finalShare: fresh > 0 ? Math.min(1, t.legendaryCaught / fresh) : NaN,
  }
}

/** Probability of catching one legendary encounter if `legendaryMinCaptureRate` were `minRate` (same balls, status and HP as played). */
export function encounterCatchProb(e: LegendaryEncounter, minRate: number, rateOverride: Record<string, number> = {}): number {
  const reff = Math.max(rateOverride[e.slug] ?? e.rate, minRate)
  let fail = 1
  for (let i = 0; i < e.maxThrows; i++) {
    const m = e.mults[Math.min(i, e.mults.length - 1)] ?? 0
    fail *= 1 - Math.min(1, (m * reff) / 255)
  }
  return 1 - fail
}

/** Mean first-encounter catch share of the recorded legendaries for a given minimum capture rate. */
export function legendaryShareAt(runs: PlayerMetrics[], minRate: number, rateOverride: Record<string, number> = {}): { share: number; n: number } {
  const es = runs.flatMap((r) => r.legendaryEncounters).filter((e) => e.fresh)
  return { share: es.length ? mean(es.map((e) => encounterCatchProb(e, minRate, rateOverride))) : NaN, n: es.length }
}
