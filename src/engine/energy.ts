/**
 * Daily energy (GDD §5.3): 05:00 local reset, box regeneration, break recovery,
 * healing items.
 */
import { defaultContext, type EngineContext } from './context'
import { err, ok, type OwnedPokemon, type PlayerState, type Result } from './state'
import { maxEnergyOf } from './stats'
import { HOUR_MS, resetDayKeyOf } from './time'

/** Current energy fraction (0–1) of a Pokémon as stored (call refreshEnergy first for "now"). */
export function energyFraction(p: OwnedPokemon, ctx: EngineContext = defaultContext()): number {
  const max = maxEnergyOf(p, ctx)
  return max > 0 ? p.energy.current / max : 0
}

/** Energy of one Pokémon at `now` (pure; does not change the record). */
export function energyAt(state: PlayerState, p: OwnedPokemon, now: number, ctx: EngineContext = defaultContext()): number {
  const cfg = ctx.config
  const max = maxEnergyOf(p, ctx)
  const tz = state.profile.timezone
  if (now <= p.energy.updatedAt) return Math.min(max, p.energy.current)
  if (resetDayKeyOf(p.energy.updatedAt, tz, cfg.energy.dailyResetHour) !== resetDayKeyOf(now, tz, cfg.energy.dailyResetHour)) return max
  if (state.team.includes(p.uid)) return Math.min(max, p.energy.current)
  const hours = (now - p.energy.updatedAt) / HOUR_MS
  return Math.min(max, p.energy.current + max * cfg.energy.boxRecoverPctPerHour * hours)
}

/**
 * Is a Pokémon still asleep from Rest at `now`? The daily energy reset
 * (05:00 local) wakes it up even if it never sat in a session.
 */
export function isAsleepAt(state: PlayerState, p: OwnedPokemon, now: number, ctx: EngineContext = defaultContext()): boolean {
  if (!p.asleepNextSession) return false
  const since = p.asleepSetAt ?? p.energy.updatedAt
  const tz = state.profile.timezone
  const h = ctx.config.energy.dailyResetHour
  return now <= since || resetDayKeyOf(since, tz, h) === resetDayKeyOf(now, tz, h)
}

/**
 * Bring every Pokémon's energy up to `now`: full refill if the 05:00 local
 * reset happened since its last update; otherwise box members regenerate
 * `boxRecoverPctPerHour` of max per hour. Team members do not regenerate.
 * Rest sleep also ends at the daily reset.
 */
export function refreshEnergy(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): PlayerState {
  const pokemon: Record<string, OwnedPokemon> = {}
  for (const [uid, p] of Object.entries(state.pokemon)) {
    let q = p
    if (q.asleepNextSession && !isAsleepAt(state, q, now, ctx)) q = { ...q, asleepNextSession: false, asleepSetAt: null }
    if (now > q.energy.updatedAt) q = { ...q, energy: { current: energyAt(state, q, now, ctx), updatedAt: now } }
    pokemon[uid] = q
  }
  return { ...state, pokemon }
}

function healMember(p: OwnedPokemon, amount: number, ctx: EngineContext): OwnedPokemon {
  const max = maxEnergyOf(p, ctx)
  return { ...p, energy: { ...p.energy, current: Math.min(max, p.energy.current + amount) } }
}

/** Completing the pomodoro break: team recovers `breakRecoverPct` of max energy. */
export function completeBreak(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): PlayerState {
  const s = refreshEnergy(state, now, ctx)
  const pokemon = { ...s.pokemon }
  for (const uid of s.team) {
    const p = pokemon[uid]
    if (p) pokemon[uid] = healMember(p, maxEnergyOf(p, ctx) * ctx.config.energy.breakRecoverPct, ctx)
  }
  return { ...s, pokemon }
}

export type GroupHealError = 'unknown_pokemon' | 'session_active' | 'already_full'

/**
 * Receive a study-group heal: `+groupHeal.amount` energy for one Pokémon (capped
 * at its max). Not while the Pokémon is in the running session (its energy is
 * simulated from the start); the receiver accepts after claiming.
 */
export function receiveGroupHeal(state: PlayerState, uid: string, now: number, ctx: EngineContext = defaultContext()): Result<PlayerState, GroupHealError> {
  if (state.activeSession && state.activeSession.teamUids.includes(uid)) return err('session_active')
  const s = refreshEnergy(state, now, ctx)
  const p = s.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (p.energy.current >= maxEnergyOf(p, ctx)) return err('already_full')
  return ok({ ...s, pokemon: { ...s.pokemon, [uid]: healMember(p, ctx.config.energy.groupHeal.amount, ctx) } })
}

export type UseItemError = 'unknown_pokemon' | 'no_item' | 'not_a_heal_item' | 'already_full' | 'not_exhausted' | 'session_active'

/** Use a potion (flat energy) or a revive (from 0 to `revivePct`). */
export function useHealItem(
  state: PlayerState,
  uid: string,
  item: string,
  now: number,
  ctx: EngineContext = defaultContext(),
): Result<PlayerState, UseItemError> {
  if (state.activeSession && state.activeSession.teamUids.includes(uid)) return err('session_active')
  if ((state.inventory[item] ?? 0) <= 0) return err('no_item')
  const s = refreshEnergy(state, now, ctx)
  const p = s.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  const max = maxEnergyOf(p, ctx)
  let next: OwnedPokemon
  if (item === 'revive') {
    if (p.energy.current > 0) return err('not_exhausted')
    next = { ...p, energy: { ...p.energy, current: max * ctx.config.energy.revivePct } }
  } else {
    const amount = ctx.config.energy.potions[item]
    if (amount === undefined) return err('not_a_heal_item')
    if (p.energy.current >= max) return err('already_full')
    next = healMember(p, amount, ctx)
  }
  return ok({
    ...s,
    pokemon: { ...s.pokemon, [uid]: next },
    inventory: { ...s.inventory, [item]: (s.inventory[item] ?? 0) - 1 },
  })
}
