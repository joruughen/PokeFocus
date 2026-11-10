/** Integration tests for roles, sudo mode (reauth), ADMIN_EMAILS and the audit log (docs/admin-plan.md §4, delivery E2). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AdminMaintenanceItem, AdminMeResponse, PublicUser, UserRole } from '../src/game/protocol'
import { audit } from './admin/audit'
import { promoteAdminEmails, setRoleByEmail } from './admin/roles'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { adminAudit, maintenanceWindows, users } from './db/schema'
import { loadEnv } from './env'
import { ApiError, requireAuth, requireElevated, requireRole, type AppEnv } from './http'
import { ELEVATION_MS } from './routes/admin'
import { RateLimiter, RULES } from './rate-limit'

const ORIGIN = 'http://localhost:5173'
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4'
const PASSWORD = 'correct horse battery'
const T0 = Date.UTC(2026, 10, 9, 12, 0)
const MIN = 60_000

let database: Database
let now = T0
const clock = () => now
let seq = 0

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  now = T0
  await database.db.delete(adminAudit)
  await database.db.delete(maintenanceWindows)
})

function makeApp(opts: { adminToken?: string } = {}) {
  const limiter = new RateLimiter(clock)
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, ...(opts.adminToken ? { ADMIN_TOKEN: opts.adminToken } : {}) })
  const built = createApp({ env, db: database.db, clock, limiter })
  const call = async (method: string, path: string, o: { cookie?: string; bearer?: string; body?: unknown; ip?: string } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': o.ip ?? `10.7.${Math.floor(++seq / 250)}.${seq % 250}` }
    if (o.cookie) headers.cookie = `pf_session=${o.cookie}`
    if (o.bearer) headers.authorization = `Bearer ${o.bearer}`
    if (method !== 'GET') {
      headers.origin = ORIGIN
      headers['content-type'] = 'application/json'
    }
    const res = await built.app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(o.body ?? {}) })
    const text = await res.text()
    const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, cookie: sc ? sc[1]! : null, res }
  }
  return { ...built, call, limiter, env }
}
type Harness = ReturnType<typeof makeApp>

/** Register an account (optionally with a role) and return its session cookie. */
async function account(h: Harness, role: UserRole = 'player') {
  const email = `u${++seq}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const r = await h.call('POST', '/api/auth/register', { body: { email, password: PASSWORD, trainerName: `Trainer${seq}`, country: 'PE' } })
  expect(r.status).toBe(201)
  const user = (r.json as unknown as { user: PublicUser }).user
  if (role !== 'player') await database.db.update(users).set({ role }).where(eq(users.id, user.id))
  return { email, id: user.id, cookie: r.cookie! }
}

const win = (startMin: number, endMin: number, note = 'n') => ({ startsAt: now + startMin * MIN, endsAt: now + endMin * MIN, note })
const lastAudit = async () => (await database.db.select().from(adminAudit).orderBy(desc(adminAudit.createdAt)).limit(1))[0]

describe('roles in the schema and in the client user', () => {
  it('new accounts are players and /auth/me exposes the role', async () => {
    const h = makeApp()
    const a = await account(h)
    const me = await h.call('GET', '/api/auth/me', { cookie: a.cookie })
    expect((me.json as unknown as { user: PublicUser }).user.role).toBe('player')
    await database.db.update(users).set({ role: 'admin' }).where(eq(users.id, a.id))
    const again = await h.call('GET', '/api/auth/me', { cookie: a.cookie })
    expect((again.json as unknown as { user: PublicUser }).user.role).toBe('admin')
  })

  it('the check constraint rejects an unknown role', async () => {
    const h = makeApp()
    const a = await account(h)
    await expect(database.db.update(users).set({ role: 'root' as UserRole }).where(eq(users.id, a.id))).rejects.toThrow()
  })
})

describe('requireRole on /api/admin/me', () => {
  it('401 without a session, 403 for a player, 200 for support and admin', async () => {
    const h = makeApp()
    expect((await h.call('GET', '/api/admin/me')).status).toBe(401)
    const player = await account(h)
    const denied = await h.call('GET', '/api/admin/me', { cookie: player.cookie })
    expect(denied.status).toBe(403)
    expect(denied.json).toEqual({ error: 'forbidden' })
    expect(denied.res.headers.get('cache-control')).toBe('no-store')

    const support = await account(h, 'support')
    const s = await h.call('GET', '/api/admin/me', { cookie: support.cookie })
    expect(s.status).toBe(200)
    expect(s.json).toEqual({ role: 'support', elevated: false, elevatedUntil: null, serverNow: T0 } satisfies AdminMeResponse)

    const admin = await account(h, 'admin')
    expect(((await h.call('GET', '/api/admin/me', { cookie: admin.cookie })).json as unknown as AdminMeResponse).role).toBe('admin')
  })

  it('the role is read from the database on every request (a demotion applies at once)', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    expect((await h.call('GET', '/api/admin/me', { cookie: a.cookie })).status).toBe(200)
    await database.db.update(users).set({ role: 'player' }).where(eq(users.id, a.id))
    expect((await h.call('GET', '/api/admin/me', { cookie: a.cookie })).status).toBe(403)
  })

  it('requireRole orders player < support < admin', async () => {
    const h = makeApp()
    const probe = new Hono<AppEnv>()
    probe.use('*', requireAuth(h.deps))
    probe.get('/support', requireRole('support'), (c) => c.json({ ok: true }))
    probe.get('/admin', requireRole('admin'), (c) => c.json({ ok: true }))
    probe.onError((e, c) => (e instanceof ApiError ? c.json({ error: e.code }, e.status) : c.json({ error: 'internal' }, 500)))
    const get = async (path: string, cookie: string) => (await probe.request(path, { headers: { cookie: `pf_session=${cookie}` } })).status
    const [p, s, a] = [await account(h), await account(h, 'support'), await account(h, 'admin')]
    expect([await get('/support', p.cookie), await get('/support', s.cookie), await get('/support', a.cookie)]).toEqual([403, 200, 200])
    expect([await get('/admin', p.cookie), await get('/admin', s.cookie), await get('/admin', a.cookie)]).toEqual([403, 403, 200])
  })
})

describe('POST /api/admin/reauth (sudo mode)', () => {
  it('a wrong password is 403 wrong_password and does not elevate', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const r = await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: 'nope nope nope' } })
    expect(r.status).toBe(403)
    expect(r.json).toEqual({ error: 'wrong_password' })
    expect(((await h.call('GET', '/api/admin/me', { cookie: a.cookie })).json as unknown as AdminMeResponse).elevated).toBe(false)
    expect(await lastAudit()).toBeUndefined()
  })

  it('the right password elevates this session for 30 minutes, then it lapses', async () => {
    const h = makeApp()
    const a = await account(h, 'support')
    const r = await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: PASSWORD } })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ role: 'support', elevated: true, elevatedUntil: T0 + ELEVATION_MS, serverNow: T0 })
    expect(ELEVATION_MS).toBe(30 * MIN)

    now = T0 + 29 * MIN
    expect(((await h.call('GET', '/api/admin/me', { cookie: a.cookie })).json as unknown as AdminMeResponse).elevated).toBe(true)
    now = T0 + 31 * MIN
    expect(((await h.call('GET', '/api/admin/me', { cookie: a.cookie })).json as unknown as AdminMeResponse)).toMatchObject({ elevated: false, elevatedUntil: null })

    const row = await lastAudit()
    expect(row).toMatchObject({ action: 'admin.reauth', actorId: a.id, targetType: 'session' })
  })

  it('elevation belongs to the session: another session of the same user is not elevated', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: PASSWORD } })
    const other = await h.call('POST', '/api/auth/login', { body: { email: a.email, password: PASSWORD } })
    expect(((await h.call('GET', '/api/admin/me', { cookie: other.cookie! })).json as unknown as AdminMeResponse).elevated).toBe(false)
  })

  it('players cannot use it; the body is validated', async () => {
    const h = makeApp()
    const p = await account(h)
    expect((await h.call('POST', '/api/admin/reauth', { cookie: p.cookie, body: { password: PASSWORD } })).status).toBe(403)
    const a = await account(h, 'admin')
    expect((await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: {} })).status).toBe(400)
  })

  it('wrong passwords are rate limited per user (5 / 15 min), a right one clears the counter', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    for (let i = 0; i < 4; i++) expect((await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: 'bad bad bad' } })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: PASSWORD } })).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: 'bad bad bad' } })).status).toBe(403)
    const blocked = await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: PASSWORD } })
    expect(blocked.status).toBe(429)
    expect(blocked.res.headers.get('retry-after')).toBeTruthy()
    now = T0 + 16 * MIN
    expect((await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: PASSWORD } })).status).toBe(200)
  })

  it('requireElevated: 403 elevation_required until reauth, and again once it lapses', async () => {
    const h = makeApp()
    const probe = new Hono<AppEnv>()
    probe.use('*', requireAuth(h.deps))
    probe.post('/sensitive', requireRole('admin'), requireElevated(h.deps), (c) => c.json({ ok: true }))
    probe.onError((e, c) => (e instanceof ApiError ? c.json({ error: e.code }, e.status) : c.json({ error: 'internal' }, 500)))
    const post = async (cookie: string) => {
      const r = await probe.request('/sensitive', { method: 'POST', headers: { cookie: `pf_session=${cookie}` } })
      return { status: r.status, json: await r.json() }
    }
    const a = await account(h, 'admin')
    expect(await post(a.cookie)).toEqual({ status: 403, json: { error: 'elevation_required' } })
    await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: PASSWORD } })
    expect((await post(a.cookie)).status).toBe(200)
    now = T0 + 30 * MIN
    expect((await post(a.cookie)).json).toEqual({ error: 'elevation_required' })
  })
})

describe('per-user rate limit on the admin routes', () => {
  it('429 after the per-user budget, other users unaffected', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const b = await account(h, 'support')
    for (let i = 0; i < RULES.adminUser.limit; i++) h.limiter.hit(`admin:user:${a.id}`, RULES.adminUser)
    const r = await h.call('GET', '/api/admin/me', { cookie: a.cookie })
    expect(r.status).toBe(429)
    expect(r.json).toMatchObject({ error: 'rate_limited' })
    expect((await h.call('GET', '/api/admin/me', { cookie: b.cookie })).status).toBe(200)
  })
})

describe('maintenance with roles and the legacy token', () => {
  it('an admin account (cookie) lists, creates and deletes; players and support get 403', async () => {
    const h = makeApp() // no ADMIN_TOKEN at all
    const admin = await account(h, 'admin')
    const created = await h.call('POST', '/api/admin/maintenance', { cookie: admin.cookie, body: win(30, 60, 'upgrade') })
    expect(created.status).toBe(201)
    const item = (created.json as unknown as { item: AdminMaintenanceItem }).item
    const list = await h.call('GET', '/api/admin/maintenance', { cookie: admin.cookie })
    expect((list.json as unknown as { items: AdminMaintenanceItem[] }).items.map((i) => i.id)).toEqual([item.id])

    for (const role of ['player', 'support'] as const) {
      const u = await account(h, role)
      expect((await h.call('GET', '/api/admin/maintenance', { cookie: u.cookie })).status, role).toBe(403)
      expect((await h.call('POST', '/api/admin/maintenance', { cookie: u.cookie, body: win(30, 60) })).status, role).toBe(403)
      expect((await h.call('DELETE', `/api/admin/maintenance/${item.id}`, { cookie: u.cookie })).status, role).toBe(403)
    }
    expect((await h.call('DELETE', `/api/admin/maintenance/${item.id}`, { cookie: admin.cookie })).status).toBe(204)
    expect(await database.db.select().from(maintenanceWindows)).toHaveLength(0)
  })

  it('no credentials: 404 admin_disabled without ADMIN_TOKEN, 401 with it', async () => {
    expect((await makeApp().call('GET', '/api/admin/maintenance')).json).toEqual({ error: 'admin_disabled' })
    expect((await makeApp({ adminToken: TOKEN }).call('GET', '/api/admin/maintenance')).status).toBe(401)
  })

  it('the deprecated ADMIN_TOKEN still works and is audited as actor_label "token"', async () => {
    const h = makeApp({ adminToken: TOKEN })
    const created = await h.call('POST', '/api/admin/maintenance', { bearer: TOKEN, body: win(10, 20, 'via token'), ip: '10.9.9.9' })
    expect(created.status).toBe(201)
    const item = (created.json as unknown as { item: AdminMaintenanceItem }).item
    expect(await lastAudit()).toMatchObject({ action: 'maintenance.create', actorId: null, actorLabel: 'token', targetType: 'maintenance', targetId: item.id, ip: '10.9.9.9' })
    expect((await h.call('DELETE', `/api/admin/maintenance/${item.id}`, { bearer: TOKEN })).status).toBe(204)
    expect(await lastAudit()).toMatchObject({ action: 'maintenance.delete', actorLabel: 'token' })
  })

  it('the token is not a session: it opens no /admin/me, and an admin session does not need it', async () => {
    const h = makeApp({ adminToken: TOKEN })
    expect((await h.call('GET', '/api/admin/me', { bearer: TOKEN })).status).toBe(401)
    const admin = await account(h, 'admin')
    expect((await h.call('GET', '/api/admin/maintenance', { cookie: admin.cookie })).status).toBe(200)
  })

  it('a wrong token still counts against the IP limit even with a player cookie', async () => {
    const h = makeApp({ adminToken: TOKEN })
    const p = await account(h)
    for (let i = 0; i < 10; i++) expect((await h.call('GET', '/api/admin/maintenance', { cookie: p.cookie, bearer: 'wrong', ip: '10.8.8.8' })).status).toBe(401)
    expect((await h.call('GET', '/api/admin/maintenance', { cookie: p.cookie, bearer: 'wrong', ip: '10.8.8.8' })).status).toBe(429)
  })
})

describe('audit log', () => {
  it('records create and delete by an admin account with actor, before/after and ip, in the same request', async () => {
    const h = makeApp()
    const admin = await account(h, 'admin')
    const created = await h.call('POST', '/api/admin/maintenance', { cookie: admin.cookie, body: win(30, 60, 'db upgrade'), ip: '10.5.5.5' })
    const item = (created.json as unknown as { item: AdminMaintenanceItem }).item
    expect(await lastAudit()).toMatchObject({ action: 'maintenance.create', actorId: admin.id, actorLabel: null, targetId: item.id, before: null, after: item, ip: '10.5.5.5' })
    await h.call('DELETE', `/api/admin/maintenance/${item.id}`, { cookie: admin.cookie })
    expect(await lastAudit()).toMatchObject({ action: 'maintenance.delete', actorId: admin.id, targetId: item.id, before: item, after: null })
    expect(await database.db.select().from(adminAudit)).toHaveLength(2)
  })

  it('a failed mutation writes no audit row (404 delete, 409 too_many)', async () => {
    const h = makeApp()
    const admin = await account(h, 'admin')
    expect((await h.call('DELETE', '/api/admin/maintenance/6f1f6f1e-1b1b-4b1b-8b1b-1b1b1b1b1b1b', { cookie: admin.cookie })).status).toBe(404)
    expect(await database.db.select().from(adminAudit)).toHaveLength(0)
    for (let i = 0; i < 20; i++) expect((await h.call('POST', '/api/admin/maintenance', { cookie: admin.cookie, body: win(10 + i, 20 + i) })).status).toBe(201)
    expect((await h.call('POST', '/api/admin/maintenance', { cookie: admin.cookie, body: win(10, 20) })).status).toBe(409)
    expect(await database.db.select().from(adminAudit)).toHaveLength(20)
  })

  it('audit() shares the caller transaction: rolling back the transaction drops the row', async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await audit(tx, { label: 'system' }, { action: 'test.rollback', targetType: 'x', targetId: '1' })
        expect(await tx.select().from(adminAudit)).toHaveLength(1)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await database.db.select().from(adminAudit)).toHaveLength(0)
  })
})

describe('ADMIN_EMAILS and role changes outside HTTP', () => {
  it('env: comma-separated, trimmed, lower-cased, de-duplicated; empty counts as unset; junk is rejected', () => {
    expect(loadEnv({}).adminEmails).toEqual([])
    expect(loadEnv({ ADMIN_EMAILS: '' }).adminEmails).toEqual([])
    expect(loadEnv({ ADMIN_EMAILS: ' A@x.com, b@y.org ,a@x.com,' }).adminEmails).toEqual(['a@x.com', 'b@y.org'])
    expect(() => loadEnv({ ADMIN_EMAILS: 'not-an-email' })).toThrow(/ADMIN_EMAILS/)
  })

  it('promotes existing accounts to admin once, audited as actor "system"; missing emails are reported', async () => {
    const h = makeApp()
    const a = await account(h)
    const b = await account(h, 'support')
    const first = await promoteAdminEmails(database.db, [a.email.toUpperCase(), b.email, 'ghost@example.com'])
    expect(first).toEqual({ promoted: [a.email.toUpperCase(), b.email], missing: ['ghost@example.com'] })
    const rows = await database.db.select().from(users).where(eq(users.id, a.id))
    expect(rows[0]!.role).toBe('admin')
    const audits = await database.db.select().from(adminAudit)
    expect(audits).toHaveLength(2)
    expect(audits.find((r) => r.targetId === a.id)).toMatchObject({ action: 'user.role', actorId: null, actorLabel: 'system', before: { role: 'player' }, after: { role: 'admin' }, note: 'ADMIN_EMAILS' })
    expect(audits.find((r) => r.targetId === b.id)).toMatchObject({ before: { role: 'support' }, after: { role: 'admin' } })

    // Idempotent: a second start changes and audits nothing.
    expect(await promoteAdminEmails(database.db, [a.email, b.email])).toEqual({ promoted: [], missing: [] })
    expect(await database.db.select().from(adminAudit)).toHaveLength(2)
    // …and the promoted account now passes requireRole('admin').
    expect((await h.call('GET', '/api/admin/maintenance', { cookie: a.cookie })).status).toBe(200)
  })

  it('never demotes: an account missing from the list keeps its role', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    await promoteAdminEmails(database.db, [])
    expect((await database.db.select().from(users).where(eq(users.id, a.id)))[0]!.role).toBe('admin')
  })

  it('setRoleByEmail (the CLI) changes the role, audits as "cli" and reports unknown emails', async () => {
    const h = makeApp()
    const a = await account(h)
    expect(await setRoleByEmail(database.db, a.email, 'support', 'cli')).toEqual({ ok: true, changed: true, before: 'player' })
    expect(await lastAudit()).toMatchObject({ actorLabel: 'cli', action: 'user.role', before: { role: 'player' }, after: { role: 'support' } })
    expect(await setRoleByEmail(database.db, a.email, 'support', 'cli')).toEqual({ ok: true, changed: false, before: 'support' })
    expect(await setRoleByEmail(database.db, 'nobody@example.com', 'admin', 'cli')).toEqual({ ok: false, reason: 'not_found' })
    expect(await database.db.select().from(adminAudit)).toHaveLength(1)
  })
})
