/**
 * Trades between friends (GDD §12.8): the per-player rules of one completed
 * 1-for-1 trade. The server owns the offer workflow (who offered what, the
 * friendship age, open-offer locks, expiry) and calls `applyTrade` once per
 * side inside one transaction; everything here is pure.
 *
 * - Cost (`tradeCost`): both players pay the same Dust, that of the dearer of
 *   the two Pokémon: `dustBase` × `shinyMult` if shiny × `legendaryMult` if
 *   legendary or mythical (a shiny legendary = both multipliers).
 * - Limits: `dailyLimit` completed trades per local day; a legendary or
 *   mythical can only be traded once in its life (`traded.count`).
 * - The receiver's level cap (§12.5) must allow the Pokémon's level.
 * - The Pokémon keeps all its individual state (level, EXP, IVs, nature,
 *   ability, techniques, Mastery, shiny, Tera…); its Bond restarts at 0, its
 *   nickname is cleared (the new trainer names it) and a pending Rest is dropped.
 * - Trade evolutions (Kadabra, Machoke, Graveler, Haunter, §12.6) happen on arrival.
 */
import { defaultContext, getSpecies, getSpeciesById, type EngineContext } from './context'
import { definedAbilities, isLegendarySpecies, rollAbility } from './individual'
import { recordMissionEvent } from './missions'
import { levelUpMovesUpTo, techniqueSlots } from './moves'
import { levelCap } from './progression'
import type { Rng } from './rng'
import { err, ok, type IndividualCore, type OwnedPokemon, type PlayerState, type Result, type TradeArrival } from './state'
import { maxEnergyOf } from './stats'
import { dayKeyOf } from './time'

/** Why a Pokémon cannot be offered or given right now. */
export type TradeBlock = 'unknown_pokemon' | 'in_team' | 'session_active' | 'last_pokemon' | 'legendary_traded'

export type TradeError = TradeBlock | 'over_level_cap' | 'daily_limit' | 'not_enough_dust' | 'no_player'

/** Most arrival windows kept waiting (older ones are dropped). */
const MAX_PENDING_ARRIVALS = 20

export function isLegendaryOrMythical(speciesSlug: string, ctx: EngineContext = defaultContext()): boolean {
  return isLegendarySpecies(getSpecies(speciesSlug, ctx))
}

/**
 * Why `uid` cannot be traded away by this player (null = it can). Team members,
 * members of the running session, the last Pokémon and an already-traded
 * legendary/mythical are blocked. Saved teams do not block (see `inSavedTeam`).
 */
export function tradeBlock(state: PlayerState, uid: string, ctx: EngineContext = defaultContext()): TradeBlock | null {
  const p = state.pokemon[uid]
  if (!p) return 'unknown_pokemon'
  if (Object.keys(state.pokemon).length <= 1) return 'last_pokemon'
  if (state.team.includes(uid)) return 'in_team'
  if (state.activeSession?.teamUids.includes(uid)) return 'session_active'
  if ((p.traded?.count ?? 0) >= 1 && isLegendaryOrMythical(p.speciesSlug, ctx)) return 'legendary_traded'
  return null
}

/** Names of the saved teams that include `uid` (it can be traded: it then shows as missing there, as when released). */
export function inSavedTeam(state: PlayerState, uid: string): string[] {
  return (state.teamPresets ?? []).filter((t) => t.uids.includes(uid)).map((t) => t.name)
}

/** Dust one Pokémon is worth in a trade: base × shiny × legendary/mythical. */
export function tradeDustCostOf(p: Pick<IndividualCore, 'speciesSlug' | 'isShiny'>, ctx: EngineContext = defaultContext()): number {
  const t = ctx.config.trade
  let cost = t.dustBase
  if (p.isShiny) cost *= t.shinyMult
  if (isLegendaryOrMythical(p.speciesSlug, ctx)) cost *= t.legendaryMult
  return Math.round(cost)
}

/** Dust EACH player pays for a trade of `a` for `b`: the cost of the dearer one (the same for both). */
export function tradeCost(a: Pick<IndividualCore, 'speciesSlug' | 'isShiny'>, b: Pick<IndividualCore, 'speciesSlug' | 'isShiny'>, ctx: EngineContext = defaultContext()): number {
  return Math.max(tradeDustCostOf(a, ctx), tradeDustCostOf(b, ctx))
}

/** Completed trades of the player's current local day. */
export function tradesToday(state: PlayerState, now: number): number {
  const t = state.trades
  return t && t.dayKey === dayKeyOf(now, state.profile.timezone) ? t.count : 0
}

/** null if this player can receive `p`; 'over_level_cap' if its level is above their cap (§12.5). */
export function receiveBlock(state: PlayerState, p: Pick<IndividualCore, 'level'>, ctx: EngineContext = defaultContext()): 'over_level_cap' | null {
  return p.level > levelCap(state, ctx) ? 'over_level_cap' : null
}

/** Species a Pokémon of `speciesSlug` evolves into when traded (§12.6), or null. Item-held trade evolutions are not supported. */
export function tradeEvolution(speciesSlug: string, ctx: EngineContext = defaultContext()): string | null {
  const sp = ctx.speciesBySlug.get(speciesSlug)
  const e = sp?.evolutions.find((x) => x.trigger === 'trade' && !x.item)
  return e ? getSpeciesById(e.to, ctx).slug : null
}

/** Same evolution step as `evolvePokemon` (ability kept if the target has it, new level-up moves, energy gain, slots). */
function evolveInto(p: OwnedPokemon, toSlug: string, rng: Rng, ctx: EngineContext): OwnedPokemon {
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
  return evolved
}

/** One side of a completed trade, as seen by the player it is applied to. */
export interface TradeSide {
  /** Uid of the Pokémon this player gives. */
  give: string
  /** The Pokémon this player receives, exactly as the partner had it. */
  receive: OwnedPokemon
  /** The partner's trainer name (OT and "received from"). */
  partnerName: string
  /** This player's trainer name (becomes the OT of the Pokémon they give, if it had none). Informative only. */
  selfName: string
  /** Dust this player pays (see `tradeCost`). */
  dust: number
}

export interface TradeApplied {
  state: PlayerState
  /** Uid of the received Pokémon in this player's box. */
  uid: string
  /** Species it evolved into on arrival, or null. */
  evolvedTo: string | null
  arrival: TradeArrival
}

/**
 * The partner-independent record a Pokémon carries after being traded by
 * `giverName` at `now` (first trade: the giver becomes its original trainer).
 */
export function tradeRecordAfter(p: OwnedPokemon, giverName: string, now: number): NonNullable<OwnedPokemon['traded']> {
  return {
    originalTrainer: p.traded?.originalTrainer ?? giverName,
    receivedFrom: giverName,
    receivedAt: now,
    count: (p.traded?.count ?? 0) + 1,
  }
}

/**
 * Apply one side of a trade to a player: checks the given Pokémon (`tradeBlock`),
 * the received one against the level cap, the daily limit and the Dust; then
 * removes the given one, adds the received one under a new uid (Bond 0, no
 * nickname, OT recorded, trade-evolved if it applies), registers it in the
 * Pokédex, pays the Dust, counts the trade for today and queues the arrival window.
 * Nothing changes on error.
 */
export function applyTrade(state: PlayerState, side: TradeSide, now: number, rng: Rng, ctx: EngineContext = defaultContext()): Result<TradeApplied, TradeError> {
  const block = tradeBlock(state, side.give, ctx)
  if (block) return err(block)
  if (receiveBlock(state, side.receive, ctx)) return err('over_level_cap')
  const today = dayKeyOf(now, state.profile.timezone)
  const done = tradesToday(state, now)
  if (done >= ctx.config.trade.dailyLimit) return err('daily_limit')
  if (state.dust < side.dust) return err('not_enough_dust')

  const uid = `p${state.counters.pokemon + 1}`
  const { nickname: _nick, ...rest } = side.receive
  let mon: OwnedPokemon = {
    ...rest,
    uid,
    bondMinutes: 0,
    asleepNextSession: false,
    asleepSetAt: null,
    traded: tradeRecordAfter(side.receive, side.partnerName, now),
  }
  const evolvedTo = tradeEvolution(mon.speciesSlug, ctx)
  if (evolvedTo) mon = evolveInto(mon, evolvedTo, rng, ctx)

  const pokemon = { ...state.pokemon }
  delete pokemon[side.give]
  pokemon[uid] = mon
  const add = (list: string[], slugs: string[]) => [...list, ...slugs.filter((s, i) => !list.includes(s) && slugs.indexOf(s) === i)]
  const slugs = evolvedTo ? [side.receive.speciesSlug, evolvedTo] : [side.receive.speciesSlug]
  const arrival: TradeArrival = { uid, fromSpecies: side.receive.speciesSlug, toSpecies: mon.speciesSlug, shiny: mon.isShiny, partnerName: side.partnerName, at: now }
  let next: PlayerState = {
    ...state,
    dust: state.dust - side.dust,
    pokemon,
    pokedex: { seen: add(state.pokedex.seen, slugs), caught: add(state.pokedex.caught, slugs) },
    counters: { ...state.counters, pokemon: state.counters.pokemon + 1 },
    trades: { dayKey: today, count: done + 1 },
    pendingTrades: [...(state.pendingTrades ?? []), arrival].slice(-MAX_PENDING_ARRIVALS),
  }
  if (evolvedTo) next = recordMissionEvent(next, { kind: 'evolve' }, now, ctx)
  return ok({ state: next, uid, evolvedTo, arrival })
}
