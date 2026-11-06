/**
 * F2 client ⇄ server contract (see docs/F2-plan.md).
 *
 * The server is authoritative: it owns the player's `GameDoc`, runs every rule
 * with the engine and returns the new doc. The browser only sends intents.
 * This file is shared by `server/` and `src/ui/` — it must stay pure types
 * (plus tiny constants), no runtime imports besides the engine's types.
 */
import type {
  BoxError,
  CandyKind,
  ChargeError,
  MissionReward,
  OwnedPokemon,
  PlayerState,
  ProgressEvent,
  SoundProfile,
  SessionResult,
  StartSessionError,
  ThrowBall,
  ThrowError,
  ThrowOutcome,
  TimeZoneSpec,
  WeatherInput,
  WildRef,
} from '../engine'

// ---------------------------------------------------------------------------
// Game document (what used to be the persisted slice of the zustand store)
// ---------------------------------------------------------------------------

/** Timer of the active study session, in game time (ms). */
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

/** Optional pomodoro break after a session (GDD §5.3). */
export interface BreakTimer {
  /** Session (history id) the break belongs to: one break per session. */
  forSession: string
  startedAt: number
  endsAt: number
  minutes: number
}

/** One row per user in `player_doc.doc`. `player` is null until the starter is chosen. */
export interface GameDoc {
  player: PlayerState | null
  timer: SessionTimer | null
  outcome: LastOutcome | null
  breakTimer: BreakTimer | null
  /** History id of the last session whose break was taken or skipped. */
  lastBreakFor: string | null
}

export const EMPTY_DOC: GameDoc = { player: null, timer: null, outcome: null, breakTimer: null, lastBreakFor: null }

// ---------------------------------------------------------------------------
// Actions: POST /api/game/action  body = GameAction
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'createPlayer'; locale: 'es' | 'en'; timezone: TimeZoneSpec; starterSlug: string }
  | { type: 'updateProfile'; patch: { locale?: 'es' | 'en'; timezone?: TimeZoneSpec; city?: string | null } }
  | { type: 'setWeather'; weather: WeatherInput | null }
  // Study session
  | { type: 'start'; minutes: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'markNotified' }
  /**
   * `devFocusLabel` is honored only when the server runs with DEV_TOOLS=1.
   * `soundProfile`: microphone shares measured in the browser (audio never leaves the device).
   */
  | { type: 'claim'; devFocusLabel?: string | null; soundProfile?: SoundProfile | null }
  | { type: 'dismissResults' }
  // Waves
  | { type: 'throwBall'; ref: WildRef; ball: ThrowBall }
  | { type: 'applyStatus'; chargeId: string; ref: WildRef }
  | { type: 'reroll'; chargeId: string; ref: WildRef }
  | { type: 'nextWave' }
  | { type: 'finishWaves' }
  // Box
  | { type: 'release'; uid: string }
  | { type: 'feedCandy'; uid: string; candy: CandyKind; count: number }
  | { type: 'equip'; uid: string; moves: string[] }
  | { type: 'setTeam'; uids: string[] }
  | { type: 'setLeader'; uid: string }
  | { type: 'evolve'; uid: string; to: string }
  | { type: 'heal'; uid: string; item: string }
  // Missions
  | { type: 'claimMission'; id: string }
  | { type: 'claimAllMissions' }
  // Pomodoro break
  | { type: 'startBreak'; minutes: number }
  | { type: 'endBreak' }
  | { type: 'skipBreak' }
  // Dev helpers — rejected with 403 unless the server runs with DEV_TOOLS=1
  | { type: 'devAddItems'; items: Record<string, number> }
  | { type: 'devAddDust'; amount: number }
  | { type: 'devAddCandies'; amount: number }
  | { type: 'devLevelUp'; levels: number }
  | { type: 'devAddRandomPokemon'; count: number }
  | { type: 'resetAll' }

export type GameActionType = GameAction['type']

/** Extra data each action returns besides the new doc (`null` = nothing). */
export interface ActionResults {
  createPlayer: null
  updateProfile: null
  setWeather: null
  start: null
  pause: null
  resume: null
  cancel: null
  markNotified: null
  claim: { outcome: LastOutcome }
  dismissResults: null
  throwBall: { outcome: ThrowOutcome }
  applyStatus: null
  reroll: null
  nextWave: null
  finishWaves: null
  release: null
  feedCandy: { events: ProgressEvent[]; dustSpent: number; used: number }
  equip: null
  setTeam: null
  setLeader: null
  evolve: { pokemon: OwnedPokemon }
  heal: null
  claimMission: { reward: MissionReward }
  claimAllMissions: { rewards: MissionReward[] }
  startBreak: null
  endBreak: { rewarded: boolean }
  skipBreak: null
  devAddItems: null
  devAddDust: null
  devAddCandies: null
  devLevelUp: null
  devAddRandomPokemon: null
  resetAll: null
}

/** Engine / rule errors an action can fail with (HTTP 409, body `{ error }`). */
export type GameActionError =
  | StartSessionError
  | ThrowError
  | ChargeError
  | BoxError
  | 'no_player'
  | 'player_exists'
  | 'invalid_starter'
  | 'not_finished'
  | 'paused'
  | 'no_session'
  | 'unknown_mission'
  | 'already_claimed'
  | 'not_complete'
  | 'no_break'
  | 'session_active_elsewhere'
  | (string & {})

/** 200 response of POST /api/game/action and of GET /api/game. */
export interface GameSnapshot {
  doc: GameDoc
  /** Monotonic per user; bumps on every successful write. */
  version: number
  /** Server clock (ms) when the response was built — the client uses it to estimate skew. */
  serverNow: number
}

export type ActionResponse<T extends GameActionType = GameActionType> = GameSnapshot & { result: ActionResults[T] }

// ---------------------------------------------------------------------------
// Auth & social payloads
// ---------------------------------------------------------------------------

export interface PublicUser {
  id: string
  email: string
  trainerName: string
  /** ISO 3166-1 alpha-2, uppercase (e.g. 'PE'). */
  country: string
  /** 8-char code others type to send a friend request. */
  friendCode: string
  createdAt: number
}

export interface AuthSessionInfo {
  id: string
  createdAt: number
  lastSeenAt: number
  userAgent: string | null
  current: boolean
}

export type FriendStatus = 'friend' | 'incoming' | 'outgoing'

export interface FriendSummary {
  userId: string
  trainerName: string
  country: string
  friendCode: string
  status: FriendStatus
  /** Only for accepted friends. */
  trainerLevel?: number
  weeklyPoints?: number
  league?: string
  /** Species slugs of the team, leader first. */
  team?: { speciesSlug: string; shiny: boolean; level: number }[]
}

export type LeaderboardScope = 'global' | 'country' | 'friends'
export type LeaderboardPeriod = 'week' | 'month'

export interface LeaderboardRow {
  rank: number
  userId: string
  trainerName: string
  country: string
  points: number
  league: string
  /** Leader species slug (for the avatar). */
  leader: string | null
  me: boolean
}

export interface LeaderboardResponse {
  scope: LeaderboardScope
  period: LeaderboardPeriod
  /** e.g. '2026-W45' or '2026-11'. */
  periodKey: string
  rows: LeaderboardRow[]
  /** The caller's own row, even if outside `rows`. null if no points yet. */
  mine: LeaderboardRow | null
  total: number
}

/** Server-sent events on GET /api/events (EventSource). */
export type ServerEvent =
  | { type: 'game'; version: number }
  | { type: 'friends' }
  | { type: 'logout' }

/** Header names used only when the server runs with DEV_TOOLS=1. */
export const DEV_NOW_HEADER = 'x-dev-now'
export const DEV_SEED_HEADER = 'x-dev-seed'
