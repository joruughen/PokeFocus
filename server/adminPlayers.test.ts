/** Player support API (docs/admin-plan.md §4, delivery E11): permissions, search, detail and every action with its audit row. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { ADMIN_GRANT_LIMITS } from '../src/game/admin'
import type { AdminPlayerDetail, AdminPlayersResponse, PublicUser, ServerEvent, UserRole } from '../src/game/protocol'
import { COUNTRY_LOCK_DAYS, NAME_LOCK_DAYS } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { activeStudySessions, adminAudit, authSessions, users } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'
import { RateLimiter } from './rate-limit'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'correct horse battery'
const T0 = Date.UTC(2026, 10, 9, 12, 0)
const DAY = 86_400_000

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
})

function makeApp() {
  const limiter = new RateLimiter(clock)
  const bus = new EventBus()
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN })
  const built = createApp({ env, db: database.db, clock, limiter, bus })
  const call = async (method: string, path: string, o: { cookie?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': `10.9.${Math.floor(++seq / 250)}.${seq % 250}` }
    if (o.cookie) headers.cookie = `pf_session=${o.cookie}`
    if (method !== 'GET') {
      headers.origin = ORIGIN
      headers['content-type'] = 'application/json'
    }
    const res = await built.app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(o.body ?? {}) })
    const text = await res.text()
    const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, cookie: sc ? sc[1]! : null }
  }
  return { ...built, call, limiter, bus }
}
type Harness = ReturnType<typeof makeApp>

async function account(h: Harness, role: UserRole = 'player', patch: { trainerName?: string; email?: string } = {}) {
  const n = ++seq
  const email = patch.email ?? `p${n}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const r = await h.call('POST', '/api/auth/register', { body: { email, password: PASSWORD, trainerName: patch.trainerName ?? `Trainer${n}`, country: 'PE' } })
  expect(r.status).toBe(201)
  const user = (r.json as unknown as { user: PublicUser }).user
  if (role !== 'player') await database.db.update(users).set({ role }).where(eq(users.id, user.id))
  return { id: user.id, email, friendCode: user.friendCode, cookie: r.cookie! }
}
type Acct = Awaited<ReturnType<typeof account>>

const act = (h: Harness, u: Acct, action: unknown) => h.call('POST', '/api/game/action', { cookie: u.cookie, body: action })
const withPlayer = async (h: Harness, u: Acct) => {
  expect((await act(h, u, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'squirtle' })).status).toBe(200)
  return u
}
const elevate = async (h: Harness, u: Acct) => expect((await h.call('POST', '/api/admin/reauth', { cookie: u.cookie, body: { password: PASSWORD } })).status).toBe(200)
const auditRows = () => database.db.select().from(adminAudit).orderBy(asc(adminAudit.createdAt))
const base = (id: string) => `/api/admin/players/${id}`
const detail = (r: { json: Record<string, unknown> | null }) => r.json as unknown as AdminPlayerDetail

describe('permissions', () => {
  it('anonymous is 401 and a plain player is 403 on every route', async () => {
    const h = makeApp()
    const p = await account(h)
    const target = await account(h)
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/admin/players?q=abc'],
      ['GET', base(target.id)],
      ['POST', `${base(target.id)}/grant`, { dust: 5, reason: 'because' }],
      ['POST', `${base(target.id)}/unlock`, { field: 'country' }],
      ['POST', `${base(target.id)}/cancel-session`, {}],
      ['POST', `${base(target.id)}/logout-all`, {}],
    ]
    for (const [m, path, body] of routes) {
      expect((await h.call(m, path, { body })).status, `${m} ${path} anon`).toBe(401)
      const r = await h.call(m, path, { cookie: p.cookie, body })
      expect([r.status, r.json?.error], `${m} ${path} player`).toEqual([403, 'forbidden'])
    }
    expect(await auditRows()).toHaveLength(0)
  })

  it('support can read, but grant is admin only (403 forbidden, even when elevated)', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await withPlayer(h, await account(h))
    expect((await h.call('GET', base(t.id), { cookie: s.cookie })).status).toBe(200)
    await elevate(h, s)
    const r = await h.call('POST', `${base(t.id)}/grant`, { cookie: s.cookie, body: { dust: 5, reason: 'support try' } })
    expect([r.status, r.json?.error]).toEqual([403, 'forbidden'])
  })

  it('grant needs the sudo mode: admin without it is 403 elevation_required, with it 200', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const t = await withPlayer(h, await account(h))
    const body = { dust: 10, reason: 'lost reward' }
    const no = await h.call('POST', `${base(t.id)}/grant`, { cookie: a.cookie, body })
    expect([no.status, no.json?.error]).toEqual([403, 'elevation_required'])
    await elevate(h, a)
    expect((await h.call('POST', `${base(t.id)}/grant`, { cookie: a.cookie, body })).status).toBe(200)
    now += 31 * 60_000
    const lapsed = await h.call('POST', `${base(t.id)}/grant`, { cookie: a.cookie, body })
    expect([lapsed.status, lapsed.json?.error]).toEqual([403, 'elevation_required'])
  })

  it('support only changes player accounts; admin may change staff', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const a = await account(h, 'admin')
    const otherStaff = await account(h, 'support')
    for (const path of ['unlock', 'cancel-session', 'logout-all']) {
      const r = await h.call('POST', `${base(otherStaff.id)}/${path}`, { cookie: s.cookie, body: { field: 'country' } })
      expect([r.status, r.json?.error], path).toEqual([403, 'forbidden_target'])
    }
    // Reading staff is fine; an admin can sign a support account out.
    expect((await h.call('GET', base(a.id), { cookie: s.cookie })).status).toBe(200)
    expect((await h.call('POST', `${base(otherStaff.id)}/logout-all`, { cookie: a.cookie })).status).toBe(200)
    expect((await h.call('GET', '/api/auth/me', { cookie: otherStaff.cookie })).status).toBe(401)
  })

  it('malformed or unknown ids are 404', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    expect((await h.call('GET', base('nope'), { cookie: s.cookie })).status).toBe(404)
    expect((await h.call('GET', base('00000000-0000-4000-8000-000000000000'), { cookie: s.cookie })).status).toBe(404)
    expect((await h.call('POST', `${base('00000000-0000-4000-8000-000000000000')}/logout-all`, { cookie: s.cookie })).status).toBe(404)
  })
})

describe('search and detail', () => {
  it('finds by email, trainer name and friend code (case-insensitive), at most 20', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const tag = `zq${Math.random().toString(36).slice(2, 7)}`
    const a = await account(h, 'player', { email: `${tag}.one@example.com`, trainerName: 'Alpha Zed' })
    const b = await account(h, 'player', { trainerName: `Bob ${tag}` })
    const search = async (q: string) => ((await h.call('GET', `/api/admin/players?q=${encodeURIComponent(q)}`, { cookie: s.cookie })).json as unknown as AdminPlayersResponse).items
    expect((await search(tag.toUpperCase())).map((i) => i.id).sort()).toEqual([a.id, b.id].sort())
    expect((await search('alpha zed')).map((i) => i.id)).toEqual([a.id])
    expect((await search(a.friendCode.toLowerCase())).map((i) => i.id)).toContain(a.id)
    const item = (await search(`${tag}.one`))[0]!
    expect(item).toMatchObject({ id: a.id, email: `${tag}.one@example.com`, trainerName: 'Alpha Zed', role: 'player', country: 'PE' })
    expect(item).not.toHaveProperty('passwordHash')
    for (let i = 0; i < 22; i++) await account(h, 'player', { trainerName: `Many${i} ${tag}x` })
    expect(await search(`${tag}x`)).toHaveLength(20)
  })

  it('LIKE wildcards are literal and a too short or too long query is 400', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    await account(h)
    expect(((await h.call('GET', '/api/admin/players?q=%25%25', { cookie: s.cookie })).json as unknown as AdminPlayersResponse).items).toEqual([])
    expect(((await h.call('GET', '/api/admin/players?q=__', { cookie: s.cookie })).json as unknown as AdminPlayersResponse).items).toEqual([])
    for (const q of ['', 'a', ' a ', 'x'.repeat(61)]) {
      const r = await h.call('GET', `/api/admin/players?q=${encodeURIComponent(q)}`, { cookie: s.cookie })
      expect([r.status, r.json?.error], q).toEqual([400, 'invalid_query'])
    }
  })

  it('detail: profile, locks, game summary and browsers; a a fresh account has an empty doc', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await account(h)
    const fresh = detail(await h.call('GET', base(t.id), { cookie: s.cookie }))
    expect(fresh.doc).toMatchObject({ hasPlayer: false, version: 0, team: [], activeSession: null })
    expect(fresh.user).toMatchObject({ id: t.id, nameUnlockAt: null, countryUnlockAt: null })
    expect(fresh.authSessions).toHaveLength(1)

    await withPlayer(h, t)
    await h.call('PATCH', '/api/auth/me', { cookie: t.cookie, body: { trainerName: 'Renamed Once' } })
    await act(h, t, { type: 'start', minutes: 25 })
    const d = detail(await h.call('GET', base(t.id), { cookie: s.cookie }))
    expect(d.user.nameUnlockAt).toBe(T0 + NAME_LOCK_DAYS * DAY)
    expect(d.user.countryUnlockAt).toBeNull()
    expect(d.doc).toMatchObject({ hasPlayer: true, trainerLevel: 1, pokemonCount: 1, activeSession: { plannedMinutes: 25, paused: false, endsAt: T0 + 25 * 60_000 } })
    expect(d.doc!.team).toHaveLength(1)
    expect(d.doc!.team[0]!.speciesSlug).toBe('squirtle')
    expect(d.doc!.history).toEqual([])
    expect(JSON.stringify(d)).not.toMatch(/passwordHash|token/i)
  })
})

describe('grant', () => {
  async function setup() {
    const h = makeApp()
    const a = await account(h, 'admin')
    await elevate(h, a)
    const t = await withPlayer(h, await account(h))
    const grant = (body: unknown, who: Acct = a) => h.call('POST', `${base(t.id)}/grant`, { cookie: who.cookie, body })
    return { h, a, t, grant }
  }

  it('adds items and dust, bumps the version, audits with the reason and notifies the player', async () => {
    const { h, t, a, grant } = await setup()
    const events: ServerEvent[] = []
    h.bus.subscribe({ userId: t.id, sessionId: 'x', send: (e) => events.push(e), close: () => {} })
    const before = detail(await h.call('GET', base(t.id), { cookie: a.cookie }))
    const r = await grant({ items: { 'great-ball': 3, potion: 2 }, dust: 120, reason: 'Lost reward, ticket #42' })
    expect(r.status).toBe(200)
    const d = detail(r)
    expect(d.doc!.dust).toBe(before.doc!.dust + 120)
    expect(d.doc!.inventory['great-ball']).toBe((before.doc!.inventory['great-ball'] ?? 0) + 3)
    expect(d.doc!.inventory.potion).toBe((before.doc!.inventory.potion ?? 0) + 2)
    expect(d.doc!.version).toBe(before.doc!.version + 1)
    expect(events).toEqual([{ type: 'game', version: d.doc!.version }])
    // The player sees it in their own document.
    const snap = (await h.call('GET', '/api/game', { cookie: t.cookie })).json as unknown as { doc: { player: { dust: number } } }
    expect(snap.doc.player.dust).toBe(d.doc!.dust)
    const rows = (await auditRows()).filter((x) => x.action === 'player.grant')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: a.id, targetType: 'user', targetId: t.id, note: 'Lost reward, ticket #42' })
    expect(rows[0]!.after).toMatchObject({ granted: { dust: 120, items: { 'great-ball': 3, potion: 2 } } })
    expect(rows[0]!.before).toMatchObject({ dust: before.doc!.dust })
  })

  it('a message queues the gift window (pendingGifts), is audited and is plain text; without one the gift is silent', async () => {
    const { h, t, a, grant } = await setup()
    const gifts = async () => ((await h.call('GET', '/api/game', { cookie: t.cookie })).json as unknown as { doc: { player: { pendingGifts?: unknown[] } } }).doc.player.pendingGifts
    expect((await grant({ dust: 10, reason: 'silent gift' })).status).toBe(200)
    expect(await gifts()).toBeUndefined()
    const message = { es: 'Perdiste una recompensa, aquí la tienes', en: 'You lost a reward, here it is' }
    expect((await grant({ items: { potion: 2 }, dust: 30, message, reason: 'Ticket #7' })).status).toBe(200)
    expect(await gifts()).toEqual([{ items: { potion: 2 }, dust: 30, message, at: T0 }])
    const row = (await auditRows()).filter((x) => x.action === 'player.grant').at(-1)!
    expect(row.after).toMatchObject({ granted: { dust: 30, items: { potion: 2 } }, message })
    expect(row.note).toBe('Ticket #7')
    // Only one language is fine; the older gifts stay, at most 10 are kept.
    for (let i = 0; i < 11; i++) expect((await grant({ dust: 1, message: { en: `gift ${i}` }, reason: 'many gifts' })).status).toBe(200)
    const list = (await gifts()) as { message: { en: string } }[]
    expect(list).toHaveLength(10)
    expect(list.at(-1)!.message).toEqual({ en: 'gift 10' })
    void a
  })

  it('rejects bad messages with 400 invalid_body and writes nothing', async () => {
    const { h, t, a, grant } = await setup()
    const v0 = detail(await h.call('GET', base(t.id), { cookie: a.cookie })).doc!.version
    const bad: unknown[] = [
      { es: '<script>alert(1)</script>' },
      { en: 'a <b>bold</b> claim' },
      { es: 'x'.repeat(121) },
      { es: '   ', en: '' },
      {},
      { es: 'two\nlines' },
      { fr: 'bonjour' },
      'just text',
    ]
    for (const message of bad) {
      const r = await grant({ dust: 5, message, reason: 'valid reason' })
      expect([r.status, r.json?.error], JSON.stringify(message)).toEqual([400, 'invalid_body'])
    }
    expect((await auditRows()).filter((x) => x.action === 'player.grant')).toHaveLength(0)
    expect(detail(await h.call('GET', base(t.id), { cookie: a.cookie })).doc!.version).toBe(v0)
    // The limit itself is allowed.
    expect((await grant({ dust: 5, message: { es: 'x'.repeat(120) }, reason: 'valid reason' })).status).toBe(200)
  })

  it('rejects bad grants with 400 and writes nothing (no audit row, same version)', async () => {
    const { h, t, a, grant } = await setup()
    const v0 = detail(await h.call('GET', base(t.id), { cookie: a.cookie })).doc!.version
    const reason = 'valid reason'
    const cases: [unknown, string][] = [
      [{ reason }, 'empty_grant'],
      [{ items: {}, reason }, 'empty_grant'],
      [{ items: { 'not-an-item': 1 }, reason }, 'unknown_item'],
      [{ items: { potion: 0 }, reason }, 'invalid_amount'],
      [{ items: { potion: -3 }, reason }, 'invalid_amount'],
      [{ items: { potion: 1.5 }, reason }, 'invalid_amount'],
      [{ dust: -5, reason }, 'invalid_amount'],
      [{ items: { potion: ADMIN_GRANT_LIMITS.maxPerItem + 1 }, reason }, 'amount_too_large'],
      [{ dust: ADMIN_GRANT_LIMITS.maxDust + 1, reason }, 'amount_too_large'],
    ]
    for (const [body, code] of cases) {
      const r = await grant(body)
      expect([r.status, r.json?.error], JSON.stringify(body).slice(0, 60)).toEqual([400, code])
    }
    // The caps themselves are allowed.
    expect((await grant({ items: { potion: ADMIN_GRANT_LIMITS.maxPerItem }, dust: ADMIN_GRANT_LIMITS.maxDust, reason })).status).toBe(200)
    expect((await auditRows()).filter((x) => x.action === 'player.grant')).toHaveLength(1)
    expect(detail(await h.call('GET', base(t.id), { cookie: a.cookie })).doc!.version).toBe(v0 + 1)
  })

  it('too many item kinds is 400 too_many_items', async () => {
    const { h, t, a } = await setup()
    const slugs = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball', 'potion', 'super-potion', 'hyper-potion', 'max-potion', 'revive', 'full-restore', 'tera-shard']
    const { gameData } = await import('../src/data')
    const known = slugs.filter((s) => gameData.items.some((i) => i.slug === s)).concat(gameData.items.map((i) => i.slug)).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, ADMIN_GRANT_LIMITS.maxItemKinds + 1)
    expect(known).toHaveLength(ADMIN_GRANT_LIMITS.maxItemKinds + 1)
    const r = await h.call('POST', `${base(t.id)}/grant`, { cookie: a.cookie, body: { items: Object.fromEntries(known.map((s) => [s, 1])), reason: 'valid reason' } })
    expect([r.status, r.json?.error]).toEqual([400, 'too_many_items'])
  })

  it('the reason is required (5..280 chars) and the body must be valid', async () => {
    const { grant } = await setup()
    for (const body of [{ dust: 5 }, { dust: 5, reason: '' }, { dust: 5, reason: 'abc' }, { dust: 5, reason: 'x'.repeat(ADMIN_GRANT_LIMITS.reasonMax + 1) }, { dust: 'lots', reason: 'valid reason' }]) {
      const r = await grant(body)
      expect([r.status, r.json?.error], JSON.stringify(body).slice(0, 50)).toEqual([400, 'invalid_body'])
    }
    expect((await auditRows()).filter((x) => x.action === 'player.grant')).toHaveLength(0)
  })

  it('an account that has not chosen a starter yet is 409 no_player', async () => {
    const { h, a } = await setup()
    const nodoc = await account(h)
    const r = await h.call('POST', `${base(nodoc.id)}/grant`, { cookie: a.cookie, body: { dust: 5, reason: 'valid reason' } })
    expect([r.status, r.json?.error]).toEqual([409, 'no_player'])
    expect((await auditRows()).filter((x) => x.action === 'player.grant')).toHaveLength(0)
  })

  it('grants are rate limited per admin (adminGrant, 20 / 15 min)', async () => {
    const { h, a, t, grant } = await setup()
    for (let i = 0; i < 20; i++) expect((await grant({ dust: 1, reason: 'valid reason' })).status).toBe(200)
    const r = await grant({ dust: 1, reason: 'valid reason' })
    expect([r.status, r.json?.error]).toEqual([429, 'rate_limited'])
    expect(detail(await h.call('GET', base(t.id), { cookie: a.cookie })).doc!.dust).toBeGreaterThanOrEqual(20)
  })
})

describe('unlock', () => {
  it('clears the 30-day name and country locks so the player can change them again; audited', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await account(h)
    const patch = (body: unknown) => h.call('PATCH', '/api/auth/me', { cookie: t.cookie, body })
    expect((await patch({ trainerName: 'First Name', country: 'CL' })).status).toBe(200)
    expect((await patch({ trainerName: 'Second Name' })).json?.error).toBe('name_locked')
    expect((await patch({ country: 'AR' })).json?.error).toBe('country_locked')

    const name = await h.call('POST', `${base(t.id)}/unlock`, { cookie: s.cookie, body: { field: 'trainerName', reason: 'typo at sign-up' } })
    expect(name.status).toBe(200)
    expect(detail(name).user).toMatchObject({ nameUnlockAt: null, countryUnlockAt: T0 + COUNTRY_LOCK_DAYS * DAY })
    expect((await patch({ trainerName: 'Second Name' })).status).toBe(200)
    expect((await patch({ country: 'AR' })).json?.error).toBe('country_locked')

    expect((await h.call('POST', `${base(t.id)}/unlock`, { cookie: s.cookie, body: { field: 'country' } })).status).toBe(200)
    expect((await patch({ country: 'AR' })).status).toBe(200)

    const rows = (await auditRows()).filter((x) => x.action === 'player.unlock')
    expect(rows.map((x) => x.actorId)).toEqual([s.id, s.id])
    expect(rows[0]).toMatchObject({ targetId: t.id, note: 'typo at sign-up', after: { trainerNameChangedAt: null } })
    expect(rows[0]!.before).toEqual({ trainerNameChangedAt: T0 })
    expect(rows[1]).toMatchObject({ after: { countryChangedAt: null }, note: null })
  })

  it('clears the timezone lock stored in the game document (version + 1, game event)', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await withPlayer(h, await account(h))
    expect((await act(h, t, { type: 'updateProfile', patch: { timezone: -300 } })).status).toBe(200)
    expect((await act(h, t, { type: 'updateProfile', patch: { timezone: 60 } })).json?.error).toBe('timezone_locked')
    const events: ServerEvent[] = []
    h.bus.subscribe({ userId: t.id, sessionId: 'x', send: (e) => events.push(e), close: () => {} })
    const before = detail(await h.call('GET', base(t.id), { cookie: s.cookie }))
    expect(before.doc!.timezoneUnlockAt).not.toBeNull()
    const r = await h.call('POST', `${base(t.id)}/unlock`, { cookie: s.cookie, body: { field: 'timezone' } })
    expect(r.status).toBe(200)
    expect(detail(r).doc).toMatchObject({ timezoneUnlockAt: null, version: before.doc!.version + 1 })
    expect(events).toEqual([{ type: 'game', version: before.doc!.version + 1 }])
    expect((await act(h, t, { type: 'updateProfile', patch: { timezone: 60 } })).status).toBe(200)
    expect((await auditRows()).filter((x) => x.action === 'player.unlock')).toHaveLength(1)
  })

  it('409 not_locked when there is nothing to clear (never changed, or the lock already ended); 409 no_player for timezone without a player', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await account(h)
    const unlock = (field: string) => h.call('POST', `${base(t.id)}/unlock`, { cookie: s.cookie, body: { field } })
    expect([(await unlock('trainerName')).json?.error, (await unlock('country')).json?.error]).toEqual(['not_locked', 'not_locked'])
    expect((await unlock('timezone')).json?.error).toBe('no_player')
    await h.call('PATCH', '/api/auth/me', { cookie: t.cookie, body: { trainerName: 'Changed Name' } })
    now += NAME_LOCK_DAYS * DAY + 1
    await database.db.update(authSessions).set({ expiresAt: new Date(now + 5 * DAY) }) // the sessions outlive the jump in time
    expect((await unlock('trainerName')).json?.error).toBe('not_locked')
    expect((await h.call('POST', `${base(t.id)}/unlock`, { cookie: s.cookie, body: { field: 'email' } })).json?.error).toBe('invalid_body')
    expect((await auditRows()).filter((x) => x.action === 'player.unlock')).toHaveLength(0)
  })
})

describe('cancel-session', () => {
  it('cancels a stuck session through the player reducer: doc, active_study_sessions mirror and event; audited', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await withPlayer(h, await account(h))
    expect((await act(h, t, { type: 'start', minutes: 25 })).status).toBe(200)
    expect(await database.db.select().from(activeStudySessions).where(eq(activeStudySessions.userId, t.id))).toHaveLength(1)
    const events: ServerEvent[] = []
    h.bus.subscribe({ userId: t.id, sessionId: 'x', send: (e) => events.push(e), close: () => {} })
    const before = detail(await h.call('GET', base(t.id), { cookie: s.cookie }))
    const r = await h.call('POST', `${base(t.id)}/cancel-session`, { cookie: s.cookie, body: { reason: 'stuck after crash' } })
    expect(r.status).toBe(200)
    expect(detail(r).doc).toMatchObject({ activeSession: null, version: before.doc!.version + 1 })
    expect(await database.db.select().from(activeStudySessions).where(eq(activeStudySessions.userId, t.id))).toHaveLength(0)
    expect(events).toEqual([{ type: 'game', version: before.doc!.version + 1 }])
    // The player can start again right away.
    expect((await act(h, t, { type: 'start', minutes: 25 })).status).toBe(200)
    const rows = (await auditRows()).filter((x) => x.action === 'player.cancel_session')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: s.id, targetId: t.id, note: 'stuck after crash' })
    expect(rows[0]!.before).toMatchObject({ sessionId: before.doc!.activeSession!.id, plannedMinutes: 25 })
  })

  it('409 no_session when none is running, and nothing is audited', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await withPlayer(h, await account(h))
    const r = await h.call('POST', `${base(t.id)}/cancel-session`, { cookie: s.cookie })
    expect([r.status, r.json?.error]).toEqual([409, 'no_session'])
    expect(await auditRows()).toHaveLength(0)
  })
})

describe('logout-all', () => {
  it('closes every session of the player (cookie dead, rows gone), tells open streams, and audits the count', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await account(h)
    const second = await h.call('POST', '/api/auth/login', { body: { email: t.email, password: PASSWORD } })
    expect(second.status).toBe(200)
    const sessionIds = (await database.db.select().from(authSessions).where(eq(authSessions.userId, t.id))).map((x) => x.id)
    expect(sessionIds).toHaveLength(2)
    const events: ServerEvent[] = []
    h.bus.subscribe({ userId: t.id, sessionId: sessionIds[0]!, send: (e) => events.push(e), close: () => {} })

    const r = await h.call('POST', `${base(t.id)}/logout-all`, { cookie: s.cookie, body: { reason: 'account compromised' } })
    expect(r.status).toBe(200)
    expect(detail(r).authSessions).toEqual([])
    expect((await h.call('GET', '/api/auth/me', { cookie: t.cookie })).status).toBe(401)
    expect((await h.call('GET', '/api/auth/me', { cookie: second.cookie! })).status).toBe(401)
    expect(events).toEqual([{ type: 'logout' }])
    // The staff session is untouched and the player can log in again.
    expect((await h.call('GET', '/api/admin/me', { cookie: s.cookie })).status).toBe(200)
    expect((await h.call('POST', '/api/auth/login', { body: { email: t.email, password: PASSWORD } })).status).toBe(200)
    const rows = (await auditRows()).filter((x) => x.action === 'player.logout_all')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: s.id, targetId: t.id, after: { sessions: 2 }, note: 'account compromised' })
  })

  it('your own account is 409 self_target, and a player with no sessions changes nothing (no audit)', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await account(h)
    const self = await h.call('POST', `${base(s.id)}/logout-all`, { cookie: s.cookie })
    expect([self.status, self.json?.error]).toEqual([409, 'self_target'])
    await database.db.delete(authSessions).where(eq(authSessions.userId, t.id))
    expect((await h.call('POST', `${base(t.id)}/logout-all`, { cookie: s.cookie })).status).toBe(200)
    expect(await auditRows()).toHaveLength(0)
  })
})

describe('rate limit', () => {
  it('mutations of one staff user are limited to 60 / 15 min (429 + Retry-After)', async () => {
    const h = makeApp()
    const s = await account(h, 'support')
    const t = await account(h)
    for (let i = 0; i < 60; i++) expect((await h.call('POST', `${base(t.id)}/logout-all`, { cookie: s.cookie })).status).toBe(200)
    const r = await h.call('POST', `${base(t.id)}/logout-all`, { cookie: s.cookie })
    expect([r.status, r.json?.error]).toEqual([429, 'rate_limited'])
    now += 16 * 60_000
    expect((await h.call('POST', `${base(t.id)}/logout-all`, { cookie: s.cookie })).status).toBe(200)
  })
})
