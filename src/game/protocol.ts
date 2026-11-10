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
  ContentItem,
  ContentPatch,
  EventOverlay,
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
   * Long sessions (GDD §3.4) keep the minutes studied and the waves of the full
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

/** Query of GET /api/admin/metrics: UTC range [from, to) in epoch ms (default: the last 28 days) and the bucket size. */
export type AdminMetricsGranularity = 'day' | 'week'
export const ADMIN_METRICS_MAX_BUCKETS = 120

/** Sums over a set of claimed sessions. Focus bands: low < 0.75 (late claim), mid 0.75 to < 1, full >= 1. */
export interface AdminMetricsCounts {
  sessions: number
  minutes: number
  points: number
  wilds: number
  catches: number
  shinies: number
  legendaries: number
  focusLow: number
  focusMid: number
  focusFull: number
}

export interface AdminMetricsBucket extends AdminMetricsCounts {
  /** First UTC day of the bucket, `YYYY-MM-DD` (a Monday for weeks). */
  start: string
  activePlayers: number
  /** Players active in the previous bucket. */
  prevActive: number
  /** Of those, how many were active again in this bucket. */
  returned: number
}

/** GET /api/admin/metrics (support or admin). Aggregates only: no per-player data. */
export interface AdminMetricsResponse {
  from: number
  to: number
  granularity: AdminMetricsGranularity
  serverNow: number
  buckets: AdminMetricsBucket[]
  totals: AdminMetricsCounts & { activePlayers: number }
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
  /** Broadcast to every connection: the active live content changed (refetch GET /api/content). */
  | { type: 'content'; hash: string }

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
 * GET /api/content — public (no session): the live content active now.
 * `ETag: "<hash>"`, `Cache-Control: no-cache` (304 on `If-None-Match`).
 * GET /api/content/:hash — the content a session pinned (`ActiveSession.contentHash`,
 * `EncounterState.contentHash`); immutable (`Cache-Control: public, max-age=31536000,
 * immutable`) except `base`; 404 `unknown_content` for an unknown hash.
 *
 * The client rebuilds the context with
 * `createEngineContext(resolveContent(patch, events, eventItems, { hash }))`;
 * `hash: 'base'` = the bundled data as is. A `baseHash` different from the
 * bundle's `src/data/game/meta.json` means the client is stale (reload).
 */
export interface ContentResponse {
  hash: string
  baseHash: string
  /** Active admin patch (`{}` = none). */
  patch: ContentPatch
  /** Live events active when resolved, in (startsAt, id) order. */
  events: EventOverlay[]
  /** Item names of every published event (past ones too). */
  eventItems: Record<string, ContentItem>
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

// ---------------------------------------------------------------------------
// Admin: player support (docs/admin-plan.md §4, delivery E11)
// ---------------------------------------------------------------------------

/**
 *   GET  /api/admin/players?q=                → AdminPlayersResponse   (support+; q = 2..60 chars, at most 20 results)
 *   GET  /api/admin/players/:id               → AdminPlayerDetail      (support+)
 *   POST /api/admin/players/:id/grant         { items?, dust?, reason } → AdminPlayerDetail   (admin + sudo; audited)
 *   POST /api/admin/players/:id/unlock        { field } → AdminPlayerDetail                    (support+; audited)
 *   POST /api/admin/players/:id/cancel-session                → AdminPlayerDetail              (support+; audited)
 *   POST /api/admin/players/:id/logout-all                    → AdminPlayerDetail              (support+; audited)
 *
 * Support may only change `player` accounts (403 `forbidden_target` on staff); admin may change anyone.
 * Errors: 400 invalid_body, 403 forbidden / elevation_required / forbidden_target, 404 not_found,
 * 409 (`no_session`, `not_locked`, `no_player`, `self_target`, grant errors of src/game/admin.ts), 429 rate_limited.
 */
export type AdminUnlockField = 'trainerName' | 'country' | 'timezone'

export interface AdminPlayerSummary {
  id: string
  email: string
  trainerName: string
  country: string
  friendCode: string
  role: UserRole
  createdAt: number
}

export interface AdminPlayersResponse {
  items: AdminPlayerSummary[]
  serverNow: number
}

export interface AdminPlayerDetail {
  user: AdminPlayerSummary & {
    anonymousRankings: boolean
    /** Epoch ms when each 30-day lock ends; null = not locked. */
    nameUnlockAt: number | null
    countryUnlockAt: number | null
  }
  /** Null while the account has no game document (never opened the game). */
  doc: {
    version: number
    updatedAt: number
    /** False until the starter is chosen: everything below is then empty. */
    hasPlayer: boolean
    trainerLevel: number
    dust: number
    inventory: Record<string, number>
    pokemonCount: number
    team: { uid: string; speciesSlug: string; level: number; shiny: boolean; nickname: string | null }[]
    timezone: string
    timezoneUnlockAt: number | null
    activeSession: { id: string; startedAt: number; plannedMinutes: number; endsAt: number | null; paused: boolean } | null
    /** Last 20 claimed sessions, newest first. */
    history: { id: string; claimedAt: number; minutes: number; points: number; focus: number; lateClaim: boolean }[]
  } | null
  /** Signed-in browsers (unexpired sessions). */
  authSessions: { id: string; createdAt: number; lastSeenAt: number; userAgent: string | null }[]
  serverNow: number
}

// ---------------------------------------------------------------------------
// Admin: live content (docs/admin-plan.md §4, delivery E5)
// ---------------------------------------------------------------------------

/**
 *   GET    /api/admin/content/live                       → AdminContentLiveResponse         (support+)
 *   GET    /api/admin/content/versions?status=           → AdminContentVersionsResponse     (support+; newest first, at most 100)
 *   GET    /api/admin/content/versions/:id               → AdminContentVersionResponse      (support+; diff against the active patch)
 *   POST   /api/admin/content/drafts {from?, fromVersionId?, title?, note?} → 201 AdminContentVersionResponse (admin)
 *   PUT    /api/admin/content/drafts/:id {patch?, title?, note?}            → AdminContentVersionResponse (admin; saves even with errors)
 *   DELETE /api/admin/content/drafts/:id                 → 204                              (admin)
 *   POST   /api/admin/content/drafts/:id/validate        → AdminContentValidateResponse     (admin; full, with the engine smoke test)
 *   POST   /api/admin/content/drafts/:id/publish {effectiveAt?, confirm?, note?} → AdminContentVersionResponse (admin + sudo)
 *   POST   /api/admin/content/versions/:id/rollback {confirm?, note?}    → 201 AdminContentVersionResponse (admin + sudo)
 *   GET    /api/admin/content/spawn-preview?versionId&hour&weather&trainerLevel → AdminSpawnPreview (admin)
 *
 * Every mutation is audited in its own transaction (`content.draft.create|update|delete`, `content.publish`,
 * `content.schedule`, `content.rollback`). Drafts never reach `/api/content`: only published versions do.
 * Errors: 400 invalid_body / invalid_id / invalid_query / invalid_effective_at, 403 forbidden / elevation_required,
 * 404 not_found, 409 (`not_draft`, `not_published`, `too_many_drafts`, `confirm_required`),
 * 422 `validation_failed` { errors, warnings, requiresConfirm }, 429 rate_limited.
 */
export type AdminContentStatus = 'draft' | 'published' | 'archived'

export interface ContentIssue {
  code: string
  path: string
  message: string
  params?: Record<string, unknown>
  requiresConfirm?: boolean
}

/** Result of the content validation (src/game/content/validate.ts) as stored on the version and returned. */
export interface AdminContentValidation {
  ok: boolean
  errors: ContentIssue[]
  warnings: ContentIssue[]
  /** Some warning needs `confirm: true` to publish (changes beyond ×3, probabilities ×5). */
  requiresConfirm: boolean
  /** The engine smoke test ran (PUT saves without it; /validate and publishing always run it). */
  smoke: boolean
  /** Epoch ms when it was computed. */
  at: number
}

export interface AdminContentAuthor {
  id: string
  trainerName: string
}

export interface AdminContentVersionSummary {
  id: number
  status: AdminContentStatus
  title: string | null
  note: string | null
  parentId: number | null
  hash: string | null
  /** Epoch ms: null while a draft, in the future = scheduled. */
  effectiveAt: number | null
  createdBy: AdminContentAuthor | null
  createdAt: number
  publishedBy: AdminContentAuthor | null
  publishedAt: number | null
  /** It is the version in force now. */
  active: boolean
  /** Published with `effectiveAt` in the future. */
  scheduled: boolean
  /** Counts of the last saved validation (null = never validated). */
  validation: { ok: boolean; errors: number; warnings: number; requiresConfirm: boolean; smoke: boolean } | null
}

/** One changed path of a patch compared with the active one. `before`/`after`: the patch value, else the base value when known, else null. */
export interface AdminContentDiffEntry {
  path: string
  kind: 'added' | 'changed' | 'removed'
  before: unknown
  after: unknown
}

export interface AdminContentVersion extends AdminContentVersionSummary {
  patch: ContentPatch
  baseHash: string | null
  /** Full last saved validation. */
  validationDetail: AdminContentValidation | null
}

export interface AdminContentVersionResponse {
  version: AdminContentVersion
  /** Against the active patch (empty when this is the active version). */
  diff: AdminContentDiffEntry[]
  serverNow: number
}

export interface AdminContentVersionsResponse {
  items: AdminContentVersionSummary[]
  serverNow: number
}

export interface AdminContentValidateResponse {
  validation: AdminContentValidation
  diff: AdminContentDiffEntry[]
  serverNow: number
}

export interface AdminContentLiveResponse {
  /** Hash of the content in force ('base' = none). */
  hash: string
  baseHash: string
  active: AdminContentVersionSummary | null
  /** The next published version that takes effect in the future. */
  scheduled: AdminContentVersionSummary | null
  /** Live events active now. */
  events: { id: string; slug: string; startsAt: number; endsAt: number }[]
  serverNow: number
}

export type AdminSpawnWeather = 'rain' | 'sun' | 'snow' | 'clear' | 'unknown'

export interface AdminSpawnPreview {
  /** Version previewed (null = the active content, which may have none). */
  versionId: number | null
  hash: string
  hour: number
  weather: AdminSpawnWeather
  trainerLevel: number
  wildLevel: { min: number; max: number }
  /**
   * Non-legendary species that can appear, most likely first. `probability` is
   * the average share over the wild levels of the band with a neutral wave
   * (first wave, no condition/sound/team bonuses): weight = captureRate × the
   * spawn rule multiplier. Legendaries are rolled apart with `legendaryChance`.
   */
  species: { slug: string; probability: number; weight: number; weightMult: number }[]
  /** Species with weight > 0 (== species.length). */
  count: number
  legendaryChance: number
  /** Species with a spawn rule in this content (admin or events), enabled or not. */
  rules: { slug: string; enabled: boolean; weightMult: number; hours?: [number, number][]; weather?: string[]; minTrainerLevel?: number }[]
}

// ---------------------------------------------------------------------------
// Live events (docs/admin-plan.md §3, §4, §6; delivery E8)
// ---------------------------------------------------------------------------

/**
 *   GET    /api/live-events?before=<endsAt ms>      → LiveEventsResponse   (public; published events only, never drafts or archived)
 *
 *   GET    /api/admin/events?status=                → AdminEventsResponse  (admin)
 *   POST   /api/admin/events {slug, name, description, startsAt, endsAt, imageId?, overlay} → 201 AdminEventResponse (admin; a draft)
 *   GET    /api/admin/events/:id                    → AdminEventResponse   (admin)
 *   PUT    /api/admin/events/:id {slug?, name?, description?, startsAt?, endsAt?, imageId?, overlay?, confirm?}
 *                                                   → AdminEventResponse   (admin; a published event also needs sudo, bumps `revision`)
 *   DELETE /api/admin/events/:id                    → 204                  (admin; drafts only)
 *   POST   /api/admin/events/:id/publish {confirm?, note?}  → AdminEventResponse (admin + sudo; a future `startsAt` = scheduled)
 *   POST   /api/admin/events/:id/archive {note?}            → AdminEventResponse (admin + sudo; a published event only)
 *
 *   GET    /api/admin/uploads                       → AdminUploadsResponse (admin)
 *   POST   /api/admin/uploads  (raw body, Content-Type image/png|jpeg|webp, at most 3 MB) → 201 | 200 AdminUploadResponse (admin; re-encoded)
 *   DELETE /api/admin/uploads/:id                   → 204                  (admin; only images no event references)
 *   GET    /media/events/<sha256>.webp | <sha256>-480.webp   the sanitized images (immutable, nosniff)
 *
 * Every mutation is audited in its own transaction (`event.create|update|delete|publish|archive`,
 * `upload.create|delete`). Errors: 400 invalid_body / invalid_query / invalid_dates, 403 forbidden / elevation_required,
 * 404 not_found, 409 (`not_draft`, `not_published`, `not_editable`, `slug_taken`, `slug_locked`, `too_many_drafts`,
 * `confirm_required`, `in_use`, `uploads_full`), 413 body_too_large, 415 unsupported_type, 422 (`validation_failed`
 * { errors, warnings, requiresConfirm }, `invalid_image`, `image_too_small`, `image_too_large`, `animated_image`), 429 rate_limited.
 */
export type AdminEventStatus = 'draft' | 'published' | 'archived'

/** The editable part of an event (`live_events.overlay`): an `EventOverlay` without id, slug and dates. */
export type EventOverlayBody = Omit<EventOverlay, 'id' | 'slug' | 'startsAt' | 'endsAt'>

export interface LiveEventText {
  es: string
  en: string
}

/** A sanitized upload as the pages reference it: 16:9 webp (`url`) and its 480 px card version (`thumbUrl`). */
export interface LiveEventImage {
  url: string
  thumbUrl: string
  width: number
  height: number
}

/** A published event as players see it. */
export interface LiveEventPublic extends EventOverlayBody {
  id: string
  slug: string
  name: LiveEventText
  description: LiveEventText
  image: LiveEventImage | null
  startsAt: number
  endsAt: number
}

export interface LiveEventsResponse {
  /** `startsAt <= now < endsAt`, by start. */
  active: LiveEventPublic[]
  /** Starting within the next 60 days, by start. */
  upcoming: LiveEventPublic[]
  /** Ended within the last 90 days, most recent first; `before=<nextCursor>` asks for more. */
  past: LiveEventPublic[]
  nextCursor: number | null
  serverNow: number
}

export interface AdminUpload extends LiveEventImage {
  id: string
  sha256: string
  /** Bytes of the main image and of the 480 px one. */
  bytes: number
  thumbBytes: number
  createdAt: number
  /** Events that reference it (drafts included). */
  inUse: number
}

export interface AdminUploadResponse {
  upload: AdminUpload
  /** The same image was already stored (identical after re-encoding). */
  reused: boolean
}

export interface AdminUploadsResponse {
  items: AdminUpload[]
  totalBytes: number
  limitBytes: number
}

export interface AdminEvent {
  id: string
  slug: string
  status: AdminEventStatus
  startsAt: number
  endsAt: number
  name: LiveEventText
  description: LiveEventText
  imageId: string | null
  image: LiveEventImage | null
  overlay: EventOverlayBody
  /** 1 when created; +1 on every edit of a published event. */
  revision: number
  /** Last saved validation (the shape is the same as the content versions'). */
  validation: AdminContentValidation | null
  createdBy: AdminContentAuthor | null
  createdAt: number
  updatedAt: number
  publishedBy: AdminContentAuthor | null
  publishedAt: number | null
  /** Published and `startsAt <= now < endsAt`. */
  active: boolean
  /** Published and `startsAt > now`. */
  scheduled: boolean
}

export interface AdminEventResponse {
  event: AdminEvent
  serverNow: number
}

export interface AdminEventsResponse {
  items: AdminEvent[]
  serverNow: number
}
