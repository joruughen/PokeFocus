import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { defaultContext, monthKeyOf, podiumDust, rankInterval, rankOf, weekKeyOf } from '../src/engine'
import type { ActionResponse, FriendSummary, GameAction, GameSnapshot, LeaderboardResponse, PodiumResponse, PublicUser } from '../src/game/protocol'
import { createApp } from './app'
import { hashToken } from './auth/tokens'
import { openDatabase, type Database } from './db/client'
import { activeStudySessions, authSessions, leagueScores, playerDocs } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'
import { deleteExpiredSessions } from './routes/auth'

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 3, 10, 0)
const MIN = 60_000

let database: Database
let now = T0
const clock = () => now
let prod: ReturnType<typeof createApp>
let dev: ReturnType<typeof createApp>
let ipSeq = 0

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  const base = { NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: `${ORIGIN}, https://pokefocus.example` }
  prod = createApp({ env: loadEnv({ ...base, DEV_TOOLS: '0' }), db: database.db, clock })
  dev = createApp({ env: loadEnv({ ...base, DEV_TOOLS: '1' }), db: database.db, clock })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

interface Req {
  body?: unknown
  cookie?: string | null
  ip?: string
  origin?: string | null
  headers?: Record<string, string>
  app?: ReturnType<typeof createApp>
}

async function call(method: string, path: string, opts: Req = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? `10.0.0.${++ipSeq % 250}`, ...opts.headers }
  if (method !== 'GET') {
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
    headers['content-type'] ??= 'application/json'
  }
  if (opts.cookie) headers.cookie = `pf_session=${opts.cookie}`
  const res = await (opts.app ?? prod).app.request(path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : null
  return { res, status: res.status, json, cookie: cookieOf(res) }
}

function cookieOf(res: Response): string | null {
  const sc = res.headers.get('set-cookie')
  const m = sc?.match(/pf_session=([^;]*)/)
  return m ? m[1]! : null
}

let userSeq = 0
async function register(patch: Partial<{ email: string; password: string; trainerName: string; country: string }> = {}) {
  const n = ++userSeq
  const body = { email: `user${n}@test.dev`, password: 'correct horse', trainerName: `Trainer ${n}`, country: 'PE', ...patch }
  const r = await call('POST', '/api/auth/register', { body })
  expect(r.status).toBe(201)
  return { user: (r.json as { user: PublicUser }).user, cookie: r.cookie!, password: body.password, email: body.email }
}

async function act(cookie: string, action: GameAction, opts: Req = {}) {
  return call('POST', '/api/game/action', { ...opts, cookie, body: action })
}

describe('auth', () => {
  it('register → me → logout', async () => {
    const r = await call('POST', '/api/auth/register', {
      body: { email: '  Misty@Test.dev ', password: 'starmie!!', trainerName: 'Misty', country: 'pe' },
    })
    expect(r.status).toBe(201)
    const user = (r.json as { user: PublicUser }).user
    expect(user).toMatchObject({ email: 'misty@test.dev', trainerName: 'Misty', country: 'PE', nameChangedAt: null, countryChangedAt: null, anonymousRankings: false })
    expect(user.friendCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
    expect(r.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const me = await call('GET', '/api/auth/me', { cookie: r.cookie })
    expect(me.status).toBe(200)
    expect((me.json as { user: PublicUser }).user.id).toBe(user.id)

    // only the hash is stored
    const rows = await database.db.select().from(authSessions).where(eq(authSessions.userId, user.id))
    expect(rows[0]?.tokenHash).toBe(hashToken(r.cookie!))

    // empty doc created with the user
    const g = await call('GET', '/api/game', { cookie: r.cookie })
    expect((g.json as unknown as GameSnapshot).doc.player).toBeNull()

    const out = await call('POST', '/api/auth/logout', { cookie: r.cookie })
    expect(out.status).toBe(204)
    expect(out.res.headers.get('set-cookie')).toMatch(/pf_session=;.*Max-Age=0/)
    expect((await call('GET', '/api/auth/me', { cookie: r.cookie })).status).toBe(401)
  })

  it('cookie flags: HttpOnly, SameSite=Lax, Path=/, 30 days; Secure only in production', async () => {
    const r = await call('POST', '/api/auth/register', {
      body: { email: 'flags@test.dev', password: 'password1', trainerName: 'Flags', country: 'US' },
    })
    const sc = r.res.headers.get('set-cookie')!
    expect(sc).toContain('HttpOnly')
    expect(sc).toContain('SameSite=Lax')
    expect(sc).toContain('Path=/')
    expect(sc).toContain(`Max-Age=${30 * 24 * 3600}`)
    expect(sc).not.toContain('Secure')

    const production = createApp({ env: loadEnv({ NODE_ENV: 'production', PASSWORD_PEPPER: 'test-pepper-0123456789abcdefghijklmnop', APP_ORIGIN: ORIGIN, TRUST_PROXY: '1' }), db: database.db, clock })
    const p = await call('POST', '/api/auth/login', { app: production, body: { email: 'flags@test.dev', password: 'password1' } })
    expect(p.status).toBe(200)
    expect(p.res.headers.get('set-cookie')).toContain('Secure')
    expect(production.deps.env.devTools).toBe(false)
  })

  it('validates bodies', async () => {
    const bad = await call('POST', '/api/auth/register', { body: { email: 'nope', password: 'short', trainerName: 'x!', country: 'Peru' } })
    expect(bad.status).toBe(400)
    expect(bad.json).toMatchObject({ error: 'invalid_body' })
    expect((bad.json as { fields: string[] }).fields.sort()).toEqual(['country', 'email', 'password', 'trainerName'])
    const dup = await call('POST', '/api/auth/register', { body: { email: 'misty@test.dev', password: 'whatever1', trainerName: 'Dup', country: 'PE' } })
    expect(dup.status).toBe(409)
    expect(dup.json).toEqual({ error: 'email_taken' })
  })

  it('wrong password and unknown email give the identical error', async () => {
    const u = await register()
    const login = await call('POST', '/api/auth/login', { body: { email: u.email.toUpperCase(), password: u.password } })
    expect(login.status).toBe(200)
    expect(login.cookie).not.toBe(u.cookie) // new token on each login

    const wrong = await call('POST', '/api/auth/login', { body: { email: u.email, password: 'wrong password' } })
    const unknown = await call('POST', '/api/auth/login', { body: { email: 'ghost@test.dev', password: 'wrong password' } })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.json).toEqual({ error: 'invalid_credentials' })
    expect(unknown.json).toEqual(wrong.json)
  })

  it('rate limits login per email and per IP, and register per IP (429 + Retry-After)', async () => {
    const u = await register()
    // Audit M5: only FAILED logins count, per (IP, account). A stranger's failures block his own IP, not the owner.
    const attacker = '192.168.6.6'
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/api/auth/login', { ip: attacker, body: { email: u.email, password: 'nope nope' } })).status).toBe(401)
    }
    const blocked = await call('POST', '/api/auth/login', { ip: attacker, body: { email: u.email, password: u.password } })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.res.headers.get('retry-after'))).toBeGreaterThan(0)
    const owner = await call('POST', '/api/auth/login', { ip: '192.168.6.7', body: { email: u.email, password: u.password } })
    expect(owner.status).toBe(200)

    const ip = '192.168.7.7'
    for (let i = 0; i < 20; i++) {
      expect((await call('POST', '/api/auth/login', { ip, body: { email: `x${i}@test.dev`, password: 'nope nope' } })).status).toBe(401)
    }
    expect((await call('POST', '/api/auth/login', { ip, body: { email: 'y@test.dev', password: 'nope nope' } })).status).toBe(429)

    const rip = '192.168.8.8'
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/api/auth/register', { ip: rip, body: { email: `rl${i}@test.dev`, password: 'password1', trainerName: `Rl ${i}`, country: 'PE' } })
      expect(r.status).toBe(201)
    }
    const r6 = await call('POST', '/api/auth/register', { ip: rip, body: { email: 'rl6@test.dev', password: 'password1', trainerName: 'Rl 6', country: 'PE' } })
    expect(r6.status).toBe(429)
    expect(r6.res.headers.get('retry-after')).toBeTruthy()
  }, 30_000)

  it('rejects a bad or missing Origin (403) and non-JSON bodies (415)', async () => {
    const u = await register()
    const evil = await call('POST', '/api/game/action', { cookie: u.cookie, origin: 'https://evil.example', body: { type: 'pause' } })
    expect(evil.status).toBe(403)
    expect(evil.json).toEqual({ error: 'bad_origin' })
    const none = await call('POST', '/api/auth/logout', { cookie: u.cookie, origin: null })
    expect(none.status).toBe(403)
    // second allowed origin from the comma-separated list
    const alt = await call('GET', '/api/auth/me', { cookie: u.cookie, origin: 'https://pokefocus.example' })
    expect(alt.status).toBe(200)
    const form = await call('POST', '/api/auth/login', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x' })
    expect(form.status).toBe(415)
    expect((await call('GET', '/api/auth/me')).status).toBe(401)
  })

  it('rejects bodies over 64 KB', async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'x'.repeat(70_000) } })
    expect(r.status).toBe(413)
  })

  it('change password revokes the other sessions; sessions list and revoke one', async () => {
    const u = await register()
    const second = await call('POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
    const third = await call('POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
    const list = await call('GET', '/api/auth/sessions', { cookie: u.cookie })
    const sessions = (list.json as { sessions: { id: string; current: boolean }[] }).sessions
    expect(sessions).toHaveLength(3)
    expect(sessions.filter((s) => s.current)).toHaveLength(1)

    // revoke one (the third login)
    const [thirdRow] = await database.db.select().from(authSessions).where(eq(authSessions.tokenHash, hashToken(third.cookie!)))
    expect((await call('DELETE', `/api/auth/sessions/${thirdRow!.id}`, { cookie: u.cookie })).status).toBe(204)
    expect((await call('GET', '/api/auth/me', { cookie: third.cookie })).status).toBe(401)
    expect((await call('DELETE', `/api/auth/sessions/${thirdRow!.id}`, { cookie: u.cookie })).status).toBe(404)

    const wrong = await call('POST', '/api/auth/password', { cookie: u.cookie, body: { current: 'not it at all', next: 'brand new pw' } })
    expect(wrong.status).toBe(403)
    expect(wrong.json).toEqual({ error: 'wrong_password' })
    const ok = await call('POST', '/api/auth/password', { cookie: u.cookie, body: { current: u.password, next: 'brand new pw' } })
    expect(ok.status).toBe(204)
    expect((await call('GET', '/api/auth/me', { cookie: u.cookie })).status).toBe(200)
    expect((await call('GET', '/api/auth/me', { cookie: second.cookie })).status).toBe(401)
    expect((await call('POST', '/api/auth/login', { body: { email: u.email, password: u.password } })).status).toBe(401)
    expect((await call('POST', '/api/auth/login', { body: { email: u.email, password: 'brand new pw' } })).status).toBe(200)
  }, 30_000)

  it('logout-all ends every session', async () => {
    const u = await register()
    const other = await call('POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
    expect((await call('POST', '/api/auth/logout-all', { cookie: u.cookie })).status).toBe(204)
    expect((await call('GET', '/api/auth/me', { cookie: u.cookie })).status).toBe(401)
    expect((await call('GET', '/api/auth/me', { cookie: other.cookie })).status).toBe(401)
  })

  it('PATCH me updates name/country (and the name inside the game doc)', async () => {
    const u = await register()
    await act(u.cookie, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'squirtle' })
    const r = await call('PATCH', '/api/auth/me', { cookie: u.cookie, body: { trainerName: 'Gary Oak', country: 'cl' } })
    expect(r.status).toBe(200)
    expect((r.json as { user: PublicUser }).user).toMatchObject({ trainerName: 'Gary Oak', country: 'CL', nameChangedAt: now, countryChangedAt: now, anonymousRankings: false })
    const g = (await call('GET', '/api/game', { cookie: u.cookie })).json as unknown as GameSnapshot
    expect(g.doc.player?.profile.trainerName).toBe('Gary Oak')
    expect((await call('PATCH', '/api/auth/me', { cookie: u.cookie, body: { trainerName: '<script>' } })).status).toBe(400)
  })

  it('sliding expiry renews after 24 h; expired sessions are rejected and cleaned up', async () => {
    const u = await register()
    now = T0 + 2 * 24 * 3_600_000
    const me = await call('GET', '/api/auth/me', { cookie: u.cookie })
    expect(me.status).toBe(200)
    expect(me.cookie).toBe(u.cookie) // cookie re-sent with a fresh Max-Age
    const [row] = await database.db.select().from(authSessions).where(eq(authSessions.tokenHash, hashToken(u.cookie)))
    expect(row!.expiresAt.getTime()).toBe(now + 30 * 24 * 3_600_000)
    now += 31 * 24 * 3_600_000
    expect((await call('GET', '/api/auth/me', { cookie: u.cookie })).status).toBe(401)
    expect(await deleteExpiredSessions(database.db, now)).toBeGreaterThan(0)
    now = T0
  })
})

describe('game', () => {
  it('action roundtrip: createPlayer → start → claim, single study session, versions', async () => {
    const u = await register({ trainerName: 'Red' })
    const cp = await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' })
    expect(cp.status).toBe(200)
    const snap = cp.json as unknown as ActionResponse<'createPlayer'>
    expect(snap.version).toBe(1)
    expect(snap.result).toBeNull()
    expect(snap.doc.player?.profile.trainerName).toBe('Red')

    const st = await act(u.cookie, { type: 'start', minutes: 25 })
    expect(st.status).toBe(200)
    expect((st.json as unknown as GameSnapshot).version).toBe(2)
    const rows = await database.db.select().from(activeStudySessions).where(eq(activeStudySessions.userId, u.user.id))
    expect(rows).toHaveLength(1)

    const again = await act(u.cookie, { type: 'start', minutes: 25 })
    expect(again.status).toBe(409)
    expect(again.json).toEqual({ error: 'session_active' })

    const early = await act(u.cookie, { type: 'claim' })
    expect(early.json).toEqual({ error: 'not_finished' })

    now = T0 + 26 * MIN
    const claim = await act(u.cookie, { type: 'claim' })
    expect(claim.status).toBe(200)
    const c = claim.json as unknown as ActionResponse<'claim'>
    expect(c.result.outcome.result.minutes).toBe(25)
    expect(c.version).toBe(3)
    expect(c.serverNow).toBe(now)
    expect(await database.db.select().from(activeStudySessions).where(eq(activeStudySessions.userId, u.user.id))).toHaveLength(0)

    const scores = await database.db.select().from(leagueScores).where(eq(leagueScores.userId, u.user.id))
    const pts = c.doc.player!.league.weeklyPoints[weekKeyOf(now, 0)] ?? 0
    expect(pts).toBeGreaterThan(0)
    expect(scores.find((s) => s.period === 'week')).toMatchObject({ periodKey: weekKeyOf(now, 0), points: pts })
    expect(scores.find((s) => s.period === 'month')).toMatchObject({ periodKey: monthKeyOf(now, 0) })

    const g = (await call('GET', '/api/game', { cookie: u.cookie })).json as unknown as GameSnapshot
    expect(g.version).toBe(3)
    now = T0
  })

  it('a stale active study session row blocks start with 409 session_active_elsewhere', async () => {
    const u = await register()
    await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' })
    await database.db.insert(activeStudySessions).values({ userId: u.user.id, sessionId: 'elsewhere', startedAt: new Date(T0) })
    const st = await act(u.cookie, { type: 'start', minutes: 25 })
    expect(st.status).toBe(409)
    expect(st.json).toEqual({ error: 'session_active_elsewhere' })
    // rolled back: the doc has no active session
    const g = (await call('GET', '/api/game', { cookie: u.cookie })).json as unknown as GameSnapshot
    expect(g.doc.player?.activeSession).toBeNull()
    expect(g.version).toBe(1)
  })

  it('validates action bodies', async () => {
    const u = await register()
    expect((await act(u.cookie, { type: 'start', minutes: 5 })).status).toBe(400)
    expect((await act(u.cookie, { type: 'start', minutes: 999 })).status).toBe(400)
    expect((await act(u.cookie, { type: 'nope' } as unknown as GameAction)).status).toBe(400)
    expect((await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 'Mars/Olympus', starterSlug: 'bulbasaur' })).status).toBe(400)
    const noPlayer = await act(u.cookie, { type: 'start', minutes: 25 })
    expect(noPlayer.status).toBe(409)
    expect(noPlayer.json).toEqual({ error: 'no_player' })
  })

  it('dev headers and dev actions are ignored/rejected when DEV_TOOLS=0', async () => {
    const u = await register()
    await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' })
    await act(u.cookie, { type: 'start', minutes: 25 })
    const future = String(T0 + 3 * 3_600_000)
    const claim = await act(u.cookie, { type: 'claim' }, { headers: { 'x-dev-now': future } })
    expect(claim.json).toEqual({ error: 'not_finished' })
    const dust = await act(u.cookie, { type: 'devAddDust', amount: 100 })
    expect(dust.status).toBe(403)
    expect(dust.json).toEqual({ error: 'dev_disabled' })

    // same user through the DEV_TOOLS=1 app: the header is honored
    const devClaim = await act(u.cookie, { type: 'claim', devFocusLabel: 'studying' }, { app: dev, headers: { 'x-dev-now': future, 'x-dev-seed': 'abc' } })
    expect(devClaim.status).toBe(200)
    expect((devClaim.json as unknown as GameSnapshot).serverNow).toBe(Number(future))
    const devDust = await act(u.cookie, { type: 'devAddDust', amount: 100 }, { app: dev })
    expect((devDust.json as unknown as GameSnapshot).doc.player?.dust).toBeGreaterThanOrEqual(100)
  })

  it('devAddTrainerExp: 403 without DEV_TOOLS, applies with it, refuses 0 and out-of-range amounts', async () => {
    const u = await register()
    await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' })
    const off = await act(u.cookie, { type: 'devAddTrainerExp', amount: 500 })
    expect(off.status).toBe(403)
    expect(off.json).toEqual({ error: 'dev_disabled' })
    const on = await act(u.cookie, { type: 'devAddTrainerExp', amount: 500 }, { app: dev })
    expect(on.status).toBe(200)
    const trainer = (on.json as unknown as GameSnapshot).doc.player?.trainer
    expect(trainer?.exp).toBe(500)
    expect(trainer?.level).toBeGreaterThan(1)
    expect((await act(u.cookie, { type: 'devAddTrainerExp', amount: 0 }, { app: dev })).status).toBe(400)
    expect((await act(u.cookie, { type: 'devAddTrainerExp', amount: 2_000_000 }, { app: dev })).status).toBe(400)
    const down = await act(u.cookie, { type: 'devAddTrainerExp', amount: -9999 }, { app: dev })
    expect((down.json as unknown as GameSnapshot).doc.player?.trainer).toEqual({ level: 1, exp: 0 })
  })

  it('GET /api/config announces the developer tools (public, no-store; never on in production)', async () => {
    const off = await call('GET', '/api/config')
    expect(off.status).toBe(200)
    expect(off.json).toEqual({ devTools: false })
    expect(off.res.headers.get('cache-control')).toBe('no-store')
    // No session needed: it answers on the sign-in screen too, and the dev app says yes.
    const on = await call('GET', '/api/config', { app: dev })
    expect(on.json).toEqual({ devTools: true })
    // DEV_TOOLS=1 is forced off in production.
    const production = createApp({ env: loadEnv({ NODE_ENV: 'production', PASSWORD_PEPPER: 'test-pepper-0123456789abcdefghijklmnop', DEV_TOOLS: '1', APP_ORIGIN: ORIGIN, TRUST_PROXY: '1' }), db: database.db, clock })
    expect((await call('GET', '/api/config', { app: production })).json).toEqual({ devTools: false })
  })

  it('publishes a game event to the user on every write', async () => {
    const bus = new EventBus()
    const app = createApp({ env: loadEnv({ NODE_ENV: 'test', APP_ORIGIN: ORIGIN, TRUST_PROXY: '1' }), db: database.db, clock, bus })
    const u = await register()
    const seen: unknown[] = []
    bus.subscribe({ userId: u.user.id, sessionId: 'x', send: (e) => seen.push(e), close: () => {} })
    await act(u.cookie, { type: 'createPlayer', locale: 'en', timezone: 0, starterSlug: 'bulbasaur' }, { app })
    expect(seen).toEqual([{ type: 'game', version: 1 }])
  })

  it('SSE stream answers with text/event-stream', async () => {
    const u = await register()
    const res = await prod.app.request('/api/events', { headers: { cookie: `pf_session=${u.cookie}` } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('retry: 5000')
    expect(prod.deps.bus.count(u.user.id)).toBe(1)
    prod.deps.bus.publish(u.user.id, { type: 'friends' })
    const second = new TextDecoder().decode((await reader.read()).value)
    expect(second).toContain('data: {"type":"friends"}')
    await reader.cancel()
    expect((await prod.app.request('/api/events')).status).toBe(401)
  })
})

describe('friends', () => {
  it('request → accept → list → remove', async () => {
    const a = await register({ trainerName: 'Brock' })
    const b = await register({ trainerName: 'Misty Two' })
    await act(b.cookie, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'squirtle' })

    expect((await call('POST', '/api/friends/request', { cookie: a.cookie, body: { friendCode: a.user.friendCode } })).json).toEqual({ error: 'cannot_add_self' })
    expect((await call('POST', '/api/friends/request', { cookie: a.cookie, body: { friendCode: 'ZZZZZZZZ' } })).status).toBe(404)

    const req = await call('POST', '/api/friends/request', { cookie: a.cookie, body: { friendCode: ` ${b.user.friendCode.toLowerCase()} ` } })
    expect(req.status).toBe(201)
    expect(req.json).toEqual({ userId: b.user.id, status: 'outgoing' })
    expect((await call('POST', '/api/friends/request', { cookie: a.cookie, body: { friendCode: b.user.friendCode } })).json).toEqual({ error: 'already_requested' })

    const la = (await call('GET', '/api/friends', { cookie: a.cookie })).json as { friends: FriendSummary[] }
    const lb = (await call('GET', '/api/friends', { cookie: b.cookie })).json as { friends: FriendSummary[] }
    expect(la.friends).toMatchObject([{ userId: b.user.id, status: 'outgoing', trainerName: 'Misty Two' }])
    expect(lb.friends).toMatchObject([{ userId: a.user.id, status: 'incoming' }])
    expect(la.friends[0]!.team).toBeUndefined()

    expect((await call('POST', `/api/friends/${b.user.id}/accept`, { cookie: a.cookie })).status).toBe(404) // only the addressee accepts
    expect((await call('POST', `/api/friends/${a.user.id}/accept`, { cookie: b.cookie })).status).toBe(204)
    const la2 = (await call('GET', '/api/friends', { cookie: a.cookie })).json as { friends: FriendSummary[] }
    expect(la2.friends[0]).toMatchObject({ status: 'friend', trainerLevel: 1, weeklyPoints: 0, league: 'base', team: [{ speciesSlug: 'squirtle', level: 5 }] })
    expect((await call('POST', '/api/friends/request', { cookie: b.cookie, body: { friendCode: a.user.friendCode } })).json).toEqual({ error: 'already_friends' })

    expect((await call('DELETE', `/api/friends/${a.user.id}`, { cookie: b.cookie })).status).toBe(204)
    expect(((await call('GET', '/api/friends', { cookie: a.cookie })).json as { friends: FriendSummary[] }).friends).toEqual([])
    expect((await call('DELETE', `/api/friends/${a.user.id}`, { cookie: b.cookie })).status).toBe(404)
    expect((await call('DELETE', '/api/friends/not-a-uuid', { cookie: b.cookie })).status).toBe(404)
  })

  it('a request to someone who already asked you accepts it; both get a friends event', async () => {
    const a = await register()
    const b = await register()
    const events: string[] = []
    prod.deps.bus.subscribe({ userId: a.user.id, sessionId: 's', send: (e) => events.push(`a:${e.type}`), close: () => {} })
    prod.deps.bus.subscribe({ userId: b.user.id, sessionId: 's', send: (e) => events.push(`b:${e.type}`), close: () => {} })
    await call('POST', '/api/friends/request', { cookie: a.cookie, body: { friendCode: b.user.friendCode } })
    const r = await call('POST', '/api/friends/request', { cookie: b.cookie, body: { friendCode: a.user.friendCode } })
    expect(r.json).toEqual({ userId: a.user.id, status: 'friend' })
    expect(events).toEqual(['a:friends', 'b:friends', 'b:friends', 'a:friends'])
  })
})

describe('leaderboard', () => {
  it('global / country / friends with ranks and the caller row', async () => {
    // a fresh week so other tests' scores do not interfere
    now = T0 + 7 * 24 * 3_600_000
    const week = weekKeyOf(now, 0)
    expect(week).not.toBe(weekKeyOf(T0, 0))
    const mk2 = monthKeyOf(now, 0)

    const people = []
    for (const [name, country, pts] of [
      ['Lb Pe One', 'PE', 500],
      ['Lb Pe Two', 'PE', 300],
      ['Lb Us One', 'US', 900],
      ['Lb Pe Three', 'PE', 300],
      ['Lb Me', 'PE', 100],
    ] as const) {
      const u = await register({ trainerName: name, country })
      await act(u.cookie, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'charmander' })
      await database.db.insert(leagueScores).values([
        { userId: u.user.id, period: 'week', periodKey: week, points: pts, updatedAt: new Date(now + people.length) },
        { userId: u.user.id, period: 'month', periodKey: mk2, points: pts * 2, updatedAt: new Date(now + people.length) },
      ])
      people.push(u)
    }
    const me = people[4]!

    const g = (await call('GET', '/api/leaderboard?scope=global&period=week', { cookie: me.cookie })).json as unknown as LeaderboardResponse
    expect(g.periodKey).toBe(week)
    expect(g.total).toBe(5)
    expect(g.rows.map((r) => [r.trainerName, r.rank])).toEqual([
      ['Lb Us One', 1],
      ['Lb Pe One', 2],
      ['Lb Pe Two', 3],
      ['Lb Pe Three', 3],
      ['Lb Me', 5],
    ])
    expect(g.rows[0]).toMatchObject({ country: 'US', leader: 'charmander', me: false, league: 'base', anonymous: false })
    expect(g.mine).toMatchObject({ rank: 5, me: true, points: 100 })

    const c = (await call('GET', '/api/leaderboard?scope=country&period=week', { cookie: me.cookie })).json as unknown as LeaderboardResponse
    expect(c.rows.map((r) => r.trainerName)).toEqual(['Lb Pe One', 'Lb Pe Two', 'Lb Pe Three', 'Lb Me'])
    expect(c.mine?.rank).toBe(4)

    const m = (await call('GET', '/api/leaderboard?scope=global&period=month', { cookie: me.cookie })).json as unknown as LeaderboardResponse
    expect(m.periodKey).toBe(mk2)
    expect(m.rows.find((r) => r.trainerName === 'Lb Us One')?.points).toBe(1800)

    // friends: only accepted friends + self
    const usa = people[2]!
    await call('POST', '/api/friends/request', { cookie: me.cookie, body: { friendCode: usa.user.friendCode } })
    let f = (await call('GET', '/api/leaderboard?scope=friends&period=week', { cookie: me.cookie })).json as unknown as LeaderboardResponse
    expect(f.rows.map((r) => r.trainerName)).toEqual(['Lb Me'])
    await call('POST', `/api/friends/${me.user.id}/accept`, { cookie: usa.cookie })
    f = (await call('GET', '/api/leaderboard?scope=friends&period=week', { cookie: me.cookie })).json as unknown as LeaderboardResponse
    expect(f.rows.map((r) => [r.trainerName, r.rank])).toEqual([
      ['Lb Us One', 1],
      ['Lb Me', 2],
    ])
    expect(f.total).toBe(2)

    // a user with no points has mine = null
    const fresh = await register()
    const n = (await call('GET', '/api/leaderboard?scope=global&period=week', { cookie: fresh.cookie })).json as unknown as LeaderboardResponse
    expect(n.mine).toBeNull()
    expect(n.periodKey).toBe(week) // UTC fallback without a player

    expect((await call('GET', '/api/leaderboard?scope=galaxy', { cookie: me.cookie })).status).toBe(400)
    now = T0
  }, 30_000)

  it('rung boards (league + subrank), the few-players fallback and the weekly podium', async () => {
    now = T0 + 21 * 24 * 3_600_000
    const week = weekKeyOf(now, 0)
    const cfg = defaultContext().config
    const s3 = rankOf('super', 3)
    const { from, to } = rankInterval(s3.index)
    // Scores live in league_scores (the boards) and in the player doc (the caller's own rung and the podium).
    const seed = async (name: string, country: string, pts: number, withPlayer = false) => {
      const u = await register({ trainerName: name, country })
      await database.db.insert(leagueScores).values({ userId: u.user.id, period: 'week', periodKey: week, points: pts, updatedAt: new Date(now + pts) })
      if (withPlayer) {
        await act(u.cookie, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'charmander' })
        const [row] = await database.db.select().from(playerDocs).where(eq(playerDocs.userId, u.user.id))
        const player = row!.doc.player!
        await database.db
          .update(playerDocs)
          .set({ doc: { ...row!.doc, player: { ...player, league: { ...player.league, weeklyPoints: { [week]: pts } } } } })
          .where(eq(playerDocs.userId, u.user.id))
      }
      return u
    }
    const top = await seed('Rk Pe Top', 'PE', to! - 1, true)
    const third = await seed('Rk Pe Third', 'PE', to! - 3, true)
    await seed('Rk Pe Second', 'PE', to! - 2)
    for (let i = 0; i < cfg.leagues.podium.minPlayers - 3; i++) await seed(`Rk Pe ${i}`, 'PE', from + i)
    const usa = await seed('Rk Us', 'US', from + 500, true)
    const low = await seed('Rk Pe Low', 'PE', 10, true)
    const get = async (cookie: string, q: string) => (await call('GET', `/api/leaderboard?period=week&${q}`, { cookie })).json as unknown as LeaderboardResponse

    // My rung in my country: only Super 3 trainers of Peru.
    const mine = await get(top.cookie, 'scope=country&rank=mine')
    expect(mine.rank).toMatchObject({ league: 'super', sub: 3, index: s3.index, from, to })
    expect(mine.myRank).toMatchObject({ league: 'super', sub: 3 })
    expect(mine.fallback).toBeUndefined()
    expect(mine.scope).toBe('country')
    expect(mine.total).toBe(cfg.leagues.podium.minPlayers)
    expect(mine.rows.slice(0, 3).map((r) => [r.trainerName, r.rank, r.league, r.sub])).toEqual([
      ['Rk Pe Top', 1, 'super', 3],
      ['Rk Pe Second', 2, 'super', 3],
      ['Rk Pe Third', 3, 'super', 3],
    ])
    expect(mine.mine).toMatchObject({ rank: 1, me: true })

    // Too few trainers of that rung in the USA: the global board of the rung, flagged.
    const us = await get(usa.cookie, 'scope=country&rank=mine')
    expect(us.scope).toBe('global')
    expect(us.fallback).toEqual({ from: 'country', minPlayers: cfg.leagues.podium.minPlayers })
    expect(us.total).toBe(cfg.leagues.podium.minPlayers + 1)
    expect(us.mine?.me).toBe(true)

    // Any other rung can be read; my own row is only there when I am in it.
    const base = await get(top.cookie, 'scope=global&league=base&sub=1')
    expect(base.rank).toMatchObject({ league: 'base', sub: 1, from: 0 })
    expect(base.rows.map((r) => r.trainerName)).toEqual(['Rk Pe Low'])
    expect(base.mine).toBeNull()
    expect(base.myRank).toMatchObject({ league: 'super', sub: 3 })
    // Without a rung the board is the whole country, as before.
    expect((await get(low.cookie, 'scope=country')).rank).toBeNull()
    expect((await call('GET', '/api/leaderboard?league=galaxy', { cookie: top.cookie })).status).toBe(400)
    expect((await call('GET', '/api/leaderboard?rank=best', { cookie: top.cookie })).status).toBe(400)

        const podium = async (cookie: string) => (await call('POST', '/api/leaderboard/podium', { cookie, headers: { origin: ORIGIN } })).json as unknown as PodiumResponse
    // While the week is open only the week before it can be closed (no points there: no prize).
    expect((await podium(top.cookie)).settled).toMatchObject({ weekKey: '2026-11-16', place: null, dust: 0 })
    // The next local week has started, but UTC−12 is still playing the old one.
    now = Date.UTC(2026, 10, 30, 6, 0)
    expect(weekKeyOf(now, 0)).not.toBe(week)
    expect((await podium(top.cookie)).settled).toBeNull()
    now = Date.UTC(2026, 10, 30, 13, 0)
    const before = ((await call('GET', '/api/game', { cookie: top.cookie })).json as unknown as GameSnapshot).doc.player!.dust
    const first = await podium(top.cookie)
    expect(first.settled).toEqual({ weekKey: week, league: 'super', sub: 3, place: 1, scope: 'country', dust: podiumDust(s3.index, 1, cfg) })
    const after = ((await call('GET', '/api/game', { cookie: top.cookie })).json as unknown as GameSnapshot).doc.player!
    expect(after.dust).toBe(before + podiumDust(s3.index, 1, cfg))
    expect(after.pendingLeagueNotices).toEqual([expect.objectContaining({ kind: 'podium', weekKey: week, rank: s3.index, place: 1, scope: 'country' })])
    expect((await podium(top.cookie)).settled).toBeNull() // once
    expect((await podium(third.cookie)).settled).toMatchObject({ place: 3, scope: 'country', dust: podiumDust(s3.index, 3, cfg) })
    // The USA trainer competes on the global board of the rung (20 Peruvians above → no podium).
    expect((await podium(usa.cookie)).settled).toMatchObject({ place: null, scope: null, dust: 0 })
    // A Base 1 board with one trainer has no podium.
    expect((await podium(low.cookie)).settled).toMatchObject({ league: 'base', sub: 1, place: null, dust: 0 })
    await act(top.cookie, { type: 'ackLeagueNotices' })
    expect(((await call('GET', '/api/game', { cookie: top.cookie })).json as unknown as GameSnapshot).doc.player!.pendingLeagueNotices).toBeUndefined()
    now = T0
  }, 120_000)
})
