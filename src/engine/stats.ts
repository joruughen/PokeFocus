/**
 * Stats (GDD §5.1) and their PokeFocus roles.
 *
 *   effectiveBase = pivot + (base − pivot) · k          (statCurves, layer 1 of §20.1)
 *   HP    = floor((2·B + IV) · L / 100) + L + 10
 *   Other = floor((floor((2·B + IV) · L / 100) + 5) · nature)
 *
 * Roles: hp = Energy, speed = Pace, specialAttack = points/action,
 * attack = catch energy, specialDefense = technique multiplier, defense = Grit.
 */
import type { GameConfig } from './config'
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { BaseStats, Nature, StatKey } from './data-types'
import type { IndividualCore } from './state'

export const STAT_KEYS: readonly StatKey[] = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed']

/** Layer-1 curve applied to a species base stat. Never below 1. */
export function effectiveBase(stat: StatKey, base: number, cfg: GameConfig): number {
  const c = cfg.statCurves[stat]
  if (!c) return base
  return Math.max(1, c.pivot + (base - c.pivot) * c.k)
}

export function natureMultiplier(nature: Nature | undefined, stat: StatKey): number {
  if (!nature || stat === 'hp') return 1
  if (nature.increased === stat) return 1.1
  if (nature.decreased === stat) return 0.9
  return 1
}

/** Raw stat formula on an (already transformed) base. */
export function statValue(stat: StatKey, base: number, iv: number, level: number, natureMult = 1): number {
  const core = Math.floor(((2 * base + iv) * level) / 100)
  if (stat === 'hp') return core + level + 10
  return Math.floor((core + 5) * natureMult)
}

/** Final stats of an individual. */
export function computeStats(ind: Pick<IndividualCore, 'speciesSlug' | 'level' | 'ivs' | 'nature'>, ctx: EngineContext = defaultContext()): BaseStats {
  const sp = getSpecies(ind.speciesSlug, ctx)
  const nature = ctx.naturesBySlug.get(ind.nature)
  const out = {} as BaseStats
  for (const k of STAT_KEYS) {
    out[k] = statValue(k, effectiveBase(k, sp.baseStats[k], ctx.config), ind.ivs[k], ind.level, natureMultiplier(nature, k))
  }
  return out
}

/** Max daily energy (= HP stat). */
export function maxEnergyOf(ind: Pick<IndividualCore, 'speciesSlug' | 'level' | 'ivs' | 'nature'>, ctx: EngineContext = defaultContext()): number {
  return computeStats(ind, ctx).hp
}

// --- Roles (GDD §5.1) ------------------------------------------------------

/** Seconds between actions, before `pace` modifiers: 300·60 / (60 + Speed). */
export function actionIntervalSeconds(speed: number, cfg: GameConfig): number {
  const a = cfg.actions
  return (a.intervalBaseSeconds * a.intervalSpeedOffset) / (a.intervalSpeedOffset + speed)
}

/** Points per action before the multiplier M: 5 + SpAtk / 4. */
export function basePointsPerAction(spAtk: number, cfg: GameConfig): number {
  return cfg.actions.pointsBase + spAtk / cfg.actions.pointsSpAtkDivisor
}

/** Catch energy per action: (Atk / 5) · (power / 60). */
export function catchEnergyPerAction(attack: number, power: number, cfg: GameConfig): number {
  return (attack / cfg.actions.energyAtkDivisor) * (power / cfg.actions.energyPowerDivisor)
}

/** Catch energy when no damage technique is equipped: Normal energy at `noDamageMoveEnergyFactor`. */
export function noDamageMoveEnergy(attack: number, cfg: GameConfig): number {
  return (attack / cfg.actions.energyAtkDivisor) * cfg.actions.noDamageMoveEnergyFactor
}

/** Technique multiplier: min(2.0, 0.5 + SpDef / 100). */
export function techniqueMultiplier(spDef: number, cfg: GameConfig): number {
  const a = cfg.actions
  return Math.min(a.techMultMax, a.techMultBase + spDef / a.techMultSpDefDivisor)
}

/** Share of the missing focus that Defense recovers: min(0.5, Def / 400). */
export function defenseFocusShare(defense: number, cfg: GameConfig): number {
  return Math.min(cfg.actions.defenseFocusMaxShare, defense / cfg.actions.defenseFocusDivisor)
}

/** Effective focus: Focus + (1 − Focus) · min(0.5, Def / 400). */
export function effectiveFocus(focus: number, defense: number, cfg: GameConfig): number {
  return focus + (1 - focus) * defenseFocusShare(defense, cfg)
}

/** Energy cost per action: 0.5 + level / 25. */
export function energyCostPerAction(level: number, cfg: GameConfig): number {
  return cfg.energy.costBase + level / cfg.energy.costLevelDivisor
}

/** Bond multiplier: 1 + min(0.20, minutes / 30000). */
export function bondMultiplier(bondMinutes: number, cfg: GameConfig): number {
  return 1 + Math.min(cfg.bond.maxBonus, bondMinutes / cfg.bond.minutesForMax)
}

/** Mastery multiplier for a technique equipped `minutes` minutes. */
export function masteryMultiplier(minutes: number, cfg: GameConfig): number {
  let mult = 1
  for (const t of cfg.progression.mastery) if (minutes >= t.hours * 60) mult = t.mult
  return mult
}

/** Mastery stars (1–5) for a technique equipped `minutes` minutes. */
export function masteryStars(minutes: number, cfg: GameConfig): number {
  let stars = 0
  for (const t of cfg.progression.mastery) if (minutes >= t.hours * 60) stars++
  return Math.max(1, stars)
}
