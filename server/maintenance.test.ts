/** Integration tests for scheduled maintenance notices (/api/announcements + /api/admin/maintenance). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MAINTENANCE_MAX_MS,
  MAINTENANCE_NOTE_MAX,
  type AdminMaintenanceItem,
  type AdminMaintenanceResponse,
  type AnnouncementsResponse,
} from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { maintenanceWindows } from './db/schema'
import { loadEnv } from './env'
import { RateLimiter } from './rate-limit'

const ORIGIN = 'http://localhost:5173'
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4' // 48 chars
const T0 = Date.UTC(2026, 10, 6, 12, 0)
const MIN = 60_000
const HOUR = 60 * MIN

let database: Database
let now = T0
const clock = () => now

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  now = T0
  await database.db.delete(maintenanceWindows)
})

/** A fresh app (and limiter) per call: nothing but the table is shared between tests. */
function makeApp(adminToken: string | null = TOKEN) {
  const limiter = new RateLimiter(clock)
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, ...(adminToken === null ? {} : { ADMIN_TOKEN: adminToken }) })
  const { app } = createApp({ env, db: database.db, clock, limiter })
  const call = async (
    method: string,
    path: string,
    opts: { token?: string | null; auth?: string; body?: unknown; ip?: string; cookie?: string } = {},
  ) => {
    const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '10.2.0.1' }
    const token = opts.token === undefined ? TOKEN : opts.token
    if (opts.auth) headers.authorization = opts.auth
    else if (token) headers.authorization = `Bearer ${token}`
    if (opts.cookie) headers.cookie = opts.cookie
    if (method !== 'GET') {
      headers.origin = ORIGIN
      headers['content-type'] = 'application/json'
    }
    const res = await app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}) })
    const text = await res.text()
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, res }
  }
  return { app, call, limiter }
}

const win = (startMin: number, endMin: number, note?: string | null) => ({
  startsAt: now + startMin * MIN,
  endsAt: now + endMin * MIN,
  ...(note === undefined ? {} : { note }),
})

describe('env: ADMIN_TOKEN', () => {
  it('is optional and empty counts as unset', () => {
    expect(loadEnv({}).adminToken).toBeUndefined()
    expect(loadEnv({ ADMIN_TOKEN: '' }).adminToken).toBeUndefined()
  })
  it('accepts a token of at least 24 characters', () => {
    expect(loadEnv({ ADMIN_TOKEN: 'x'.repeat(24) }).adminToken).toBe('x'.repeat(24))
    expect(loadEnv({ ADMIN_TOKEN: TOKEN }).adminToken).toBe(TOKEN)
  })
  it('rejects a short token with a clear error that does not echo it', () => {
    const short = 'secret-but-short'
    let message = ''
    try {
      loadEnv({ ADMIN_TOKEN: short })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/^Invalid environment: ADMIN_TOKEN: .*24/)
    expect(message).not.toContain(short)
    expect(() => loadEnv({ ADMIN_TOKEN: 'x'.repeat(23) })).toThrow(/Invalid environment/)
  })
})

describe('GET /api/announcements (public)', () => {
  it('is empty at first, needs no cookie and is never cached', async () => {
    const { call } = makeApp()
    const r = await call('GET', '/api/announcements', { token: null })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ maintenance: [], contentNote: null, serverNow: T0 })
    expect(r.res.headers.get('cache-control')).toBe('no-store')
  })

  it('works when the admin API is disabled, and ignores a bogus session cookie', async () => {
    const { call } = makeApp(null)
    const r = await call('GET', '/api/announcements', { token: null, cookie: 'pf_session=nonsense' })
    expect(r.status).toBe(200)
    expect((r.json as unknown as AnnouncementsResponse).maintenance).toEqual([])
  })

  it('lists upcoming and running windows by start, hides ended ones', async () => {
    const { call } = makeApp()
    const later = await call('POST', '/api/admin/maintenance', { body: win(120, 180, 'later') })
    const soon = await call('POST', '/api/admin/maintenance', { body: win(30, 60, 'soon') })
    const running = await call('POST', '/api/admin/maintenance', { body: win(-10, 20, 'running') })
    for (const r of [later, soon, running]) expect(r.status).toBe(201)

    let pub = (await call('GET', '/api/announcements', { token: null })).json as unknown as AnnouncementsResponse
    expect(pub.maintenance.map((m) => m.note)).toEqual(['running', 'soon', 'later'])
    expect(pub.maintenance[0]).toEqual({ id: expect.any(String), startsAt: now - 10 * MIN, endsAt: now + 20 * MIN, note: 'running' })
    expect(Object.keys(pub.maintenance[0]!).sort()).toEqual(['endsAt', 'id', 'note', 'startsAt'])

    now = T0 + 25 * MIN // "running" ended
    pub = (await call('GET', '/api/announcements', { token: null })).json as unknown as AnnouncementsResponse
    expect(pub.maintenance.map((m) => m.note)).toEqual(['soon', 'later'])
    expect(pub.serverNow).toBe(now)

    now = T0 + 4 * HOUR // everything ended
    pub = (await call('GET', '/api/announcements', { token: null })).json as unknown as AnnouncementsResponse
    expect(pub.maintenance).toEqual([])
  })
})

describe('admin guard', () => {
  it('404 admin_disabled for every method when ADMIN_TOKEN is unset, before any other check', async () => {
    const { call } = makeApp(null)
    for (const [method, path] of [
      ['GET', '/api/admin/maintenance'],
      ['POST', '/api/admin/maintenance'],
      ['DELETE', '/api/admin/maintenance/6f1f6f1e-1b1b-4b1b-8b1b-1b1b1b1b1b1b'],
    ] as const) {
      const r = await call(method, path, { body: win(10, 20) })
      expect(r.status, `${method} ${path}`).toBe(404)
      expect(r.json).toEqual({ error: 'admin_disabled' })
    }
    // Not rate limited either: it is simply off.
    for (let i = 0; i < 15; i++) expect((await call('GET', '/api/admin/maintenance', { token: 'wrong' })).status).toBe(404)
  })

  it('401 unauthorized for a missing, wrong or malformed credential', async () => {
    const { call } = makeApp()
    const cases: Array<{ token?: string | null; auth?: string }> = [
      { token: null },
      { token: 'wrong' },
      { token: TOKEN.slice(0, -1) },
      { token: TOKEN + 'x' },
      { token: TOKEN.toUpperCase() },
      { auth: TOKEN }, // no scheme
      { auth: `Basic ${TOKEN}` },
      { auth: 'Bearer' },
    ]
    for (const c of cases) {
      const r = await call('GET', '/api/admin/maintenance', { ...c, ip: `10.9.0.${Math.floor(Math.random() * 200)}` })
      expect(r.status, JSON.stringify(c)).toBe(401)
      expect(r.json).toEqual({ error: 'unauthorized' })
    }
    // …for every method, and nothing was written.
    expect((await call('POST', '/api/admin/maintenance', { token: 'wrong', body: win(10, 20) })).status).toBe(401)
    expect((await call('DELETE', '/api/admin/maintenance/6f1f6f1e-1b1b-4b1b-8b1b-1b1b1b1b1b1b', { token: null })).status).toBe(401)
    expect(await database.db.select().from(maintenanceWindows)).toHaveLength(0)
  })

  it('accepts the right token (scheme is case-insensitive) and never caches admin responses', async () => {
    const { call } = makeApp()
    const r = await call('GET', '/api/admin/maintenance')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ items: [], serverNow: T0 })
    expect(r.res.headers.get('cache-control')).toBe('no-store')
    expect((await call('GET', '/api/admin/maintenance', { token: null, auth: `bearer ${TOKEN}` })).status).toBe(200)
  })

  it('does not accept a session cookie instead of the token', async () => {
    const { call } = makeApp()
    expect((await call('GET', '/api/admin/maintenance', { token: null, cookie: 'pf_session=whatever' })).status).toBe(401)
  })

  it('still applies the CSRF Origin guard to POST', async () => {
    const { app } = makeApp()
    const r = await app.request('/api/admin/maintenance', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify(win(10, 20)),
    })
    expect(r.status).toBe(403)
  })
})

describe('rate limit on the admin API', () => {
  it('blocks an IP after 10 failed attempts, even for the right token, until the window passes', async () => {
    const { call } = makeApp()
    for (let i = 0; i < 10; i++) expect((await call('GET', '/api/admin/maintenance', { token: `wrong-${i}` })).status).toBe(401)
    const blocked = await call('GET', '/api/admin/maintenance')
    expect(blocked.status).toBe(429)
    expect(blocked.json).toMatchObject({ error: 'rate_limited', retryAfter: 15 * 60 })
    expect(blocked.res.headers.get('retry-after')).toBe(String(15 * 60))

    // Another IP is not affected.
    expect((await call('GET', '/api/admin/maintenance', { ip: '10.2.0.99' })).status).toBe(200)

    now = T0 + 15 * MIN + 1
    expect((await call('GET', '/api/admin/maintenance')).status).toBe(200)
  })

  it('a successful token check resets the counter: a legitimate admin is never locked out', async () => {
    const { call } = makeApp()
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 9; i++) expect((await call('GET', '/api/admin/maintenance', { token: 'typo' })).status).toBe(401)
      expect((await call('GET', '/api/admin/maintenance')).status).toBe(200)
    }
    // Many successful requests in a row never trip the limiter either.
    for (let i = 0; i < 25; i++) expect((await call('GET', '/api/admin/maintenance')).status).toBe(200)
  })

  it('counts POST and DELETE attempts too', async () => {
    const { call } = makeApp()
    for (let i = 0; i < 5; i++) expect((await call('POST', '/api/admin/maintenance', { token: 'bad', body: win(10, 20) })).status).toBe(401)
    for (let i = 0; i < 5; i++) expect((await call('DELETE', '/api/admin/maintenance/6f1f6f1e-1b1b-4b1b-8b1b-1b1b1b1b1b1b', { token: 'bad' })).status).toBe(401)
    expect((await call('POST', '/api/admin/maintenance', { body: win(10, 20) })).status).toBe(429)
  })
})

describe('POST /api/admin/maintenance', () => {
  it('creates a window → 201 { item } that shows up in both lists', async () => {
    const { call } = makeApp()
    const r = await call('POST', '/api/admin/maintenance', { body: win(60, 90, 'Actualizando el servidor') })
    expect(r.status).toBe(201)
    const item = (r.json as unknown as { item: AdminMaintenanceItem }).item
    expect(item).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), startsAt: T0 + 60 * MIN, endsAt: T0 + 90 * MIN, note: 'Actualizando el servidor', createdAt: T0 })

    const admin = (await call('GET', '/api/admin/maintenance')).json as unknown as AdminMaintenanceResponse
    expect(admin).toEqual({ items: [item], serverNow: T0 })
    const pub = (await call('GET', '/api/announcements', { token: null })).json as unknown as AnnouncementsResponse
    expect(pub.maintenance).toEqual([{ id: item.id, startsAt: item.startsAt, endsAt: item.endsAt, note: item.note }])
  })

  it('admin list: only windows that have not ended, oldest start first', async () => {
    const { call } = makeApp()
    await call('POST', '/api/admin/maintenance', { body: win(300, 360, 'c') })
    await call('POST', '/api/admin/maintenance', { body: win(10, 20, 'a') })
    await call('POST', '/api/admin/maintenance', { body: win(100, 200, 'b') })
    let items = ((await call('GET', '/api/admin/maintenance')).json as unknown as AdminMaintenanceResponse).items
    expect(items.map((i) => i.note)).toEqual(['a', 'b', 'c'])
    now = T0 + 30 * MIN
    items = ((await call('GET', '/api/admin/maintenance')).json as unknown as AdminMaintenanceResponse).items
    expect(items.map((i) => i.note)).toEqual(['b', 'c'])
  })

  it('trims the note; blank, null or missing → null', async () => {
    const { call } = makeApp()
    const post = async (extra: Record<string, unknown>) =>
      ((await call('POST', '/api/admin/maintenance', { body: { startsAt: now + MIN, endsAt: now + 2 * MIN, ...extra } })).json as unknown as { item: AdminMaintenanceItem }).item
    expect((await post({ note: '  hola  mundo \n' })).note).toBe('hola  mundo')
    expect((await post({ note: '   ' })).note).toBeNull()
    expect((await post({ note: '' })).note).toBeNull()
    expect((await post({ note: null })).note).toBeNull()
    expect((await post({})).note).toBeNull()
  })

  it('accepts a note of exactly the maximum length (after trimming) and a window of exactly the maximum length', async () => {
    const { call } = makeApp()
    const note = 'n'.repeat(MAINTENANCE_NOTE_MAX)
    const r = await call('POST', '/api/admin/maintenance', { body: { startsAt: now + MIN, endsAt: now + MIN + MAINTENANCE_MAX_MS, note: `  ${note}  ` } })
    expect(r.status).toBe(201)
    expect((r.json as unknown as { item: AdminMaintenanceItem }).item.note).toBe(note)
  })

  it('400 invalid_body with the offending fields', async () => {
    const { call } = makeApp()
    const bad = async (body: unknown) => {
      const r = await call('POST', '/api/admin/maintenance', { body })
      expect(r.status, JSON.stringify(body)).toBe(400)
      expect(r.json).toMatchObject({ error: 'invalid_body' })
      return (r.json as { fields: string[] }).fields
    }
    // end <= start
    expect(await bad({ startsAt: now + 60 * MIN, endsAt: now + 60 * MIN })).toContain('endsAt')
    expect(await bad({ startsAt: now + 60 * MIN, endsAt: now + 30 * MIN })).toContain('endsAt')
    // end in the past (even if the order is right)
    expect(await bad({ startsAt: now - 2 * HOUR, endsAt: now - HOUR })).toContain('endsAt')
    expect(await bad({ startsAt: now - HOUR, endsAt: now })).toContain('endsAt')
    // too long
    expect(await bad({ startsAt: now + MIN, endsAt: now + MIN + MAINTENANCE_MAX_MS + 1 })).toContain('endsAt')
    // note too long (also after trimming)
    expect(await bad({ startsAt: now + MIN, endsAt: now + 2 * MIN, note: 'n'.repeat(MAINTENANCE_NOTE_MAX + 1) })).toEqual(['note'])
    // not integers / wrong types / missing
    expect(await bad({ startsAt: now + MIN + 0.5, endsAt: now + 2 * MIN })).toContain('startsAt')
    expect(await bad({ startsAt: now + MIN, endsAt: now + 2 * MIN + 0.5 })).toContain('endsAt')
    expect(await bad({ startsAt: String(now + MIN), endsAt: now + 2 * MIN })).toContain('startsAt')
    expect(await bad({ startsAt: now + MIN, endsAt: null })).toContain('endsAt')
    expect(await bad({ startsAt: now + MIN })).toContain('endsAt')
    expect(await bad({ endsAt: now + MIN })).toContain('startsAt')
    expect(await bad({ startsAt: now + MIN, endsAt: now + 2 * MIN, note: 42 })).toEqual(['note'])
    expect(await bad({ startsAt: Number.MAX_SAFE_INTEGER - 1, endsAt: Number.MAX_SAFE_INTEGER })).toBeTruthy()
    expect(await bad({ startsAt: 1e300, endsAt: 1e301 })).toBeTruthy()
    expect(await bad({})).toEqual(expect.arrayContaining(['startsAt', 'endsAt']))
    expect(await database.db.select().from(maintenanceWindows)).toHaveLength(0)
  })

  it('400 invalid_json for a body that is not JSON', async () => {
    const { app } = makeApp()
    const r = await app.request('/api/admin/maintenance', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', origin: ORIGIN },
      body: '{nope',
    })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'invalid_json' })
  })

  it('409 too_many beyond 20 windows that have not ended; ended ones do not count', async () => {
    const { call } = makeApp()
    expect((await call('POST', '/api/admin/maintenance', { body: win(10, 20, 'short') })).status).toBe(201)
    for (let i = 1; i < 20; i++) expect((await call('POST', '/api/admin/maintenance', { body: win(100 + i, 200 + i) })).status, `window ${i}`).toBe(201)
    const over = await call('POST', '/api/admin/maintenance', { body: win(500, 600) })
    expect(over.status).toBe(409)
    expect(over.json).toEqual({ error: 'too_many' })
    expect(await database.db.select().from(maintenanceWindows)).toHaveLength(20)

    now = T0 + 30 * MIN // the first one is over: room for one more
    expect((await call('POST', '/api/admin/maintenance', { body: win(500, 600) })).status).toBe(201)
    expect((await call('POST', '/api/admin/maintenance', { body: win(700, 800) })).status).toBe(409)
  })

  it('deleting a window frees a slot', async () => {
    const { call } = makeApp()
    let first = ''
    for (let i = 0; i < 20; i++) {
      const r = await call('POST', '/api/admin/maintenance', { body: win(10 + i, 20 + i) })
      if (i === 0) first = (r.json as unknown as { item: AdminMaintenanceItem }).item.id
    }
    expect((await call('POST', '/api/admin/maintenance', { body: win(10, 20) })).status).toBe(409)
    expect((await call('DELETE', `/api/admin/maintenance/${first}`)).status).toBe(204)
    expect((await call('POST', '/api/admin/maintenance', { body: win(10, 20) })).status).toBe(201)
  })
})

describe('DELETE /api/admin/maintenance/:id', () => {
  it('removes the window → 204, gone from both lists; a second delete is 404', async () => {
    const { call } = makeApp()
    const a = (await call('POST', '/api/admin/maintenance', { body: win(10, 20, 'a') })).json as unknown as { item: AdminMaintenanceItem }
    const b = (await call('POST', '/api/admin/maintenance', { body: win(30, 40, 'b') })).json as unknown as { item: AdminMaintenanceItem }

    const del = await call('DELETE', `/api/admin/maintenance/${a.item.id}`)
    expect(del.status).toBe(204)
    expect(del.json).toBeNull()

    const pub = (await call('GET', '/api/announcements', { token: null })).json as unknown as AnnouncementsResponse
    expect(pub.maintenance.map((m) => m.id)).toEqual([b.item.id])
    const admin = (await call('GET', '/api/admin/maintenance')).json as unknown as AdminMaintenanceResponse
    expect(admin.items.map((m) => m.id)).toEqual([b.item.id])

    const again = await call('DELETE', `/api/admin/maintenance/${a.item.id}`)
    expect(again.status).toBe(404)
    expect(again.json).toEqual({ error: 'not_found' })
  })

  it('404 not_found for an unknown id and for a malformed one (never 500)', async () => {
    const { call } = makeApp()
    for (const id of ['6f1f6f1e-1b1b-4b1b-8b1b-1b1b1b1b1b1b', 'not-a-uuid', '123', '%27%3B%20DROP%20TABLE%20users%3B--', '6f1f6f1e-1b1b-4b1b-8b1b-1b1b1b1b1b1bX']) {
      const r = await call('DELETE', `/api/admin/maintenance/${id}`)
      expect(r.status, id).toBe(404)
      expect(r.json, id).toEqual({ error: 'not_found' })
    }
  })
})

describe('schema', () => {
  it('the database itself refuses a window that does not end after it starts', async () => {
    const t = new Date(T0)
    await expect(database.db.insert(maintenanceWindows).values({ startsAt: t, endsAt: t })).rejects.toThrow()
    await expect(database.db.insert(maintenanceWindows).values({ startsAt: new Date(T0 + 1), endsAt: t })).rejects.toThrow()
  })
})
