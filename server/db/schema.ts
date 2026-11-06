/** Drizzle schema (PostgreSQL / PGlite). See docs/F2-plan.md § Esquema. */
import { sql } from 'drizzle-orm'
import { boolean, char, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { GameDoc } from '../../src/game/protocol'

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
})

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

export type UserRow = typeof users.$inferSelect
export type AuthSessionRow = typeof authSessions.$inferSelect
