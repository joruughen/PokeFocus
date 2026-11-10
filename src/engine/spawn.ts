/**
 * Live spawn rules and event hooks (docs/admin-plan.md §6 «Enganches en src/engine»).
 *
 * - `spawnRuleMult` / `spawnMultiplier`: the admin spawn rules of `ctx.spawn`
 *   (enabled, hour windows, weather, minimum trainer level) and the weight
 *   multiplier (admin × featured species of the active events). The content
 *   validator's coverage check (src/game/content/coverage.ts) uses this same rule.
 * - `shinyChanceFor`, `legendaryChanceFor`: the event shiny and legendary odds.
 * - `rollEventDrops`: event drops per wave, with an RNG derived from the
 *   session id and the event id (never the session's main RNG).
 *
 * Golden rule: with no spawn rules and no events every helper returns the
 * plain config value (no `×1`, no RNG draw), so sessions, claims and throws
 * stay bit-identical to the engine without live content.
 */
import { defaultContext, type EngineContext } from './context'
import type { ResolvedSpawn, SpawnWeather } from './content'
import type { Species } from './data-types'
import { chance, createRng } from './rng'
import type { WeatherInput } from './state'

/** What a spawn rule depends on. */
export interface SpawnEnv {
  /** Local hour 0–23 of the session start; null = unknown (a species limited to some hours does not appear). */
  hour: number | null
  /** null = unknown weather (a species limited to some weather does not appear). */
  weather: SpawnWeather | null
  trainerLevel: number
}

/** The weather tag of a session ('clear' = known and neither rain, sun nor snow). */
export function spawnWeatherOf(w: WeatherInput | null | undefined): SpawnWeather | null {
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

/**
 * Spawn weight multiplier of a rule (undefined rule = 1): 0 when the species
 * is disabled, outside its hours or weather (unknown hour/weather included),
 * or below its trainer level; else `weightMult` (featured multipliers included).
 */
export function spawnRuleMult(rule: ResolvedSpawn | undefined, env: SpawnEnv): number {
  if (!rule) return 1
  if (!rule.enabled) return 0
  if (rule.hours && (env.hour === null || !rule.hours.some((w) => hourInWindow(env.hour as number, w)))) return 0
  if (rule.weather && (env.weather === null || !rule.weather.includes(env.weather))) return 0
  if (rule.minTrainerLevel !== undefined && env.trainerLevel < rule.minTrainerLevel) return 0
  return rule.weightMult
}

/** `spawnRuleMult` of a species under `ctx.spawn`. */
export function spawnMultiplier(slug: string, env: SpawnEnv, ctx: EngineContext = defaultContext()): number {
  return spawnRuleMult(ctx.spawn.get(slug), env)
}

/** Is the species featured by an active event of `ctx`? */
export function isFeatured(slug: string, ctx: EngineContext = defaultContext()): boolean {
  return ctx.events.some((ev) => (ev.featured ?? []).some((f) => f.species === slug))
}

/**
 * Base shiny chance of a species (before the session Focus factor): the
 * config one, or the highest event shiny that covers it (scope `all`, or
 * `featured` and the species is featured by that event) if higher.
 */
export function shinyChanceFor(sp: Pick<Species, 'slug'>, ctx: EngineContext = defaultContext()): number {
  let p = ctx.config.encounters.shinyChance
  for (const ev of ctx.events) {
    const s = ev.shiny
    if (!s || s.chance <= p) continue
    if (s.scope === 'all' || (ev.featured ?? []).some((f) => f.species === sp.slug)) p = s.chance
  }
  return p
}

/** Base legendary chance per wild (before Focus and long-session factors): config × every active event's `legendaryChanceMult`. */
export function legendaryChanceFor(ctx: EngineContext = defaultContext()): number {
  let p = ctx.config.encounters.legendaryChance
  for (const ev of ctx.events) if (ev.legendaryChanceMult !== undefined) p *= ev.legendaryChanceMult
  return p
}

/** Event items dropped in a session, per event (absent when nothing dropped). */
export type EventDrops = Record<string, number>

/**
 * Event drops of a session with `waves` waves: for every active event, wave
 * and drop (in order), the item drops with `perWaveChance` until `max` per
 * session. RNG derived from `${sessionId}|drops|${eventId}`, so the session's
 * main RNG is never touched. Returns `{}` with no events, drops or waves.
 */
export function rollEventDrops(sessionId: string, waves: number, ctx: EngineContext = defaultContext()): EventDrops {
  const out: EventDrops = {}
  if (waves <= 0) return out
  for (const ev of ctx.events) {
    const drops = ev.drops ?? []
    if (drops.length === 0) continue
    const rng = createRng(`${sessionId}|drops|${ev.id}`)
    const got = new Map<string, number>()
    for (let w = 0; w < waves; w++) {
      for (const d of drops) {
        const n = got.get(d.item) ?? 0
        if (n >= d.max) continue
        if (chance(rng, d.perWaveChance)) got.set(d.item, n + 1)
      }
    }
    for (const [item, n] of got) if (n > 0) out[item] = (out[item] ?? 0) + n
  }
  return out
}
