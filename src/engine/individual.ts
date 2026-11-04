/**
 * Individuals (GDD §6): IVs, nature, ability, shiny, extra moves.
 */
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { BaseStats, Species } from './data-types'
import { defaultEquipped, equippableMoves, extraMoveCandidates, levelUpMovesUpTo } from './moves'
import { chance, pick, randInt, sample, type Rng } from './rng'
import type { BallSlug } from './config'
import type { IndividualCore, OwnedPokemon } from './state'
import { maxEnergyOf, STAT_KEYS } from './stats'
import { expForLevel } from './progression'

export function isLegendarySpecies(sp: Species): boolean {
  return sp.isLegendary || sp.isMythical
}

/** IVs 0..ivMax; legendaries/mythicals get `legendaryPerfectIvs` random stats at ivMax. */
export function rollIvs(rng: Rng, legendary: boolean, ctx: EngineContext = defaultContext()): BaseStats {
  const max = ctx.config.progression.ivMax
  const ivs = {} as BaseStats
  for (const k of STAT_KEYS) ivs[k] = randInt(rng, 0, max)
  if (legendary) for (const k of sample(rng, STAT_KEYS, ctx.config.progression.legendaryPerfectIvs)) ivs[k] = max
  return ivs
}

export function rollNature(rng: Rng, ctx: EngineContext = defaultContext()): string {
  return pick(rng, ctx.data.natures).slug
}

/** Defined abilities of a species (only those present in custom-abilities). */
export function definedAbilities(sp: Species, ctx: EngineContext = defaultContext()): { slug: string; isHidden: boolean }[] {
  return sp.abilities.filter((a) => ctx.abilities[a.slug] !== undefined)
}

/** Ability roll among defined ones; the hidden one with `hiddenAbilityChance` (if defined). */
export function rollAbility(sp: Species, rng: Rng, ctx: EngineContext = defaultContext()): string | null {
  const defined = definedAbilities(sp, ctx)
  if (defined.length === 0) return null
  const normal = defined.filter((a) => !a.isHidden)
  const hidden = defined.filter((a) => a.isHidden)
  if (hidden.length > 0 && (normal.length === 0 || chance(rng, ctx.config.progression.hiddenAbilityChance))) {
    return pick(rng, hidden).slug
  }
  return pick(rng, normal).slug
}

export function rollExtraMoves(sp: Species, rng: Rng, ctx: EngineContext = defaultContext()): string[] {
  const [min, max] = ctx.config.progression.extraMovesPerIndividual
  return sample(rng, extraMoveCandidates(sp, ctx), randInt(rng, min, max))
}

export interface CreateIndividualOptions {
  shiny?: boolean
  nature?: string
}

/** Roll a new individual of a species at a level. */
export function createIndividual(
  speciesSlug: string,
  level: number,
  rng: Rng,
  opts: CreateIndividualOptions = {},
  ctx: EngineContext = defaultContext(),
): IndividualCore {
  const sp = getSpecies(speciesSlug, ctx)
  const ivs = rollIvs(rng, isLegendarySpecies(sp), ctx)
  const nature = opts.nature ?? rollNature(rng, ctx)
  const ability = rollAbility(sp, rng, ctx)
  const extraMoves = rollExtraMoves(sp, rng, ctx)
  return { speciesSlug, level, ivs, nature, ability, isShiny: opts.shiny ?? false, extraMoves }
}

/** Turn an individual into an owned Pokémon (full energy, learned moves, default loadout). */
export function toOwnedPokemon(
  core: IndividualCore,
  uid: string,
  now: number,
  ball: OwnedPokemon['caughtBall'] | BallSlug,
  ctx: EngineContext = defaultContext(),
): OwnedPokemon {
  const sp = getSpecies(core.speciesSlug, ctx)
  const learnedMoves = levelUpMovesUpTo(sp, core.level, ctx)
  const equippedMoves = defaultEquipped(core.speciesSlug, equippableMoves({ learnedMoves, extraMoves: core.extraMoves, level: core.level }, ctx), core.level, ctx)
  return {
    speciesSlug: core.speciesSlug,
    level: core.level,
    ivs: { ...core.ivs },
    nature: core.nature,
    ability: core.ability,
    isShiny: core.isShiny,
    extraMoves: [...core.extraMoves],
    uid,
    exp: expForLevel(core.level, ctx),
    bondMinutes: 0,
    learnedMoves,
    equippedMoves,
    moveMasteryMinutes: {},
    energy: { current: maxEnergyOf(core, ctx), updatedAt: now },
    asleepNextSession: false,
    teraType: null,
    teraUntil: null,
    teraSessionsLeft: 0,
    caughtAt: now,
    caughtBall: ball,
    metLevel: core.level,
  }
}

/**
 * IV quality of an individual (GDD §6.1), for the box sort, the detail sheet
 * and the wild "reveal IVs" effect. `tier` 0–4: 0 under 25% of the max total,
 * 1 under 50%, 2 under 75%, 3 under 95%, 4 from 95% (near perfect).
 * `best` lists the stats at ivMax.
 */
export function ivQuality(ivs: BaseStats, ctx: EngineContext = defaultContext()): { total: number; max: number; fraction: number; tier: 0 | 1 | 2 | 3 | 4; best: (keyof BaseStats)[] } {
  const ivMax = ctx.config.progression.ivMax
  const keys = Object.keys(ivs) as (keyof BaseStats)[]
  const total = keys.reduce((a, k) => a + ivs[k], 0)
  const max = ivMax * 6
  const fraction = max > 0 ? total / max : 0
  const tier = fraction >= 0.95 ? 4 : fraction >= 0.75 ? 3 : fraction >= 0.5 ? 2 : fraction >= 0.25 ? 1 : 0
  return { total, max, fraction, tier, best: keys.filter((k) => ivs[k] >= ivMax) }
}
