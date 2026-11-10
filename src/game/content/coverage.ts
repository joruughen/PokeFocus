/**
 * Spawn coverage (docs/admin-plan.md §2): for every local hour × weather ×
 * wild-level band, the non-legendary pool must keep at least
 * `MIN_SPAWN_SPECIES` species with weight > 0.
 *
 * `spawnRuleMult` mirrors the rule E7 will wire into `waves.ts`
 * (`spawnMultiplier` in src/engine/spawn.ts): 0 when the species is disabled,
 * outside its hours/weather, or below its trainer level; else `weightMult`.
 * A weather-restricted species does not appear when the weather is unknown.
 * When E7 lands, this should import the engine helper instead.
 */
import type { EngineContext } from '../../engine/context'
import { isLegendarySpecies } from '../../engine/individual'
import { minWildLevel } from '../../engine/waves'
import type { ResolvedSpawn, SpawnWeather } from '../../engine/content'
import type { WeatherInput } from '../../engine/state'
import { MIN_SPAWN_SPECIES } from './limits'

export interface SpawnEnv {
  /** Local hour 0–23. */
  hour: number
  /** null = unknown weather. */
  weather: SpawnWeather | null
  trainerLevel: number
}

/** The weather tag of a session ('clear' = known and neither rain, sun nor snow). */
export function spawnWeatherOf(w: WeatherInput | null): SpawnWeather | null {
  if (!w) return null
  if (w.rain) return 'rain'
  if (w.snow) return 'snow'
  if (w.sun) return 'sun'
  return 'clear'
}

/** Is `hour` inside `[from, to)` (wrapping midnight when from > to)? */
export function hourInWindow(hour: number, [from, to]: readonly [number, number]): boolean {
  return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

/** Spawn weight multiplier of a rule (undefined rule = 1). */
export function spawnRuleMult(rule: ResolvedSpawn | undefined, env: SpawnEnv): number {
  if (!rule) return 1
  if (!rule.enabled) return 0
  if (rule.hours && !rule.hours.some((w) => hourInWindow(env.hour, w))) return 0
  if (rule.weather && (env.weather === null || !rule.weather.includes(env.weather))) return 0
  if (rule.minTrainerLevel !== undefined && env.trainerLevel < rule.minTrainerLevel) return 0
  return rule.weightMult
}

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
