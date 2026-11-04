/**
 * Game store (persisted): the engine `PlayerState` plus the UI bookkeeping
 * around a session (timer, last result). Every rule runs in the engine; actions
 * here only pick inputs (time, rng, focus label) and save what the engine returns.
 *
 * Time: always `now()` from prefs.ts (dev clock aware).
 * RNG: `rng()` below (fixed seed from the dev panel, random otherwise).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  addItems,
  advanceWave,
  applySessionResult,
  applyStatusCharge,
  cancelSession,
  claimAllMissions,
  claimMission,
  completeBreak,
  completeSession,
  createIndividual,
  createNewPlayer,
  createRng,
  defaultContext,
  equipMoves,
  evolvePokemon,
  expForLevel,
  finishEncounter,
  gainExp,
  levelCap,
  MINUTE_MS,
  releasePokemon,
  rerollWild,
  setLeader,
  setTeam,
  startSession,
  throwBall,
  toOwnedPokemon,
  useCandy,
  useHealItem,
  type BoxError,
  type CandyKind,
  type MissionReward,
  type OwnedPokemon,
  type UseItemError,
  type ChargeError,
  type ProgressEvent,
  type PlayerState,
  type SessionResult,
  type StartSessionError,
  type ThrowBall,
  type ThrowError,
  type ThrowOutcome,
  type TimeZoneSpec,
  type TypeSlug,
  type WeatherInput,
  type WildRef,
} from '../../engine'
import type { Locale } from '../../i18n'
import { jsonStorage, STORAGE_KEYS } from './persistence'
import { now, usePrefs } from './prefs'

const ctx = defaultContext()

/** Timer of the active session, in game time (ms). */
export interface SessionTimer {
  sessionId: string
  /** When the countdown reaches 0 (already includes pauses taken so far). */
  endsAt: number
  /** Set while paused. */
  pausedAt: number | null
  /** Total paused time so far (ms). */
  pausedMs: number
  /** The end-of-session notification was already sent (one tab, once). */
  notified: boolean
}

export interface LastOutcome {
  result: SessionResult
  events: ProgressEvent[]
  /** Player state right before applying the result (for "before → after" bars). */
  before: { levels: Record<string, number>; exp: Record<string, number>; trainerLevel: number }
  /** Results screen was dismissed. */
  seen: boolean
}

export type Phase = 'none' | 'idle' | 'focus' | 'paused' | 'claim' | 'late' | 'results' | 'waves' | 'break'

/** Optional pomodoro break after a session (GDD §5.3): +breakRecoverPct Energy to the team when completed. */
export interface BreakTimer {
  /** Session (history id) the break belongs to: one break per session. */
  forSession: string
  startedAt: number
  endsAt: number
  minutes: number
}

export interface GameState {
  player: PlayerState | null
  timer: SessionTimer | null
  outcome: LastOutcome | null
  breakTimer: BreakTimer | null
  /** History id of the last session whose break was taken or skipped. */
  lastBreakFor: string | null

  createPlayer: (input: { trainerName: string; locale: Locale; timezone: TimeZoneSpec; starterSlug: string }) => boolean
  updateProfile: (patch: Partial<Pick<PlayerState['profile'], 'trainerName' | 'locale' | 'timezone' | 'city'>>) => void
  setWeather: (weather: WeatherInput | null) => void

  start: (minutes: number) => StartSessionError | null
  pause: () => void
  resume: () => void
  cancel: () => void
  markNotified: () => void
  claim: () => boolean
  dismissResults: () => void

  throwBall: (ref: WildRef, ball: ThrowBall) => { ok: true; outcome: ThrowOutcome } | { ok: false; error: ThrowError }
  applyStatus: (chargeId: string, ref: WildRef) => ChargeError | null
  reroll: (chargeId: string, ref: WildRef) => ChargeError | null
  nextWave: () => void
  finishWaves: () => void

  /** Box (all return an engine error code or null). */
  release: (uid: string) => BoxError | null
  feedCandy: (uid: string, candy: CandyKind, count: number) => { ok: true; events: ProgressEvent[]; dustSpent: number; used: number } | { ok: false; error: BoxError }
  equip: (uid: string, moves: string[]) => BoxError | null
  setTeam: (uids: string[]) => BoxError | null
  setLeader: (uid: string) => BoxError | null
  evolve: (uid: string, to: string) => { ok: true; pokemon: OwnedPokemon } | { ok: false; error: BoxError }
  heal: (uid: string, item: string) => UseItemError | null

  /** Missions (engine `claimMission` / `claimAllMissions`). */
  claimMission: (id: string) => { ok: true; reward: MissionReward } | { ok: false; error: string }
  claimAllMissions: () => MissionReward[]

  /** Pomodoro break. */
  startBreak: (minutes: number) => void
  /** Completed → engine `completeBreak` (team Energy). Early → no reward. Returns whether it was rewarded. */
  endBreak: () => boolean
  skipBreak: () => void

  /** Dev helpers. */
  devAddItems: (items: Record<string, number>) => void
  devAddDust: (amount: number) => void
  devAddCandies: (amount: number) => void
  devFinishNow: () => void
  devLevelUp: (levels: number) => void
  devAddRandomPokemon: (count: number) => void
  resetAll: () => void
}

/** RNG for one engine call. */
export function rng() {
  const seed = usePrefs.getState().nextSeed()
  return createRng(seed ?? `${Date.now()}-${Math.random()}`)
}

/** Derived phase of the core loop at time `t`. */
export function phaseOf(s: Pick<GameState, 'player' | 'timer' | 'outcome'> & { breakTimer?: BreakTimer | null }, t: number): Phase {
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

/** Timer for the active session, rebuilt if it was lost (e.g. older save). */
export function timerOf(s: Pick<GameState, 'player' | 'timer'>): SessionTimer | null {
  const a = s.player?.activeSession
  if (!a) return null
  if (s.timer && s.timer.sessionId === a.id) return s.timer
  return { sessionId: a.id, endsAt: a.startedAt + a.plannedMinutes * MINUTE_MS, pausedAt: null, pausedMs: 0, notified: false }
}

export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
      player: null,
      timer: null,
      outcome: null,
      breakTimer: null,
      lastBreakFor: null,

      createPlayer: ({ trainerName, locale, timezone, starterSlug }) => {
        const r = createNewPlayer({ trainerName, locale, timezone, starterSlug, now: now() }, rng())
        if (!r.ok) return false
        set({ player: r.value, timer: null, outcome: null })
        return true
      },
      updateProfile: (patch) =>
        set((s) => (s.player ? { player: { ...s.player, profile: { ...s.player.profile, ...patch } } } : s)),
      setWeather: (weather) =>
        set((s) => (s.player ? { player: { ...s.player, profile: { ...s.player.profile, weather } } } : s)),

      start: (minutes) => {
        const p = get().player
        if (!p) return 'empty_team'
        const t = now()
        const r = startSession(p, { plannedMinutes: minutes, startedAt: t })
        if (!r.ok) return r.error
        set({
          player: r.value.state,
          timer: { sessionId: r.value.session.id, endsAt: t + minutes * MINUTE_MS, pausedAt: null, pausedMs: 0, notified: false },
          outcome: null,
          breakTimer: null,
          lastBreakFor: get().breakTimer?.forSession ?? get().lastBreakFor,
        })
        return null
      },
      pause: () => {
        const timer = timerOf(get())
        if (!timer || timer.pausedAt !== null) return
        if (now() >= timer.endsAt) return
        set({ timer: { ...timer, pausedAt: now() } })
      },
      resume: () => {
        const timer = timerOf(get())
        if (!timer || timer.pausedAt === null) return
        const d = Math.max(0, now() - timer.pausedAt)
        set({ timer: { ...timer, pausedAt: null, pausedMs: timer.pausedMs + d, endsAt: timer.endsAt + d } })
      },
      cancel: () => {
        const p = get().player
        if (!p) return
        set({ player: cancelSession(p), timer: null })
      },
      markNotified: () => {
        const timer = timerOf(get())
        if (timer) set({ timer: { ...timer, notified: true } })
      },
      claim: () => {
        const s = get()
        const p = s.player
        const session = p?.activeSession
        const timer = timerOf(s)
        if (!p || !session || !timer) return false
        const t = now()
        if (timer.pausedAt !== null || t < timer.endsAt) return false
        const label = usePrefs.getState().dev.focusLabel
        const done = completeSession(
          p,
          session,
          {
            endedAt: timer.endsAt,
            claimedAt: t,
            pausedSeconds: timer.pausedMs / 1000,
            focusInputs: { screenshotLabels: label ? [label] : null, missedCaptures: 0 },
          },
          rng(),
        )
        if (!done.ok) return false
        const applied = applySessionResult(p, done.value)
        if (!applied.ok) return false
        const levels: Record<string, number> = {}
        const exp: Record<string, number> = {}
        for (const m of done.value.members) {
          const before = p.pokemon[m.uid]
          if (before) {
            levels[m.uid] = before.level
            exp[m.uid] = before.exp
          }
        }
        set({
          player: applied.value.state,
          timer: null,
          outcome: {
            result: done.value,
            events: applied.value.events,
            before: { levels, exp, trainerLevel: p.trainer.level },
            seen: false,
          },
        })
        return true
      },
      dismissResults: () => set((s) => (s.outcome ? { outcome: { ...s.outcome, seen: true } } : s)),

      throwBall: (ref, ball) => {
        const p = get().player
        if (!p) return { ok: false, error: 'no_encounter' }
        const r = throwBall(p, ref, ball, rng(), now())
        if (!r.ok) return { ok: false, error: r.error }
        set({ player: r.value.state })
        return { ok: true, outcome: r.value.outcome }
      },
      applyStatus: (chargeId, ref) => {
        const p = get().player
        if (!p) return 'no_encounter'
        const r = applyStatusCharge(p, chargeId, ref)
        if (!r.ok) return r.error
        set({ player: r.value })
        return null
      },
      reroll: (chargeId, ref) => {
        const p = get().player
        if (!p) return 'no_encounter'
        const r = rerollWild(p, chargeId, ref, rng())
        if (!r.ok) return r.error
        set({ player: r.value })
        return null
      },
      nextWave: () => set((s) => (s.player ? { player: advanceWave(s.player) } : s)),
      finishWaves: () => set((s) => (s.player ? { player: finishEncounter(s.player) } : s)),

      release: (uid) => {
        const p = get().player
        if (!p) return 'unknown_pokemon'
        const r = releasePokemon(p, uid)
        if (!r.ok) return r.error
        set({ player: r.value })
        return null
      },
      feedCandy: (uid, candy, count) => {
        const p = get().player
        if (!p) return { ok: false, error: 'unknown_pokemon' }
        const r = useCandy(p, uid, candy, count)
        if (!r.ok) return { ok: false, error: r.error }
        const before = candy.kind === 'species' ? sumChains(p) : (p.candies.types[candy.type] ?? 0)
        const after = candy.kind === 'species' ? sumChains(r.value.state) : (r.value.state.candies.types[candy.type] ?? 0)
        set({ player: r.value.state })
        usePrefs.getState().markMilestone('candy')
        return { ok: true, events: r.value.events, dustSpent: r.value.dustSpent, used: before - after }
      },
      equip: (uid, moves) => {
        const p = get().player
        if (!p) return 'unknown_pokemon'
        const r = equipMoves(p, uid, moves)
        if (!r.ok) return r.error
        set({ player: r.value })
        if (moves.length > 0) usePrefs.getState().markMilestone('equip')
        return null
      },
      setTeam: (uids) => {
        const p = get().player
        if (!p) return 'unknown_pokemon'
        const r = setTeam(p, uids, now())
        if (!r.ok) return r.error
        set({ player: r.value })
        return null
      },
      setLeader: (uid) => {
        const p = get().player
        if (!p) return 'unknown_pokemon'
        const r = setLeader(p, uid, now())
        if (!r.ok) return r.error
        set({ player: r.value })
        return null
      },
      evolve: (uid, to) => {
        const p = get().player
        if (!p) return { ok: false, error: 'unknown_pokemon' }
        const r = evolvePokemon(p, uid, to, now(), rng())
        if (!r.ok) return { ok: false, error: r.error }
        set({ player: r.value.state })
        usePrefs.getState().markMilestone('evolve')
        return { ok: true, pokemon: r.value.pokemon }
      },
      heal: (uid, item) => {
        const p = get().player
        if (!p) return 'unknown_pokemon'
        const r = useHealItem(p, uid, item, now())
        if (!r.ok) return r.error
        set({ player: r.value })
        return null
      },

      claimMission: (id) => {
        const p = get().player
        if (!p) return { ok: false, error: 'unknown_mission' }
        const r = claimMission(p, id, now())
        if (!r.ok) return { ok: false, error: r.error }
        set({ player: r.value.state })
        return { ok: true, reward: r.value.reward }
      },
      claimAllMissions: () => {
        const p = get().player
        if (!p) return []
        const r = claimAllMissions(p, now())
        set({ player: r.state })
        return r.rewards.map((x) => x.reward)
      },

      startBreak: (minutes) => {
        const p = get().player
        const last = p?.history[p.history.length - 1]
        if (!p || !last || p.activeSession || get().lastBreakFor === last.id) return
        const t = now()
        set({ breakTimer: { forSession: last.id, startedAt: t, endsAt: t + minutes * MINUTE_MS, minutes } })
      },
      endBreak: () => {
        const b = get().breakTimer
        const p = get().player
        if (!b || !p) return false
        const done = now() >= b.endsAt
        set({ breakTimer: null, lastBreakFor: b.forSession, player: done ? completeBreak(p, now()) : p })
        return done
      },
      skipBreak: () => {
        const p = get().player
        const last = p?.history[p.history.length - 1]
        set({ breakTimer: null, lastBreakFor: get().breakTimer?.forSession ?? last?.id ?? null })
      },

      devAddItems: (items) => set((s) => (s.player ? { player: addItems(s.player, items) } : s)),
      devAddDust: (amount) => set((s) => (s.player ? { player: { ...s.player, dust: s.player.dust + amount } } : s)),
      devAddCandies: (amount) =>
        set((s) => {
          const p = s.player
          if (!p) return s
          const chains = { ...p.candies.chains }
          const types: Partial<Record<TypeSlug, number>> = { ...p.candies.types }
          for (const uid of p.team) {
            const mon = p.pokemon[uid]
            const sp = mon ? ctx.speciesBySlug.get(mon.speciesSlug) : undefined
            if (!sp) continue
            chains[String(sp.evolutionChainId)] = (chains[String(sp.evolutionChainId)] ?? 0) + amount
            for (const ty of sp.types) types[ty] = (types[ty] ?? 0) + amount
          }
          return { player: { ...p, candies: { chains, types } } }
        }),
      devFinishNow: () => {
        const timer = timerOf(get())
        if (!timer) return
        let tm = timer
        if (tm.pausedAt !== null) {
          get().resume()
          tm = timerOf(get()) ?? tm
        }
        const ahead = tm.endsAt - now()
        if (ahead > 0) usePrefs.getState().advanceClock(ahead + 50)
      },
      devLevelUp: (levels) =>
        set((s) => {
          const p = s.player
          if (!p) return s
          const cap = levelCap(p)
          const pokemon = { ...p.pokemon }
          for (const uid of p.team) {
            const mon = pokemon[uid]
            if (!mon) continue
            const target = Math.min(cap, mon.level + levels)
            pokemon[uid] = gainExp(mon, Math.max(0, expForLevel(target) - mon.exp), cap).pokemon
          }
          return { player: { ...p, pokemon } }
        }),
      devAddRandomPokemon: (count) =>
        set((s) => {
          const p = s.player
          if (!p) return s
          const r = rng()
          const pool = ctx.data.species.filter((sp) => !sp.isLegendary && !sp.isMythical)
          const pokemon = { ...p.pokemon }
          const caught = new Set(p.pokedex.caught)
          const seen = new Set(p.pokedex.seen)
          let n = p.counters.pokemon
          const t = now()
          for (let i = 0; i < count; i++) {
            const sp = pool[Math.floor(r.next() * pool.length)]!
            const level = 3 + Math.floor(r.next() * 25)
            const core = createIndividual(sp.slug, level, r, { shiny: r.next() < 0.08 })
            n++
            const uid = `p${n}`
            pokemon[uid] = toOwnedPokemon(core, uid, t - i * 3_600_000, 'poke-ball')
            caught.add(sp.slug)
            seen.add(sp.slug)
          }
          for (const sp of pool) if (r.next() < 0.25) seen.add(sp.slug)
          return { player: { ...p, pokemon, pokedex: { caught: [...caught], seen: [...seen] }, counters: { ...p.counters, pokemon: n } } }
        }),
      resetAll: () => set({ player: null, timer: null, outcome: null, breakTimer: null, lastBreakFor: null }),
    }),
    {
      name: STORAGE_KEYS.game,
      storage: jsonStorage,
      version: 1,
      partialize: ({ player, timer, outcome, breakTimer, lastBreakFor }) => ({ player, timer, outcome, breakTimer, lastBreakFor }),
    },
  ),
)

function sumChains(p: PlayerState): number {
  return Object.values(p.candies.chains).reduce((a, b) => a + b, 0)
}

/** Keep tabs in sync: another tab wrote the save → reload it here. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.game) void useGame.persist.rehydrate()
    if (e.key === STORAGE_KEYS.prefs) void usePrefs.persist.rehydrate()
  })
}
