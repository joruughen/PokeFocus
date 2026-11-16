/** /api/friends and /api/leaderboard. */
import { Hono } from 'hono'
import { and, asc, count, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm'
import { leagueForPoints, monthKey, monthKeyOf, weekKey, weekKeyOf, weeklyPoints } from '../../src/engine'
import type {
  FriendStatus,
  FriendSummary,
  LeaderboardPeriod,
  LeaderboardResponse,
  LeaderboardRow,
  LeaderboardScope,
} from '../../src/game/protocol'
import { normalizeFriendCode } from '../auth/tokens'
import type { Db, Tx } from '../db/client'
import { friendships, leagueScores, playerDocs, users } from '../db/schema'
import { ApiError, readBody, requireAuth, UUID_RE, type AppEnv, type Deps } from '../http'
import { friendRequestBody } from '../validation'
import { cancelTradesBetween } from './trades'

/** Max friendships (any status) per user. */
const MAX_FRIENDS = 200
const LEADERBOARD_SIZE = 100

/** Accepted friend ids of a user. */
export async function friendIds(db: Db | Tx, userId: string): Promise<string[]> {
  const rows = await db
    .select({ a: friendships.requesterId, b: friendships.addresseeId })
    .from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))))
  return rows.map((r) => (r.a === userId ? r.b : r.a))
}

export function friendRoutes(deps: Deps) {
  const { db, bus } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))

  app.get('/', async (c) => {
    const me = c.get('user')
    const rels = await db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)))
      .orderBy(asc(friendships.createdAt))
    const otherIds = rels.map((r) => (r.requesterId === me.id ? r.addresseeId : r.requesterId))
    if (otherIds.length === 0) return c.json({ friends: [] as FriendSummary[] })
    const accepted = new Set(rels.filter((r) => r.status === 'accepted').map((r) => (r.requesterId === me.id ? r.addresseeId : r.requesterId)))
    const people = await db
      .select({ user: users })
      .from(users)
      .where(inArray(users.id, otherIds))
    const docs = accepted.size
      ? await db.select({ userId: playerDocs.userId, doc: playerDocs.doc }).from(playerDocs).where(inArray(playerDocs.userId, [...accepted]))
      : []
    const docOf = new Map(docs.map((d) => [d.userId, d.doc]))
    const byId = new Map(people.map((p) => [p.user.id, p.user]))
    const now = deps.clock()
    const friends: FriendSummary[] = []
    for (const r of rels) {
      const otherId = r.requesterId === me.id ? r.addresseeId : r.requesterId
      const u = byId.get(otherId)
      if (!u) continue
      const status: FriendStatus = r.status === 'accepted' ? 'friend' : r.requesterId === me.id ? 'outgoing' : 'incoming'
      const f: FriendSummary = { userId: u.id, trainerName: u.trainerName, country: u.country, friendCode: u.friendCode, status }
      if (status === 'friend') f.friendsSince = (r.acceptedAt ?? r.createdAt).getTime()
      const player = status === 'friend' ? docOf.get(u.id)?.player : null
      if (player) {
        const wp = weeklyPoints(player, now)
        f.trainerLevel = player.trainer.level
        f.weeklyPoints = wp
        f.league = leagueForPoints(wp, 'week')
        f.team = player.team.flatMap((uid) => {
          const p = player.pokemon[uid]
          return p ? [{ speciesSlug: p.speciesSlug, shiny: p.isShiny, level: p.level }] : []
        })
      }
      friends.push(f)
    }
    return c.json({ friends })
  })

  app.post('/request', async (c) => {
    const me = c.get('user')
    const { friendCode } = await readBody(c, friendRequestBody)
    const [target] = await db.select().from(users).where(eq(users.friendCode, normalizeFriendCode(friendCode))).limit(1)
    if (!target) throw new ApiError(404, 'unknown_friend_code')
    if (target.id === me.id) throw new ApiError(409, 'cannot_add_self')
    const status = await db.transaction(async (tx) => {
      const rels = await tx
        .select()
        .from(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, target.id)),
            and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, me.id)),
          ),
        )
      const rel = rels[0]
      if (rel?.status === 'accepted') throw new ApiError(409, 'already_friends')
      if (rel && rel.requesterId === me.id) throw new ApiError(409, 'already_requested')
      if (rel) {
        // They already asked me: accept directly.
        await tx
          .update(friendships)
          .set({ status: 'accepted', acceptedAt: new Date(deps.clock()) })
          .where(and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, me.id)))
        return 'friend' as const
      }
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(friendships)
        .where(or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)))) as [{ n: number }]
      if (n >= MAX_FRIENDS) throw new ApiError(409, 'too_many_friends')
      await tx.insert(friendships).values({ requesterId: me.id, addresseeId: target.id, status: 'pending', createdAt: new Date(deps.clock()) }).onConflictDoNothing()
      return 'outgoing' as const
    })
    bus.publish(me.id, { type: 'friends' })
    bus.publish(target.id, { type: 'friends' })
    return c.json({ userId: target.id, status }, 201)
  })

  app.post('/:userId/accept', async (c) => {
    const me = c.get('user')
    const other = c.req.param('userId')
    if (!UUID_RE.test(other)) throw new ApiError(404, 'not_found')
    const done = await db
      .update(friendships)
      .set({ status: 'accepted', acceptedAt: new Date(deps.clock()) })
      .where(and(eq(friendships.requesterId, other), eq(friendships.addresseeId, me.id), eq(friendships.status, 'pending')))
      .returning({ id: friendships.requesterId })
    if (done.length === 0) throw new ApiError(404, 'not_found')
    bus.publish(me.id, { type: 'friends' })
    bus.publish(other, { type: 'friends' })
    return c.body(null, 204)
  })

  app.delete('/:userId', async (c) => {
    const me = c.get('user')
    const other = c.req.param('userId')
    if (!UUID_RE.test(other)) throw new ApiError(404, 'not_found')
    const gone = await db
      .delete(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, other)),
          and(eq(friendships.requesterId, other), eq(friendships.addresseeId, me.id)),
        ),
      )
      .returning({ id: friendships.requesterId })
    if (gone.length === 0) throw new ApiError(404, 'not_found')
    // Open trade offers between them close (a trade needs a friendship).
    for (const e of await cancelTradesBetween(db, me.id, other, deps.clock(), me)) bus.publish(e.to, e.event)
    bus.publish(me.id, { type: 'friends' })
    bus.publish(other, { type: 'friends' })
    return c.body(null, 204)
  })

  return app
}

/** Shared tops of the global and country boards (see `leaderboardCacheMs`). Bounded: oldest entry out. */
type BoardTop = { userId: string; points: number; trainerName: string; anonymous: boolean; country: string; leader: string | null }[]
const boardCache = new Map<string, { at: number; top: BoardTop; total: number }>()
const BOARD_CACHE_MAX = 600

export function leaderboardRoutes(deps: Deps) {
  const { db } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))

  app.get('/', async (c) => {
    const me = c.get('user')
    const scope = (c.req.query('scope') ?? 'global') as LeaderboardScope
    const period = (c.req.query('period') ?? 'week') as LeaderboardPeriod
    if (!['global', 'country', 'friends'].includes(scope)) throw new ApiError(400, 'invalid_scope')
    if (!['week', 'month'].includes(period)) throw new ApiError(400, 'invalid_period')

    // The caller's current period key, from their own time zone (UTC if no player yet).
    const now = deps.clock()
    const [mine] = await db.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, me.id))
    const player = mine?.doc.player
    const periodKey = player ? (period === 'week' ? weekKey(player, now) : monthKey(player, now)) : period === 'week' ? weekKeyOf(now, 0) : monthKeyOf(now, 0)

    const conds: SQL[] = [eq(leagueScores.period, period), eq(leagueScores.periodKey, periodKey), gt(leagueScores.points, 0)]
    if (scope === 'country') conds.push(eq(users.country, me.country))
    if (scope === 'friends') conds.push(inArray(leagueScores.userId, [me.id, ...(await friendIds(db, me.id))]))
    const where = and(...conds)

    // team[0] → its species slug, read straight from the jsonb doc.
    const leader = sql<string | null>`${playerDocs.doc} -> 'player' -> 'pokemon' -> (${playerDocs.doc} -> 'player' -> 'team' ->> 0) ->> 'speciesSlug'`
    const cols = {
      userId: leagueScores.userId,
      points: leagueScores.points,
      trainerName: users.trainerName,
      anonymous: users.anonymousRankings,
      country: users.country,
      leader,
    }
    const base = () =>
      db
        .select(cols)
        .from(leagueScores)
        .innerJoin(users, eq(users.id, leagueScores.userId))
        .leftJoin(playerDocs, eq(playerDocs.userId, leagueScores.userId))

    // The top and the total are the same for every viewer of a global or country board, so they are
    // computed once per `cacheMs` (the caller's own row below is always live). Friends boards depend on
    // the viewer and are never cached. The total needs the users join only for the country filter.
    const cacheKey = scope === 'friends' ? null : `${scope}|${period}|${periodKey}|${scope === 'country' ? me.country : ''}`
    const cacheMs = deps.env.leaderboardCacheMs
    const hit = cacheKey && cacheMs > 0 ? boardCache.get(cacheKey) : undefined
    let top: BoardTop
    let total: number
    if (hit && now - hit.at < cacheMs) {
      ;({ top, total } = hit)
    } else {
      // Pick the 100 ids from league_scores alone (index order), and only then join `users` and the large
      // player doc for those 100. Joining first made every call walk all the players (52 ms at 5,000).
      const pick = db.select({ userId: leagueScores.userId, points: leagueScores.points, updatedAt: leagueScores.updatedAt }).from(leagueScores).$dynamic()
      const ranked = (scope === 'country' ? pick.innerJoin(users, eq(users.id, leagueScores.userId)) : pick)
        .where(where)
        .orderBy(desc(leagueScores.points), asc(leagueScores.updatedAt))
        .limit(LEADERBOARD_SIZE)
        .as('ranked')
      top = await db
        .select({ userId: ranked.userId, points: ranked.points, trainerName: users.trainerName, anonymous: users.anonymousRankings, country: users.country, leader })
        .from(ranked)
        .innerJoin(users, eq(users.id, ranked.userId))
        .leftJoin(playerDocs, eq(playerDocs.userId, ranked.userId))
        .orderBy(desc(ranked.points), asc(ranked.updatedAt))
      const countFrom = db.select({ total: count() }).from(leagueScores)
      const [row] = (await (scope === 'country' ? countFrom.innerJoin(users, eq(users.id, leagueScores.userId)) : countFrom).where(where)) as [{ total: number }]
      total = Number(row.total)
      if (cacheKey && cacheMs > 0) {
        if (boardCache.size >= BOARD_CACHE_MAX) boardCache.delete(boardCache.keys().next().value!)
        boardCache.set(cacheKey, { at: now, top, total })
      }
    }

    // Privacy: anonymous trainers lose their name in the global and country scopes, except on the
    // caller's own row. Friends always see names. `anonymous` is reported either way.
    const toRow = (r: (typeof top)[number], rank: number): LeaderboardRow => ({
      rank,
      userId: r.userId,
      trainerName: scope !== 'friends' && r.anonymous && r.userId !== me.id ? null : r.trainerName,
      anonymous: r.anonymous,
      country: r.country,
      points: r.points,
      league: leagueForPoints(r.points, period),
      leader: r.leader ?? null,
      me: r.userId === me.id,
    })
    // Competition ranking: ties share a rank ("1, 2, 2, 4"), same as `mine`.
    const rows: LeaderboardRow[] = []
    top.forEach((r, i) => {
      const prev = rows[i - 1]
      rows.push(toRow(r, prev && prev.points === r.points ? prev.rank : i + 1))
    })

    let mineRow: LeaderboardRow | null = rows.find((r) => r.me) ?? null
    if (!mineRow) {
      const [own] = await base()
        .where(and(where, eq(leagueScores.userId, me.id)))
        .limit(1)
      if (own) {
        const betterFrom = db.select({ better: count() }).from(leagueScores)
        const [{ better }] = (await (scope === 'country' ? betterFrom.innerJoin(users, eq(users.id, leagueScores.userId)) : betterFrom).where(
          and(where, gt(leagueScores.points, own.points)),
        )) as [{ better: number }]
        mineRow = toRow(own, Number(better) + 1)
      }
    }

    const body: LeaderboardResponse = { scope, period, periodKey, rows, mine: mineRow, total }
    return c.json(body)
  })

  return app
}
