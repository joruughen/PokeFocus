/**
 * Game store: a cache of the player's server-side `GameDoc` (docs/F2-plan.md).
 *
 * The server is authoritative. Every action POSTs a `GameAction` to
 * /api/game/action and replaces the cached doc with the response, but only if
 * the response's `version` is newer than what we hold (two tabs, SSE refetches
 * and slow responses can arrive in any order). Nothing is persisted locally.
 *
 * Actions return Promises with the same shapes the UI used before (an error
 * code or null, `{ ok, … }` objects, booleans). Failures that are not game
 * rules (network, 5xx, 403) come back with their code ('network', 'http_500'…)
 * and are also kept in `error`.
 *
 * Time: `now()` from prefs.ts. Its "real" time is the browser clock corrected
 * by the server skew (`serverNow - Date.now()` at each response), so countdowns
 * derived from `doc.timer.endsAt` match the server without flicker. With the
 * dev clock active, the virtual time travels as the `x-dev-now` header instead
 * and the skew is left untouched.
 */
import { create } from 'zustand'
import {
  MINUTE_MS,
  defaultContext,
  type BoxError,
  type CandyKind,
  type MissionReward,
  type OwnedPokemon,
  type ProgressEvent,
  type StartSessionError,
  type ThrowBall,
  type ThrowOutcome,
  type TimeZoneSpec,
  type WeatherInput,
  type WildRef,
} from '../../engine'
import {
  EMPTY_DOC,
  type ActionResults,
  type BreakTimer,
  type GameAction,
  type GameActionError,
  type GameActionType,
  type GameDoc,
  type GameSnapshot,
  type LastOutcome,
  type SessionTimer,
} from '../../game/protocol'
import type { Locale } from '../../i18n'
import { errorCode } from '../api/client'
import { gameApi } from '../api/endpoints'
import { clearMicTallies, micProfileFor } from '../lib/mic/monitor'
import { devEnabled, now, setServerOffset, usePrefs } from './prefs'

export type { BreakTimer, LastOutcome, SessionTimer }

const ctx = defaultContext()

export type Phase = 'none' | 'idle' | 'focus' | 'paused' | 'claim' | 'late' | 'results' | 'waves' | 'break'

/** Result of an action call: the action's extra data, or an error code. */
export type ActionOutcome<T extends GameActionType> = { ok: true; result: ActionResults[T] } | { ok: false; error: GameActionError }

export interface GameState extends GameDoc {
  /** Version of the doc we hold (-1 = nothing loaded). */
  version: number
  /** The doc was loaded from the server at least once for this account. */
  loaded: boolean
  /** GET /api/game in flight. */
  loading: boolean
  /** Number of user actions in flight (buttons disable while > 0). */
  pending: number
  /** Last failure code (load or action), cleared on the next success. */
  error: string | null

  /** GET /api/game (on login, on an SSE 'game' event, on retry). */
  load: () => Promise<boolean>
  /** Forget everything (logout). */
  clear: () => void
  /** Send any action; used by the typed helpers below. */
  dispatch: <A extends GameAction>(action: A, opts?: { background?: boolean }) => Promise<ActionOutcome<A['type']>>

  createPlayer: (input: { locale: Locale; timezone: TimeZoneSpec; starterSlug: string }) => Promise<boolean>
  updateProfile: (patch: { locale?: Locale; timezone?: TimeZoneSpec; city?: string | null }) => Promise<GameActionError | null>
  setWeather: (weather: WeatherInput | null) => Promise<GameActionError | null>

  start: (minutes: number) => Promise<StartSessionError | GameActionError | null>
  pause: () => Promise<GameActionError | null>
  resume: () => Promise<GameActionError | null>
  cancel: () => Promise<GameActionError | null>
  markNotified: () => Promise<void>
  claim: () => Promise<boolean>
  dismissResults: () => Promise<GameActionError | null>

  throwBall: (ref: WildRef, ball: ThrowBall) => Promise<{ ok: true; outcome: ThrowOutcome } | { ok: false; error: GameActionError }>
  applyStatus: (chargeId: string, ref: WildRef) => Promise<GameActionError | null>
  reroll: (chargeId: string, ref: WildRef) => Promise<GameActionError | null>
  /** Manual damage split (before the wave's first ball). */
  assignDamage: (waveIndex: number, uid: string, wildIndex: number | null) => Promise<GameActionError | null>
  autoAssignDamage: (waveIndex: number) => Promise<GameActionError | null>
  setAutoDamage: (value: boolean) => Promise<GameActionError | null>
  nextWave: () => Promise<GameActionError | null>
  finishWaves: () => Promise<GameActionError | null>

  /** Box (error code or null). */
  release: (uid: string) => Promise<BoxError | GameActionError | null>
  feedCandy: (
    uid: string,
    candy: CandyKind,
    count: number,
  ) => Promise<{ ok: true; events: ProgressEvent[]; dustSpent: number; used: number } | { ok: false; error: GameActionError }>
  equip: (uid: string, moves: string[]) => Promise<GameActionError | null>
  setTeam: (uids: string[]) => Promise<GameActionError | null>
  setLeader: (uid: string) => Promise<GameActionError | null>
  evolve: (uid: string, to: string) => Promise<{ ok: true; pokemon: OwnedPokemon } | { ok: false; error: GameActionError }>
  heal: (uid: string, item: string) => Promise<GameActionError | null>

  claimMission: (id: string) => Promise<{ ok: true; reward: MissionReward } | { ok: false; error: GameActionError }>
  /** Rewards claimed ([] on failure; see `error`). */
  claimAllMissions: () => Promise<MissionReward[]>

  startBreak: (minutes: number) => Promise<GameActionError | null>
  /** Whether the completed break was rewarded (false on early end or failure). */
  endBreak: () => Promise<boolean>
  skipBreak: () => Promise<GameActionError | null>

  /** Dev helpers (the server accepts them only with DEV_TOOLS=1). */
  devAddItems: (items: Record<string, number>) => Promise<GameActionError | null>
  devAddDust: (amount: number) => Promise<GameActionError | null>
  devAddCandies: (amount: number) => Promise<GameActionError | null>
  /** Client-only: jumps the dev clock to the end of the session. */
  devFinishNow: () => Promise<void>
  devLevelUp: (levels: number) => Promise<GameActionError | null>
  devAddRandomPokemon: (count: number) => Promise<GameActionError | null>
  resetAll: () => Promise<GameActionError | null>
}

/** Derived phase of the core loop at time `t`. */
export function phaseOf(s: Pick<GameDoc, 'player' | 'timer' | 'outcome'> & { breakTimer?: BreakTimer | null }, t: number): Phase {
  const p = s.player
  if (!p) return 'none'
  if (p.activeSession) {
    const timer = s.timer
    if (timer?.pausedAt != null) return 'paused'
    const endsAt = timer?.endsAt ?? p.activeSession.startedAt + p.activeSession.plannedMinutes * MINUTE_MS
    if (t < endsAt) return 'focus'
    return t - endsAt > ctx.config.session.claimWindowMinutes * MINUTE_MS ? 'late' : 'claim'
  }
  if (s.outcome && !s.outcome.seen) return 'results'
  if (p.encounter) return 'waves'
  if (s.breakTimer) return 'break'
  return 'idle'
}

/** Timer for the active session, rebuilt if the doc has none. */
export function timerOf(s: Pick<GameDoc, 'player' | 'timer'>): SessionTimer | null {
  const a = s.player?.activeSession
  if (!a) return null
  if (s.timer && s.timer.sessionId === a.id) return s.timer
  return { sessionId: a.id, endsAt: a.startedAt + a.plannedMinutes * MINUTE_MS, pausedAt: null, pausedMs: 0, notified: false }
}

const INITIAL = { ...EMPTY_DOC, version: -1, loaded: false, loading: false, pending: 0, error: null }

/** Bumped by `clear()`: responses started before a logout are dropped. */
let epoch = 0

/** Error code → `null` on success, for the actions that only report errors. */
const errOf = (r: ActionOutcome<GameActionType>): GameActionError | null => (r.ok ? null : r.error)

export const useGame = create<GameState>()((set, get) => {
  /** Adopt a snapshot if it is newer than what we hold. */
  const adopt = (snap: GameSnapshot, sentAt: number) => {
    // Skew: assume the server stamped the response halfway through the round trip.
    if (!usePrefs.getState().dev.anchor && Number.isFinite(snap.serverNow)) {
      const mid = (sentAt + Date.now()) / 2
      setServerOffset(snap.serverNow - mid)
    }
    if (snap.version <= get().version && get().loaded) return
    const d = snap.doc
    set({ player: d.player, timer: d.timer, outcome: d.outcome, breakTimer: d.breakTimer, lastBreakFor: d.lastBreakFor, version: snap.version, loaded: true })
  }

  const dispatch = async <A extends GameAction>(action: A, opts?: { background?: boolean }): Promise<ActionOutcome<A['type']>> => {
    const myEpoch = epoch
    const background = opts?.background ?? false
    if (!background) set((s) => ({ pending: s.pending + 1 }))
    const sentAt = Date.now()
    try {
      const res = await gameApi.action(action)
      if (myEpoch !== epoch) return { ok: false, error: 'logged_out' }
      adopt(res, sentAt)
      set({ error: null })
      return { ok: true, result: res.result as ActionResults[A['type']] }
    } catch (e) {
      const code = errorCode(e)
      if (myEpoch === epoch) set({ error: code })
      // A rule error may mean our cache is stale (another tab moved on): resync quietly.
      if (myEpoch === epoch && code !== 'network') void get().load()
      return { ok: false, error: code }
    } finally {
      if (!background && myEpoch === epoch) set((s) => ({ pending: Math.max(0, s.pending - 1) }))
    }
  }

  return {
    ...INITIAL,

    load: async () => {
      const myEpoch = epoch
      set({ loading: true })
      const sentAt = Date.now()
      try {
        const snap = await gameApi.get()
        if (myEpoch !== epoch) return false
        adopt(snap, sentAt)
        set({ loading: false, error: null })
        return true
      } catch (e) {
        if (myEpoch === epoch) set({ loading: false, error: errorCode(e) })
        return false
      }
    },
    clear: () => {
      epoch++
      set({ ...INITIAL })
    },
    dispatch,

    createPlayer: async ({ locale, timezone, starterSlug }) => (await dispatch({ type: 'createPlayer', locale, timezone, starterSlug })).ok,
    updateProfile: async (patch) => errOf(await dispatch({ type: 'updateProfile', patch })),
    setWeather: async (weather) => errOf(await dispatch({ type: 'setWeather', weather })),

    start: async (minutes) => errOf(await dispatch({ type: 'start', minutes })),
    pause: async () => errOf(await dispatch({ type: 'pause' })),
    resume: async () => errOf(await dispatch({ type: 'resume' })),
    cancel: async () => errOf(await dispatch({ type: 'cancel' })),
    markNotified: async () => {
      // Local flag first so the watcher (which runs 4×/s) asks only once; the server confirms it.
      const timer = timerOf(get())
      if (!timer || timer.notified) return
      set({ timer: { ...timer, notified: true } })
      await dispatch({ type: 'markNotified' }, { background: true })
    },
    claim: async () => {
      const label = usePrefs.getState().dev.focusLabel
      // Only the microphone shares go to the server (never audio).
      const sid = get().player?.activeSession?.id
      const soundProfile = sid ? micProfileFor(sid) : null
      const r = await dispatch({ type: 'claim', ...(devEnabled() ? { devFocusLabel: label } : {}), ...(soundProfile ? { soundProfile } : {}) })
      if (r.ok && sid) clearMicTallies()
      return r.ok
    },
    dismissResults: async () => errOf(await dispatch({ type: 'dismissResults' })),

    throwBall: async (ref, ball) => {
      const r = await dispatch({ type: 'throwBall', ref, ball })
      return r.ok ? { ok: true, outcome: r.result.outcome } : { ok: false, error: r.error }
    },
    applyStatus: async (chargeId, ref) => errOf(await dispatch({ type: 'applyStatus', chargeId, ref })),
    reroll: async (chargeId, ref) => errOf(await dispatch({ type: 'reroll', chargeId, ref })),
    assignDamage: async (waveIndex, uid, wildIndex) => errOf(await dispatch({ type: 'assignDamage', waveIndex, uid, wildIndex })),
    autoAssignDamage: async (waveIndex) => errOf(await dispatch({ type: 'autoAssignDamage', waveIndex })),
    setAutoDamage: async (value) => errOf(await dispatch({ type: 'setAutoDamage', value })),
    nextWave: async () => errOf(await dispatch({ type: 'nextWave' })),
    finishWaves: async () => errOf(await dispatch({ type: 'finishWaves' })),

    release: async (uid) => errOf(await dispatch({ type: 'release', uid })),
    feedCandy: async (uid, candy, count) => {
      const r = await dispatch({ type: 'feedCandy', uid, candy, count })
      if (!r.ok) return { ok: false, error: r.error }
      usePrefs.getState().markMilestone('candy')
      return { ok: true, events: r.result.events, dustSpent: r.result.dustSpent, used: r.result.used }
    },
    equip: async (uid, moves) => {
      const r = await dispatch({ type: 'equip', uid, moves })
      if (r.ok && moves.length > 0) usePrefs.getState().markMilestone('equip')
      return errOf(r)
    },
    setTeam: async (uids) => errOf(await dispatch({ type: 'setTeam', uids })),
    setLeader: async (uid) => errOf(await dispatch({ type: 'setLeader', uid })),
    evolve: async (uid, to) => {
      const r = await dispatch({ type: 'evolve', uid, to })
      if (!r.ok) return { ok: false, error: r.error }
      usePrefs.getState().markMilestone('evolve')
      return { ok: true, pokemon: r.result.pokemon }
    },
    heal: async (uid, item) => errOf(await dispatch({ type: 'heal', uid, item })),

    claimMission: async (id) => {
      const r = await dispatch({ type: 'claimMission', id })
      if (!r.ok) return { ok: false, error: r.error }
      usePrefs.getState().markMilestone('mission')
      return { ok: true, reward: r.result.reward }
    },
    claimAllMissions: async () => {
      const r = await dispatch({ type: 'claimAllMissions' })
      if (!r.ok) return []
      if (r.result.rewards.length > 0) usePrefs.getState().markMilestone('mission')
      return r.result.rewards
    },

    startBreak: async (minutes) => errOf(await dispatch({ type: 'startBreak', minutes })),
    endBreak: async () => {
      const r = await dispatch({ type: 'endBreak' })
      return r.ok && r.result.rewarded
    },
    skipBreak: async () => errOf(await dispatch({ type: 'skipBreak' })),

    devAddItems: async (items) => errOf(await dispatch({ type: 'devAddItems', items })),
    devAddDust: async (amount) => errOf(await dispatch({ type: 'devAddDust', amount })),
    devAddCandies: async (amount) => errOf(await dispatch({ type: 'devAddCandies', amount })),
    devFinishNow: async () => {
      let timer = timerOf(get())
      if (!timer) return
      if (timer.pausedAt !== null) {
        await get().resume()
        timer = timerOf(get())
        if (!timer) return
      }
      const ahead = timer.endsAt - now()
      if (ahead > 0) usePrefs.getState().advanceClock(ahead + 50)
    },
    devLevelUp: async (levels) => errOf(await dispatch({ type: 'devLevelUp', levels })),
    devAddRandomPokemon: async (count) => errOf(await dispatch({ type: 'devAddRandomPokemon', count })),
    resetAll: async () => errOf(await dispatch({ type: 'resetAll' })),
  }
})
