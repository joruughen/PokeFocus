/** Drizzle schema (PostgreSQL / PGlite). See docs/F2-plan.md § Esquema. */
import { sql } from 'drizzle-orm'
import { char, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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

export type UserRow = typeof users.$inferSelect
export type AuthSessionRow = typeof authSessions.$inferSelect
