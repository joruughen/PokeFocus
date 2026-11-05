/** /api/game — the player's document and the action endpoint. */
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createRng } from '../../src/engine'
import { applyAction, isDevAction } from '../../src/game/actions'
import { DEV_NOW_HEADER, DEV_SEED_HEADER, EMPTY_DOC, type ActionResponse, type GameDoc, type GameSnapshot } from '../../src/game/protocol'
import type { Tx } from '../db/client'
import { activeStudySessions, leagueScores, playerDocs } from '../db/schema'
import { ApiError, readBody, requireAuth, type AppEnv, type Ctx, type Deps } from '../http'
import { asGameAction, gameActionBody } from '../validation'

export function gameRoutes(deps: Deps) {
  const { db, env, bus } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))

  /** Game time: server clock, or x-dev-now only with DEV_TOOLS=1. */
  const gameNow = (c: Ctx): number => {
    if (env.devTools) {
      const v = Number(c.req.header(DEV_NOW_HEADER))
      if (Number.isFinite(v) && v > 0) return Math.floor(v)
    }
    return deps.clock()
  }

  app.get('/', async (c) => {
    const user = c.get('user')
    let [row] = await db.select({ doc: playerDocs.doc, version: playerDocs.version }).from(playerDocs).where(eq(playerDocs.userId, user.id))
    if (!row) {
      await db.insert(playerDocs).values({ userId: user.id, doc: EMPTY_DOC, version: 0 }).onConflictDoNothing()
      row = { doc: EMPTY_DOC, version: 0 }
    }
    const snap: GameSnapshot = { doc: row.doc, version: row.version, serverNow: gameNow(c) }
    return c.json(snap)
  })

  app.post('/action', async (c) => {
    const user = c.get('user')
    const action = asGameAction(await readBody(c, gameActionBody))
    if (isDevAction(action.type) && !env.devTools) throw new ApiError(403, 'dev_disabled')
    const now = gameNow(c)
    const seed = env.devTools ? c.req.header(DEV_SEED_HEADER) : undefined
    const rng = createRng(seed && seed.length <= 128 ? seed : randomBytes(16).toString('hex'))

    const out = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, user.id)).for('update')
      const before = row?.doc ?? EMPTY_DOC
      const r = applyAction(before, action, { now, rng, dev: env.devTools, trainerName: user.trainerName })
      if (!r.ok) return r
      await syncActiveSession(tx, user.id, before, r.doc)
      if (action.type === 'resetAll') await tx.delete(leagueScores).where(eq(leagueScores.userId, user.id))
      else await syncLeagueScores(tx, user.id, before, r.doc, deps.clock())
      const version = (row?.version ?? 0) + 1
      const updatedAt = new Date(deps.clock())
      if (row) await tx.update(playerDocs).set({ doc: r.doc, version, updatedAt }).where(eq(playerDocs.userId, user.id))
      else await tx.insert(playerDocs).values({ userId: user.id, doc: r.doc, version, updatedAt })
      return { ok: true as const, doc: r.doc, result: r.result, version }
    })
    if (!out.ok) throw new ApiError(out.error === 'dev_disabled' ? 403 : 409, out.error)
    bus.publish(user.id, { type: 'game', version: out.version })
    const body: ActionResponse = { doc: out.doc, version: out.version, serverNow: now, result: out.result }
    return c.json(body)
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
