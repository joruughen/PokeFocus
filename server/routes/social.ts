/** /api/friends and /api/leaderboard. */
import { Hono } from 'hono'
import { and, asc, count, desc, eq, gt, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import {
  addDays,
  defaultContext,
  leagueLadder,
  monthKey,
  monthKeyOf,
  podiumSettled,
  rankForPoints,
  rankInterval,
  rankOf,
  settlePodium,
  weekKey,
  weekKeyOf,
  weeklyPoints,
  type LeagueId,
} from '../../src/engine'
import type {
  FriendStatus,
  FriendSummary,
  LeaderboardPeriod,
  LeaderboardRank,
  LeaderboardResponse,
  LeaderboardRow,
  LeaderboardScope,
  PodiumResponse,
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
        const rung = rankForPoints(wp, 'week')
        f.league = rung.league
        f.leagueSub = rung.sub
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
/** One entry per board seen in the last `leaderboardCacheMs`: scope × period × country × rung. */
const BOARD_CACHE_MAX = 1500

/** Hours after a local week ends before it is final everywhere (the last time zone is UTC−12). */
const WEEK_FINAL_AFTER_MS = 12 * 3_600_000

/** UTC ms at which the week of a Monday key ('YYYY-MM-DD') has ended in every time zone. */
function weekFinalAt(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 7) + WEEK_FINAL_AFTER_MS
}

export function leaderboardRoutes(deps: Deps) {
  const { db, bus } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))

  app.get('/', async (c) => {
    const me = c.get('user')
    const askedScope = (c.req.query('scope') ?? 'global') as LeaderboardScope
    const period = (c.req.query('period') ?? 'week') as LeaderboardPeriod
    if (!['global', 'country', 'friends'].includes(askedScope)) throw new ApiError(400, 'invalid_scope')
    if (!['week', 'month'].includes(period)) throw new ApiError(400, 'invalid_period')

    // The caller's current period key, from their own time zone (UTC if no player yet).
    const now = deps.clock()
    const [mine] = await db.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, me.id))
    const player = mine?.doc.player
    const periodKey = player ? (period === 'week' ? weekKey(player, now) : monthKey(player, now)) : period === 'week' ? weekKeyOf(now, 0) : monthKeyOf(now, 0)
    const myPoints = player ? ((period === 'week' ? player.league.weeklyPoints : player.league.monthlyPoints)[periodKey] ?? 0) : 0
    const myRung = rankForPoints(myPoints, period)

    // Rung filter (GDD §14): `rank=mine` = the caller's rung; `league` + `sub` = any rung; nothing = every rung.
    // The rung of a row comes from its points, so a rung board is a points interval on the ranking index.
    const rankParam = c.req.query('rank')
    const leagueParam = c.req.query('league')
    let rung: LeaderboardRank | null = null
    if (rankParam === 'mine' || leagueParam !== undefined) {
      let r = myRung
      if (rankParam !== 'mine') {
        if (!leagueLadder(period).some((x) => x.league === leagueParam)) throw new ApiError(400, 'invalid_league')
        const sub = Number(c.req.query('sub') ?? '1')
        if (!Number.isInteger(sub) || sub < 1 || sub > 99) throw new ApiError(400, 'invalid_sub')
        r = rankOf(leagueParam as LeagueId, sub, period)
      }
      rung = { league: r.league, sub: r.sub, index: r.index, ...rankInterval(r.index, period) }
    } else if (rankParam !== undefined && rankParam !== 'all') throw new ApiError(400, 'invalid_rank')

    // team[0] → its species slug, read straight from the jsonb doc.
    const leader = sql<string | null>`${playerDocs.doc} -> 'player' -> 'pokemon' -> (${playerDocs.doc} -> 'player' -> 'team' ->> 0) ->> 'speciesSlug'`
    const friends = askedScope === 'friends' ? [me.id, ...(await friendIds(db, me.id))] : []
    const cacheMs = deps.env.leaderboardCacheMs

    const whereOf = (scope: LeaderboardScope): SQL => {
      const conds: SQL[] = [eq(leagueScores.period, period), eq(leagueScores.periodKey, periodKey), gt(leagueScores.points, 0)]
      if (rung) {
        conds.push(gte(leagueScores.points, rung.from))
        if (rung.to !== null) conds.push(lt(leagueScores.points, rung.to))
      }
      if (scope === 'country') conds.push(eq(users.country, me.country))
      if (scope === 'friends') conds.push(inArray(leagueScores.userId, friends))
      return and(...conds) as SQL
    }

    // The top and the total are the same for every viewer of a global or country board, so they are
    // computed once per `cacheMs` (the caller's own row below is always live). Friends boards depend on
    // the viewer and are never cached. The total needs the users join only for the country filter.
    const loadBoard = async (scope: LeaderboardScope): Promise<{ top: BoardTop; total: number }> => {
      const cacheKey = scope === 'friends' ? null : `${scope}|${period}|${periodKey}|${scope === 'country' ? me.country : ''}|${rung ? rung.index : 'all'}`
      const hit = cacheKey && cacheMs > 0 ? boardCache.get(cacheKey) : undefined
      if (hit && now - hit.at < cacheMs) return hit
      const where = whereOf(scope)
      // Pick the 100 ids from league_scores alone (index order), and only then join `users` and the large
      // player doc for those 100. Joining first made every call walk all the players (52 ms at 5,000).
      const pick = db.select({ userId: leagueScores.userId, points: leagueScores.points, updatedAt: leagueScores.updatedAt }).from(leagueScores).$dynamic()
      const ranked = (scope === 'country' ? pick.innerJoin(users, eq(users.id, leagueScores.userId)) : pick)
        .where(where)
        .orderBy(desc(leagueScores.points), asc(leagueScores.updatedAt))
        .limit(LEADERBOARD_SIZE)
        .as('ranked')
      const top = await db
        .select({ userId: ranked.userId, points: ranked.points, trainerName: users.trainerName, anonymous: users.anonymousRankings, country: users.country, leader })
        .from(ranked)
        .innerJoin(users, eq(users.id, ranked.userId))
        .leftJoin(playerDocs, eq(playerDocs.userId, ranked.userId))
        .orderBy(desc(ranked.points), asc(ranked.updatedAt))
      const countFrom = db.select({ total: count() }).from(leagueScores)
      const [row] = (await (scope === 'country' ? countFrom.innerJoin(users, eq(users.id, leagueScores.userId)) : countFrom).where(where)) as [{ total: number }]
      const board = { at: now, top, total: Number(row.total) }
      if (cacheKey && cacheMs > 0) {
        if (boardCache.size >= BOARD_CACHE_MAX) boardCache.delete(boardCache.keys().next().value!)
        boardCache.set(cacheKey, board)
      }
      return board
    }

    // Few players (GDD §14): a rung board of a country with fewer than `podium.minPlayers` trainers shows the
    // global board of that rung instead, and says so.
    const minPlayers = leaguePodium().minPlayers
    let scope = askedScope
    let board = await loadBoard(scope)
    let fallback: LeaderboardResponse['fallback']
    if (rung && askedScope === 'country' && board.total < minPlayers) {
      scope = 'global'
      board = await loadBoard(scope)
      fallback = { from: 'country', minPlayers }
    }
    const { top, total } = board
    const where = whereOf(scope)

    // Privacy: anonymous trainers lose their name in the global and country scopes, except on the
    // caller's own row. Friends always see names. `anonymous` is reported either way.
    const toRow = (r: (typeof top)[number], rank: number): LeaderboardRow => {
      const rowRung = rankForPoints(r.points, period)
      return {
        rank,
        userId: r.userId,
        trainerName: scope !== 'friends' && r.anonymous && r.userId !== me.id ? null : r.trainerName,
        anonymous: r.anonymous,
        country: r.country,
        points: r.points,
        league: rowRung.league,
        sub: rowRung.sub,
        leader: r.leader ?? null,
        me: r.userId === me.id,
      }
    }
    // Competition ranking: ties share a rank ("1, 2, 2, 4"), same as `mine`.
    const rows: LeaderboardRow[] = []
    top.forEach((r, i) => {
      const prev = rows[i - 1]
      rows.push(toRow(r, prev && prev.points === r.points ? prev.rank : i + 1))
    })

    let mineRow: LeaderboardRow | null = rows.find((r) => r.me) ?? null
    if (!mineRow) {
      const [own] = await db
        .select({ userId: leagueScores.userId, points: leagueScores.points, trainerName: users.trainerName, anonymous: users.anonymousRankings, country: users.country, leader })
        .from(leagueScores)
        .innerJoin(users, eq(users.id, leagueScores.userId))
        .leftJoin(playerDocs, eq(playerDocs.userId, leagueScores.userId))
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

    const body: LeaderboardResponse = {
      scope,
      period,
      periodKey,
      rows,
      mine: mineRow,
      total,
      rank: rung,
      myRank: { league: myRung.league, sub: myRung.sub, index: myRung.index },
      ...(fallback && { fallback }),
    }
    return c.json(body)
  })

  /**
   * Weekly podium (GDD §14), settled when the player asks, with no background job: the caller's previous local
   * week is closed once it is final in every time zone. Their place on the board of their final rung (their
   * country's, or the global one when the country has fewer than `podium.minPlayers` trainers on that rung; no
   * podium when the global one is short too) pays Dust and queues the notice. Idempotent: `league.podiumSettled`.
   */
  app.post('/podium', async (c) => {
    const me = c.get('user')
    const now = deps.clock()
    const out = await db.transaction(async (tx): Promise<{ settled: PodiumResponse['settled']; version: number | null }> => {
      const [row] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, me.id)).for('update')
      const player = row?.doc.player
      if (!row || !player) return { settled: null, version: null }
      const key = addDays(weekKey(player, now), -7)
      const finalAt = weekFinalAt(key)
      if (podiumSettled(player, key) || finalAt === null || now < finalAt) return { settled: null, version: null }
      const points = player.league.weeklyPoints[key] ?? 0
      const rung = rankForPoints(points, 'week')
      const podium = leaguePodium()
      let place: number | null = null
      let scope: 'country' | 'global' | null = null
      if (points > 0) {
        const { from, to } = rankInterval(rung.index, 'week')
        const inRung = (extra?: SQL) =>
          and(eq(leagueScores.period, 'week'), eq(leagueScores.periodKey, key), gte(leagueScores.points, from), ...(to !== null ? [lt(leagueScores.points, to)] : []), ...(extra ? [extra] : []))
        const countIn = async (s: 'country' | 'global', extra?: SQL): Promise<number> => {
          const q = tx.select({ n: count() }).from(leagueScores)
          const [r] = (await (s === 'country' ? q.innerJoin(users, eq(users.id, leagueScores.userId)).where(and(inRung(extra), eq(users.country, me.country))) : q.where(inRung(extra)))) as [{ n: number }]
          return Number(r.n)
        }
        if ((await countIn('country')) >= podium.minPlayers) scope = 'country'
        else if ((await countIn('global')) >= podium.minPlayers) scope = 'global'
        if (scope) {
          const better = await countIn(scope, gt(leagueScores.points, points))
          if (better + 1 <= podium.placeMult.length) place = better + 1
        }
      }
      const r = settlePodium(player, { weekKey: key, index: rung.index, place, scope: scope ?? 'country', at: now })
      const version = row.version + 1
      await tx.update(playerDocs).set({ doc: { ...row.doc, player: r.state }, version, updatedAt: new Date(now) }).where(eq(playerDocs.userId, me.id))
      return { settled: { weekKey: key, league: rung.league, sub: rung.sub, place, scope: place === null ? null : scope, dust: r.dust }, version }
    })
    if (out.version !== null) bus.publish(me.id, { type: 'game', version: out.version })
    const body: PodiumResponse = { settled: out.settled }
    return c.json(body)
  })

  return app
}

/** Podium rules of the live config. */
function leaguePodium() {
  return defaultContext().config.leagues.podium
}
