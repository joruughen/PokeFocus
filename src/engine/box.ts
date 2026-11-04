/**
 * New player and box operations (GDD §2.1, §7, §12): starter, release,
 * candies, equipping techniques, team/leader, evolution.
 */
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { LocaleCode, TypeSlug } from './data-types'
import { refreshEnergy } from './energy'
import { createIndividual, definedAbilities, rollAbility, toOwnedPokemon } from './individual'
import { recordMissionEvent, refreshMissions } from './missions'
import { levelUpMovesUpTo, techniqueSlots, validateEquip, type EquipError } from './moves'
import {
  candyDustCost,
  evolutionOptions,
  expForLevel,
  gainExp,
  levelCap,
  type EvolutionBlock,
  type ProgressEvent,
} from './progression'
import type { Rng } from './rng'
import { err, ok, type OwnedPokemon, type PlayerState, type Result } from './state'
import { maxEnergyOf } from './stats'
import type { TimeZoneSpec } from './time'

export interface NewPlayerInput {
  trainerName: string
  locale: LocaleCode
  starterSlug: string
  now: number
  /** IANA zone or fixed UTC offset in minutes (default 0 = UTC). */
  timezone?: TimeZoneSpec
  city?: string | null
}

/** A fresh player: starter at `starterLevel` with 1 technique, `starterPokeBalls` Poké Balls. */
export function createNewPlayer(input: NewPlayerInput, rng: Rng, ctx: EngineContext = defaultContext()): Result<PlayerState, 'invalid_starter'> {
  const cfg = ctx.config
  if (!cfg.starters.includes(input.starterSlug) || !ctx.speciesBySlug.has(input.starterSlug)) return err('invalid_starter')
  const core = createIndividual(input.starterSlug, cfg.starterLevel, rng, {}, ctx)
  const starter = toOwnedPokemon(core, 'p1', input.now, 'starter', ctx)
  return ok(refreshMissions({
    version: 1,
    profile: {
      trainerName: input.trainerName,
      locale: input.locale,
      timezone: input.timezone ?? 0,
      city: input.city ?? null,
      weather: null,
      createdAt: input.now,
    },
    trainer: { level: 1, exp: 0 },
    dust: 0,
    inventory: { 'poke-ball': cfg.starterPokeBalls },
    candies: { chains: {}, types: {} },
    pokemon: { p1: { ...starter, equippedMoves: starter.equippedMoves.slice(0, 1) } },
    team: ['p1'],
    pokedex: { seen: [input.starterSlug], caught: [input.starterSlug] },
    history: [],
    streak: { current: 0, best: 0, lastDayKey: null, gapBeforeLastDay: 0, protectUsedWeek: null },
    league: { weeklyPoints: {}, monthlyPoints: {}, bestLeague: cfg.leagues.order[0] ?? 'base' },
    roaming: [],
    pendingWishes: [],
    activeSession: null,
    encounter: null,
    days: {},
    lastSessionEndedAt: null,
    techniqueWeekUses: { weekKey: '', uses: {} },
    counters: { pokemon: 1, session: 0, charge: 0 },
  }, input.now, ctx))
}

type BoxError =
  | 'unknown_pokemon'
  | 'session_active'
  | 'in_team'
  | 'team_too_large'
  | 'team_empty'
  | 'duplicate_in_team'
  | 'not_enough_candies'
  | 'not_enough_dust'
  | 'level_cap'
  | 'wrong_chain'
  | 'wrong_type'
  | 'invalid_count'
  | EquipError
  | EvolutionBlock
  | 'no_such_evolution'

export type { BoxError }

function sessionLocks(state: PlayerState, uid?: string): boolean {
  return state.activeSession !== null && (uid === undefined || state.activeSession.teamUids.includes(uid))
}

/** Release a Pokémon: gives 1/2/3 candies of its line by stage. Team members cannot be released. */
export function releasePokemon(state: PlayerState, uid: string, ctx: EngineContext = defaultContext()): Result<PlayerState, BoxError> {
  const p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (state.team.includes(uid)) return err('in_team')
  const sp = getSpecies(p.speciesSlug, ctx)
  const gain = ctx.config.progression.candiesOnRelease[sp.stage - 1] ?? 1
  const key = String(sp.evolutionChainId)
  const pokemon = { ...state.pokemon }
  delete pokemon[uid]
  return ok({ ...state, pokemon, candies: { ...state.candies, chains: { ...state.candies.chains, [key]: (state.candies.chains[key] ?? 0) + gain } } })
}

export type CandyKind = { kind: 'species' } | { kind: 'type'; type: TypeSlug }

/**
 * Use `count` candies on a Pokémon. Each candy costs `25 + 3·level` dust at the
 * level it has when used, gives candyExp (species) or typeCandyExp (type), and
 * cannot be used at the level cap.
 */
export function useCandy(
  state: PlayerState,
  uid: string,
  candy: CandyKind,
  count: number,
  ctx: EngineContext = defaultContext(),
): Result<{ state: PlayerState; events: ProgressEvent[]; dustSpent: number }, BoxError> {
  const cfg = ctx.config
  if (!Number.isInteger(count) || count < 1) return err('invalid_count')
  let p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (sessionLocks(state, uid)) return err('session_active')
  const sp = getSpecies(p.speciesSlug, ctx)
  const key = candy.kind === 'species' ? String(sp.evolutionChainId) : candy.type
  if (candy.kind === 'type' && !sp.types.includes(candy.type)) return err('wrong_type')
  const have = candy.kind === 'species' ? (state.candies.chains[key] ?? 0) : (state.candies.types[candy.type] ?? 0)
  if (have < count) return err('not_enough_candies')
  const cap = levelCap(state, ctx)
  const expEach = candy.kind === 'species' ? cfg.progression.candyExp : cfg.progression.typeCandyExp
  let dust = state.dust
  let spent = 0
  const events: ProgressEvent[] = []
  for (let i = 0; i < count; i++) {
    if (p.level >= cap) return i === 0 ? err('level_cap') : done()
    const cost = candyDustCost(p.level, ctx)
    if (dust < cost) return i === 0 ? err('not_enough_dust') : done()
    dust -= cost
    spent++
    const g = gainExp(p, expEach, cap, ctx)
    p = g.pokemon
    events.push(...g.events)
  }
  return done()

  function done() {
    const candies =
      candy.kind === 'species'
        ? { ...state.candies, chains: { ...state.candies.chains, [key]: have - spent } }
        : { ...state.candies, types: { ...state.candies.types, [key]: have - spent } }
    return ok({ state: { ...state, dust, candies, pokemon: { ...state.pokemon, [uid]: p as OwnedPokemon } }, events, dustSpent: state.dust - dust })
  }
}

/** Equip techniques (validated against slots, known and usable moves). Not during a session. */
export function equipMoves(state: PlayerState, uid: string, moves: string[], ctx: EngineContext = defaultContext()): Result<PlayerState, BoxError> {
  const p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (sessionLocks(state, uid)) return err('session_active')
  const e = validateEquip(p, moves, ctx)
  if (e) return err(e)
  return ok({ ...state, pokemon: { ...state.pokemon, [uid]: { ...p, equippedMoves: [...moves] } } })
}

/**
 * Set the team (1–6 distinct uids, slot 0 = leader). Only between sessions.
 * Energy is refreshed at `now` first so box regeneration is settled.
 */
export function setTeam(state: PlayerState, uids: string[], now: number, ctx: EngineContext = defaultContext()): Result<PlayerState, BoxError> {
  if (state.activeSession) return err('session_active')
  if (uids.length === 0) return err('team_empty')
  if (uids.length > 6) return err('team_too_large')
  if (new Set(uids).size !== uids.length) return err('duplicate_in_team')
  if (uids.some((u) => !state.pokemon[u])) return err('unknown_pokemon')
  const s = refreshEnergy(state, now, ctx)
  return ok({ ...s, team: [...uids] })
}

/** Move a team member to slot 0 (leader). */
export function setLeader(state: PlayerState, uid: string, now: number, ctx: EngineContext = defaultContext()): Result<PlayerState, BoxError> {
  if (!state.team.includes(uid)) return err('unknown_pokemon')
  return setTeam(state, [uid, ...state.team.filter((u) => u !== uid)], now, ctx)
}

/**
 * Evolve a Pokémon into `toSlug` if eligible right now (level, stone in the
 * inventory — consumed —, Bond + time of day). Trade evolutions are not
 * available in the prototype ('trade_unavailable').
 */
export function evolvePokemon(
  state: PlayerState,
  uid: string,
  toSlug: string,
  now: number,
  rng: Rng,
  ctx: EngineContext = defaultContext(),
): Result<{ state: PlayerState; pokemon: OwnedPokemon }, BoxError> {
  const p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (sessionLocks(state, uid)) return err('session_active')
  const opt = evolutionOptions(state, p, now, ctx).find((o) => o.to === toSlug)
  if (!opt) return err('no_such_evolution')
  if (opt.blockedBy) return err(opt.blockedBy)
  const target = getSpecies(toSlug, ctx)
  const oldMax = maxEnergyOf(p, ctx)
  const keepAbility = p.ability !== null && definedAbilities(target, ctx).some((a) => a.slug === p.ability)
  const evolved: OwnedPokemon = {
    ...p,
    speciesSlug: toSlug,
    ability: keepAbility ? p.ability : rollAbility(target, rng, ctx),
    learnedMoves: [...new Set([...p.learnedMoves, ...levelUpMovesUpTo(target, p.level, ctx)])],
  }
  const newMax = maxEnergyOf(evolved, ctx)
  evolved.energy = { ...p.energy, current: Math.min(newMax, p.energy.current + Math.max(0, newMax - oldMax)) }
  evolved.equippedMoves = evolved.equippedMoves.slice(0, techniqueSlots(evolved.level, ctx))
  const inventory = { ...state.inventory }
  if (opt.evolution.trigger === 'item' && opt.evolution.item) inventory[opt.evolution.item] = (inventory[opt.evolution.item] ?? 0) - 1
  const caught = state.pokedex.caught.includes(toSlug) ? state.pokedex.caught : [...state.pokedex.caught, toSlug]
  const seen = state.pokedex.seen.includes(toSlug) ? state.pokedex.seen : [...state.pokedex.seen, toSlug]
  const next = recordMissionEvent({ ...state, inventory, pokedex: { seen, caught }, pokemon: { ...state.pokemon, [uid]: evolved } }, { kind: 'evolve' }, now, ctx)
  return ok({ state: next, pokemon: evolved })
}

/** Add items (e.g. mission rewards, debug). */
export function addItems(state: PlayerState, items: Record<string, number>): PlayerState {
  const inventory = { ...state.inventory }
  for (const [k, n] of Object.entries(items)) inventory[k] = Math.max(0, (inventory[k] ?? 0) + n)
  return { ...state, inventory }
}

/** Total EXP needed for the next level, and progress within the current one. */
export function levelProgress(p: OwnedPokemon, ctx: EngineContext = defaultContext()): { current: number; needed: number; fraction: number } {
  const a = expForLevel(p.level, ctx)
  const b = expForLevel(p.level + 1, ctx)
  const current = Math.max(0, p.exp - a)
  return { current, needed: b - a, fraction: Math.min(1, current / Math.max(1, b - a)) }
}
