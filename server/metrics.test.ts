/** session_log (written in the claim's transaction) and GET /api/admin/metrics (docs/admin-plan.md §2, §4-5; delivery E12). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ActionResponse, AdminMetricsResponse, GameAction, GameDoc, PublicUser, UserRole } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { sessionLog, users } from './db/schema'
import { loadEnv } from './env'
import { BASE_CONTENT_HASH, logSession } from './session-log'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'correct horse battery'
const T0 = Date.UTC(2026, 10, 4, 10, 0) // a Wednesday
const MIN = 60_000
const DAY = 86_400_000

let database: Database
let now = T0
const clock = () => now
let seq = 0
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  app = createApp({ env: loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, DEV_TOOLS: '0' }), db: database.db, clock })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  now = T0
  await database.db.delete(sessionLog)
})

async function call(method: string, path: string, o: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.9.${Math.floor(++seq / 250)}.${seq % 250}` }
  if (o.cookie) headers.cookie = `pf_session=${o.cookie}`
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  const res = await app.app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(o.body ?? {}) })
  const text = await res.text()
  const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
  return { status: res.status, text, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, cookie: sc ? sc[1]! : null }
}

async function account(role: UserRole = 'player') {
  const email = `m${++seq}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const r = await call('POST', '/api/auth/register', { body: { email, password: PASSWORD, trainerName: `Metric${seq}`, country: 'PE' } })
  expect(r.status).toBe(201)
  const user = (r.json as unknown as { user: PublicUser }).user
  if (role !== 'player') await database.db.update(users).set({ role }).where(eq(users.id, user.id))
  return { id: user.id, email, cookie: r.cookie! }
}

const act = (cookie: string, action: GameAction) => call('POST', '/api/game/action', { cookie, body: action })

type Row = typeof sessionLog.$inferInsert
let sid = 0
async function log(userId: string, endedAt: number, extra: Partial<Row> = {}) {
  await database.db.insert(sessionLog).values({
    userId,
    sessionId: `s${++sid}`,
    startedAt: new Date(endedAt - 25 * MIN),
    endedAt: new Date(endedAt),
    claimedAt: new Date(endedAt),
    minutes: 25,
    focus: 1,
    points: 100,
    wilds: 3,
    catches: 2,
    ...extra,
  })
}

describe('session_log writer', () => {
  it('a claim writes one row in the same transaction, with the content hash set to base', async () => {
    const u = await account()
    expect((await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' })).status).toBe(200)
    expect((await act(u.cookie, { type: 'start', minutes: 25 })).status).toBe(200)
    expect(await database.db.select().from(sessionLog)).toHaveLength(0)
    expect((await act(u.cookie, { type: 'claim' })).json).toEqual({ error: 'not_finished' })
    expect(await database.db.select().from(sessionLog)).toHaveLength(0)

    now = T0 + 26 * MIN
    const claim = await act(u.cookie, { type: 'claim' })
    expect(claim.status).toBe(200)
    const out = (claim.json as unknown as ActionResponse<'claim'>).result.outcome.result
    const rows = await database.db.select().from(sessionLog).where(eq(sessionLog.userId, u.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionId: out.sessionId,
      minutes: 25,
      focus: out.focus,
      lateClaim: out.lateClaim,
      points: Math.round(out.totalPoints),
      contentHash: BASE_CONTENT_HASH,
    })
    expect(rows[0]!.startedAt.getTime()).toBe(out.startedAt)
    expect(rows[0]!.endedAt.getTime()).toBe(out.endedAt)
    expect(rows[0]!.claimedAt.getTime()).toBe(out.claimedAt)
    const wilds = out.waves.flatMap((w) => w.wilds)
    expect(rows[0]!.wilds).toBe(wilds.length)
    expect(rows[0]!.shinies).toBe(wilds.filter((w) => w.isShiny).length)
    expect(rows[0]!.legendaries).toBe(wilds.filter((w) => w.isLegendary).length)
  })

  it('a cancelled long session that keeps its minutes is logged; one that keeps nothing is not', async () => {
    const u = await account()
    await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' })
    // 50 min planned, cancelled at 30: keeps 30 min and one wave block.
    expect((await act(u.cookie, { type: 'start', minutes: 50 })).status).toBe(200)
    now = T0 + 30 * MIN
    const cancel = await act(u.cookie, { type: 'cancel' })
    expect(cancel.status).toBe(200)
    const out = (cancel.json as unknown as ActionResponse<'cancel'>).result.outcome
    expect(out).not.toBeNull()
    const rows = await database.db.select().from(sessionLog).where(eq(sessionLog.userId, u.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: out!.result.sessionId, minutes: out!.result.minutes })

    // A short session cancelled keeps nothing: no new row (the stale outcome is not logged again).
    expect((await act(u.cookie, { type: 'start', minutes: 25 })).status).toBe(200)
    now += 10 * MIN
    expect((await act(u.cookie, { type: 'cancel' })).status).toBe(200)
    expect(await database.db.select().from(sessionLog).where(eq(sessionLog.userId, u.id))).toHaveLength(1)
  })

  it('catches follow later throws of the same session; unrelated actions change nothing', async () => {
    const u = await account()
    await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' })
    await act(u.cookie, { type: 'start', minutes: 25 })
    now = T0 + 26 * MIN
    const claim = (await act(u.cookie, { type: 'claim' })).json as unknown as ActionResponse<'claim'>
    const id = claim.result.outcome.result.sessionId
    const doc = claim.doc
    const history = doc.player!.history.map((e) => (e.id === id ? { ...e, caught: e.caught + 2 } : e))
    const after: GameDoc = { ...doc, player: { ...doc.player!, history } }
    await database.db.transaction((tx) => logSession(tx, u.id, 'throwBall', doc, after))
    const [row] = await database.db.select().from(sessionLog).where(eq(sessionLog.userId, u.id))
    expect(row!.catches).toBe(doc.player!.history.find((e) => e.id === id)!.caught + 2)
    // No history change: no write, no error.
    await database.db.transaction((tx) => logSession(tx, u.id, 'setAutoDamage', after, after))
    const [again] = await database.db.select().from(sessionLog).where(eq(sessionLog.userId, u.id))
    expect(again!.catches).toBe(row!.catches)
  })

  it('claiming the same session twice never duplicates the row', async () => {
    const u = await account()
    await log(u.id, T0)
    const [row] = await database.db.select().from(sessionLog)
    await expect(database.db.insert(sessionLog).values({ ...row!, id: undefined }).onConflictDoNothing()).resolves.toBeDefined()
    expect(await database.db.select().from(sessionLog)).toHaveLength(1)
  })
})

describe('GET /api/admin/metrics', () => {
  it('requires a signed-in support or admin account', async () => {
    const player = await account('player')
    const support = await account('support')
    const admin = await account('admin')
    expect((await call('GET', '/api/admin/metrics')).status).toBe(401)
    expect((await call('GET', '/api/admin/metrics', { cookie: player.cookie })).status).toBe(403)
    expect((await call('GET', '/api/admin/metrics', { cookie: support.cookie })).status).toBe(200)
    expect((await call('GET', '/api/admin/metrics', { cookie: admin.cookie })).status).toBe(200)
  })

  it('aggregates per day: players, sessions, minutes, Focus bands, catches and rares', async () => {
    const staff = await account('support')
    const a = await account()
    const b = await account()
    const day = Math.floor(T0 / DAY) * DAY
    await log(a.id, day + 9 * 3_600_000)
    await log(a.id, day + 11 * 3_600_000, { focus: 0.5, lateClaim: true, shinies: 1, minutes: 50, catches: 0 })
    await log(b.id, day + 12 * 3_600_000, { focus: 0.9, legendaries: 1 })
    await log(b.id, day - DAY + 12 * 3_600_000)
    const r = await call('GET', `/api/admin/metrics?from=${day - DAY}&to=${day + DAY}`, { cookie: staff.cookie })
    expect(r.status).toBe(200)
    const m = r.json as unknown as AdminMetricsResponse
    expect(m.granularity).toBe('day')
    expect(m.buckets.map((x) => x.start)).toEqual([new Date(day - DAY).toISOString().slice(0, 10), new Date(day).toISOString().slice(0, 10)])
    expect(m.buckets[0]).toMatchObject({ activePlayers: 1, sessions: 1, minutes: 25, prevActive: 0, returned: 0 })
    expect(m.buckets[1]).toMatchObject({
      activePlayers: 2,
      sessions: 3,
      minutes: 100,
      points: 300,
      wilds: 9,
      catches: 4,
      shinies: 1,
      legendaries: 1,
      focusLow: 1,
      focusMid: 1,
      focusFull: 1,
      prevActive: 1,
      returned: 1,
    })
    expect(m.totals).toMatchObject({ activePlayers: 2, sessions: 4, minutes: 125, focusFull: 2 })
  })

  it('weekly buckets start on Monday and count a player once per week; retention is week over week', async () => {
    const staff = await account('admin')
    const a = await account()
    const b = await account()
    const monday = Math.floor(T0 / DAY) * DAY - 2 * DAY // T0 is a Wednesday
    expect(new Date(monday).getUTCDay()).toBe(1)
    await log(a.id, monday - 7 * DAY + 3_600_000) // previous week
    await log(b.id, monday - 7 * DAY + 3_600_000)
    await log(a.id, monday + 3_600_000)
    await log(a.id, monday + 2 * DAY)
    const r = await call('GET', `/api/admin/metrics?granularity=week&from=${monday}&to=${monday + 3 * DAY}`, { cookie: staff.cookie })
    const m = r.json as unknown as AdminMetricsResponse
    expect(m.buckets).toHaveLength(1)
    expect(m.buckets[0]).toMatchObject({ start: new Date(monday).toISOString().slice(0, 10), activePlayers: 1, sessions: 2, prevActive: 2, returned: 1 })
  })

  it('fills empty buckets with zeros and returns aggregates only (no player data)', async () => {
    const staff = await account('support')
    const a = await account()
    await log(a.id, T0)
    const r = await call('GET', '/api/admin/metrics', { cookie: staff.cookie })
    const m = r.json as unknown as AdminMetricsResponse
    expect(m.buckets).toHaveLength(28 + 1 - (T0 % DAY === 0 ? 1 : 0))
    expect(m.buckets.filter((x) => x.sessions === 0).length).toBe(m.buckets.length - 1)
    expect(r.text).not.toContain(a.id)
    expect(r.text).not.toContain(a.email)
    expect(r.text).not.toMatch(/trainer|user_?id|email/i)
  })

  it('rejects a bad query', async () => {
    const staff = await account('support')
    for (const q of ['granularity=month', 'from=abc', 'from=10&to=5', `from=0&to=${T0}`]) {
      const r = await call('GET', `/api/admin/metrics?${q}`, { cookie: staff.cookie })
      expect(r.status, q).toBe(400)
    }
  })
})
