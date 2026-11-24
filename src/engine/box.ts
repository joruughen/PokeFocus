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
import { pruneCopies } from './transform'
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
  | 'empty_selection'
  | 'too_many_selected'
  | 'duplicate_selection'
  | 'unknown_pending'
  | 'box_full'
  | EquipError
  | EvolutionBlock
  | 'no_such_evolution'

export type { BoxError }

function sessionLocks(state: PlayerState, uid?: string): boolean {
  return state.activeSession !== null && (uid === undefined || state.activeSession.teamUids.includes(uid))
}

/** Candies of its line a Pokémon of this species gives when released (1/2/3 by stage). */
export function releaseCandyGain(speciesSlug: string, ctx: EngineContext = defaultContext()): { chainId: string; gain: number } {
  const sp = getSpecies(speciesSlug, ctx)
  return { chainId: String(sp.evolutionChainId), gain: ctx.config.progression.candiesOnRelease[sp.stage - 1] ?? 1 }
}

/** How many Pokémon the Box holds at this trainer level (GDD §12.9). */
export function boxCapacity(trainerLevel: number, ctx: EngineContext = defaultContext()): number {
  const b = ctx.config.box
  return Math.min(b.maxCapacity, b.baseCapacity + b.perStep * Math.floor(Math.max(0, trainerLevel) / b.stepLevels))
}

/** Is the Box full for this player? */
export function isBoxFull(state: PlayerState, ctx: EngineContext = defaultContext()): boolean {
  return Object.keys(state.pokemon).length >= boxCapacity(state.trainer.level, ctx)
}

/** What to do with a pending capture (GDD §12.9). */
export type PendingChoice = { kind: 'swap'; releaseUid: string } | { kind: 'convert' } | { kind: 'keep' }

/**
 * Settle one pending capture: `swap` releases a Box Pokémon (not in the team; its candies as a normal release) and
 * puts the capture in its place; `convert` turns the capture into the candies a release would give; `keep` stores it
 * (only with room in the Box).
 */
export function resolvePendingCapture(state: PlayerState, uid: string, choice: PendingChoice, ctx: EngineContext = defaultContext()): Result<PlayerState, BoxError> {
  const list = state.pendingCaptures ?? []
  const cap = list.find((p) => p.uid === uid)
  if (!cap) return err('unknown_pending')
  const rest = list.filter((p) => p.uid !== uid)
  let s: PlayerState = { ...state, pendingCaptures: rest.length > 0 ? rest : undefined }
  if (choice.kind === 'convert') {
    const { chainId, gain } = releaseCandyGain(cap.speciesSlug, ctx)
    return ok({ ...s, candies: { ...s.candies, chains: { ...s.candies.chains, [chainId]: (s.candies.chains[chainId] ?? 0) + gain } } })
  }
  if (choice.kind === 'swap') {
    const r = releasePokemon(s, choice.releaseUid, ctx)
    if (!r.ok) return r
    s = r.value
  } else if (isBoxFull(s, ctx)) return err('box_full')
  return ok({ ...s, pokemon: { ...s.pokemon, [cap.uid]: cap } })
}

/** Release a Pokémon: gives 1/2/3 candies of its line by stage. Team members cannot be released. */
export function releasePokemon(state: PlayerState, uid: string, ctx: EngineContext = defaultContext()): Result<PlayerState, BoxError> {
  const p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (state.team.includes(uid)) return err('in_team')
  const { chainId: key, gain } = releaseCandyGain(p.speciesSlug, ctx)
  const pokemon = { ...state.pokemon }
  delete pokemon[uid]
  return ok({ ...state, pokemon, candies: { ...state.candies, chains: { ...state.candies.chains, [key]: (state.candies.chains[key] ?? 0) + gain } } })
}

/** Most Pokémon one `releaseMany` request may release. */
export const MAX_RELEASE_BATCH = 200

export interface ReleaseManyResult {
  state: PlayerState
  /** How many were released (= `uids.length`). */
  released: number
  /** Candies gained per evolution chain id. */
  candies: Record<string, number>
  /** Sum of `candies`. */
  totalCandies: number
}

/**
 * Release several Pokémon at once, all or nothing: if any uid is unknown or in
 * the team, or the list is empty, has repeats or more than `MAX_RELEASE_BATCH`,
 * it fails and nothing changes. Each one goes through `releasePokemon`, so the
 * rules are the same as releasing them one by one (saved teams keep the uid of
 * a released member; applying one reports it as missing).
 */
export function releaseMany(state: PlayerState, uids: readonly string[], ctx: EngineContext = defaultContext()): Result<ReleaseManyResult, BoxError> {
  if (uids.length === 0) return err('empty_selection')
  if (uids.length > MAX_RELEASE_BATCH) return err('too_many_selected')
  if (new Set(uids).size !== uids.length) return err('duplicate_selection')
  let s = state
  const candies: Record<string, number> = {}
  let totalCandies = 0
  for (const uid of uids) {
    const p = s.pokemon[uid]
    const r = releasePokemon(s, uid, ctx)
    if (!r.ok) return err(r.error)
    s = r.value
    const { chainId, gain } = releaseCandyGain(p!.speciesSlug, ctx)
    candies[chainId] = (candies[chainId] ?? 0) + gain
    totalCandies += gain
  }
  return ok({ state: s, released: uids.length, candies, totalCandies })
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

export interface CandyPreview {
  /** Candies really spent (can be fewer than asked: the level cap or the Dust stop the loop). */
  used: number
  /** Asked but not spent. */
  unused: number
  /** Why `unused > 0`. */
  stoppedBy: 'level_cap' | 'not_enough_dust' | null
  dustSpent: number
  dustLeft: number
  candiesLeft: number
  levelFrom: number
  levelTo: number
  expFrom: number
  expTo: number
  expGained: number
  /** EXP into the level and EXP the level needs (for the bar), before and after. */
  intoFrom: number
  intoTo: number
  forNextFrom: number
  forNextTo: number
  events: ProgressEvent[]
}

/**
 * Pure preview of `useCandy` (same loop, nothing applied). Unlike `useCandy`, a request that
 * cannot spend a single candy (cap / Dust) is not an error: it returns `used: 0` with `stoppedBy`.
 */
export function previewCandies(
  state: PlayerState,
  uid: string,
  candy: CandyKind,
  count: number,
  ctx: EngineContext = defaultContext(),
): Result<CandyPreview, BoxError> {
  const p = state.pokemon[uid]
  const r = useCandy(state, uid, candy, count, ctx)
  if (!r.ok && r.error !== 'level_cap' && r.error !== 'not_enough_dust') return err(r.error)
  const after = r.ok ? r.value.state : state
  const q = after.pokemon[uid] as OwnedPokemon
  const sp = getSpecies((p as OwnedPokemon).speciesSlug, ctx)
  const bag = (s: PlayerState) => (candy.kind === 'species' ? (s.candies.chains[String(sp.evolutionChainId)] ?? 0) : (s.candies.types[candy.type] ?? 0))
  const used = bag(state) - bag(after)
  const span = (lv: number) => expForLevel(lv + 1, ctx) - expForLevel(lv, ctx)
  const p0 = p as OwnedPokemon
  return ok({
    used,
    unused: count - used,
    stoppedBy: used >= count ? null : r.ok ? (q.level >= levelCap(state, ctx) ? 'level_cap' : 'not_enough_dust') : (r.error as 'level_cap' | 'not_enough_dust'),
    dustSpent: state.dust - after.dust,
    dustLeft: after.dust,
    candiesLeft: bag(after),
    levelFrom: p0.level,
    levelTo: q.level,
    expFrom: p0.exp,
    expTo: q.exp,
    expGained: q.exp - p0.exp,
    intoFrom: p0.exp - expForLevel(p0.level, ctx),
    intoTo: q.exp - expForLevel(q.level, ctx),
    forNextFrom: span(p0.level),
    forNextTo: span(q.level),
    events: r.ok ? r.value.events : [],
  })
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
  // A copy only holds while the copied teammate is in the team (Transformación, transform.ts).
  return ok(pruneCopies({ ...s, team: [...uids] }, ctx))
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
  const chainKey = String(getSpecies(p.speciesSlug, ctx).evolutionChainId)
  const chains = { ...state.candies.chains, [chainKey]: (state.candies.chains[chainKey] ?? 0) - opt.candyCost }
  const inventory = { ...state.inventory }
  if (opt.evolution.trigger === 'item' && opt.evolution.item) inventory[opt.evolution.item] = (inventory[opt.evolution.item] ?? 0) - 1
  const caught = state.pokedex.caught.includes(toSlug) ? state.pokedex.caught : [...state.pokedex.caught, toSlug]
  const seen = state.pokedex.seen.includes(toSlug) ? state.pokedex.seen : [...state.pokedex.seen, toSlug]
  const next = recordMissionEvent({ ...state, inventory, candies: { ...state.candies, chains }, pokedex: { seen, caught }, pokemon: { ...state.pokemon, [uid]: evolved } }, { kind: 'evolve' }, now, ctx)
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
