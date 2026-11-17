/**
 * Spawn preview (docs/admin-plan.md §4 `spawn-preview`): which species the
 * wild pool offers for an hour × weather × trainer level, under a given
 * content. Uses the engine's spawn rule (`spawnRuleMult`, src/engine/spawn.ts),
 * the same one the coverage check and `waves.ts` apply.
 */
import type { EngineContext } from '../../engine/context'
import { isLegendarySpecies } from '../../engine/individual'
import { minWildLevel, wildLevelRange } from '../../engine/waves'
import { stageWeight, stageWeightsForRank, type LeagueRank } from '../../engine/league'
import type { SpawnWeather } from '../../engine/content'
import type { AdminSpawnPreview, AdminSpawnWeather } from '../protocol'
import { legendaryChanceFor, spawnRuleMult } from '../../engine/spawn'

export type SpawnPreviewSlot = Pick<AdminSpawnPreview, 'wildLevel' | 'species' | 'count' | 'legendaryChance' | 'rules'>

export function spawnPreview(ctx: EngineContext, env: { hour: number; weather: AdminSpawnWeather; trainerLevel: number; /** League rung (GDD §10.2): absent = every stage, as the top league. */ rank?: Pick<LeagueRank, 'league' | 'sub'> },
): SpawnPreviewSlot {
  const weather: SpawnWeather | null = env.weather === 'unknown' ? null : env.weather
  const range = wildLevelRange(env.trainerLevel, ctx.config)
  const pool = ctx.data.species.filter((s) => !isLegendarySpecies(s))
  const mins = new Map(pool.map((s) => [s.slug, minWildLevel(s, ctx)]))
  const mult = new Map(pool.map((s) => [s.slug, spawnRuleMult(ctx.spawn.get(s.slug), { hour: env.hour, weather, trainerLevel: env.trainerLevel })]))
  const stages = env.rank ? stageWeightsForRank(env.rank, ctx.config) : null
  const stageOf = new Map(pool.map((s) => [s.slug, stageWeight(s.stage, stages)]))
  const weightOf = (slug: string, captureRate: number) => Math.max(1, captureRate) * (mult.get(slug) ?? 1) * (stageOf.get(slug) ?? 1)

  // Average of the share at every wild level of the band (the pool grows with the level).
  const share = new Map<string, number>()
  const levels = range.max - range.min + 1
  for (let level = range.min; level <= range.max; level++) {
    let eligible = pool.filter((s) => (mins.get(s.slug) ?? 1) <= level && (stageOf.get(s.slug) ?? 1) > 0)
    if (eligible.length === 0) eligible = pool.filter((s) => s.stage === 1)
    const weights = eligible.map((s) => ({ slug: s.slug, w: weightOf(s.slug, s.captureRate) }))
    const total = weights.reduce((n, x) => n + x.w, 0)
    if (total <= 0) continue
    for (const x of weights) if (x.w > 0) share.set(x.slug, (share.get(x.slug) ?? 0) + x.w / total / levels)
  }
  const species = pool
    .filter((s) => (share.get(s.slug) ?? 0) > 0)
    .map((s) => ({ slug: s.slug, probability: share.get(s.slug)!, weight: weightOf(s.slug, s.captureRate), weightMult: mult.get(s.slug) ?? 1 }))
    .sort((a, b) => b.probability - a.probability || (a.slug < b.slug ? -1 : 1))
  const rules = [...ctx.spawn.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([slug, r]) => ({
      slug,
      enabled: r.enabled,
      weightMult: r.weightMult,
      ...(r.hours && { hours: r.hours }),
      ...(r.weather && { weather: [...r.weather] }),
      ...(r.minTrainerLevel !== undefined && { minTrainerLevel: r.minTrainerLevel }),
    }))
  return { wildLevel: range, species, count: species.length, legendaryChance: legendaryChanceFor(ctx) * (stages?.legendary ?? 1), rules }
}
