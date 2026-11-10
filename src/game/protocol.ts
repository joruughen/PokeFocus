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
  DamageError,
  MissionReward,
  NicknameError,
  OwnedPokemon,
  PlayerState,
  PresetError,
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
  | { type: 'updateProfile'; patch: { locale?: 'es' | 'en'; timezone?: TimeZoneSpec; city?: string | null; location?: { lat: number; lon: number } | null } }
  | { type: 'setWeather'; weather: WeatherInput | null }
  // Study session
  | { type: 'start'; minutes: number }
  | { type: 'pause' }
  | { type: 'resume' }
  /**
   * Long sessions (GDD §5.6) keep the minutes studied and the waves of the full
   * 25-min blocks, decided with the server clock. `soundProfile` as in `claim`.
   */
  | { type: 'cancel'; soundProfile?: SoundProfile | null }
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
  /** Manual damage split: send a member's damage token of a wave to a wild (`null` = take it back). */
  | { type: 'assignDamage'; waveIndex: number; uid: string; wildIndex: number }
  /** Unassigned tokens of the wave take the automatic split. */
  | { type: 'autoAssignDamage'; waveIndex: number }
  /** Preference copied into the next claimed encounter (`EncounterState.damageMode`). */
  | { type: 'setAutoDamage'; value: boolean }
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
  /** Nickname: up to 12 graphemes, trimmed; empty text or null removes it. Allowed at any time. */
  | { type: 'setNickname'; uid: string; nickname: string | null }
  // Saved teams (max 10). `applyPreset` only between sessions.
  | { type: 'savePreset'; name: string }
  | { type: 'renamePreset'; id: string; name: string }
  | { type: 'overwritePreset'; id: string }
  | { type: 'deletePreset'; id: string }
  | { type: 'applyPreset'; id: string }
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
  /** `outcome` when the cancelled session kept something (it is also `doc.outcome`), null when nothing was kept. */
  cancel: { outcome: LastOutcome | null }
  markNotified: null
  claim: { outcome: LastOutcome }
  dismissResults: null
  throwBall: { outcome: ThrowOutcome }
  applyStatus: null
  reroll: null
  assignDamage: null
  autoAssignDamage: null
  setAutoDamage: null
  nextWave: null
  finishWaves: null
  release: null
  feedCandy: { events: ProgressEvent[]; dustSpent: number; used: number }
  equip: null
  setTeam: null
  setLeader: null
  evolve: { pokemon: OwnedPokemon }
  heal: null
  setNickname: null
  savePreset: { id: string }
  renamePreset: null
  overwritePreset: null
  deletePreset: null
  /** `missing`: members of the preset that no longer exist (released) and were skipped. */
  applyPreset: { missing: number }
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
  | DamageError
  | BoxError
  | NicknameError
  | PresetError
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

/**
 * Account changes (PATCH /api/auth/me): the trainer name and the country can
 * each be changed, then are locked for this many days (like the time zone,
 * `TIMEZONE_LOCK_DAYS`): the country decides which leaderboard you are on and
 * the name is your public identity.
 *
 * - A "change" is a value that differs from the current one. Sending the same
 *   value is a no-op and starts no lock. The first change after sign-up is free.
 * - Each field has its own lock. If a request asks for any locked change the
 *   whole request fails (nothing is applied): 409 `name_locked` or
 *   `country_locked`, with `{ unlockAt }` (epoch ms) in the body.
 * - A server running with DEV_TOOLS=1 ignores the locks (same as the time zone).
 * - `anonymousRankings` has no lock.
 */
export const NAME_LOCK_DAYS = 30
export const COUNTRY_LOCK_DAYS = 30

export interface PublicUser {
  id: string
  email: string
  trainerName: string
  /** ISO 3166-1 alpha-2, uppercase (e.g. 'PE'). */
  country: string
  /** 8-char code others type to send a friend request. */
  friendCode: string
  createdAt: number
  /** Last change of the trainer name (epoch ms); null = never changed since sign-up. */
  nameChangedAt: number | null
  /** Last change of the country (epoch ms); null = never changed since sign-up. */
  countryChangedAt: number | null
  /**
   * Privacy: do not show my name in the global and country leaderboards (others
   * see "Anonymous trainer"). Friends' leaderboard and my own row always show it.
   */
  anonymousRankings: boolean
  /** Admin panel access; players are 'player'. The server decides, the client only shows or hides the link. */
  role: UserRole
}

/** player < support < admin (docs/admin-plan.md §4). */
export type UserRole = 'player' | 'support' | 'admin'

/** GET /api/admin/me (support or admin). `elevatedUntil` is epoch ms of the sudo mode, null when not elevated. */
export interface AdminMeResponse {
  role: UserRole
  elevated: boolean
  elevatedUntil: number | null
  serverNow: number
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
  /**
   * null = the trainer chose `anonymousRankings` and this is the global or country
   * scope (the client shows "Anonymous trainer"). Never null for my own row or in
   * the friends scope.
   */
  trainerName: string | null
  /** True when this trainer has `anonymousRankings` on (lets my own row say "hidden"). */
  anonymous: boolean
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

// ---------------------------------------------------------------------------
// Study groups (/api/groups) — docs/session-depth-plan.md §C
// ---------------------------------------------------------------------------

export type StudyGroupStatus = 'lobby' | 'started' | 'ended'
/** `joined` = started a session in the group; `failed` = could not start it when the host started. */
export type GroupInviteStatus = 'pending' | 'accepted' | 'declined' | 'joined' | 'failed'
/** Why a member left: pausing or cancelling leaves the group; `finished` = claimed. */
export type GroupLeaveReason = 'pause' | 'cancel' | 'leave' | 'finished'

export interface StudyGroupMember {
  userId: string
  trainerName: string
  /** Start of their session in the group (game time, ms). */
  joinedAt: number
  /** joinedAt + minutes: after this they are no longer studying. */
  endsAt: number
  leftAt: number | null
  leftReason: GroupLeaveReason | null
}

export interface StudyGroupInvite {
  userId: string
  trainerName: string
  status: GroupInviteStatus
}

export interface StudyGroupView {
  id: string
  hostId: string
  hostName: string
  minutes: number
  status: StudyGroupStatus
  createdAt: number
  startedAt: number | null
  /** Lobby: when it lapses if not started. Started: last moment a late join makes sense. */
  expiresAt: number
  members: StudyGroupMember[]
  /** Everyone invited (not the host). */
  invites: StudyGroupInvite[]
  /** The caller's relation to the group. */
  me: { host: boolean; invite: GroupInviteStatus | null; member: boolean }
}

/** GET /api/groups */
export interface GroupsResponse {
  /** The lobby I host / accepted, or the group of my running session. */
  current: StudyGroupView | null
  /** Pending invites I can still answer. */
  invites: StudyGroupView[]
  serverNow: number
}

export type GroupEventKind = 'invite' | 'accept' | 'decline' | 'start' | 'join' | 'leave' | 'disband' | 'failed'

/** Server-sent events on GET /api/events (EventSource). */
export type ServerEvent =
  | { type: 'game'; version: number }
  | { type: 'friends' }
  | { type: 'logout' }
  /** Something changed in a study group I belong to or am invited to (refetch GET /api/groups). */
  | { type: 'group'; groupId: string; kind: GroupEventKind; userId: string; trainerName: string; reason?: GroupLeaveReason }

/** Header names used only when the server runs with DEV_TOOLS=1. */
export const DEV_NOW_HEADER = 'x-dev-now'
export const DEV_SEED_HEADER = 'x-dev-seed'

// ---------------------------------------------------------------------------
// Announcements: scheduled maintenance windows (informational banner).
// ---------------------------------------------------------------------------

/** A scheduled maintenance window. Times are absolute instants (epoch ms, UTC). */
export interface MaintenanceNotice {
  id: string
  startsAt: number
  endsAt: number
  /** Free text written by the admin, shown as is (max `MAINTENANCE_NOTE_MAX` chars). */
  note: string | null
}

export const MAINTENANCE_NOTE_MAX = 280
/** Longest window the admin can schedule. */
export const MAINTENANCE_MAX_MS = 14 * 24 * 60 * 60 * 1000

/**
 * GET /api/config — public (no session), `Cache-Control: no-store`.
 * `devTools` is the server's DEV_TOOLS (always false in production): only then
 * does it honor `x-dev-now` / `x-dev-seed` and the `dev*` / `setWeather` actions.
 * The client's developer panel (`?dev`) checks it and locks its server-side controls.
 */
export interface ConfigResponse {
  devTools: boolean
}

/**
 * GET /api/announcements — public (no session), `Cache-Control: no-store`.
 * Windows that have not ended yet (upcoming or running), oldest start first.
 * `serverNow` lets the client correct its clock skew.
 */
export interface AnnouncementsResponse {
  maintenance: MaintenanceNotice[]
  serverNow: number
}

/**
 * Admin API, guarded by `Authorization: Bearer <ADMIN_TOKEN>` (the server env
 * var; unset = admin API off → 404 `admin_disabled`; wrong token → 401
 * `unauthorized`; too many wrong tokens from an IP → 429 `rate_limited`).
 *
 * Since E2 the maintenance routes also accept a signed-in user with role
 * 'admin' (session cookie, no Authorization header); the token is deprecated.
 *
 *   GET    /api/admin/maintenance      → AdminMaintenanceResponse
 *   POST   /api/admin/maintenance      body MaintenanceCreateRequest → 201 { item: AdminMaintenanceItem }
 *   DELETE /api/admin/maintenance/:id  → 204 (404 `not_found` if unknown)
 *
 * POST validation (400 `invalid_body` with `fields`): startsAt/endsAt are
 * integers, endsAt > startsAt, endsAt > now, endsAt - startsAt <= MAINTENANCE_MAX_MS,
 * note trimmed, empty → null, <= MAINTENANCE_NOTE_MAX. At most 20 windows that
 * have not ended (409 `too_many`).
 */
export interface MaintenanceCreateRequest {
  startsAt: number
  endsAt: number
  note?: string | null
}

export interface AdminMaintenanceItem extends MaintenanceNotice {
  createdAt: number
}

export interface AdminMaintenanceResponse {
  items: AdminMaintenanceItem[]
  serverNow: number
}

// ---------------------------------------------------------------------------
// Web Push: the end-of-session notice when the page cannot show it
// ---------------------------------------------------------------------------

/**
 * The page shows the end-of-session notification itself (leader tab, then
 * `markNotified`). A hidden tab can be frozen by the browser (Chrome's Memory /
 * Energy Saver), and then nobody notifies, the player claims after the 5-minute
 * window and gets the late-claim multiplier. So the SERVER also pushes, as a
 * fallback, through the browser's push service (FCM, Mozilla autopush, Apple…).
 *
 * Rule (server/push.ts): a push is sent for a session when ALL hold:
 *  - the player has at least one push subscription;
 *  - `timer.pausedAt === null` and `timer.notified === false` (the page did not
 *    notify: that flag is the dedupe, so an open page never doubles the notice);
 *  - now >= timer.endsAt + PUSH_GRACE_MS (the page gets that long to notify first);
 *  - timer.endsAt > now - PUSH_MAX_AGE_MS (no stale pushes after downtime);
 *  - nothing was sent for (user, sessionId) before (at most once per session).
 * The claim window itself is NOT changed (5 minutes).
 *
 * Endpoints (all need the session cookie; the Origin/JSON CSRF guard applies):
 *   GET  /api/push/config      → PushConfigResponse
 *   POST /api/push/subscribe   body PushSubscribeRequest → 204 (upsert by endpoint;
 *                               a known endpoint moves to the caller)
 *   POST /api/push/unsubscribe body { endpoint } → 204 (only the caller's own; idempotent)
 *   POST /api/push/test        → 200 { sent: number } — sends PushPayload type 'test'
 *                               to the caller's subscriptions
 * Errors: 404 `push_disabled` (server has no VAPID keys; also for subscribe/test),
 * 400 `invalid_body` (endpoint must be https on a known push-service host, sizes
 * bounded), 409 `too_many` (more than MAX_PUSH_SUBSCRIPTIONS), 409 `no_subscription`
 * (test with none), 429 `rate_limited`.
 */
export const PUSH_GRACE_MS = 20_000
export const PUSH_MAX_AGE_MS = 30 * 60_000
export const MAX_PUSH_SUBSCRIPTIONS = 10
/** Notification tag: the page and the service worker use the same one so a second notice replaces the first. */
export const PUSH_TAG = 'pokefocus-session'

export interface PushConfigResponse {
  /** False when the server has no VAPID keys configured. */
  enabled: boolean
  /** VAPID public key (base64url, the applicationServerKey), null when disabled. */
  publicKey: string | null
}

export interface PushSubscribeRequest {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** JSON body of every push the server sends (already localized to the player's language). */
export interface PushPayload {
  type: 'session-end' | 'test'
  title: string
  body: string
  tag: string
  /** Path to open when the notification is clicked. */
  url: string
}
