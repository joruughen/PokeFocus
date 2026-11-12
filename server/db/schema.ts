/** Drizzle schema (PostgreSQL / PGlite). See docs/F2-plan.md § Esquema. */
import { sql } from 'drizzle-orm'
import { bigserial, boolean, char, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { ContentPatch, ContentItem, EventOverlay } from '../../src/engine/content'
import type { AdminContentValidation, AdminSimParams, AdminSimReport, EventOverlayBody, GameDoc, LiveEventText } from '../../src/game/protocol'

/** What `resolveContent` takes (stored in content_snapshots.resolved). */
export interface ResolvedContentInput {
  patch: ContentPatch
  events: EventOverlay[]
  eventItems: Record<string, ContentItem>
}

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  trainerName: text('trainer_name').notNull(),
  country: char('country', { length: 2 }).notNull(),
  friendCode: text('friend_code').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
  /** Last change of the trainer name / country (null = never changed): each starts a 30-day lock. */
  trainerNameChangedAt: ts('trainer_name_changed_at'),
  countryChangedAt: ts('country_changed_at'),
  /** Privacy: hide the name in the global and country leaderboards. */
  anonymousRankings: boolean('anonymous_rankings').notNull().default(false),
  /** Admin panel access (docs/admin-plan.md §4): player < support < admin. */
  role: text('role', { enum: ['player', 'support', 'admin'] }).notNull().default('player'),
},
(t) => [check('users_role_check', sql`${t.role} in ('player', 'support', 'admin')`)],
)

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    userAgent: text('user_agent'),
    /** Sudo mode: sensitive admin actions need `elevated_until > now` (POST /api/admin/reauth). */
    elevatedUntil: ts('elevated_until'),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId), index('auth_sessions_expires_idx').on(t.expiresAt)],
)

export const playerDocs = pgTable('player_docs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  doc: jsonb('doc').$type<GameDoc>().notNull(),
  version: integer('version').notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

/** One row per user while a study session runs: the PK makes it unique. */
export const activeStudySessions = pgTable('active_study_sessions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  startedAt: ts('started_at').notNull(),
})

export const leagueScores = pgTable(
  'league_scores',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    period: text('period', { enum: ['week', 'month'] }).notNull(),
    periodKey: text('period_key').notNull(),
    points: integer('points').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.period, t.periodKey] }),
    index('league_scores_rank_idx').on(t.period, t.periodKey, t.points.desc()),
    check('league_scores_period_check', sql`${t.period} in ('week', 'month')`),
  ],
)

export const friendships = pgTable(
  'friendships',
  {
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted'] }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    index('friendships_addressee_idx').on(t.addresseeId),
    check('friendships_not_self', sql`${t.requesterId} <> ${t.addresseeId}`),
    check('friendships_status_check', sql`${t.status} in ('pending', 'accepted')`),
  ],
)

/**
 * Study groups (docs/session-depth-plan.md §C). A lobby collects invites; when
 * the host starts it every accepted invitee starts a session at the same time.
 */
export const studyGroups = pgTable(
  'study_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    minutes: integer('minutes').notNull(),
    status: text('status', { enum: ['lobby', 'started', 'ended'] }).notNull(),
    createdAt: ts('created_at').notNull(),
    startedAt: ts('started_at'),
    /** Lobby: lapses if not started by then. Started: last moment to join late. */
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    index('study_groups_host_idx').on(t.hostId),
    check('study_groups_status_check', sql`${t.status} in ('lobby', 'started', 'ended')`),
  ],
)

/** One row per user who started a session in the group: their in-group interval. */
export const studyGroupMembers = pgTable(
  'study_group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => studyGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** activeSession.id of the member's game doc. */
    sessionId: text('session_id').notNull(),
    joinedAt: ts('joined_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    leftAt: ts('left_at'),
    leftReason: text('left_reason', { enum: ['pause', 'cancel', 'leave', 'finished'] }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('study_group_members_user_idx').on(t.userId, t.sessionId),
  ],
)

export const studyGroupInvites = pgTable(
  'study_group_invites',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => studyGroups.id, { onDelete: 'cascade' }),
    inviteeId: uuid('invitee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted', 'declined', 'joined', 'failed'] }).notNull(),
    createdAt: ts('created_at').notNull(),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.inviteeId] }),
    index('study_group_invites_invitee_idx').on(t.inviteeId, t.status),
    check('study_group_invites_status_check', sql`${t.status} in ('pending', 'accepted', 'declined', 'joined', 'failed')`),
  ],
)

/**
 * Scheduled maintenance windows (informational banner; the server does not block
 * requests during a window). Written through the admin API only.
 */
export const maintenanceWindows = pgTable(
  'maintenance_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('maintenance_windows_ends_idx').on(t.endsAt),
    check('maintenance_windows_range_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
)

/**
 * Web Push subscriptions (server/push.ts). `endpoint` is unique: the same browser
 * logging in with another account moves the row to that account.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSuccessAt: ts('last_success_at'),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
)

/** Claims of sent pushes: the PK makes "at most once per (user, session, kind)" hold across restarts. */
export const pushSent = pgTable(
  'push_sent',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    kind: text('kind').notNull().default('session-end'),
    /** Time of the last claim; NULL = released after an all-transient failure (the next tick may retry). */
    sentAt: ts('sent_at').defaultNow(),
    /** Delivery attempts so far (at most PUSH_MAX_ATTEMPTS). */
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sessionId, t.kind] })],
)

/**
 * Append-only audit log of admin mutations, written in the same transaction as the
 * change (server/admin/audit.ts). `actor_label` is 'token' for the legacy ADMIN_TOKEN
 * and 'system' for the start-up promotion; `actor_id` goes null if the user is deleted.
 */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    note: text('note'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('admin_audit_created_idx').on(t.createdAt.desc()), index('admin_audit_target_idx').on(t.targetType, t.targetId)],
)

/**
 * Live content versions (docs/admin-plan.md §1–2): each one is a full patch over
 * the shipped data (not a delta). Published versions are immutable; the active
 * one is the published version with the latest `effective_at <= now` (a future
 * `effective_at` = scheduled). Rollback = a new version copying an old patch.
 */
export const contentVersions = pgTable(
  'content_versions',
  {
    id: serial('id').primaryKey(),
    status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
    patch: jsonb('patch').$type<ContentPatch>().notNull(),
    /** `baseHash` of the shipped data the patch was written against. */
    baseHash: text('base_hash'),
    /** sha256 of the canonical patch. */
    hash: text('hash'),
    parentId: integer('parent_id'),
    title: text('title'),
    note: text('note'),
    /** null while a draft; in the future = scheduled. */
    effectiveAt: ts('effective_at'),
    /** Validation result (errors, warnings) of the last save/publish. */
    validation: jsonb('validation'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: ts('published_at'),
  },
  (t) => [
    check('content_versions_status_check', sql`${t.status} in ('draft', 'published', 'archived')`),
    index('content_versions_status_effective_idx').on(t.status, t.effectiveAt),
  ],
)

/**
 * Resolved content by hash (patch + active event overlays + event item names),
 * written the first time a session pins that hash, so a claim can rebuild the
 * exact context after a restart or a later publication. Never deleted while a
 * session or encounter uses it (pruned after ~90 days).
 */
export const contentSnapshots = pgTable('content_snapshots', {
  hash: text('hash').primaryKey(),
  baseHash: text('base_hash').notNull(),
  versionId: integer('version_id'),
  /** `{ [eventId]: revision }` of the active events. */
  eventRevs: jsonb('event_revs').$type<Record<string, number>>().notNull(),
  resolved: jsonb('resolved').$type<ResolvedContentInput>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/**
 * Admin balance simulations of a draft against the active content (docs/admin-plan.md §7, E10;
 * server/content/simRunner.ts). One runs at a time; a row left `running` by a restart is marked
 * `interrupted`. `draft_hash` is the draft's patch hash when simulated: publishing warns when
 * no `done` run of the current hash is recent.
 */
export const contentSimRuns = pgTable(
  'content_sim_runs',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id').references(() => contentVersions.id, { onDelete: 'set null' }),
    draftHash: text('draft_hash').notNull(),
    activeVersionId: integer('active_version_id'),
    activeHash: text('active_hash').notNull(),
    status: text('status', { enum: ['running', 'done', 'failed', 'timeout', 'interrupted'] }).notNull().default('running'),
    params: jsonb('params').$type<AdminSimParams>().notNull(),
    result: jsonb('result').$type<AdminSimReport>(),
    error: text('error'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    check('content_sim_runs_status_check', sql`${t.status} in ('running', 'done', 'failed', 'timeout', 'interrupted')`),
    index('content_sim_runs_version_idx').on(t.versionId, t.createdAt.desc()),
    index('content_sim_runs_created_idx').on(t.createdAt.desc()),
  ],
)

/**
 * Event images (docs/admin-plan.md §3): re-encoded by sharp (webp, no metadata) and
 * stored on disk under UPLOADS_DIR as `events/<sha256>.webp` (+ `-480.webp`).
 * `sha256` is the hash of the stored main image (identical images are stored once);
 * the original file name is never kept.
 */
export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  sha256: text('sha256').notNull().unique(),
  mime: text('mime').notNull().default('image/webp'),
  /** Bytes of the main image and of the 480 px card version. */
  bytes: integer('bytes').notNull(),
  thumbBytes: integer('thumb_bytes').notNull().default(0),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  /** Relative to UPLOADS_DIR. */
  path: text('path').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/**
 * Live events (docs/admin-plan.md §2, §6). `overlay` is the EventOverlay without id, slug and
 * dates (the id is this row's id); only `published` rows reach the ContentService
 * (a future `starts_at` = scheduled; `archived` events stay known for their items' names).
 * `revision` +1 on every edit of a published event (snapshots in live_event_revisions).
 */
export const liveEvents = pgTable(
  'live_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    name: jsonb('name').$type<LiveEventText>().notNull(),
    description: jsonb('description').$type<LiveEventText>().notNull(),
    imageId: uuid('image_id').references(() => uploads.id),
    overlay: jsonb('overlay').$type<EventOverlayBody>().notNull(),
    revision: integer('revision').notNull().default(1),
    /** Times an admin pressed "Notify players": each one makes the announcement window show again to everyone. */
    announceRev: integer('announce_rev').notNull().default(0),
    /** Result of the last save/publish validation. */
    validation: jsonb('validation').$type<AdminContentValidation>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: ts('published_at'),
  },
  (t) => [
    check('live_events_status_check', sql`${t.status} in ('draft', 'published', 'archived')`),
    check('live_events_range_check', sql`${t.endsAt} > ${t.startsAt}`),
    index('live_events_status_idx').on(t.status, t.startsAt, t.endsAt),
    index('live_events_image_idx').on(t.imageId),
  ],
)

/** What a published event looked like at each revision (written at publish and on every published edit). */
export const liveEventRevisions = pgTable(
  'live_event_revisions',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => liveEvents.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.revision] })],
)

/**
 * One row per claimed (valid) study session, written in the claim's transaction
 * (server/session-log.ts) for the admin metrics. Holds no personal data besides
 * the user id (rows go with the account). `wilds`/`shinies`/`legendaries` count what
 * the session spawned; `catches` follows the session's later ball throws.
 * `content_hash`: content version the session ran with ('base' = the bundled data).
 */
export const sessionLog = pgTable(
  'session_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at').notNull(),
    claimedAt: ts('claimed_at').notNull(),
    minutes: doublePrecision('minutes').notNull(),
    focus: doublePrecision('focus').notNull(),
    lateClaim: boolean('late_claim').notNull().default(false),
    points: integer('points').notNull().default(0),
    wilds: integer('wilds').notNull().default(0),
    catches: integer('catches').notNull().default(0),
    shinies: integer('shinies').notNull().default(0),
    legendaries: integer('legendaries').notNull().default(0),
    contentHash: text('content_hash'),
  },
  (t) => [uniqueIndex('session_log_user_session_idx').on(t.userId, t.sessionId), index('session_log_ended_idx').on(t.endedAt)],
)

export type UserRow = typeof users.$inferSelect
export type AuthSessionRow = typeof authSessions.$inferSelect
