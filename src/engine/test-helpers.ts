/** Helpers for engine unit tests (not part of the public API). */
import { createNewPlayer } from './box'
import { defaultContext, type EngineContext } from './context'
import type { BaseStats } from './data-types'
import { createIndividual, toOwnedPokemon } from './individual'
import { createRng } from './rng'
import { completeSession, startSession, type CompleteSessionInput, type SessionResult } from './session'
import type { OwnedPokemon, PlayerState } from './state'
import { maxEnergyOf } from './stats'

/** 2026-11-03 (Tuesday) 10:00 at UTC. Profiles use timezone 0 (UTC). */
export const T0 = Date.UTC(2026, 10, 3, 10, 0)
export const MIN = 60_000

export const IV15: BaseStats = { hp: 15, attack: 15, defense: 15, specialAttack: 15, specialDefense: 15, speed: 15 }

export function makeMon(
  slug: string,
  level: number,
  opts: Partial<OwnedPokemon> & { uid?: string } = {},
  ctx: EngineContext = defaultContext(),
): OwnedPokemon {
  const core = createIndividual(slug, level, createRng(`${slug}-${level}`), {}, ctx)
  const p = toOwnedPokemon({ ...core, ivs: IV15, nature: 'hardy' }, opts.uid ?? slug, T0 - 60 * MIN, 'poke-ball', ctx)
  const full = { ...p, ...opts }
  full.energy = opts.energy ?? { current: maxEnergyOf(full, ctx), updatedAt: T0 - 60 * MIN }
  return full
}

export function makePlayer(team: OwnedPokemon[], patch: Partial<PlayerState> = {}, ctx: EngineContext = defaultContext()): PlayerState {
  const r = createNewPlayer({ trainerName: 'Test', locale: 'es', starterSlug: 'bulbasaur', now: T0 - 120 * MIN, timezone: 0 }, createRng(1), ctx)
  if (!r.ok) throw new Error(r.error)
  const pokemon: Record<string, OwnedPokemon> = {}
  for (const p of team) pokemon[p.uid] = p
  return { ...r.value, pokemon, team: team.map((p) => p.uid), inventory: { 'poke-ball': 10, 'great-ball': 5, 'ultra-ball': 5 }, ...patch }
}

export const STUDYING: CompleteSessionInput['focusInputs'] = { screenshotLabels: ['studying'], missedCaptures: 0 }

/** Start + complete a session; returns the result and the state with the active session. */
export function runSession(
  state: PlayerState,
  minutes: number,
  seed: number | string = 7,
  input: Partial<CompleteSessionInput> & { startedAt?: number } = {},
  ctx: EngineContext = defaultContext(),
): { result: SessionResult; state: PlayerState } {
  const startedAt = input.startedAt ?? T0
  const st = startSession(state, { plannedMinutes: minutes, startedAt }, ctx)
  if (!st.ok) throw new Error(st.error)
  const endedAt = startedAt + minutes * MIN
  const r = completeSession(
    st.value.state,
    st.value.session,
    { endedAt, claimedAt: endedAt + MIN, pausedSeconds: 0, focusInputs: STUDYING, ...input },
    createRng(seed),
    ctx,
  )
  if (!r.ok) throw new Error(r.error)
  return { result: r.value, state: st.value.state }
}
