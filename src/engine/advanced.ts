/**
 * Advanced items (phase F4, GDD §6.1–6.3, §7, §9.4): Terastallization, TMs,
 * Mints, Bottle Caps and the Ability Capsule. Pure reducers: each one checks
 * the trainer-level unlock (`config.advanced`), the item in the inventory and
 * the rule of its item, spends one use and changes one Pokémon. None of them
 * touches an RNG, and all are refused for a member of the active session.
 */
import { ALL_TYPES } from './conditions'
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { NatureStatKey, StatKey, TypeSlug } from './data-types'
import { definedAbilities } from './individual'
import { equippableMoves, isUsableMove } from './moves'
import { err, ok, type OwnedPokemon, type PlayerState, type Result } from './state'
import { effectiveNature, maxEnergyOf, STAT_KEYS } from './stats'

/**
 * Item slugs. Mission rewards give the `choice-mint` ("Mint of your choice": the player picks the target nature
 * when using it). The 21 `<nature>-mint` items (real PokeAPI slugs, one per target nature) still work for anyone
 * who already owns one.
 */
export const CHOICE_MINT = 'choice-mint'
export const TERA_SHARD = 'tera-shard'
export const TECHNICAL_MACHINE = 'technical-machine'
export const BOTTLE_CAP = 'bottle-cap'
export const ABILITY_CAPSULE = 'ability-capsule'

/** The advanced uses that a trainer level unlocks (TMs have no lock). */
export type AdvancedUnlock = 'tera' | 'mint' | 'bottleCap' | 'abilityCapsule'
export const ADVANCED_UNLOCKS: readonly AdvancedUnlock[] = ['mint', 'tera', 'bottleCap', 'abilityCapsule']

export type AdvancedError =
  | 'unknown_pokemon'
  | 'session_active'
  | 'trainer_level_too_low'
  | 'no_item'
  | 'invalid_type'
  | 'same_type'
  | 'move_not_compatible'
  | 'move_already_known'
  | 'invalid_nature'
  | 'same_nature'
  | 'invalid_stat'
  | 'iv_maxed'
  | 'invalid_ability'
  | 'same_ability'
  | 'no_other_ability'

// ---------------------------------------------------------------------------
// Queries (UI and reducers)
// ---------------------------------------------------------------------------

/** Trainer level that unlocks a use (`config.advanced.<kind>.minTrainerLevel`). */
export function unlockLevel(kind: AdvancedUnlock, ctx: EngineContext = defaultContext()): number {
  return ctx.config.advanced?.[kind]?.minTrainerLevel ?? 1
}

export function isUnlocked(state: Pick<PlayerState, 'trainer'>, kind: AdvancedUnlock, ctx: EngineContext = defaultContext()): boolean {
  return state.trainer.level >= unlockLevel(kind, ctx)
}

/** The mint item that sets `nature`'s effect. */
export function mintItem(nature: string): string {
  return `${nature}-mint`
}

/** Any mint item: the choice mint or the mint of a known nature. */
export function isMintItem(slug: string, ctx: EngineContext = defaultContext()): boolean {
  return slug === CHOICE_MINT || mintNatureOf(slug, ctx) !== null
}

/**
 * The mint item `useMint` would spend to set `nature`: the specific `<nature>-mint` if the player has one (legacy
 * stock first), else a `choice-mint`; null when they have neither.
 */
export function mintSourceFor(state: Pick<PlayerState, 'inventory'>, nature: string): string | null {
  if ((state.inventory[mintItem(nature)] ?? 0) > 0) return mintItem(nature)
  return (state.inventory[CHOICE_MINT] ?? 0) > 0 ? CHOICE_MINT : null
}

/** Target nature of a mint item slug, or null if it is not a mint of a known nature. */
export function mintNatureOf(slug: string, ctx: EngineContext = defaultContext()): string | null {
  const m = /^(.+)-mint$/.exec(slug)
  return m && ctx.naturesBySlug.has(m[1] as string) ? (m[1] as string) : null
}

/** Active Tera type at `at` (ms), or null: not used, or expired by time or sessions. */
export function activeTera(p: Pick<OwnedPokemon, 'teraType' | 'teraUntil' | 'teraSessionsLeft'>, at: number): TypeSlug | null {
  return p.teraType && p.teraUntil !== null && at < p.teraUntil && p.teraSessionsLeft > 0 ? p.teraType : null
}

/** Tera types that can be chosen: any of the 18, except the one a single-type species already has. */
export function teraChoices(p: Pick<OwnedPokemon, 'speciesSlug'>, ctx: EngineContext = defaultContext()): TypeSlug[] {
  const types = getSpecies(p.speciesSlug, ctx).types
  return ALL_TYPES.filter((t) => !(types.length === 1 && types[0] === t))
}

/** TM moves the species can learn (PokeAPI `machine` learnset) that exist in PokeFocus and it cannot equip yet. */
export function tmCandidates(p: Pick<OwnedPokemon, 'speciesSlug' | 'learnedMoves' | 'extraMoves' | 'level'>, ctx: EngineContext = defaultContext()): string[] {
  const known = new Set(equippableMoves(p, ctx))
  const machine = getSpecies(p.speciesSlug, ctx).learnset.machine
  return [...new Set(machine)].filter((m) => isUsableMove(m, ctx) && !known.has(m)).sort()
}

/** Natures a mint can set: those whose effect differs from the current effect (the original one = remove the mint). */
export function mintChoices(p: Pick<OwnedPokemon, 'nature' | 'mintNature'>, ctx: EngineContext = defaultContext()): string[] {
  const cur = ctx.naturesBySlug.get(effectiveNature(p))
  return ctx.data.natures.filter((n) => !(n.increased === (cur?.increased ?? null) && n.decreased === (cur?.decreased ?? null))).map((n) => n.slug)
}

/** Stats whose IV is below the max (where a Bottle Cap works). */
export function bottleCapStats(p: Pick<OwnedPokemon, 'ivs'>, ctx: EngineContext = defaultContext()): StatKey[] {
  return STAT_KEYS.filter((k) => p.ivs[k] < ctx.config.progression.ivMax)
}

/** Abilities the capsule can switch to: the species' other defined, non-hidden abilities (GDD §6.3). */
export function abilityCapsuleChoices(p: Pick<OwnedPokemon, 'speciesSlug' | 'ability'>, ctx: EngineContext = defaultContext()): string[] {
  return definedAbilities(getSpecies(p.speciesSlug, ctx), ctx)
    .filter((a) => !a.isHidden && a.slug !== p.ability)
    .map((a) => a.slug)
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

function target(state: PlayerState, uid: string): Result<OwnedPokemon, AdvancedError> {
  const p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (state.activeSession?.teamUids.includes(uid)) return err('session_active')
  return ok(p)
}

function spend(state: PlayerState, item: string, n: number, uid: string, p: OwnedPokemon): PlayerState {
  return { ...state, inventory: { ...state.inventory, [item]: (state.inventory[item] ?? 0) - n }, pokemon: { ...state.pokemon, [uid]: p } }
}

const has = (state: PlayerState, item: string, n = 1) => (state.inventory[item] ?? 0) >= n

/**
 * Terastallize (GDD §9.4): spend `tera.shardCost` Tera Shards to set one type for its conditions during
 * `tera.hours` hours or `tera.sessions` sessions, whichever ends first. Using it again replaces the type
 * and restarts both counters. Techniques keep their own type.
 */
export function useTera(state: PlayerState, uid: string, type: TypeSlug, now: number, ctx: EngineContext = defaultContext()): Result<PlayerState, AdvancedError> {
  const t = target(state, uid)
  if (!t.ok) return t
  const p = t.value
  const cfg = ctx.config.advanced.tera
  if (!isUnlocked(state, 'tera', ctx)) return err('trainer_level_too_low')
  if (!ALL_TYPES.includes(type)) return err('invalid_type')
  if (!teraChoices(p, ctx).includes(type) || activeTera(p, now) === type) return err('same_type')
  if (!has(state, TERA_SHARD, cfg.shardCost)) return err('no_item')
  const next: OwnedPokemon = { ...p, teraType: type, teraUntil: now + Math.round(cfg.hours * 3_600_000), teraSessionsLeft: cfg.sessions }
  return ok(spend(state, TERA_SHARD, cfg.shardCost, uid, next))
}

/** Teach a TM move (GDD §7): a usable move of the species' TM learnset it cannot equip yet. It is learned for good. */
export function useTm(state: PlayerState, uid: string, move: string, ctx: EngineContext = defaultContext()): Result<PlayerState, AdvancedError> {
  const t = target(state, uid)
  if (!t.ok) return t
  const p = t.value
  if (!tmCandidates(p, ctx).includes(move)) {
    return err(equippableMoves(p, ctx).includes(move) ? 'move_already_known' : 'move_not_compatible')
  }
  if (!has(state, TECHNICAL_MACHINE)) return err('no_item')
  const next: OwnedPokemon = { ...p, learnedMoves: [...p.learnedMoves, move], tmMoves: [...(p.tmMoves ?? []), move] }
  return ok(spend(state, TECHNICAL_MACHINE, 1, uid, next))
}

/**
 * Use a mint to set `nature` (GDD §6.2): its stats follow that nature's effect; the original nature is kept
 * (and shown). Setting the original nature removes the change. It spends the `<nature>-mint` if the player owns
 * one, otherwise a `choice-mint` (the player picks the nature when using it).
 */
export function useMint(state: PlayerState, uid: string, nature: string, ctx: EngineContext = defaultContext()): Result<PlayerState, AdvancedError> {
  const t = target(state, uid)
  if (!t.ok) return t
  const p = t.value
  if (!isUnlocked(state, 'mint', ctx)) return err('trainer_level_too_low')
  if (!ctx.naturesBySlug.has(nature)) return err('invalid_nature')
  if (!mintChoices(p, ctx).includes(nature)) return err('same_nature')
  const item = mintSourceFor(state, nature)
  if (!item) return err('no_item')
  const { mintNature: _old, ...rest } = p
  const next: OwnedPokemon = nature === p.nature ? rest : { ...rest, mintNature: nature }
  return ok(spend(state, item, 1, uid, next))
}

/** Bottle Cap (GDD §6.1): raise one IV below the max to `ivMax`. A higher HP IV also fills the extra Energy. */
export function useBottleCap(state: PlayerState, uid: string, stat: StatKey, ctx: EngineContext = defaultContext()): Result<PlayerState, AdvancedError> {
  const t = target(state, uid)
  if (!t.ok) return t
  const p = t.value
  if (!isUnlocked(state, 'bottleCap', ctx)) return err('trainer_level_too_low')
  if (!STAT_KEYS.includes(stat)) return err('invalid_stat')
  if (!bottleCapStats(p, ctx).includes(stat)) return err('iv_maxed')
  if (!has(state, BOTTLE_CAP)) return err('no_item')
  const next: OwnedPokemon = {
    ...p,
    ivs: { ...p.ivs, [stat]: ctx.config.progression.ivMax },
    bottleCapped: [...new Set([...(p.bottleCapped ?? []), stat])],
  }
  const gained = maxEnergyOf(next, ctx) - maxEnergyOf(p, ctx)
  if (gained > 0) next.energy = { ...p.energy, current: p.energy.current + gained }
  return ok(spend(state, BOTTLE_CAP, 1, uid, next))
}

/** Ability Capsule (GDD §6.3): switch to another defined, non-hidden ability of its species. */
export function useAbilityCapsule(state: PlayerState, uid: string, ability: string, ctx: EngineContext = defaultContext()): Result<PlayerState, AdvancedError> {
  const t = target(state, uid)
  if (!t.ok) return t
  const p = t.value
  if (!isUnlocked(state, 'abilityCapsule', ctx)) return err('trainer_level_too_low')
  const choices = abilityCapsuleChoices(p, ctx)
  if (choices.length === 0) return err('no_other_ability')
  if (!choices.includes(ability)) return err(ability === p.ability ? 'same_ability' : 'invalid_ability')
  if (!has(state, ABILITY_CAPSULE)) return err('no_item')
  return ok(spend(state, ABILITY_CAPSULE, 1, uid, { ...p, ability }))
}

/** Stats a nature can touch, for the mint picker. */
export const NATURE_STATS: readonly NatureStatKey[] = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
