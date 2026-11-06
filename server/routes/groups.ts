/**
 * /api/groups — study groups ("Estudiar con amigos", docs/session-depth-plan.md §C).
 *
 *   GET  /groups               → GroupsResponse (my current group + pending invites)
 *   POST /groups               { minutes, friendIds } → 201 StudyGroupView (lobby)
 *   GET  /groups/:id           → StudyGroupView (participants only)
 *   POST /groups/:id/invite    { friendIds } → StudyGroupView (host; lobby or joinable)
 *   POST /groups/:id/accept    → StudyGroupView (lobby: wait; started: join late = start now)
 *   POST /groups/:id/decline   → 204
 *   POST /groups/:id/start     → StudyGroupView (host: everyone accepted starts now)
 *   POST /groups/:id/leave     → 204 (lobby: host disbands / invitee declines; started: leave, session goes on solo)
 *
 * Every change publishes `{ type: 'group', … }` to the participants.
 */
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { MINUTE_MS } from '../../src/engine'
import type { GroupsResponse } from '../../src/game/protocol'
import type { Tx } from '../db/client'
import { activeStudySessions, playerDocs, studyGroupInvites, studyGroupMembers, studyGroups, users } from '../db/schema'
import {
  dropLobbies,
  effectiveStatus,
  groupView,
  isJoinable,
  LOBBY_TTL_MS,
  MAX_GROUP_SIZE,
  memberOfSession,
  membersOf,
  openLobbyOf,
  pendingInvitesOf,
  publishGroupEvents,
  type GroupRow,
  type PendingGroupEvent,
} from '../groups'
import { ApiError, gameTime, readBody, requireAuth, UUID_RE, type AppEnv, type Ctx, type Deps } from '../http'
import { RULES } from '../rate-limit'
import { groupCreateBody, groupInviteBody } from '../validation'
import { actionRng, runGameAction } from './game'
import { friendIds } from './social'

type Actor = { id: string; trainerName: string }

export function groupRoutes(deps: Deps) {
  const { db, bus, limiter } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))

  const limit = (c: Ctx, rule: (typeof RULES)[keyof typeof RULES], key: string) => {
    const r = limiter.hit(key, rule)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
  }
  const groupId = (c: Ctx): string => {
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    return id
  }
  const lockGroup = async (tx: Tx, id: string): Promise<GroupRow> => {
    const [g] = await tx.select().from(studyGroups).where(eq(studyGroups.id, id)).for('update')
    if (!g) throw new ApiError(404, 'not_found')
    return g
  }
  /** Serialize one user's group writes (and their game actions) on their doc row. */
  const lockUser = async (tx: Tx, userId: string) => {
    const [row] = await tx.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, userId)).for('update')
    return row?.doc ?? null
  }
  const hasActiveSession = async (tx: Tx, userId: string) =>
    (await tx.select({ id: activeStudySessions.userId }).from(activeStudySessions).where(eq(activeStudySessions.userId, userId))).length > 0
  const inviteOf = async (tx: Tx, gid: string, userId: string) => {
    const [i] = await tx
      .select()
      .from(studyGroupInvites)
      .where(and(eq(studyGroupInvites.groupId, gid), eq(studyGroupInvites.inviteeId, userId)))
    return i ?? null
  }
  const setInvite = (tx: Tx, gid: string, userId: string, status: 'accepted' | 'declined' | 'joined' | 'failed' | 'pending', now: number) =>
    tx
      .update(studyGroupInvites)
      .set({ status, respondedAt: status === 'pending' ? null : new Date(now) })
      .where(and(eq(studyGroupInvites.groupId, gid), eq(studyGroupInvites.inviteeId, userId)))
  /** Validate a friend list: no self, accepted friends only. */
  const checkFriends = async (tx: Tx, me: string, ids: string[]): Promise<string[]> => {
    const list = [...new Set(ids)]
    if (list.includes(me)) throw new ApiError(409, 'cannot_invite_self')
    const mine = new Set(await friendIds(tx, me))
    if (list.some((id) => !mine.has(id))) throw new ApiError(409, 'not_friends')
    return list
  }
  /**
   * Start the user's session in group `g` (same minutes) and record the member
   * row, inside a savepoint so a failure leaves nothing behind.
   */
  const startMember = async (tx: Tx, c: Ctx, g: GroupRow, user: Actor, now: number) =>
    tx.transaction(async (sp) => {
      const r = await runGameAction(sp, deps, user, { type: 'start', minutes: g.minutes }, { now, rng: actionRng(deps, c), viaGroup: true })
      if (!r.ok) throw new ApiError(409, r.error)
      const session = r.doc.player?.activeSession
      if (!session) throw new ApiError(409, 'no_session')
      await sp.insert(studyGroupMembers).values({
        groupId: g.id,
        userId: user.id,
        sessionId: session.id,
        joinedAt: new Date(now),
        endsAt: new Date(now + g.minutes * MINUTE_MS),
      })
      const dropped = await dropLobbies(sp, user.id, now, g.id)
      return { version: r.version, dropped: dropped.map((e) => ({ ...e, actor: user })) }
    })

  app.get('/', async (c) => {
    const me = c.get('user')
    const now = gameTime(deps, c)
    let current: GroupRow | null = null
    const [act] = await db.select().from(activeStudySessions).where(eq(activeStudySessions.userId, me.id))
    if (act) {
      const m = await memberOfSession(db, me.id, act.sessionId)
      if (m) current = (await db.select().from(studyGroups).where(eq(studyGroups.id, m.groupId)))[0] ?? null
    }
    current ??= await openLobbyOf(db, me.id, now)
    const invites = await pendingInvitesOf(db, me.id, now)
    const body: GroupsResponse = {
      current: current ? await groupView(db, current, me.id, now) : null,
      invites: await Promise.all(invites.filter((g) => g.id !== current?.id).map((g) => groupView(db, g, me.id, now))),
      serverNow: now,
    }
    return c.json(body)
  })

  app.post('/', async (c) => {
    const me = c.get('user')
    limit(c, RULES.groupInviteUser, `group-invite:user:${me.id}`)
    const body = await readBody(c, groupCreateBody)
    const now = gameTime(deps, c)
    const g = await db.transaction(async (tx) => {
      const doc = await lockUser(tx, me.id)
      if (!doc?.player) throw new ApiError(409, 'no_player')
      if (doc.player.activeSession || (await hasActiveSession(tx, me.id))) throw new ApiError(409, 'session_active')
      if (await openLobbyOf(tx, me.id, now)) throw new ApiError(409, 'already_in_group')
      const ids = await checkFriends(tx, me.id, body.friendIds)
      if (ids.length + 1 > MAX_GROUP_SIZE) throw new ApiError(409, 'group_full')
      const [row] = await tx
        .insert(studyGroups)
        .values({ hostId: me.id, minutes: body.minutes, status: 'lobby', createdAt: new Date(now), expiresAt: new Date(now + LOBBY_TTL_MS) })
        .returning()
      await tx.insert(studyGroupInvites).values(ids.map((id) => ({ groupId: row!.id, inviteeId: id, status: 'pending' as const, createdAt: new Date(now) })))
      return row!
    })
    await publishGroupEvents(deps, me, [{ groupId: g.id, kind: 'invite' }])
    return c.json(await groupView(db, g, me.id, now), 201)
  })

  app.get('/:id', async (c) => {
    const me = c.get('user')
    const id = groupId(c)
    const now = gameTime(deps, c)
    const [g] = await db.select().from(studyGroups).where(eq(studyGroups.id, id))
    if (!g) throw new ApiError(404, 'not_found')
    const view = await groupView(db, g, me.id, now)
    if (!view.me.host && !view.me.member && view.me.invite === null) throw new ApiError(404, 'not_found')
    return c.json(view)
  })

  app.post('/:id/invite', async (c) => {
    const me = c.get('user')
    const id = groupId(c)
    limit(c, RULES.groupInviteUser, `group-invite:user:${me.id}`)
    const body = await readBody(c, groupInviteBody)
    const now = gameTime(deps, c)
    const g = await db.transaction(async (tx) => {
      const g = await lockGroup(tx, id)
      if (g.hostId !== me.id) throw new ApiError(409, 'not_host')
      const st = effectiveStatus(g, now)
      if (!(st === 'lobby' || (st === 'started' && isJoinable(g, await membersOf(tx, g.id), now)))) throw new ApiError(409, 'group_ended')
      const ids = await checkFriends(tx, me.id, body.friendIds)
      const existing = await tx.select().from(studyGroupInvites).where(eq(studyGroupInvites.groupId, g.id))
      const byId = new Map(existing.map((i) => [i.inviteeId, i]))
      const fresh = ids.filter((uid) => !byId.has(uid))
      if (existing.length + fresh.length + 1 > MAX_GROUP_SIZE) throw new ApiError(409, 'group_full')
      if (fresh.length) await tx.insert(studyGroupInvites).values(fresh.map((uid) => ({ groupId: g.id, inviteeId: uid, status: 'pending' as const, createdAt: new Date(now) })))
      // Ask again whoever declined or could not start; pending/accepted/joined stay as they are.
      for (const uid of ids) {
        const prev = byId.get(uid)
        if (prev && (prev.status === 'declined' || prev.status === 'failed')) await setInvite(tx, g.id, uid, 'pending', now)
      }
      return g
    })
    await publishGroupEvents(deps, me, [{ groupId: g.id, kind: 'invite' }])
    return c.json(await groupView(db, g, me.id, now))
  })

  app.post('/:id/accept', async (c) => {
    const me = c.get('user')
    const id = groupId(c)
    limit(c, RULES.groupWriteUser, `group-write:user:${me.id}`)
    const now = gameTime(deps, c)
    const out = await db.transaction(async (tx) => {
      const g = await lockGroup(tx, id)
      const doc = await lockUser(tx, me.id)
      const inv = await inviteOf(tx, g.id, me.id)
      if (!inv) throw new ApiError(404, 'not_found')
      const st = effectiveStatus(g, now)
      if (inv.status === 'accepted' && st === 'lobby') return { g, events: [] as PendingGroupEvent[], version: null } // idempotent
      if (inv.status !== 'pending') throw new ApiError(409, 'invite_closed')
      if (!(await friendIds(tx, me.id)).includes(g.hostId)) throw new ApiError(409, 'not_friends')
      if (!doc?.player) throw new ApiError(409, 'no_player')
      if (doc.player.activeSession || (await hasActiveSession(tx, me.id))) throw new ApiError(409, 'session_active')
      if (st === 'lobby') {
        const other = await openLobbyOf(tx, me.id, now)
        if (other && other.id !== g.id) throw new ApiError(409, 'already_in_group')
        await setInvite(tx, g.id, me.id, 'accepted', now)
        return { g, events: [{ groupId: g.id, kind: 'accept' }] as PendingGroupEvent[], version: null }
      }
      if (st === 'started' && isJoinable(g, await membersOf(tx, g.id), now)) {
        // Late join: my session starts now with the group's minutes (less accompanied time).
        const r = await startMember(tx, c, g, me, now)
        await setInvite(tx, g.id, me.id, 'joined', now)
        return { g, events: [{ groupId: g.id, kind: 'join' }, ...r.dropped] as PendingGroupEvent[], version: r.version }
      }
      throw new ApiError(409, 'group_ended')
    })
    if (out.version !== null) bus.publish(me.id, { type: 'game', version: out.version })
    await publishGroupEvents(deps, me, out.events)
    return c.json(await groupView(db, out.g, me.id, now))
  })

  app.post('/:id/decline', async (c) => {
    const me = c.get('user')
    const id = groupId(c)
    limit(c, RULES.groupWriteUser, `group-write:user:${me.id}`)
    const now = gameTime(deps, c)
    await db.transaction(async (tx) => {
      const g = await lockGroup(tx, id)
      const inv = await inviteOf(tx, g.id, me.id)
      if (!inv) throw new ApiError(404, 'not_found')
      if (inv.status !== 'pending' && inv.status !== 'accepted') throw new ApiError(409, 'invite_closed')
      await setInvite(tx, g.id, me.id, 'declined', now)
    })
    // The host hears about it (declined invitees are no longer "participants").
    const [g] = await db.select({ hostId: studyGroups.hostId }).from(studyGroups).where(eq(studyGroups.id, id))
    await publishGroupEvents(deps, me, [{ groupId: id, kind: 'decline' }], g ? [g.hostId] : [])
    return c.body(null, 204)
  })

  app.post('/:id/start', async (c) => {
    const me = c.get('user')
    const id = groupId(c)
    limit(c, RULES.groupWriteUser, `group-write:user:${me.id}`)
    const now = gameTime(deps, c)
    const out = await db.transaction(async (tx) => {
      const g = await lockGroup(tx, id)
      if (g.hostId !== me.id) throw new ApiError(409, 'not_host')
      if (effectiveStatus(g, now) !== 'lobby') throw new ApiError(409, 'group_ended')
      const started: { id: string; version: number }[] = []
      const events: PendingGroupEvent[] = []
      // The host first: if they cannot start (e.g. a session elsewhere), nothing happens.
      const host = await startMember(tx, c, g, me, now)
      started.push({ id: me.id, version: host.version })
      const accepted = await tx
        .select({ id: users.id, trainerName: users.trainerName })
        .from(studyGroupInvites)
        .innerJoin(users, eq(users.id, studyGroupInvites.inviteeId))
        .where(and(eq(studyGroupInvites.groupId, g.id), eq(studyGroupInvites.status, 'accepted')))
        .orderBy(asc(users.id))
      for (const u of accepted) {
        try {
          const r = await startMember(tx, c, g, u, now)
          await setInvite(tx, g.id, u.id, 'joined', now)
          started.push({ id: u.id, version: r.version })
          events.push(...r.dropped)
        } catch (e) {
          if (!(e instanceof ApiError)) throw e
          // Could not start (already studying, empty team…): their invite is marked failed.
          await setInvite(tx, g.id, u.id, 'failed', now)
          events.push({ groupId: g.id, kind: 'failed', actor: u })
        }
      }
      await tx
        .update(studyGroups)
        .set({ status: 'started', startedAt: new Date(now), expiresAt: new Date(now + g.minutes * MINUTE_MS) })
        .where(eq(studyGroups.id, g.id))
      return { g, started, events: [{ groupId: g.id, kind: 'start' } as PendingGroupEvent, ...events] }
    })
    for (const s of out.started) bus.publish(s.id, { type: 'game', version: s.version })
    await publishGroupEvents(deps, me, out.events)
    const [fresh] = await db.select().from(studyGroups).where(eq(studyGroups.id, id))
    return c.json(await groupView(db, fresh ?? out.g, me.id, now))
  })

  app.post('/:id/leave', async (c) => {
    const me = c.get('user')
    const id = groupId(c)
    limit(c, RULES.groupWriteUser, `group-write:user:${me.id}`)
    const now = gameTime(deps, c)
    const ev = await db.transaction(async (tx): Promise<PendingGroupEvent> => {
      const g = await lockGroup(tx, id)
      const st = effectiveStatus(g, now)
      const inv = await inviteOf(tx, g.id, me.id)
      if (st === 'lobby') {
        if (g.hostId === me.id) {
          await tx.update(studyGroups).set({ status: 'ended' }).where(eq(studyGroups.id, g.id))
          return { groupId: g.id, kind: 'disband' }
        }
        if (inv && (inv.status === 'pending' || inv.status === 'accepted')) {
          await setInvite(tx, g.id, me.id, 'declined', now)
          return { groupId: g.id, kind: 'decline' }
        }
        throw new ApiError(409, 'not_in_group')
      }
      if (st === 'started') {
        const [m] = await tx
          .select()
          .from(studyGroupMembers)
          .where(and(eq(studyGroupMembers.groupId, g.id), eq(studyGroupMembers.userId, me.id)))
        if (m && m.leftAt === null && m.endsAt.getTime() > now) {
          await tx
            .update(studyGroupMembers)
            .set({ leftAt: new Date(now), leftReason: 'leave' })
            .where(and(eq(studyGroupMembers.groupId, g.id), eq(studyGroupMembers.userId, me.id)))
          return { groupId: g.id, kind: 'leave', reason: 'leave' }
        }
        if (inv && inv.status === 'pending') {
          await setInvite(tx, g.id, me.id, 'declined', now)
          return { groupId: g.id, kind: 'decline' }
        }
        throw new ApiError(409, 'not_in_group')
      }
      throw new ApiError(409, 'group_ended')
    })
    const [g] = await db.select({ hostId: studyGroups.hostId }).from(studyGroups).where(eq(studyGroups.id, id))
    await publishGroupEvents(deps, me, [ev], g ? [g.hostId] : [])
    return c.body(null, 204)
  })

  return app
}
