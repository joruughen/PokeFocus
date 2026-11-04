/**
 * Progression (GDD §12): EXP curve, level caps, candies/dust, trainer level,
 * level-up move learning and evolution eligibility.
 */
import { defaultContext, getSpecies, getSpeciesById, type EngineContext } from './context'
import { isDaylight } from './conditions'
import type { Evolution, Species } from './data-types'
import { levelUpMovesBetween, unlockedExtraMoves } from './moves'
import type { OwnedPokemon, PlayerState } from './state'
import { maxEnergyOf } from './stats'
import { toLocal } from './time'

/** Total EXP to reach level L: round(coef · L^exponent). */
export function expForLevel(level: number, ctx: EngineContext = defaultContext()): number {
  const { coef, exponent } = ctx.config.progression.expCurve
  return Math.round(coef * Math.pow(level, exponent))
}

/** Level reached with `exp` total EXP (ignoring caps), 1..maxLevel. */
export function levelFromExp(exp: number, ctx: EngineContext = defaultContext()): number {
  const max = ctx.config.progression.maxLevel
  let lvl = 1
  while (lvl < max && expForLevel(lvl + 1, ctx) <= exp) lvl++
  return lvl
}

/** Level cap from the number of distinct species caught (GDD §12.5). */
export function levelCapFor(speciesCaught: number, ctx: EngineContext = defaultContext()): number {
  let cap = 1
  for (const c of ctx.config.progression.levelCaps) if (speciesCaught >= c.species) cap = Math.max(cap, c.cap)
  return Math.min(cap, ctx.config.progression.maxLevel)
}

export function levelCap(state: PlayerState, ctx: EngineContext = defaultContext()): number {
  return levelCapFor(state.pokedex.caught.length, ctx)
}

/** Dust per candy: 25 + 3 · current level. */
export function candyDustCost(level: number, ctx: EngineContext = defaultContext()): number {
  const p = ctx.config.progression
  return p.candyDustBase + p.candyDustPerLevel * level
}

/** Bond bonus (0..maxBonus). */
export function bondBonus(bondMinutes: number, ctx: EngineContext = defaultContext()): number {
  return Math.min(ctx.config.bond.maxBonus, bondMinutes / ctx.config.bond.minutesForMax)
}

// --- Trainer level -----------------------------------------------------------

/** Trainer EXP for level L: round(coef · (L − 1)^exponent). */
export function trainerExpForLevel(level: number, ctx: EngineContext = defaultContext()): number {
  const t = ctx.config.trainer
  return Math.round(t.expCoef * Math.pow(Math.max(0, level - 1), t.expExponent))
}

export function trainerLevelFromExp(exp: number, ctx: EngineContext = defaultContext()): number {
  let lvl = 1
  while (lvl < ctx.config.trainer.maxLevel && trainerExpForLevel(lvl + 1, ctx) <= exp) lvl++
  return lvl
}

// --- Level ups ---------------------------------------------------------------

export type ProgressEvent =
  /** `newMoves`: level-up moves learned plus extra moves unlocked by this level up. */
  | { type: 'levelUp'; uid: string; from: number; to: number; newMoves: string[]; slotsUnlocked: boolean }
  | { type: 'evolutionAvailable'; uid: string; to: string; trigger: Evolution['trigger'] }
  | { type: 'levelCapped'; uid: string; cap: number }
  | { type: 'trainerLevelUp'; from: number; to: number }
  | { type: 'leagueUp'; from: string; to: string }

/**
 * Add EXP to a Pokémon (pure). EXP keeps accumulating, but the level never
 * exceeds `cap`; when the cap rises the Pokémon levels up on its next EXP gain.
 */
export function gainExp(
  p: OwnedPokemon,
  amount: number,
  cap: number,
  ctx: EngineContext = defaultContext(),
): { pokemon: OwnedPokemon; events: ProgressEvent[] } {
  const maxExp = expForLevel(ctx.config.progression.maxLevel, ctx)
  const exp = Math.min(maxExp, p.exp + Math.max(0, Math.round(amount)))
  const target = Math.max(p.level, Math.min(cap, levelFromExp(exp, ctx)))
  const events: ProgressEvent[] = []
  let next: OwnedPokemon = { ...p, exp }
  if (target > p.level) {
    next = applyLevel(next, target, ctx)
    const sp = getSpecies(p.speciesSlug, ctx)
    const oldExtras = unlockedExtraMoves(p, ctx)
    const newMoves = [
      ...next.learnedMoves.filter((m) => !p.learnedMoves.includes(m)),
      ...unlockedExtraMoves(next, ctx).filter((m) => !oldExtras.includes(m) && !next.learnedMoves.includes(m)),
    ]
    events.push({ type: 'levelUp', uid: p.uid, from: p.level, to: target, newMoves, slotsUnlocked: slotsChanged(p.level, target, ctx) })
    for (const e of sp.evolutions) {
      if (e.trigger === 'level' && e.minLevel !== undefined && p.level < e.minLevel && target >= e.minLevel) {
        events.push({ type: 'evolutionAvailable', uid: p.uid, to: getSpeciesById(e.to, ctx).slug, trigger: 'level' })
      }
    }
  }
  if (levelFromExp(exp, ctx) > cap && next.level >= cap) events.push({ type: 'levelCapped', uid: p.uid, cap })
  return { pokemon: next, events }
}

function slotsChanged(from: number, to: number, ctx: EngineContext): boolean {
  return ctx.config.progression.techniqueSlots.some((s) => s.level > from && s.level <= to)
}

/** Set a new level: learns level-up moves and raises current energy by the max-energy gain. */
export function applyLevel(p: OwnedPokemon, level: number, ctx: EngineContext = defaultContext()): OwnedPokemon {
  const sp = getSpecies(p.speciesSlug, ctx)
  const oldMax = maxEnergyOf(p, ctx)
  const learned = [...new Set([...p.learnedMoves, ...levelUpMovesBetween(sp, p.level, level, ctx)])]
  const next = { ...p, level, learnedMoves: learned }
  const newMax = maxEnergyOf(next, ctx)
  next.energy = { ...p.energy, current: Math.min(newMax, p.energy.current + Math.max(0, newMax - oldMax)) }
  return next
}

// --- Evolution ---------------------------------------------------------------

export type EvolutionBlock =
  | 'level_too_low'
  | 'missing_item'
  | 'bond_too_low'
  | 'wrong_time_of_day'
  | 'trade_unavailable'
  | 'unsupported'

export interface EvolutionOption {
  to: string
  evolution: Evolution
  /** Null if it can evolve now. */
  blockedBy: EvolutionBlock | null
}

/** Evolution options for a Pokémon right now (`now` decides the time of day). */
export function evolutionOptions(
  state: PlayerState,
  p: OwnedPokemon,
  now: number,
  ctx: EngineContext = defaultContext(),
): EvolutionOption[] {
  const sp: Species = getSpecies(p.speciesSlug, ctx)
  const hour = toLocal(now, state.profile.timezone).hour
  return sp.evolutions.map((e) => {
    const to = getSpeciesById(e.to, ctx).slug
    let blockedBy: EvolutionBlock | null = null
    if (e.trigger === 'level') {
      if (p.level < (e.minLevel ?? 1)) blockedBy = 'level_too_low'
    } else if (e.trigger === 'item') {
      if (!e.item || (state.inventory[e.item] ?? 0) <= 0) blockedBy = 'missing_item'
    } else if (e.trigger === 'friendship') {
      if (bondBonus(p.bondMinutes, ctx) < ctx.config.bond.friendshipEvolutionBond) blockedBy = 'bond_too_low'
      else if (e.timeOfDay === 'day' && !isDaylight(hour, ctx.config)) blockedBy = 'wrong_time_of_day'
      // 'night' (and 'dusk') = any time outside daylight (05–18).
      else if ((e.timeOfDay === 'night' || e.timeOfDay === 'dusk') && isDaylight(hour, ctx.config)) blockedBy = 'wrong_time_of_day'
    } else if (e.trigger === 'trade') {
      blockedBy = 'trade_unavailable'
    } else {
      blockedBy = 'unsupported'
    }
    return { to, evolution: e, blockedBy }
  })
}
