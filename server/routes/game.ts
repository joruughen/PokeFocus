/** /api/game — the player's document and the action endpoint. */
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { createRng, type Rng, type WeatherInput } from '../../src/engine'
import { applyAction, isDevAction } from '../../src/game/actions'
import { DEV_SEED_HEADER, EMPTY_DOC, type ActionResponse, type ActionResults, type GameAction, type GameDoc, type GameSnapshot } from '../../src/game/protocol'
import type { Db, Tx } from '../db/client'
import { contentForAction } from '../content/service'
import { activeStudySessions, leagueScores, playerDocs } from '../db/schema'
import { claimOverlap, publishGroupEvents, syncGroupMembership, type PendingGroupEvent } from '../groups'
import { ApiError, gameTime, readBody, requireAuth, type AppEnv, type Ctx, type Deps } from '../http'
import { RULES } from '../rate-limit'
import { logSession } from '../session-log'
import { asGameAction, gameActionBody } from '../validation'

/** Fresh RNG for an action: x-dev-seed only with DEV_TOOLS=1. */
export function actionRng(deps: Deps, c: Ctx): Rng {
  const seed = deps.env.devTools ? c.req.header(DEV_SEED_HEADER) : undefined
  return createRng(seed && seed.length <= 128 ? seed : randomBytes(16).toString('hex'))
}

export type RunOutcome =
  | { ok: true; doc: GameDoc; result: ActionResults[keyof ActionResults]; version: number; groupEvents: PendingGroupEvent[] }
  | { ok: false; error: string }

/**
 * One game action inside a transaction: lock the doc -> (claim: group overlap
 * from the stored intervals) -> live content for the action (pinned per
 * session, see server/content/service.ts) -> reducer -> active session / group membership /
 * league mirrors -> version + 1. Also used by the study-group routes to start
 * members' sessions (`viaGroup`). Events are NOT published here (after commit).
 */
export async function runGameAction(
  tx: Tx,
  deps: Deps,
  user: { id: string; trainerName: string },
  action: GameAction,
  opts: { now: number; rng: Rng; viaGroup?: boolean; /** Weather already fetched outside the transaction (undefined = fetch it here). */ weather?: WeatherInput | null },
): Promise<RunOutcome> {
  const [row] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, user.id)).for('update')
  const before = row?.doc ?? EMPTY_DOC
  // A cancelled long session that keeps its minutes (GDD §3.4) gets the overlap accompanied so far.
  const friendOverlap =
    action.type === 'claim' ? await claimOverlap(tx, user.id, before) : action.type === 'cancel' ? await claimOverlap(tx, user.id, before, opts.now) : null
  // Real weather of the profile location (else city), fixed on the session at start (≤ 2 s, cached; null = no weather).
  // Also for sessions the server starts for study-group invitees, which is why the rounded location lives in the profile.
  const profile = before.player?.profile
  const weather =
    action.type !== 'start'
      ? undefined
      : opts.weather !== undefined
        ? opts.weather
        : ((await deps.weather.current({ location: profile?.location ?? null, city: profile?.city ?? null }))?.weather ?? null)
  // Live content: start → current (pinned on the session); claim/cancel → the session's; waves → the encounter's.
  const content = await contentForAction(deps.content, tx, before, action.type, opts.now)
  const r = applyAction(before, action, { now: opts.now, rng: opts.rng, dev: deps.env.devTools, trainerName: user.trainerName, friendOverlap, weather, ctx: content.ctx, contentHash: content.hash })
  if (!r.ok) return r
  if (action.type === 'start' && r.doc.player?.activeSession?.contentHash) await deps.content.persist(tx, content)
  await syncActiveSession(tx, user.id, before, r.doc)
  await logSession(tx, user.id, action.type, before, r.doc, { contentHash: content.hash })
  const groupEvents = await syncGroupMembership(tx, user.id, before, r.doc, action.type, opts.now, opts.viaGroup ?? false)
  if (action.type === 'resetAll') await tx.delete(leagueScores).where(eq(leagueScores.userId, user.id))
  else await syncLeagueScores(tx, user.id, before, r.doc, deps.clock())
  const version = (row?.version ?? 0) + 1
  const updatedAt = new Date(deps.clock())
  if (row) await tx.update(playerDocs).set({ doc: r.doc, version, updatedAt }).where(eq(playerDocs.userId, user.id))
  else await tx.insert(playerDocs).values({ userId: user.id, doc: r.doc, version, updatedAt })
  return { ok: true, doc: r.doc, result: r.result, version, groupEvents }
}

const MAX_ACTIONS_IN_FLIGHT = 3
const actionsInFlight = new Map<string, number>()

/** Real weather of the profile location, read from the player's doc without locking it. */
async function startWeather(db: Db, deps: Deps, userId: string): Promise<WeatherInput | null> {
  const [row] = await db
    .select({ profile: sql<{ location?: unknown; city?: unknown } | null>`${playerDocs.doc} -> 'player' -> 'profile'` })
    .from(playerDocs)
    .where(eq(playerDocs.userId, userId))
  const p = row?.profile
  const w = await deps.weather.current({ location: (p?.location as never) ?? null, city: (p?.city as never) ?? null })
  return w?.weather ?? null
}

export function gameRoutes(deps: Deps) {
  const { db, env, bus } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))

  app.get('/', async (c) => {
    const user = c.get('user')
    let [row] = await db.select({ doc: playerDocs.doc, version: playerDocs.version }).from(playerDocs).where(eq(playerDocs.userId, user.id))
    if (!row) {
      await db.insert(playerDocs).values({ userId: user.id, doc: EMPTY_DOC, version: 0 }).onConflictDoNothing()
      row = { doc: EMPTY_DOC, version: 0 }
    }
    const snap: GameSnapshot = { doc: row.doc, version: row.version, serverNow: gameTime(deps, c) }
    return c.json(snap)
  })

  app.post('/action', async (c) => {
    const user = c.get('user')
    const action = asGameAction(await readBody(c, gameActionBody))
    if (isDevAction(action.type) && !env.devTools) throw new ApiError(403, 'dev_disabled')
    // Per-player limits: a request rate and at most 3 in flight (a stuck or parallel burst from one account must not
    // fill the 10-connection pool: each action holds a connection and a row lock).
    const rl = deps.limiter.hit(`game:${user.id}`, RULES.gameActionUser)
    if (!rl.ok) {
      c.header('Retry-After', String(rl.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: rl.retryAfter })
    }
    if ((actionsInFlight.get(user.id) ?? 0) >= MAX_ACTIONS_IN_FLIGHT) throw new ApiError(429, 'too_many_requests')
    actionsInFlight.set(user.id, (actionsInFlight.get(user.id) ?? 0) + 1)
    try {
      const now = gameTime(deps, c)
      const rng = actionRng(deps, c)
      // The real weather (≤ 2 s, cached) is fetched BEFORE the transaction: waiting for Open-Meteo inside it kept a
      // pool connection and the player's row locked.
      const weather = action.type === 'start' ? await startWeather(db, deps, user.id) : undefined
      const out = await db.transaction((tx) => runGameAction(tx, deps, user, action, { now, rng, weather }))
      if (!out.ok) throw new ApiError(out.error === 'dev_disabled' ? 403 : 409, out.error)
      bus.publish(user.id, { type: 'game', version: out.version })
      await publishGroupEvents(deps, user, out.groupEvents)
      const body: ActionResponse = { doc: out.doc, version: out.version, serverNow: now, result: out.result }
      return c.json(body)
    } finally {
      const n = (actionsInFlight.get(user.id) ?? 1) - 1
      if (n <= 0) actionsInFlight.delete(user.id)
      else actionsInFlight.set(user.id, n)
    }
  })

  return app
}

/**
 * Mirror `player.activeSession` into active_study_sessions (PK = user_id, so
 * one study session per user at the database level). A conflicting row means
 * another session is registered → 409 session_active_elsewhere (rolls back).
 */
async function syncActiveSession(tx: Tx, userId: string, before: GameDoc, after: GameDoc): Promise<void> {
  const prev = before.player?.activeSession ?? null
  const next = after.player?.activeSession ?? null
  if (next && next.id !== prev?.id) {
    if (prev) await tx.delete(activeStudySessions).where(eq(activeStudySessions.userId, userId))
    const ins = await tx
      .insert(activeStudySessions)
      .values({ userId, sessionId: next.id, startedAt: new Date(next.startedAt) })
      .onConflictDoNothing()
      .returning({ userId: activeStudySessions.userId })
    if (ins.length === 0) throw new ApiError(409, 'session_active_elsewhere')
  } else if (!next && prev) {
    await tx.delete(activeStudySessions).where(eq(activeStudySessions.userId, userId))
  }
}

/**
 * Upsert league_scores for every week/month key whose points changed
 * (normally the current `weekKey`/`monthKey` of the player at claim time).
 */
async function syncLeagueScores(tx: Tx, userId: string, before: GameDoc, after: GameDoc, now: number): Promise<void> {
  const a = after.player?.league
  if (!a) return
  const b = before.player?.league
  const changes: { period: 'week' | 'month'; key: string; points: number }[] = []
  for (const [k, v] of Object.entries(a.weeklyPoints)) if (b?.weeklyPoints[k] !== v) changes.push({ period: 'week', key: k, points: v })
  for (const [k, v] of Object.entries(a.monthlyPoints)) if (b?.monthlyPoints[k] !== v) changes.push({ period: 'month', key: k, points: v })
  for (const ch of changes) {
    await tx
      .insert(leagueScores)
      .values({ userId, period: ch.period, periodKey: ch.key, points: ch.points, updatedAt: new Date(now) })
      .onConflictDoUpdate({
        target: [leagueScores.userId, leagueScores.period, leagueScores.periodKey],
        set: { points: ch.points, updatedAt: new Date(now) },
      })
  }
}

