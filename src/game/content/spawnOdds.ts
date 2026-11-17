/**
 * How often a species shows up as a wild, for the Pokédex entry, the event
 * pop-up / page and the admin event editor. Pure and cheap; it never
 * re-implements the spawn formula: probabilities come from `spawnPreview`
 * (src/game/content/preview.ts), i.e. the same weights `waves.ts` rolls with.
 *
 * "Base" odds (the Pokédex number) are the average share of the species among
 * the non-legendary wilds over the whole wild-level band of a trainer level,
 * with NEUTRAL conditions: no live spawn rules and no events (`ctx.spawn` and
 * `ctx.events` ignored), hour 12 and clear weather, and no per-session factors
 * (no active condition types, sound profile, team types or long-session
 * boost). Real encounters move around it: today's conditions favour some types
 * (×2), the team and the sound a little, some species need an hour or
 * weather, and live events change it. It is a guide, not a promise.
 *
 * Species whose final evolution needs a higher wild level (`minWildLevel`) have
 * 0 at low trainer levels; `speciesReach` says from which wild / trainer level
 * they can appear, or that they never do as wilds (evolution only). Legendaries
 * follow their own rule (a rare roll per wild, shared by all of them).
 */
import type { EngineContext } from '../../engine/context'
import type { ResolvedSpawn } from '../../engine/content'
import { isLegendarySpecies } from '../../engine/individual'
import { minWildLevel } from '../../engine/waves'
import type { LeagueId } from '../../engine/config'
import { leagueLadder, stageWeight, stageWeightsForRank, waveSizeForRank, type LeagueRank } from '../../engine/league'
import type { Species } from '../../engine/data-types'
import { spawnPreview } from './preview'

/** Where a species can show up. */
export type SpawnReach =
  /** From this wild level on; `trainerLevel` = the lowest trainer level whose wild band reaches it. */
  | { kind: 'wild'; wildLevel: number; trainerLevel: number }
  /** Not reachable in the wild at any trainer level: only by evolving. */
  | { kind: 'evolution'; wildLevel: number }
  /** Legendary / mythical: a rare roll apart from the normal pool. */
  | { kind: 'legendary' }

/** The base probability of a species at a trainer level, or why there is none. */
export type BaseSpawn =
  | { kind: 'chance'; probability: number }
  | { kind: 'fromLevel'; wildLevel: number; trainerLevel: number }
  /** Its evolution stage does not appear in the player's league yet (GDD §10.2); `league` = the first one that offers it. */
  | { kind: 'fromLeague'; league: LeagueId }
  | { kind: 'evolution' }
  /** `fromLeague`: legendaries do not appear in the player's league; the first league where they do. */
  | { kind: 'legendary'; chance: number; minLevel: number; count: number; fromLeague?: LeagueId }

/** The context with no live rules and no events: the neutral baseline (memoized per context). */
const neutrals = new WeakMap<EngineContext, EngineContext>()
function neutralOf(ctx: EngineContext): EngineContext {
  let n = neutrals.get(ctx)
  if (!n) neutrals.set(ctx, (n = { ...ctx, spawn: new Map(), events: [] }))
  return n
}

type Rank = Pick<LeagueRank, 'league' | 'sub'>
type Shares = Map<string, number>
const sharesCache = new WeakMap<EngineContext, Map<string, Shares>>()
const NEUTRAL_ENV = { hour: 12, weather: 'clear' } as const

/** Probability of every wild species at a trainer level under the neutral conditions (cached per context and level). */
function neutralShares(ctx: EngineContext, trainerLevel: number, rank?: Rank): Shares {
  let byLevel = sharesCache.get(ctx)
  if (!byLevel) sharesCache.set(ctx, (byLevel = new Map()))
  const key = `${trainerLevel}|${rank ? `${rank.league}:${rank.sub}` : ''}`
  let hit = byLevel.get(key)
  if (!hit) {
    const pre = spawnPreview(neutralOf(ctx), { ...NEUTRAL_ENV, trainerLevel, ...(rank && { rank }) })
    hit = new Map(pre.species.map((s) => [s.slug, s.probability]))
    byLevel.set(key, hit)
  }
  return hit
}

/** First league that offers wilds of an evolution stage (`'legendary'`: the legendary roll), or null when none does. */
export function firstLeagueOffering(ctx: EngineContext, what: number | 'legendary'): LeagueId | null {
  for (const r of leagueLadder('week', ctx)) {
    const w = stageWeightsForRank(r, ctx.config)
    if (what === 'legendary' ? w.legendary > 0 : stageWeight(what, w) > 0) return r.league
  }
  return null
}

/** Lowest trainer level whose wild band reaches `wildLevel`, or null when none does. */
export function trainerLevelForWildLevel(ctx: EngineContext, wildLevel: number): number | null {
  const rows = [...ctx.config.encounters.wildLevelByTrainerLevel].sort((a, b) => a.trainerLevel - b.trainerLevel)
  return rows.find((r) => r.max >= wildLevel)?.trainerLevel ?? null
}

/** From which wild / trainer level a species can appear (pure; uses `minWildLevel`). */
export function speciesReach(ctx: EngineContext, sp: Species): SpawnReach {
  if (isLegendarySpecies(sp)) return { kind: 'legendary' }
  const wildLevel = minWildLevel(sp, ctx)
  const trainerLevel = trainerLevelForWildLevel(ctx, wildLevel)
  return trainerLevel === null ? { kind: 'evolution', wildLevel } : { kind: 'wild', wildLevel, trainerLevel }
}

/** Can the species show up as a wild for a trainer of this level? (Legendaries: always, they are a separate roll.) */
export function canAppearAt(reach: SpawnReach, trainerLevel: number): boolean {
  return reach.kind === 'legendary' || (reach.kind === 'wild' && trainerLevel >= reach.trainerLevel)
}

/**
 * Pokédex number: how often a species is the wild, on average, for a trainer
 * level (see the file header for what "base" means).
 */
export function baseSpawn(ctx: EngineContext, slug: string, trainerLevel: number, rank?: Rank): BaseSpawn | null {
  const sp = ctx.speciesBySlug.get(slug)
  if (!sp) return null
  const stages = rank ? stageWeightsForRank(rank, ctx.config) : null
  if (isLegendarySpecies(sp)) {
    const e = ctx.config.encounters
    const from = stages && stages.legendary <= 0 ? firstLeagueOffering(ctx, 'legendary') : null
    return { kind: 'legendary', chance: e.legendaryChance * (stages?.legendary ?? 1), minLevel: e.legendaryMinLevel, count: ctx.data.species.filter(isLegendarySpecies).length, ...(from && { fromLeague: from }) }
  }
  const probability = neutralShares(ctx, trainerLevel, rank).get(slug) ?? 0
  if (probability > 0) return { kind: 'chance', probability }
  const reach = speciesReach(ctx, sp)
  // The level comes first: a league only matters once the wild levels reach the species.
  if (stages && stageWeight(sp.stage, stages) <= 0 && canAppearAt(reach, trainerLevel)) {
    const league = firstLeagueOffering(ctx, sp.stage)
    if (league) return { kind: 'fromLeague', league }
  }
  return reach.kind === 'wild' ? { kind: 'fromLevel', wildLevel: reach.wildLevel, trainerLevel: reach.trainerLevel } : { kind: 'evolution' }
}

export interface FeaturedOdds {
  slug: string
  /** Probability per wild without the event (neutral conditions), 0 when it cannot appear at this level. */
  without: number
  /** With the featured multipliers of the event on top. */
  with: number
  reach: SpawnReach
  /** The species can be a wild at this trainer level. */
  appears: boolean
}

/**
 * What an event's featured multipliers do at a reference trainer level: the
 * probability of each species per wild without and with the event, both under
 * the neutral conditions. All the multipliers apply at once (they compete for
 * the same pool). Legendaries are reported as not applying (`appears` true,
 * 0 / 0): featuring them changes which one appears, not how often.
 */
export function featuredOdds(ctx: EngineContext, featured: readonly { species: string; weightMult: number }[], trainerLevel: number): FeaturedOdds[] {
  const neutral = neutralOf(ctx)
  const rules = new Map<string, ResolvedSpawn>()
  for (const f of featured) if (neutral.speciesBySlug.has(f.species)) rules.set(f.species, { enabled: true, weightMult: f.weightMult })
  const withEvent = new Map(spawnPreview({ ...neutral, spawn: rules }, { ...NEUTRAL_ENV, trainerLevel }).species.map((s) => [s.slug, s.probability]))
  const without = neutralShares(ctx, trainerLevel)
  const out: FeaturedOdds[] = []
  for (const f of featured) {
    const sp = ctx.speciesBySlug.get(f.species)
    if (!sp) continue
    const reach = speciesReach(ctx, sp)
    out.push({ slug: f.species, without: without.get(f.species) ?? 0, with: withEvent.get(f.species) ?? 0, reach, appears: canAppearAt(reach, trainerLevel) })
  }
  return out
}

/** Typical wild count of a wave: the cap of the second league's first subrank (4 with the shipped config). */
export function averageWaveSize(ctx: EngineContext): number {
  const order = ctx.config.leagues.order
  return waveSizeForRank({ league: (order[1] ?? order[0]) as LeagueId, sub: 1 }, ctx.config)
}

/**
 * "On average 1 every K waves": K = 1 / (p × wave size), rounded to a whole
 * number (never under 1; one decimal under 10 would promise precision the
 * estimate does not have).
 */
export function wavesPerAppearance(probability: number, waveSize: number): number | null {
  if (!(probability > 0) || !(waveSize > 0)) return null
  return Math.max(1, Math.round(1 / (probability * waveSize)))
}

/** Trainer level above which a featured species that cannot spawn counts as a risky pick for the admin (validator warning). */
export const FEATURED_REACH_TRAINER_LEVEL = 20

/**
 * Wave sizes the help texts give examples for, from the config: the smallest wave, the biggest one of the
 * top league and the one in between (2, 6 and 10 with the shipped config).
 */
export function exampleWaveSizes(ctx: EngineContext): number[] {
  const caps = leagueLadder('week', ctx).map((r) => waveSizeForRank(r, ctx.config))
  const min = Math.min(...caps)
  const max = Math.max(...caps)
  return [...new Set([min, Math.round((min + max) / 2), max])]
}

/** Above this "1 in N" the number stops being meaningful: it is shown as "fewer than 1 in N". */
export const ONE_IN_MAX = 500

/**
 * A probability as a friendly "1 in N": exact under 10, then rounded to the
 * nearest 5 (under 30) or 10 (so 1.4 % reads "1 in 70", not "1 in 71").
 * `tiny` = rarer than 1 in `ONE_IN_MAX`: show "fewer than 1 in 500".
 */
export function oneInN(probability: number): { n: number; tiny: boolean } | null {
  if (!(probability > 0)) return null
  const raw = 1 / probability
  if (raw > ONE_IN_MAX) return { n: ONE_IN_MAX, tiny: true }
  const step = raw < 10 ? 1 : raw < 30 ? 5 : 10
  return { n: Math.max(1, Math.round(raw / step) * step), tiny: false }
}

/** Chance of at least one of the species in a wave of `size` wild Pokémon: 1 − (1 − p)^size. */
export function atLeastOne(probability: number, size: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, probability)), size)
}
