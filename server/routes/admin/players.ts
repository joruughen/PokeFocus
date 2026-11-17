/**
 * /api/admin/players — player support (docs/admin-plan.md §4, delivery E11).
 *
 *   GET  /players?q=                  support+   search by email, trainer name or friend code (2..60 chars, at most 20)
 *   GET  /players/:id                 support+   profile, locks, game summary, last 20 sessions, signed-in browsers
 *   POST /players/:id/grant           admin + sudo   { items?, dust?, message?: {es?,en?} (≤120), reason }  (capped, see src/game/admin.ts)
 *   POST /players/:id/unlock          support+   { field: trainerName|country|timezone, reason? }  clears a 30-day lock
 *   POST /players/:id/cancel-session  support+   { reason? }  cancels a stuck study session (the player's own cancel rules: a long session keeps its studied minutes, GDD §3.4)
 *   POST /players/:id/logout-all      support+   { reason? }  signs the player out everywhere
 *
 * Every mutation writes `admin_audit` in the same transaction (`player.grant`, `player.unlock`,
 * `player.cancel_session`, `player.logout_all`) and counts against `adminPlayerWrite` per staff user
 * (grants also against `adminGrant`). Support may only act on `player` accounts (403 `forbidden_target`
 * for staff targets); admin may act on anyone. SSE events go out after the commit.
 */
import { Hono, type MiddlewareHandler } from 'hono'
import { and, asc, eq, gt, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { createRng } from '../../../src/engine'
import { ADMIN_GRANT_LIMITS, applyAdminGrant } from '../../../src/game/admin'
import { TIMEZONE_LOCK_DAYS, timerOf } from '../../../src/game/actions'
import { COUNTRY_LOCK_DAYS, GIFT_MESSAGE_MAX, NAME_LOCK_DAYS, type AdminPlayerDetail, type AdminPlayerSummary, type AdminPlayersResponse } from '../../../src/game/protocol'
import { audit } from '../../admin/audit'
import type { Db, Tx } from '../../db/client'
import { authSessions, playerDocs, users, type UserRow } from '../../db/schema'
import { publishGroupEvents } from '../../groups'
import { ApiError, readBody, requireElevated, UUID_RE, type AppEnv, type Ctx, type Deps } from '../../http'
import { RULES, type RateRule } from '../../rate-limit'
import { localizedNote } from '../../validation'
import { runGameAction } from '../game'

const DAY_MS = 86_400_000
export const PLAYER_SEARCH_MIN = 2
export const PLAYER_SEARCH_MAX = 60
export const PLAYER_SEARCH_LIMIT = 20

const reasonField = z
  .string()
  .trim()
  .max(ADMIN_GRANT_LIMITS.reasonMax)
const optionalReason = z.object({ reason: reasonField.optional() })
const grantBody = z.object({
  items: z.record(z.string().max(64), z.number()).optional(),
  dust: z.number().optional(),
  /** A short message the player sees in a window when they receive the gift. */
  message: localizedNote(GIFT_MESSAGE_MAX).optional(),
  reason: reasonField.min(ADMIN_GRANT_LIMITS.reasonMin),
})
const unlockBody = z.object({ field: z.enum(['trainerName', 'country', 'timezone']), reason: reasonField.optional() })

const toSummary = (u: UserRow): AdminPlayerSummary => ({
  id: u.id,
  email: u.email,
  trainerName: u.trainerName,
  country: u.country,
  friendCode: u.friendCode,
  role: u.role,
  createdAt: u.createdAt.getTime(),
})

/** Epoch ms when a 30-day lock started at `changedAt` ends, or null when it is not (or no longer) locked. */
const lockEnd = (changedAt: number | null | undefined, days: number, now: number): number | null =>
  changedAt != null && now < changedAt + days * DAY_MS ? changedAt + days * DAY_MS : null

/** Escape LIKE wildcards so a search for `50%` is literal. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

export type Staff = (min: 'support' | 'admin') => MiddlewareHandler<AppEnv>
export type Limit = (c: Ctx, key: string, rule: RateRule) => void

export async function loadPlayerDetail(db: Pick<Db, 'select'>, id: string, now: number): Promise<AdminPlayerDetail | null> {
  const [u] = await db.select().from(users).where(eq(users.id, id))
  if (!u) return null
  const [row] = await db.select().from(playerDocs).where(eq(playerDocs.userId, id))
  const sessions = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.userId, id), gt(authSessions.expiresAt, new Date(now))))
    .orderBy(asc(authSessions.lastSeenAt))
  let doc: AdminPlayerDetail['doc'] = null
  if (row) {
    const p = row.doc.player
    const timer = p ? timerOf(row.doc) : null
    doc = {
      version: row.version,
      updatedAt: row.updatedAt.getTime(),
      hasPlayer: p !== null,
      trainerLevel: p?.trainer.level ?? 0,
      dust: p?.dust ?? 0,
      inventory: p?.inventory ?? {},
      pokemonCount: p ? Object.keys(p.pokemon).length : 0,
      team: (p?.team ?? []).flatMap((uid) => {
        const m = p?.pokemon[uid]
        return m ? [{ uid, speciesSlug: m.speciesSlug, level: m.level, shiny: m.isShiny, nickname: m.nickname ?? null }] : []
      }),
      timezone: p ? String(p.profile.timezone) : '',
      timezoneUnlockAt: lockEnd(p?.profile.timezoneChangedAt, TIMEZONE_LOCK_DAYS, now),
      activeSession: p?.activeSession
        ? {
            id: p.activeSession.id,
            startedAt: p.activeSession.startedAt,
            plannedMinutes: p.activeSession.plannedMinutes,
            endsAt: timer?.endsAt ?? null,
            paused: timer?.pausedAt != null,
          }
        : null,
      history: (p?.history ?? [])
        .slice(-20)
        .reverse()
        .map((h) => ({ id: h.id, claimedAt: h.claimedAt, minutes: h.minutes, points: h.points, focus: h.focus, lateClaim: h.lateClaim })),
    }
  }
  return {
    user: {
      ...toSummary(u),
      anonymousRankings: u.anonymousRankings,
      nameUnlockAt: lockEnd(u.trainerNameChangedAt?.getTime(), NAME_LOCK_DAYS, now),
      countryUnlockAt: lockEnd(u.countryChangedAt?.getTime(), COUNTRY_LOCK_DAYS, now),
    },
    doc,
    authSessions: sessions.map((s) => ({ id: s.id, createdAt: s.createdAt.getTime(), lastSeenAt: s.lastSeenAt.getTime(), userAgent: s.userAgent })),
    serverNow: now,
  }
}

export function playersRoutes(deps: Deps, staff: Staff, limit: Limit) {
  const { db, bus } = deps
  const app = new Hono<AppEnv>()

  const idParam = (c: Ctx): string => {
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    return id
  }
  const writeLimit = (c: Ctx) => limit(c, `admin:players:write:${c.get('user').id}`, RULES.adminPlayerWrite)

  /** Lock the target row and apply the role rule: support only touches `player` accounts. */
  const lockTarget = async (tx: Tx, c: Ctx, id: string): Promise<UserRow> => {
    const [target] = await tx.select().from(users).where(eq(users.id, id)).for('update')
    if (!target) throw new ApiError(404, 'not_found')
    if (c.get('user').role !== 'admin' && target.role !== 'player') throw new ApiError(403, 'forbidden_target')
    return target
  }

  const detail = async (c: Ctx, id: string) => {
    const body = await loadPlayerDetail(db, id, deps.clock())
    if (!body) throw new ApiError(404, 'not_found')
    return c.json(body)
  }

  app.get('/', staff('support'), async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (q.length < PLAYER_SEARCH_MIN || q.length > PLAYER_SEARCH_MAX) throw new ApiError(400, 'invalid_query')
    const like = `%${likeEscape(q)}%`
    const rows = await db
      .select()
      .from(users)
      .where(or(ilike(users.email, like), ilike(users.trainerName, like), ilike(users.friendCode, like)))
      .orderBy(asc(users.trainerName), asc(users.id))
      .limit(PLAYER_SEARCH_LIMIT)
    const body: AdminPlayersResponse = { items: rows.map(toSummary), serverNow: deps.clock() }
    return c.json(body)
  })

  app.get('/:id', staff('support'), (c) => detail(c, idParam(c)))

  app.post('/:id/grant', staff('admin'), requireElevated(deps), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, grantBody)
    writeLimit(c)
    limit(c, `admin:players:grant:${c.get('user').id}`, RULES.adminGrant)
    const version = await db.transaction(async (tx) => {
      await lockTarget(tx, c, id)
      const [row] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, id)).for('update')
      if (!row) throw new ApiError(409, 'no_player')
      const r = applyAdminGrant(row.doc, { ...(body.items && { items: body.items }), ...(body.dust !== undefined && { dust: body.dust }), ...(body.message && { message: body.message, at: deps.clock() }) })
      if (!r.ok) throw new ApiError(r.error === 'no_player' ? 409 : 400, r.error)
      const was = row.doc.player!
      const touched = (inv: Record<string, number>) => Object.fromEntries(Object.keys(r.applied.items).map((k) => [k, inv[k] ?? 0]))
      const next = row.version + 1
      await tx.update(playerDocs).set({ doc: r.doc, version: next, updatedAt: new Date(deps.clock()) }).where(eq(playerDocs.userId, id))
      await audit(tx, c, {
        action: 'player.grant',
        targetType: 'user',
        targetId: id,
        before: { dust: was.dust, items: touched(was.inventory) },
        after: { dust: r.doc.player!.dust, items: touched(r.doc.player!.inventory), granted: r.applied, ...(body.message && { message: body.message }) },
        note: body.reason,
      })
      return next
    })
    bus.publish(id, { type: 'game', version })
    return detail(c, id)
  })

  app.post('/:id/unlock', staff('support'), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, unlockBody)
    writeLimit(c)
    const now = deps.clock()
    let version: number | null = null
    await db.transaction(async (tx) => {
      const target = await lockTarget(tx, c, id)
      if (body.field === 'timezone') {
        const [row] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, id)).for('update')
        const p = row?.doc.player
        if (!row || !p) throw new ApiError(409, 'no_player')
        const changedAt = p.profile.timezoneChangedAt ?? null
        if (lockEnd(changedAt, TIMEZONE_LOCK_DAYS, now) === null) throw new ApiError(409, 'not_locked')
        version = row.version + 1
        const doc = { ...row.doc, player: { ...p, profile: { ...p.profile, timezoneChangedAt: null } } }
        await tx.update(playerDocs).set({ doc, version, updatedAt: new Date(now) }).where(eq(playerDocs.userId, id))
        await audit(tx, c, { action: 'player.unlock', targetType: 'user', targetId: id, before: { timezoneChangedAt: changedAt }, after: { timezoneChangedAt: null }, ...(body.reason && { note: body.reason }) })
        return
      }
      const isName = body.field === 'trainerName'
      const changedAt = isName ? target.trainerNameChangedAt : target.countryChangedAt
      if (lockEnd(changedAt?.getTime(), isName ? NAME_LOCK_DAYS : COUNTRY_LOCK_DAYS, now) === null) throw new ApiError(409, 'not_locked')
      await tx.update(users).set(isName ? { trainerNameChangedAt: null } : { countryChangedAt: null }).where(eq(users.id, id))
      await audit(tx, c, {
        action: 'player.unlock',
        targetType: 'user',
        targetId: id,
        before: { [`${body.field}ChangedAt`]: changedAt!.getTime() },
        after: { [`${body.field}ChangedAt`]: null },
        ...(body.reason && { note: body.reason }),
      })
    })
    if (version !== null) bus.publish(id, { type: 'game', version })
    return detail(c, id)
  })

  app.post('/:id/cancel-session', staff('support'), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, optionalReason)
    writeLimit(c)
    const out = await db.transaction(async (tx) => {
      const target = await lockTarget(tx, c, id)
      const [row] = await tx.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, id))
      const was = row?.doc.player?.activeSession
      // The same reducer and mirrors as the player's own `cancel` (active_study_sessions, group membership).
      const r = await runGameAction(tx, deps, target, { type: 'cancel' }, { now: deps.clock(), rng: createRng('admin-cancel') })
      if (!r.ok) throw new ApiError(409, r.error)
      await audit(tx, c, {
        action: 'player.cancel_session',
        targetType: 'user',
        targetId: id,
        before: { sessionId: was?.id ?? null, startedAt: was?.startedAt ?? null, plannedMinutes: was?.plannedMinutes ?? null },
        after: { sessionId: null },
        ...(body.reason && { note: body.reason }),
      })
      return { r, target }
    })
    bus.publish(id, { type: 'game', version: out.r.version })
    await publishGroupEvents(deps, out.target, out.r.groupEvents)
    return detail(c, id)
  })

  app.post('/:id/logout-all', staff('support'), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, optionalReason)
    if (id === c.get('user').id) throw new ApiError(409, 'self_target')
    writeLimit(c)
    const gone = await db.transaction(async (tx) => {
      await lockTarget(tx, c, id)
      const rows = await tx.delete(authSessions).where(eq(authSessions.userId, id)).returning({ id: authSessions.id })
      if (rows.length > 0) await audit(tx, c, { action: 'player.logout_all', targetType: 'user', targetId: id, after: { sessions: rows.length }, ...(body.reason && { note: body.reason }) })
      return rows
    })
    bus.logoutSessions(id, gone.map((s) => s.id))
    return detail(c, id)
  })

  return app
}
