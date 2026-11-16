/**
 * Balance comparison of a content draft against the active content (docs/admin-plan.md §7, E10):
 * the simulator of scripts/sim plays the same profiles and seeds on both resolved contexts and
 * the result is boiled down to the figures the admin compares (weekly points per profile,
 * leagues, captures, legendaries/shinies, dust, energy/exhaustion).
 *
 * Pure and synchronous (CPU-bound): the server only runs it inside the worker of
 * server/content/simWorker.ts; tests call it directly with a handful of seeds.
 */
import { createEngineContext, resolveContent, type ContentItem, type ContentPatch, type EngineContext } from '../../src/engine'
import type { AdminSimParams, AdminSimProfileStats, AdminSimReport, AdminSimSide } from '../../src/game/protocol'
import type { ProfileAgg } from '../../scripts/sim/aggregate.ts'
import { runMatrix } from '../../scripts/sim/experiments.ts'
import { median, mean } from '../../scripts/sim/util.ts'

/** One side of the comparison: a patch (live events left out) and where it came from. */
export interface SimSideInput {
  patch: ContentPatch
  hash: string
  versionId: number | null
}

export interface SimInput {
  params: AdminSimParams
  active: SimSideInput
  proposed: SimSideInput
  /** Items of the published events, so a patch that names one still resolves. */
  eventItems: Record<string, ContentItem>
}

export type SimProgress = (done: number, total: number) => void

export function simContext(side: SimSideInput, eventItems: Record<string, ContentItem>): EngineContext {
  return createEngineContext(resolveContent(side.patch, [], eventItems, { hash: side.hash }))
}

/** Players simulated in total (both contents). */
export function simTotal(p: AdminSimParams): number {
  return p.profiles.length * p.seeds * 2
}

export function profileStats(agg: ProfileAgg): AdminSimProfileStats {
  const runs = agg.runs
  const m = (f: (t: ProfileAgg['tallyMean']) => number) => f(agg.tallyMean)
  const pairs = runs.flatMap((r) => r.weeklyPoints)
  let awake = 0
  let exhausted = 0
  let empty = 0
  const endEnergy: number[] = []
  for (const r of runs)
    for (const s of r.sessions) {
      awake += s.active
      exhausted += s.exhausted
      empty += s.startedEmpty
      if (s.active > 0) endEnergy.push(s.endEnergyFrac)
    }
  const share = (lg: 'base' | 'super' | 'ultra' | 'master') => agg.leagueReach[lg].share
  return {
    profile: agg.profile as AdminSimProfileStats['profile'], // the admin only runs the six standard profiles
    n: agg.n,
    weeklyPoints: agg.weekly.map((w) => ({ p25: w.p25, p50: w.p50, p75: w.p75, mean: w.mean })),
    weeklyPointsMedian: median(pairs),
    leagueShare: { base: share('base'), super: share('super'), ultra: share('ultra'), master: share('master') },
    sessions: agg.meanSessionsPerSeed,
    minutesPerDay: agg.minutesPerDay,
    catches: m((t) => t.catchesTotal),
    speciesCaught: mean(runs.map((r) => r.days[r.days.length - 1]?.caught ?? 0)),
    legendarySeen: m((t) => t.legendarySeen),
    legendaryCaught: m((t) => t.legendaryCaught),
    shinySeen: m((t) => t.shinySeen),
    shinyCaught: m((t) => t.shinyCaught),
    dustEarned: m((t) => t.dustEarned),
    dustSpent: m((t) => t.dustSpent),
    finalDust: mean(runs.map((r) => r.finalDust)),
    exhaustedShare: awake ? exhausted / awake : 0,
    startedEmptyShare: awake ? empty / awake : 0,
    endEnergy: endEnergy.length ? mean(endEnergy) : 0,
    restSessions: m((t) => t.restSessions),
  }
}

function side(input: SimSideInput, eventItems: Record<string, ContentItem>, p: AdminSimParams, tick: () => void): AdminSimSide {
  const ctx = simContext(input, eventItems)
  const out: AdminSimProfileStats[] = []
  // One profile at a time: the per-session records of its runs are dropped before the next one.
  for (const profile of p.profiles) {
    const agg = runMatrix({ ctx, profiles: [profile], seeds: p.seeds, weeks: p.weeks, missions: true, onProgress: tick })[profile]
    out.push(profileStats(agg))
  }
  return { hash: input.hash, versionId: input.versionId, profiles: out }
}

/** Active vs proposed with the same profiles, seeds and weeks. */
export function simulateComparison(input: SimInput, onProgress?: SimProgress): AdminSimReport {
  const t0 = Date.now()
  const total = simTotal(input.params)
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const active = side(input.active, input.eventItems, input.params, tick)
  const proposed = side(input.proposed, input.eventItems, input.params, tick)
  return { params: input.params, active, proposed, ms: Date.now() - t0 }
}
