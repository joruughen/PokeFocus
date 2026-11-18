/**
 * /api/heals — study-group heals (GDD §9.2). Contract: src/game/protocol.ts «Study-group heals».
 *
 * A member of a study group, once their own session is over and while its waves of wild
 * Pokémon are on screen, offers `energy.groupHeal.amount` energy to ONE Pokémon
 * of the team of another member: `perWave` heal per wave reached (a 2-wave session = 2
 * heals), each to a different player. The receiver accepts (after their own session: the Pokémon of a running
 * session cannot be healed) or declines; a declined, cancelled or expired heal frees
 * the sender's slot, so they can resend or pick someone else.
 *
 * Only the receiver's player doc changes, when they accept (locked FOR UPDATE, then
 * the heal row). Every change publishes `{ type: 'heal' }` to the other side (and
 * `game` to the receiver when they accept). Pending heals lapse after `ttlHours`
 * (swept lazily).
 */
import { Hono } from 'hono'
import { and, desc, eq, inArray, lte, max, ne } from 'drizzle-orm'
import { HOUR_MS, receiveGroupHeal, type PlayerState } from '../../src/engine'
import type { GroupHealStatus, GroupHealView, HealsResponse, HealTarget } from '../../src/game/protocol'
import type { Db, Tx } from '../db/client'
import { groupHeals, playerDocs, studyGroupMembers, users, type GroupHealRow } from '../db/schema'
import { ApiError, gameTime, readBody, requireAuth, UUID_RE, type AppEnv, type Ctx, type Deps } from '../http'
import { RULES } from '../rate-limit'
import { healSendBody } from '../validation'

type Ex = Db | Tx
const OPEN: GroupHealStatus[] = ['pending', 'accepted']

const fail = (code: string, extra?: Record<string, unknown>): never => {
  throw new ApiError(409, code, extra)
}

/** The Pokémon of the player's team: the running session's team while they study, else the saved team. */
function teamOf(p: PlayerState): string[] {
  return p.activeSession?.teamUids ?? p.team
}

export function healRoutes(deps: Deps) {
  const { db, bus, limiter } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))
  const cfg = (now: number) => deps.content.current(now).then((r) => r.ctx.config.energy.groupHeal)

  const limit = (c: Ctx, rule: (typeof RULES)[keyof typeof RULES], key: string) => {
    const r = limiter.hit(key, rule)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
  }
  const healId = (c: Ctx): string => {
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    return id
  }
  const namesOf = async (ex: Ex, ids: string[]) => {
    const list = [...new Set(ids)]
    if (list.length === 0) return new Map<string, string>()
    const rows = await ex.select({ id: users.id, name: users.trainerName }).from(users).where(inArray(users.id, list))
    return new Map(rows.map((r) => [r.id, r.name]))
  }
  const readPlayer = async (ex: Ex, userId: string): Promise<PlayerState | null> => {
    const [row] = await ex.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, userId))
    return row?.doc.player ?? null
  }
  const viewOf = (r: GroupHealRow, names: Map<string, string>): GroupHealView => ({
    id: r.id,
    groupId: r.groupId,
    from: { userId: r.fromUserId, trainerName: names.get(r.fromUserId) ?? '?' },
    to: { userId: r.toUserId, trainerName: names.get(r.toUserId) ?? '?' },
    pokemonUid: r.pokemonUid,
    speciesSlug: r.speciesSlug,
    amount: r.amount,
    status: r.status,
    createdAt: r.createdAt.getTime(),
    expiresAt: r.expiresAt.getTime(),
    respondedAt: r.respondedAt?.getTime() ?? null,
  })
  const viewOne = async (r: GroupHealRow) => viewOf(r, await namesOf(db, [r.fromUserId, r.toUserId]))
  /** Pending heals that lapsed (of this user, as sender or receiver) become `expired`. */
  const sweep = async (userId: string, now: number) => {
    const lapsed = (col: typeof groupHeals.fromUserId | typeof groupHeals.toUserId) =>
      db.update(groupHeals).set({ status: 'expired', respondedAt: new Date(now) }).where(and(eq(col, userId), eq(groupHeals.status, 'pending'), lte(groupHeals.expiresAt, new Date(now))))
    await lapsed(groupHeals.fromUserId)
    await lapsed(groupHeals.toUserId)
  }
  const lockHeal = async (tx: Tx, id: string): Promise<GroupHealRow> => {
    const [r] = await tx.select().from(groupHeals).where(eq(groupHeals.id, id)).for('update')
    if (!r) throw new ApiError(404, 'not_found')
    return r
  }
  const publish = (to: string, r: GroupHealRow, actor: { id: string; trainerName: string }) =>
    bus.publish(to, { type: 'heal', healId: r.id, status: r.status, userId: actor.id, trainerName: actor.trainerName })

  /**
   * Heals the player may have open in a group: `perWave` per wave reached, while the waves of
   * THAT group's session are on screen (the encounter carries the session id). 0 = not now.
   */
  const allowanceOf = (p: PlayerState | null, sessionId: string | undefined, perWave: number): number =>
    p?.encounter && sessionId !== undefined && p.encounter.sessionId === sessionId ? perWave * (p.encounter.currentWave + 1) : 0

  /** The latest group the user studied in, while heals can still be sent: its id and the last moment. */
  const healGroupOf = async (ex: Ex, userId: string, now: number, windowMs: number) => {
    const mine = await ex
      .select({ groupId: studyGroupMembers.groupId, joinedAt: studyGroupMembers.joinedAt, sessionId: studyGroupMembers.sessionId })
      .from(studyGroupMembers)
      .where(eq(studyGroupMembers.userId, userId))
      .orderBy(desc(studyGroupMembers.joinedAt))
      .limit(1)
    const m = mine[0]
    if (!m) return null
    const [last] = await ex.select({ end: max(studyGroupMembers.endsAt) }).from(studyGroupMembers).where(eq(studyGroupMembers.groupId, m.groupId))
    const until = (last?.end?.getTime() ?? 0) + windowMs
    return now <= until ? { id: m.groupId, until, sessionId: m.sessionId } : null
  }

  app.get('/', async (c) => {
    const me = c.get('user')
    const now = gameTime(deps, c)
    await sweep(me.id, now)
    const hc = await cfg(now)
    const windowMs = hc.windowHours * HOUR_MS
    const incomingRows = await db
      .select()
      .from(groupHeals)
      .where(and(eq(groupHeals.toUserId, me.id), eq(groupHeals.status, 'pending')))
      .orderBy(desc(groupHeals.createdAt))
    const latest = await healGroupOf(db, me.id, now, windowMs)
    const allowance = latest ? allowanceOf(await readPlayer(db, me.id), latest.sessionId, hc.perWave) : 0
    const g = allowance > 0 ? latest : null
    let group: HealsResponse['group'] = null
    let sentRows: GroupHealRow[] = []
    let members: { userId: string }[] = []
    if (g) {
      sentRows = await db
        .select()
        .from(groupHeals)
        .where(and(eq(groupHeals.groupId, g.id), eq(groupHeals.fromUserId, me.id)))
        .orderBy(desc(groupHeals.createdAt))
      members = await db.select({ userId: studyGroupMembers.userId }).from(studyGroupMembers).where(and(eq(studyGroupMembers.groupId, g.id), ne(studyGroupMembers.userId, me.id)))
    }
    const names = await namesOf(db, [...incomingRows.flatMap((r) => [r.fromUserId, r.toUserId]), ...sentRows.flatMap((r) => [r.fromUserId, r.toUserId]), ...members.map((m) => m.userId)])
    if (g) {
      const sentTo = new Set(sentRows.filter((r) => OPEN.includes(r.status)).map((r) => r.toUserId))
      const targets: HealTarget[] = []
      for (const m of members) {
        const p = await readPlayer(db, m.userId)
        if (!p) continue
        targets.push({
          userId: m.userId,
          trainerName: names.get(m.userId) ?? '?',
          pokemon: teamOf(p)
            .map((uid) => p.pokemon[uid])
            .filter((x): x is NonNullable<typeof x> => !!x)
            .map((x) => ({ uid: x.uid, speciesSlug: x.speciesSlug, level: x.level, isShiny: x.isShiny })),
          sent: sentTo.has(m.userId),
        })
      }
      group = {
        id: g.id,
        until: g.until,
        remaining: Math.max(0, allowance - sentRows.filter((r) => OPEN.includes(r.status)).length),
        targets,
        sent: sentRows.map((r) => viewOf(r, names)),
      }
    }
    const body: HealsResponse = { incoming: incomingRows.map((r) => viewOf(r, names)), group, amount: hc.amount, serverNow: now }
    return c.json(body)
  })

  app.post('/', async (c) => {
    const me = c.get('user')
    limit(c, RULES.healWriteUser, `heal-write:user:${me.id}`)
    const body = await readBody(c, healSendBody)
    const now = gameTime(deps, c)
    if (body.toUserId === me.id) fail('not_in_group')
    await sweep(me.id, now)
    const hc = await cfg(now)
    const row = await db.transaction(async (tx) => {
      // Serialize this sender's sends (two taps cannot beat the limit) and read their waves.
      const [mine0] = await tx.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, me.id)).for('update')
      const members = await tx.select().from(studyGroupMembers).where(eq(studyGroupMembers.groupId, body.groupId))
      if (!members.some((m) => m.userId === me.id) || !members.some((m) => m.userId === body.toUserId)) fail('not_in_group')
      const allowance = allowanceOf(mine0?.doc.player ?? null, members.find((m) => m.userId === me.id)?.sessionId, hc.perWave)
      if (allowance === 0) fail('not_in_waves')
      const until = Math.max(...members.map((m) => m.endsAt.getTime())) + hc.windowHours * HOUR_MS
      if (now > until) fail('heal_window_closed')
      const mine = await tx
        .select()
        .from(groupHeals)
        .where(and(eq(groupHeals.groupId, body.groupId), eq(groupHeals.fromUserId, me.id), inArray(groupHeals.status, OPEN)))
      if (mine.length >= allowance) fail('heal_limit')
      if (mine.some((r) => r.toUserId === body.toUserId)) fail('heal_already_sent')
      const target = await readPlayer(tx, body.toUserId)
      const mon = target && teamOf(target).includes(body.uid) ? target.pokemon[body.uid] : undefined
      if (!mon) fail('unknown_pokemon')
      const [r] = await tx
        .insert(groupHeals)
        .values({
          groupId: body.groupId,
          fromUserId: me.id,
          toUserId: body.toUserId,
          pokemonUid: body.uid,
          speciesSlug: mon!.speciesSlug,
          amount: hc.amount,
          status: 'pending',
          createdAt: new Date(now),
          expiresAt: new Date(now + hc.ttlHours * HOUR_MS),
        })
        .returning()
      return r!
    })
    publish(row.toUserId, row, me)
    return c.json(await viewOne(row), 201)
  })

  /** Receiver accepts: +energy to the Pokémon (their doc only), once their session is over. */
  app.post('/:id/accept', async (c) => {
    const me = c.get('user')
    limit(c, RULES.healWriteUser, `heal-write:user:${me.id}`)
    const id = healId(c)
    const now = gameTime(deps, c)
    await sweep(me.id, now)
    const ctx = (await deps.content.current(now)).ctx
    const out = await db.transaction(async (tx) => {
      const [doc] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, me.id)).for('update')
      const r = await lockHeal(tx, id)
      if (r.toUserId !== me.id) throw new ApiError(404, 'not_found')
      if (r.status !== 'pending') fail('heal_closed')
      if (r.expiresAt.getTime() <= now) fail('heal_expired')
      if (!doc?.doc.player) fail('no_player')
      const healed = receiveGroupHeal(doc!.doc.player!, r.pokemonUid, now, ctx)
      if (!healed.ok) return fail(healed.error)
      const version = doc!.version + 1
      await tx.update(playerDocs).set({ doc: { ...doc!.doc, player: healed.value }, version, updatedAt: new Date(deps.clock()) }).where(eq(playerDocs.userId, me.id))
      const [done] = await tx.update(groupHeals).set({ status: 'accepted', respondedAt: new Date(now) }).where(eq(groupHeals.id, id)).returning()
      return { row: done!, version }
    })
    bus.publish(me.id, { type: 'game', version: out.version })
    publish(out.row.fromUserId, out.row, me)
    return c.json(await viewOne(out.row))
  })

  const close = (kind: 'declined' | 'cancelled') => async (c: Ctx) => {
    const me = c.get('user')
    limit(c, RULES.healWriteUser, `heal-write:user:${me.id}`)
    const id = healId(c)
    const now = gameTime(deps, c)
    await sweep(me.id, now)
    const row = await db.transaction(async (tx) => {
      const r = await lockHeal(tx, id)
      const who = kind === 'declined' ? r.toUserId : r.fromUserId
      if (who !== me.id) throw new ApiError(404, 'not_found')
      if (r.status !== 'pending') fail('heal_closed')
      const [done] = await tx.update(groupHeals).set({ status: kind, respondedAt: new Date(now) }).where(eq(groupHeals.id, id)).returning()
      return done!
    })
    publish(kind === 'declined' ? row.fromUserId : row.toUserId, row, me)
    return c.json(await viewOne(row))
  }
  app.post('/:id/decline', close('declined'))
  app.post('/:id/cancel', close('cancelled'))

  return app
}
