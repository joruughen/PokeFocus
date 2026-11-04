/**
 * Techniques (GDD §7): which moves exist in PokeFocus, slots and equipping.
 *
 * A move is usable iff it is defined in custom-techniques (passive/activable),
 * or it is a damage move with power > 0 (generic damage technique). Undefined
 * status moves and damage moves with null power do not exist in the game.
 */
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { DamageClass, Species, TypeSlug } from './data-types'
import type { TechniqueDef } from './effect-types'
import type { OwnedPokemon } from './state'

export type TechniqueKind = 'damage' | 'passive' | 'activable'

export interface TechniqueInfo {
  slug: string
  kind: TechniqueKind
  type: TypeSlug
  /** Power (damage techniques only, else 0). */
  power: number
  damageClass: DamageClass
  /** Effect definition (passive/activable only). */
  def: TechniqueDef | null
}

/** Technique info for a move slug, or null if the move doesn't exist in PokeFocus. */
export function getTechnique(slug: string, ctx: EngineContext = defaultContext()): TechniqueInfo | null {
  const move = ctx.movesBySlug.get(slug)
  if (!move) return null
  const def = ctx.techniques[slug]
  if (def) return { slug, kind: def.category, type: move.type, power: 0, damageClass: move.damageClass, def }
  if (move.damageClass !== 'status' && move.power !== null && move.power > 0) {
    return { slug, kind: 'damage', type: move.type, power: move.power, damageClass: move.damageClass, def: null }
  }
  return null
}

export function isUsableMove(slug: string, ctx: EngineContext = defaultContext()): boolean {
  return getTechnique(slug, ctx) !== null
}

/** Number of technique slots at a level (config `progression.techniqueSlots`). */
export function techniqueSlots(level: number, ctx: EngineContext = defaultContext()): number {
  let slots = 0
  for (const t of ctx.config.progression.techniqueSlots) if (level >= t.level) slots = t.slots
  return Math.max(1, slots)
}

function uniq(list: string[]): string[] {
  return [...new Set(list)]
}

/** Usable level-up moves of a species up to `level` (level 0 = on evolving: always counted). */
export function levelUpMovesUpTo(species: Species, level: number, ctx: EngineContext = defaultContext()): string[] {
  return uniq(species.learnset.levelUp.filter((m) => m.level <= level).map((m) => m.move)).filter((m) => isUsableMove(m, ctx))
}

/** Usable level-up moves learned in (fromLevel, toLevel]. */
export function levelUpMovesBetween(species: Species, fromLevel: number, toLevel: number, ctx: EngineContext = defaultContext()): string[] {
  return uniq(
    species.learnset.levelUp.filter((m) => m.level > fromLevel && m.level <= toLevel && m.level > 0).map((m) => m.move),
  ).filter((m) => isUsableMove(m, ctx))
}

/** Candidates for extra moves: usable egg/tutor/machine moves not in the level-up learnset. */
export function extraMoveCandidates(species: Species, ctx: EngineContext = defaultContext()): string[] {
  const levelUp = new Set(species.learnset.levelUp.map((m) => m.move))
  return uniq([...species.learnset.egg, ...species.learnset.tutor, ...species.learnset.machine]).filter(
    (m) => !levelUp.has(m) && isUsableMove(m, ctx),
  )
}

/**
 * Level at which an extra move unlocks (config `progression.extraMoveUnlock`):
 * damage moves max(1, round((power − powerOffset) / powerDivisor)), special
 * techniques `statusLevel`. Null if the move doesn't exist in PokeFocus.
 */
export function extraMoveUnlockLevel(slug: string, ctx: EngineContext = defaultContext()): number | null {
  const t = getTechnique(slug, ctx)
  if (!t) return null
  const u = ctx.config.progression.extraMoveUnlock
  if (t.kind !== 'damage') return u.statusLevel
  return Math.max(1, Math.round((t.power - u.powerOffset) / u.powerDivisor))
}

/** Extra moves already unlocked at the Pokémon's level (usable only). */
export function unlockedExtraMoves(p: Pick<OwnedPokemon, 'extraMoves' | 'level'>, ctx: EngineContext = defaultContext()): string[] {
  return p.extraMoves.filter((m) => {
    const lvl = extraMoveUnlockLevel(m, ctx)
    return lvl !== null && p.level >= lvl
  })
}

/** Extra moves still locked, with their unlock level (for "unlocks at level X"). */
export function lockedExtraMoves(
  p: Pick<OwnedPokemon, 'extraMoves' | 'level'>,
  ctx: EngineContext = defaultContext(),
): { move: string; unlockLevel: number }[] {
  const out: { move: string; unlockLevel: number }[] = []
  for (const m of p.extraMoves) {
    const lvl = extraMoveUnlockLevel(m, ctx)
    if (lvl !== null && p.level < lvl) out.push({ move: m, unlockLevel: lvl })
  }
  return out
}

/**
 * Moves the Pokémon can equip: learned level-up moves + extra moves unlocked
 * at its level, usable only. Without `level`, all extra moves count (legacy).
 */
export function equippableMoves(
  p: Pick<OwnedPokemon, 'learnedMoves' | 'extraMoves'> & { level?: number },
  ctx: EngineContext = defaultContext(),
): string[] {
  const extras = p.level === undefined ? p.extraMoves : unlockedExtraMoves({ extraMoves: p.extraMoves, level: p.level }, ctx)
  return uniq([...p.learnedMoves, ...extras]).filter((m) => isUsableMove(m, ctx))
}

/**
 * Default loadout: the strongest damage move (STAB breaks ties) first, then
 * special techniques, then other damage moves, up to the slot count.
 */
export function defaultEquipped(
  speciesSlug: string,
  moves: string[],
  level: number,
  ctx: EngineContext = defaultContext(),
): string[] {
  const sp = getSpecies(speciesSlug, ctx)
  const infos = moves.map((m) => getTechnique(m, ctx)).filter((t): t is TechniqueInfo => t !== null)
  const score = (t: TechniqueInfo) => t.power * (sp.types.includes(t.type) ? 1.5 : 1)
  const damage = infos.filter((t) => t.kind === 'damage').sort((a, b) => score(b) - score(a))
  const special = infos.filter((t) => t.kind !== 'damage')
  const ordered = [...damage.slice(0, 1), ...special, ...damage.slice(1)].map((t) => t.slug)
  return uniq(ordered).slice(0, techniqueSlots(level, ctx))
}

export type EquipError = 'too_many_moves' | 'duplicate_move' | 'move_not_known' | 'move_not_usable' | 'move_locked'

/** Validate a loadout for a Pokémon. Returns null if valid. */
export function validateEquip(p: OwnedPokemon, moves: string[], ctx: EngineContext = defaultContext()): EquipError | null {
  if (moves.length > techniqueSlots(p.level, ctx)) return 'too_many_moves'
  if (new Set(moves).size !== moves.length) return 'duplicate_move'
  const known = new Set([...p.learnedMoves, ...p.extraMoves])
  const unlocked = new Set([...p.learnedMoves, ...unlockedExtraMoves(p, ctx)])
  for (const m of moves) {
    if (!isUsableMove(m, ctx)) return 'move_not_usable'
    if (!known.has(m)) return 'move_not_known'
    if (!unlocked.has(m)) return 'move_locked'
  }
  return null
}
