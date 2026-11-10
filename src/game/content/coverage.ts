/**
 * Spawn coverage (docs/admin-plan.md §2): for every local hour × weather ×
 * wild-level band, the non-legendary pool must keep at least
 * `MIN_SPAWN_SPECIES` species with weight > 0.
 *
 * The spawn rule is the engine's (`spawnRuleMult` in src/engine/spawn.ts, the
 * one `waves.ts` applies): 0 when the species is disabled, outside its
 * hours/weather (unknown weather included), or below its trainer level; else
 * `weightMult`. Re-exported here for the validator and its tests.
 */
import type { EngineContext } from '../../engine/context'
import { isLegendarySpecies } from '../../engine/individual'
import { minWildLevel } from '../../engine/waves'
import type { SpawnWeather } from '../../engine/content'
import { spawnRuleMult, type SpawnEnv } from '../../engine/spawn'
import { MIN_SPAWN_SPECIES } from './limits'

export { hourInWindow, spawnRuleMult, spawnWeatherOf, type SpawnEnv } from '../../engine/spawn'

export const COVERAGE_WEATHERS: readonly (SpawnWeather | null)[] = ['rain', 'sun', 'snow', 'clear', null]

export interface CoverageGap {
  /** Trainer level of the band (its first row) and the lowest wild level rolled there. */
  trainerLevel: number
  wildLevel: number
  hour: number
  weather: SpawnWeather | null
  species: number
}

/**
 * Find the hour × weather × band slots with fewer than `MIN_SPAWN_SPECIES`
 * species of weight > 0. Each band is checked at its worst case: its first
 * trainer level and its lowest wild level (the pool only grows with level).
 */
export function spawnCoverageGaps(ctx: EngineContext, minSpecies = MIN_SPAWN_SPECIES): CoverageGap[] {
  const pool = ctx.data.species.filter((s) => !isLegendarySpecies(s)).map((s) => ({ slug: s.slug, min: minWildLevel(s, ctx) }))
  const gaps: CoverageGap[] = []
  const rows = ctx.config.encounters.wildLevelByTrainerLevel
  rows.forEach((row, i) => {
    const trainerLevel = i === 0 ? 1 : row.trainerLevel
    const level = row.min
    let band = pool.filter((s) => s.min <= level)
    // waves.ts falls back to base forms when nothing fits the level.
    if (band.length === 0) band = pool.filter((s) => ctx.speciesBySlug.get(s.slug)?.stage === 1)
    for (let hour = 0; hour < 24; hour++) {
      for (const weather of COVERAGE_WEATHERS) {
        const env: SpawnEnv = { hour, weather, trainerLevel }
        let n = 0
        for (const s of band) if (spawnRuleMult(ctx.spawn.get(s.slug), env) > 0) n++
        if (n < minSpecies) gaps.push({ trainerLevel, wildLevel: level, hour, weather, species: n })
      }
    }
  })
  return gaps
}
