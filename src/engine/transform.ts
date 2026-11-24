/**
 * Transformación (GDD §7.3): a Pokémon with a technique that has the `copyTeammate`
 * effect (Ditto) can copy one teammate. While the copy holds (the copied Pokémon is
 * in the team) it takes the teammate's types (conditions, STAB, the wild pool's
 * team-type bonus, the counterattack defence), its first `techniqueSlots(level)`
 * equipped techniques with the teammate's Mastery for them, and its look. It keeps
 * its own stats, ability, level, EXP, Bond and IVs.
 *
 * Only `copyOfUid` is stored on the Pokémon. Everything else is read from the
 * teammate when needed (`effectiveMember`), so it follows evolutions and technique
 * changes. Pure; the random choice takes the RNG of its action.
 */
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { TypeSlug } from './data-types'
import { getTechnique, isCopyMove, techniqueSlots, type TechniqueInfo } from './moves'
import { pick, type Rng } from './rng'
import { err, ok, type OwnedPokemon, type PlayerState, type Result } from './state'

export type TransformError =
  | 'unknown_pokemon'
  | 'not_transformer'
  | 'invalid_target'
  | 'no_candidates'
  | 'session_active'

const isCopyTechnique = isCopyMove

/** Can this Pokémon copy a teammate? True when it knows (not necessarily has equipped) a `copyTeammate` technique. */
export function canTransform(p: Pick<OwnedPokemon, 'learnedMoves' | 'tmMoves'>, ctx: EngineContext = defaultContext()): boolean {
  return [...p.learnedMoves, ...(p.tmMoves ?? [])].some((m) => isCopyTechnique(m, ctx))
}

/** Teammates `p` could copy: the team without itself and without any other transformer (no copy of a copy). */
export function copyCandidates(
  state: Pick<PlayerState, 'pokemon' | 'team'>,
  p: OwnedPokemon,
  ctx: EngineContext = defaultContext(),
  teamUids: readonly string[] = state.team,
): OwnedPokemon[] {
  return teamUids
    .filter((u) => u !== p.uid)
    .map((u) => state.pokemon[u])
    .filter((q): q is OwnedPokemon => Boolean(q) && !canTransform(q as OwnedPokemon, ctx))
}

/** The teammate `p` is copying right now, or null: not transformed, or the copied one left the team / is gone. */
export function copyTarget(
  state: Pick<PlayerState, 'pokemon' | 'team'>,
  p: OwnedPokemon,
  ctx: EngineContext = defaultContext(),
  teamUids: readonly string[] = state.team,
): OwnedPokemon | null {
  const uid = p.copyOfUid
  if (!uid || uid === p.uid || !canTransform(p, ctx) || !teamUids.includes(uid)) return null
  const t = state.pokemon[uid]
  return t && !canTransform(t, ctx) ? t : null
}

/** The techniques `p` would hold copying `target`: the first `techniqueSlots(p.level)` equipped ones. */
export function copiedMoves(p: Pick<OwnedPokemon, 'level'>, target: Pick<OwnedPokemon, 'equippedMoves'>, ctx: EngineContext = defaultContext()): string[] {
  return target.equippedMoves.filter((m) => !isCopyTechnique(m, ctx)).slice(0, techniqueSlots(p.level, ctx))
}

/**
 * `p` as it fights: while copying, its equipped techniques and their Mastery are the teammate's.
 * Read-only: never write the result back into the state (use the original for that).
 */
export function effectiveMember(
  state: Pick<PlayerState, 'pokemon' | 'team'>,
  p: OwnedPokemon,
  ctx: EngineContext = defaultContext(),
  teamUids: readonly string[] = state.team,
): OwnedPokemon {
  const t = copyTarget(state, p, ctx, teamUids)
  return t ? asCopyOf(p, t, ctx) : p
}

/** `p` holding the copied techniques of `t` (see `effectiveMember`). */
export function asCopyOf(p: OwnedPokemon, t: OwnedPokemon, ctx: EngineContext = defaultContext()): OwnedPokemon {
  const moves = copiedMoves(p, t, ctx)
  return { ...p, equippedMoves: moves, moveMasteryMinutes: { ...p.moveMasteryMinutes, ...Object.fromEntries(moves.map((m) => [m, t.moveMasteryMinutes[m] ?? 0])) } }
}

/** Species types a Pokémon fights with: its own, or those of the teammate it copies. */
export function bodyTypes(p: Pick<OwnedPokemon, 'speciesSlug'>, copy: Pick<OwnedPokemon, 'speciesSlug'> | null | undefined, ctx: EngineContext = defaultContext()): TypeSlug[] {
  return getSpecies((copy ?? p).speciesSlug, ctx).types
}

/** What a transformed Pokémon looks like and uses, for the UI and the report. Null when it is not copying. */
export interface CopySummary {
  uid: string
  speciesSlug: string
  isShiny: boolean
  types: TypeSlug[]
  techniques: TechniqueInfo[]
}

export function copySummary(
  state: Pick<PlayerState, 'pokemon' | 'team'>,
  p: OwnedPokemon,
  ctx: EngineContext = defaultContext(),
  teamUids: readonly string[] = state.team,
): CopySummary | null {
  const t = copyTarget(state, p, ctx, teamUids)
  if (!t) return null
  return {
    uid: t.uid,
    speciesSlug: t.speciesSlug,
    isShiny: t.isShiny,
    types: getSpecies(t.speciesSlug, ctx).types,
    techniques: copiedMoves(p, t, ctx).flatMap((m) => {
      const info = getTechnique(m, ctx)
      return info ? [info] : []
    }),
  }
}

/**
 * Team members that can copy but are not copying anyone and have someone to copy: the ones the
 * end-of-session question is about. Empty when nobody qualifies.
 */
export function pendingCopyUids(state: PlayerState, ctx: EngineContext = defaultContext()): string[] {
  const uids = state.activeSession?.teamUids ?? state.team
  return uids.filter((u) => {
    const p = state.pokemon[u]
    return p !== undefined && canTransform(p, ctx) && copyTarget(state, p, ctx, uids) === null && copyCandidates(state, p, ctx, uids).length > 0
  })
}

/**
 * Copy a teammate (`target` = its uid), copy a random one, or stop copying (`null`).
 * The target must be in the current team and not a transformer. Between sessions it is free and unlimited;
 * for a member of the active session it is only allowed once its timer ended (`atSessionEnd`) and only when
 * it is not copying yet: the answer to the end-of-session question, never a change of mind.
 */
export function setCopy(
  state: PlayerState,
  uid: string,
  target: string | null | 'random',
  rng: Rng,
  ctx: EngineContext = defaultContext(),
  opts: { atSessionEnd?: boolean } = {},
): Result<PlayerState, TransformError> {
  const p = state.pokemon[uid]
  if (!p) return err('unknown_pokemon')
  if (!canTransform(p, ctx)) return err('not_transformer')
  const inSession = state.activeSession?.teamUids.includes(uid) ?? false
  if (inSession && !(opts.atSessionEnd && target !== null && p.copyOfUid === undefined)) return err('session_active')
  if (target === null) return ok(withCopy(state, p, undefined))
  const candidates = copyCandidates(state, p, ctx)
  let chosen: OwnedPokemon | undefined
  if (target === 'random') {
    if (candidates.length === 0) return err('no_candidates')
    chosen = pick(rng, candidates)
  } else {
    chosen = candidates.find((q) => q.uid === target)
    if (!chosen) return err('invalid_target')
  }
  return ok(withCopy(state, p, chosen.uid))
}

function withCopy(state: PlayerState, p: OwnedPokemon, copyOfUid: string | undefined): PlayerState {
  if (p.copyOfUid === copyOfUid) return state
  const { copyOfUid: _old, ...rest } = p
  return { ...state, pokemon: { ...state.pokemon, [p.uid]: copyOfUid === undefined ? rest : { ...rest, copyOfUid } } }
}

/**
 * Drop every copy whose teammate is no longer in the team (or is gone, or became a transformer):
 * the Pokémon is just itself again. Returns the same state when nothing changes.
 */
export function pruneCopies(state: PlayerState, ctx: EngineContext = defaultContext()): PlayerState {
  let pokemon: PlayerState['pokemon'] | null = null
  for (const p of Object.values(state.pokemon)) {
    if (p.copyOfUid === undefined) continue
    const t = state.team.includes(p.copyOfUid) ? state.pokemon[p.copyOfUid] : undefined
    if (t && t.uid !== p.uid && !canTransform(t, ctx)) continue
    pokemon ??= { ...state.pokemon }
    const { copyOfUid: _drop, ...rest } = p
    pokemon[p.uid] = rest
  }
  return pokemon ? { ...state, pokemon } : state
}
