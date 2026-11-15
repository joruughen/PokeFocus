/**
 * Pure game reducer (F2): `applyAction(doc, action, env)` → new doc + result,
 * or a rule error. It is the logic that used to live in `src/ui/store/game.ts`,
 * without zustand: no I/O, no `Date.now()`, no `Math.random()`. The server owns
 * the inputs (`env.now`, `env.rng`, `env.dev`, `env.trainerName`).
 *
 * Errors are plain strings (`GameActionError`), returned as HTTP 409 by the
 * server — except `dev_disabled`, which the server maps to 403.
 */
import {
  addItems,
  advanceWave,
  applySessionResult,
  applyStatusCharge,
  assignDamage,
  autoAssignDamage,
  cancelKeep,
  cancelSession,
  claimAllMissions,
  claimMission,
  completeBreak,
  completeSession,
  createIndividual,
  createNewPlayer,
  defaultContext,
  equipMoves,
  evolvePokemon,
  expForLevel,
  finishEncounter,
  gainExp,
  levelCap,
  MINUTE_MS,
  overwritePreset,
  applyPreset,
  deletePreset,
  releaseMany,
  releasePokemon,
  renamePreset,
  savePreset,
  setNickname,
  rerollWild,
  setAutoDamage,
  setLeader,
  setTeam,
  startSession,
  throwBall,
  toOwnedPokemon,
  useAbilityCapsule,
  useBottleCap,
  useCandy,
  useHealItem,
  useMint,
  useTera,
  useTm,
  validatedMinutes,
  type ActiveSession,
  type EngineContext,
  type PlayerState,
  type Rng,
  type SessionResult,
  type TypeSlug,
  type WeatherInput,
} from '../engine'
import { EMPTY_DOC, type ActionResults, type GameAction, type GameActionType, type GameDoc, type LastOutcome, type SessionTimer } from './protocol'
import { resolveSessionWeather, toGeoCell } from './weather'

/** Days a timezone change stays locked (prevents shifting day/week keys to farm streaks and leagues). */
export const TIMEZONE_LOCK_DAYS = 30

export interface ActionEnv {
  /** Server time (ms). */
  now: number
  rng: Rng
  /** DEV_TOOLS=1: dev actions and `claim.devFocusLabel` are honored. */
  dev: boolean
  /** Trainer name stored on the account; used by `createPlayer` (the client does not send it). */
  trainerName?: string
  /**
   * `claim` only: accompanied share (0–1) of the session in a study group,
   * computed by the server from the stored group intervals (never sent by the
   * client). null/absent = solo session (Fairy condition off).
   */
  friendOverlap?: number | null
  /** Real weather of the profile location or city at `start` (server fetch); null/absent = unknown → no weather (manual only in dev). */
  weather?: WeatherInput | null
  /** Engine context of this action (server: the live content, pinned per session; see server/content/service.ts). Default: `defaultContext()`. */
  ctx?: EngineContext
  /**
   * `start` only: live content hash pinned on the new session (`ActiveSession.contentHash`).
   * Absent or 'base' = nothing is written (the saved doc stays as without live content).
   */
  contentHash?: string
}

export type ActionOutcome<T extends GameActionType = GameActionType> =
  | { ok: true; doc: GameDoc; result: ActionResults[T] }
  | { ok: false; error: string }

/** Actions that only exist with DEV_TOOLS=1. */
export const DEV_ACTIONS: ReadonlySet<GameActionType> = new Set<GameActionType>([
  'devAddItems',
  'devAddDust',
  'devAddCandies',
  'devLevelUp',
  'devAddRandomPokemon',
  'resetAll',
  // Manual weather: dev-panel override only (players never pick the weather, GDD §9.2).
  'setWeather',
])

export function isDevAction(type: GameActionType): boolean {
  return DEV_ACTIONS.has(type)
}

/** Timer for the active session, rebuilt if it was lost. */
export function timerOf(doc: Pick<GameDoc, 'player' | 'timer'>): SessionTimer | null {
  const a = doc.player?.activeSession
  if (!a) return null
  if (doc.timer && doc.timer.sessionId === a.id) return doc.timer
  return { sessionId: a.id, endsAt: a.startedAt + a.plannedMinutes * MINUTE_MS, pausedAt: null, pausedMs: 0, notified: false }
}

type Out = { ok: true; doc: GameDoc; result: unknown } | { ok: false; error: string }

const fail = (error: string): Out => ({ ok: false, error })
const done = (doc: GameDoc, result: unknown = null): Out => ({ ok: true, doc, result })

export function applyAction<T extends GameActionType>(doc: GameDoc, action: Extract<GameAction, { type: T }>, env: ActionEnv): ActionOutcome<T>
export function applyAction(doc: GameDoc, action: GameAction, env: ActionEnv): ActionOutcome
export function applyAction(doc: GameDoc, action: GameAction, env: ActionEnv): ActionOutcome {
  if (isDevAction(action.type) && !env.dev) return { ok: false, error: 'dev_disabled' }
  return reduce(doc, action, env) as ActionOutcome
}

function reduce(doc: GameDoc, a: GameAction, env: ActionEnv): Out {
  const ctx = env.ctx ?? defaultContext()
  const t = env.now
  const rng = env.rng

  if (a.type === 'createPlayer') {
    if (doc.player) return fail('player_exists')
    const r = createNewPlayer(
      { trainerName: env.trainerName ?? 'Trainer', locale: a.locale, timezone: a.timezone, starterSlug: a.starterSlug, now: t },
      rng,
      ctx,
    )
    if (!r.ok) return fail(r.error)
    return done({ ...EMPTY_DOC, player: r.value })
  }
  if (a.type === 'resetAll') return done({ ...EMPTY_DOC })
  if (a.type === 'dismissResults') return done(doc.outcome ? { ...doc, outcome: { ...doc.outcome, seen: true } } : doc)
  if (a.type === 'skipBreak') {
    const last = doc.player?.history[doc.player.history.length - 1]
    return done({ ...doc, breakTimer: null, lastBreakFor: doc.breakTimer?.forSession ?? last?.id ?? null })
  }

  const p = doc.player
  if (!p) return fail('no_player')
  const withPlayer = (player: PlayerState, result: unknown = null) => done({ ...doc, player }, result)

  switch (a.type) {
    case 'updateProfile': {
      const patch: Partial<PlayerState['profile']> = {}
      if (a.patch.locale !== undefined) patch.locale = a.patch.locale
      if (a.patch.timezone !== undefined && String(a.patch.timezone) !== String(p.profile.timezone)) {
        const last = p.profile.timezoneChangedAt ?? null
        if (last !== null && t - last < TIMEZONE_LOCK_DAYS * 86_400_000 && !env.dev) return fail('timezone_locked')
        patch.timezone = a.patch.timezone
        patch.timezoneChangedAt = t
      }
      if (a.patch.city !== undefined) patch.city = a.patch.city
      // Only a rounded ~0.1° cell is stored (the server validation re-rounds it too).
      if (a.patch.location !== undefined) patch.location = a.patch.location ? toGeoCell(a.patch.location.lat, a.patch.location.lon) : null
      return withPlayer({ ...p, profile: { ...p.profile, ...patch } })
    }
    case 'ackLevelUp': {
      if (!p.pendingLevelUps) return withPlayer(p)
      const { pendingLevelUps: _done, ...rest } = p
      return withPlayer(rest)
    }
    case 'ackTrade': {
      if (!p.pendingTrades) return withPlayer(p)
      const { pendingTrades: _seen, ...rest } = p
      return withPlayer(rest)
    }
    case 'setWeather':
      return withPlayer({ ...p, profile: { ...p.profile, weather: a.weather } })

    // ---- Study session ----------------------------------------------------
    case 'start': {
      const r = startSession(p, { plannedMinutes: a.minutes, startedAt: t }, ctx)
      if (!r.ok) return fail(r.error)
      const { weather } = resolveSessionWeather(env.weather, p.profile.weather, env.dev)
      const started = r.value.state.activeSession
      return done({
        player: started ? { ...r.value.state, activeSession: { ...started, weather, ...pinned(env.contentHash) } } : r.value.state,
        timer: { sessionId: r.value.session.id, endsAt: t + a.minutes * MINUTE_MS, pausedAt: null, pausedMs: 0, notified: false },
        outcome: null,
        breakTimer: null,
        lastBreakFor: doc.breakTimer?.forSession ?? doc.lastBreakFor,
      })
    }
    case 'pause': {
      const timer = timerOf(doc)
      if (!timer) return fail('no_session')
      if (timer.pausedAt !== null) return done({ ...doc, timer }) // already paused: idempotent
      if (t >= timer.endsAt) return fail('already_finished')
      return done({ ...doc, timer: { ...timer, pausedAt: t } })
    }
    case 'resume': {
      const timer = timerOf(doc)
      if (!timer) return fail('no_session')
      if (timer.pausedAt === null) return done({ ...doc, timer }) // not paused: idempotent
      const d = Math.max(0, t - timer.pausedAt)
      return done({ ...doc, timer: { ...timer, pausedAt: null, pausedMs: timer.pausedMs + d, endsAt: timer.endsAt + d } })
    }
    case 'cancel': {
      // GDD §3.4: a long session keeps the minutes studied and the waves of its full blocks.
      // Server clock only; once the timer ended it must be claimed (late rules), not cancelled.
      const session = p.activeSession
      const timer = timerOf(doc)
      if (!session || !timer) return fail('no_session')
      if (timer.pausedAt === null && t >= timer.endsAt) return fail('already_finished')
      const endedAt = timer.pausedAt ?? t
      const pausedSeconds = timer.pausedMs / 1000
      const keep = cancelKeep(session.plannedMinutes, validatedMinutes(session, endedAt, pausedSeconds), ctx.config)
      if (!keep.keeps) return done({ ...doc, player: cancelSession(p), timer: null }, { outcome: null })
      const res = completeSession(
        p,
        session,
        {
          endedAt,
          claimedAt: t,
          pausedSeconds,
          cancelled: true,
          focusInputs: { screenshotLabels: null, missedCaptures: 0 },
          friendOverlap: env.friendOverlap ?? null,
          soundProfile: a.soundProfile ?? null,
          weather: session.weather !== undefined ? session.weather : resolveSessionWeather(null, p.profile.weather, env.dev).weather,
        },
        rng,
        ctx,
      )
      if (!res.ok) return fail(res.error)
      const applied = applySessionResult(p, res.value, ctx)
      if (!applied.ok) return fail(applied.error)
      const outcome = { result: res.value, events: applied.value.events, before: beforeOf(p, res.value), seen: false }
      // The waves of the full blocks run on the content the session pinned, as after a claim.
      return done({ ...doc, player: pinEncounter(applied.value.state, session), timer: null, outcome }, { outcome })
    }
    case 'markNotified': {
      const timer = timerOf(doc)
      if (!timer) return fail('no_session')
      return done({ ...doc, timer: { ...timer, notified: true } })
    }
    case 'claim': {
      const session = p.activeSession
      const timer = timerOf(doc)
      if (!session || !timer) return fail('no_session')
      if (timer.pausedAt !== null) return fail('paused')
      if (t < timer.endsAt) return fail('not_finished')
      const label = env.dev ? (a.devFocusLabel ?? null) : null
      const res = completeSession(
        p,
        session,
        {
          endedAt: timer.endsAt,
          claimedAt: t,
          pausedSeconds: timer.pausedMs / 1000,
          focusInputs: { screenshotLabels: label ? [label] : null, missedCaptures: 0 },
          friendOverlap: env.friendOverlap ?? null,
          soundProfile: a.soundProfile ?? null,
          // Fixed at start. Older saves without it get no weather (the manual one only in dev).
          weather: session.weather !== undefined ? session.weather : resolveSessionWeather(null, p.profile.weather, env.dev).weather,
        },
        rng,
        ctx,
      )
      if (!res.ok) return fail(res.error)
      const applied = applySessionResult(p, res.value, ctx)
      if (!applied.ok) return fail(applied.error)
      // The waves of this session run on the content the session pinned.
      const player = pinEncounter(applied.value.state, session)
      const levels: Record<string, number> = {}
      const exp: Record<string, number> = {}
      for (const m of res.value.members) {
        const before = p.pokemon[m.uid]
        if (before) {
          levels[m.uid] = before.level
          exp[m.uid] = before.exp
        }
      }
      const outcome = { result: res.value, events: applied.value.events, before: { levels, exp, trainerLevel: p.trainer.level }, seen: false }
      return done({ ...doc, player, timer: null, outcome }, { outcome })
    }

    // ---- Waves --------------------------------------------------------------
    case 'throwBall': {
      const r = throwBall(p, a.ref, a.ball, rng, t, ctx)
      if (!r.ok) return fail(r.error)
      return withPlayer(r.value.state, { outcome: r.value.outcome })
    }
    case 'applyStatus': {
      const r = applyStatusCharge(p, a.chargeId, a.ref)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'reroll': {
      const r = rerollWild(p, a.chargeId, a.ref, rng, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'assignDamage': {
      const r = assignDamage(p, { waveIndex: a.waveIndex, uid: a.uid, wildIndex: a.wildIndex }, rng, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'autoAssignDamage': {
      const r = autoAssignDamage(p, a.waveIndex, rng, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'setAutoDamage':
      return withPlayer(setAutoDamage(p, a.value))
    case 'nextWave':
      if (!p.encounter) return fail('no_encounter')
      return withPlayer(advanceWave(p, ctx))
    case 'finishWaves':
      if (!p.encounter) return fail('no_encounter')
      return withPlayer(finishEncounter(p, ctx))

    // ---- Box ----------------------------------------------------------------
    case 'release': {
      const r = releasePokemon(p, a.uid, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'releaseMany': {
      const r = releaseMany(p, a.uids, ctx)
      if (!r.ok) return fail(r.error)
      const { state, released, candies, totalCandies } = r.value
      return withPlayer(state, { released, candies, totalCandies })
    }
    case 'feedCandy': {
      const r = useCandy(p, a.uid, a.candy, a.count, ctx)
      if (!r.ok) return fail(r.error)
      const candy = a.candy
      const before = candy.kind === 'species' ? sumChains(p) : (p.candies.types[candy.type] ?? 0)
      const after = candy.kind === 'species' ? sumChains(r.value.state) : (r.value.state.candies.types[candy.type] ?? 0)
      return withPlayer(r.value.state, { events: r.value.events, dustSpent: r.value.dustSpent, used: before - after })
    }
    case 'equip': {
      const r = equipMoves(p, a.uid, a.moves, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'setTeam': {
      const r = setTeam(p, a.uids, t, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'setLeader': {
      const r = setLeader(p, a.uid, t, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'evolve': {
      const r = evolvePokemon(p, a.uid, a.to, t, rng, ctx)
      return r.ok ? withPlayer(r.value.state, { pokemon: r.value.pokemon }) : fail(r.error)
    }
    case 'heal': {
      const r = useHealItem(p, a.uid, a.item, t, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }

    case 'setNickname': {
      const r = setNickname(p, a.uid, a.nickname ?? '')
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }

    // ---- Advanced items (F4) -------------------------------------------------
    case 'useTera': {
      const r = useTera(p, a.uid, a.teraType, t, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'useTm': {
      const r = useTm(p, a.uid, a.move, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'useMint': {
      const r = useMint(p, a.uid, a.nature, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'useBottleCap': {
      const r = useBottleCap(p, a.uid, a.stat, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'useAbilityCapsule': {
      const r = useAbilityCapsule(p, a.uid, a.ability, ctx)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }

    // ---- Saved teams --------------------------------------------------------
    case 'savePreset': {
      const r = savePreset(p, a.name)
      return r.ok ? withPlayer(r.value.state, { id: r.value.preset.id }) : fail(r.error)
    }
    case 'renamePreset': {
      const r = renamePreset(p, a.id, a.name)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'overwritePreset': {
      const r = overwritePreset(p, a.id)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'deletePreset': {
      const r = deletePreset(p, a.id)
      return r.ok ? withPlayer(r.value) : fail(r.error)
    }
    case 'applyPreset': {
      const r = applyPreset(p, a.id, t, ctx)
      return r.ok ? withPlayer(r.value.state, { missing: r.value.missing }) : fail(r.error)
    }

    // ---- Missions -----------------------------------------------------------
    case 'claimMission': {
      const r = claimMission(p, a.id, t, ctx)
      return r.ok ? withPlayer(r.value.state, { reward: r.value.reward }) : fail(r.error)
    }
    case 'claimAllMissions': {
      const r = claimAllMissions(p, t, ctx)
      return withPlayer(r.state, { rewards: r.rewards.map((x) => x.reward) })
    }

    // ---- Pomodoro break -----------------------------------------------------
    case 'startBreak': {
      const last = p.history[p.history.length - 1]
      if (p.activeSession) return fail('session_active')
      if (!last) return fail('no_session')
      if (doc.lastBreakFor === last.id) return fail('already_claimed')
      return done({ ...doc, breakTimer: { forSession: last.id, startedAt: t, endsAt: t + a.minutes * MINUTE_MS, minutes: a.minutes } })
    }
    case 'endBreak': {
      const b = doc.breakTimer
      if (!b) return fail('no_break')
      const rewarded = t >= b.endsAt
      return done({ ...doc, breakTimer: null, lastBreakFor: b.forSession, player: rewarded ? completeBreak(p, t, ctx) : p }, { rewarded })
    }

    // ---- Dev helpers (gated in applyAction) ---------------------------------
    case 'devAddItems':
      return withPlayer(addItems(p, a.items))
    case 'devAddDust':
      return withPlayer({ ...p, dust: Math.max(0, p.dust + a.amount) })
    case 'devAddCandies': {
      const chains = { ...p.candies.chains }
      const types: Partial<Record<TypeSlug, number>> = { ...p.candies.types }
      for (const uid of p.team) {
        const mon = p.pokemon[uid]
        const sp = mon ? ctx.speciesBySlug.get(mon.speciesSlug) : undefined
        if (!sp) continue
        chains[String(sp.evolutionChainId)] = (chains[String(sp.evolutionChainId)] ?? 0) + a.amount
        for (const ty of sp.types) types[ty] = (types[ty] ?? 0) + a.amount
      }
      return withPlayer({ ...p, candies: { chains, types } })
    }
    case 'devLevelUp': {
      const cap = levelCap(p, ctx)
      const pokemon = { ...p.pokemon }
      for (const uid of p.team) {
        const mon = pokemon[uid]
        if (!mon) continue
        const target = Math.min(cap, mon.level + a.levels)
        pokemon[uid] = gainExp(mon, Math.max(0, expForLevel(target, ctx) - mon.exp), cap, ctx).pokemon
      }
      return withPlayer({ ...p, pokemon })
    }
    case 'devAddRandomPokemon': {
      const pool = ctx.data.species.filter((sp) => !sp.isLegendary && !sp.isMythical)
      const pokemon = { ...p.pokemon }
      const caught = new Set(p.pokedex.caught)
      const seen = new Set(p.pokedex.seen)
      let n = p.counters.pokemon
      for (let i = 0; i < a.count; i++) {
        const sp = pool[Math.floor(rng.next() * pool.length)]!
        const level = 3 + Math.floor(rng.next() * 25)
        const core = createIndividual(sp.slug, level, rng, { shiny: rng.next() < 0.08 }, ctx)
        n++
        const uid = `p${n}`
        pokemon[uid] = toOwnedPokemon(core, uid, t - i * 3_600_000, 'poke-ball', ctx)
        caught.add(sp.slug)
        seen.add(sp.slug)
      }
      for (const sp of pool) if (rng.next() < 0.25) seen.add(sp.slug)
      return withPlayer({ ...p, pokemon, pokedex: { caught: [...caught], seen: [...seen] }, counters: { ...p.counters, pokemon: n } })
    }
  }
  const unknown: never = a
  return fail(`unknown_action:${(unknown as { type: string }).type}`)
}

/** Levels and EXP of the session's members (and trainer level) before applying it, for the results bars. */
function beforeOf(p: PlayerState, result: SessionResult): LastOutcome['before'] {
  const levels: Record<string, number> = {}
  const exp: Record<string, number> = {}
  for (const m of result.members) {
    const before = p.pokemon[m.uid]
    if (before) {
      levels[m.uid] = before.level
      exp[m.uid] = before.exp
    }
  }
  return { levels, exp, trainerLevel: p.trainer.level }
}

/** The waves of a session (claimed or cancelled) run on the content the session pinned. */
function pinEncounter(player: PlayerState, session: ActiveSession): PlayerState {
  const enc = player.encounter
  return enc && session.contentHash !== undefined && enc.sessionId === session.id ? { ...player, encounter: { ...enc, contentHash: session.contentHash } } : player
}

/** `{ contentHash }` to spread on a new session, or nothing for the base content. */
function pinned(hash: string | undefined): { contentHash?: string } {
  return hash !== undefined && hash !== 'base' ? { contentHash: hash } : {}
}

function sumChains(p: PlayerState): number {
  return Object.values(p.candies.chains).reduce((a, b) => a + b, 0)
}
