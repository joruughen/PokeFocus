/**
 * Read-only derived views for the UI (no state changes).
 */
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { BaseStats, Species, TypeSlug } from './data-types'
import { energyAt } from './energy'
import { equippableMoves, extraMoveUnlockLevel, getTechnique, lockedExtraMoves, techniqueSlots, type TechniqueInfo } from './moves'
import { bondBonus, evolutionOptions, expForLevel, type EvolutionOption } from './progression'
import type { OwnedPokemon, PlayerState } from './state'
import {
  actionIntervalSeconds,
  basePointsPerAction,
  computeStats,
  defenseFocusShare,
  energyCostPerAction,
  masteryMultiplier,
  masteryStars,
  techniqueMultiplier,
} from './stats'

export interface PokemonView {
  pokemon: OwnedPokemon
  species: Species
  types: TypeSlug[]
  stats: BaseStats
  /** Energy right now (daily reset / box regen applied) and max. */
  energy: number
  maxEnergy: number
  /** Role-derived numbers (before effects/conditions). */
  actionIntervalSeconds: number
  pointsPerAction: number
  techniqueMultiplier: number
  defenseFocusShare: number
  energyCostPerAction: number
  /** Approx. actions left today with current energy. */
  actionsLeft: number
  bondBonus: number
  slots: number
  equipped: TechniqueInfo[]
  /** Moves it can equip (learned + unlocked extra moves, usable only). */
  equippable: TechniqueInfo[]
  /** Extra moves not unlocked yet, with the level they unlock at ("se desbloquea al nivel X"). */
  lockedExtraMoves: { technique: TechniqueInfo; unlockLevel: number }[]
  /** All extra moves of the individual with their unlock level and whether they are unlocked. */
  extraMoves: { technique: TechniqueInfo; unlockLevel: number; unlocked: boolean }[]
  mastery: Record<string, { minutes: number; stars: number; mult: number }>
  expIntoLevel: number
  expForNextLevel: number
  evolutions: EvolutionOption[]
}

export function pokemonView(state: PlayerState, uid: string, now: number, ctx: EngineContext = defaultContext()): PokemonView | null {
  const p = state.pokemon[uid]
  if (!p) return null
  const cfg = ctx.config
  const species = getSpecies(p.speciesSlug, ctx)
  const stats = computeStats(p, ctx)
  const info = (m: string) => getTechnique(m, ctx)
  const isInfo = (t: TechniqueInfo | null): t is TechniqueInfo => t !== null
  const energy = energyAt(state, p, now, ctx)
  const cost = energyCostPerAction(p.level, cfg)
  const mastery: PokemonView['mastery'] = {}
  for (const m of equippableMoves(p, ctx)) {
    const minutes = p.moveMasteryMinutes[m] ?? 0
    mastery[m] = { minutes, stars: masteryStars(minutes, cfg), mult: masteryMultiplier(minutes, cfg) }
  }
  return {
    pokemon: p,
    species,
    types: species.types,
    stats,
    energy,
    maxEnergy: stats.hp,
    actionIntervalSeconds: actionIntervalSeconds(stats.speed, cfg),
    pointsPerAction: basePointsPerAction(stats.specialAttack, cfg),
    techniqueMultiplier: techniqueMultiplier(stats.specialDefense, cfg),
    defenseFocusShare: defenseFocusShare(stats.defense, cfg),
    energyCostPerAction: cost,
    actionsLeft: Math.ceil(energy / cost),
    bondBonus: bondBonus(p.bondMinutes, ctx),
    slots: techniqueSlots(p.level, ctx),
    equipped: p.equippedMoves.map(info).filter(isInfo),
    equippable: equippableMoves(p, ctx).map(info).filter(isInfo),
    lockedExtraMoves: lockedExtraMoves(p, ctx).flatMap(({ move, unlockLevel }) => {
      const t = info(move)
      return t ? [{ technique: t, unlockLevel }] : []
    }),
    extraMoves: p.extraMoves.flatMap((m) => {
      const t = info(m)
      const lvl = extraMoveUnlockLevel(m, ctx)
      return t && lvl !== null ? [{ technique: t, unlockLevel: lvl, unlocked: p.level >= lvl }] : []
    }),
    mastery,
    expIntoLevel: p.exp - expForLevel(p.level, ctx),
    expForNextLevel: expForLevel(p.level + 1, ctx) - expForLevel(p.level, ctx),
    evolutions: evolutionOptions(state, p, now, ctx),
  }
}
