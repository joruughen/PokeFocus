/** Live events backend (docs/admin-plan.md §3, §4, §6; delivery E8): admin CRUD, uploads, /media, /api/live-events, ContentService integration. */
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type {
  AdminEventResponse,
  AdminEventsResponse,
  AdminSpawnPreview,
  AdminUploadResponse,
  AdminUploadsResponse,
  EventOverlayBody,
  LiveEventsResponse,
  PublicUser,
  ServerEvent,
  UserRole,
} from '../src/game/protocol'
import { createApp } from './app'
import { contentBody } from './content/service'
import { openDatabase, type Database } from './db/client'
import { adminAudit, contentVersions, liveEventRevisions, liveEvents, uploads, users } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'
import { RateLimiter } from './rate-limit'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'correct horse battery'
const T0 = Date.UTC(2026, 10, 9, 12, 0)
const HOUR = 3_600_000
const DAY = 86_400_000

let database: Database
let uploadsDir: string
let now = T0
const clock = () => now
let seq = 0

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  uploadsDir = mkdtempSync(join(tmpdir(), 'pf-events-uploads-'))
}, 60_000)

afterAll(async () => {
  await database?.close()
  rmSync(uploadsDir, { recursive: true, force: true })
})

beforeEach(async () => {
  now = T0
  await database.db.delete(adminAudit)
  await database.db.delete(liveEvents) // revisions go with them
  await database.db.delete(uploads)
  await database.db.delete(contentVersions)
})

function makeApp() {
  const limiter = new RateLimiter(clock)
  const bus = new EventBus()
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, UPLOADS_DIR: uploadsDir })
  const built = createApp({ env, db: database.db, clock, limiter, bus })
  const ip = () => `10.9.${Math.floor(++seq / 250)}.${seq % 250}`
  const call = async (method: string, path: string, o: { cookie?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': ip() }
    if (o.cookie) headers.cookie = `pf_session=${o.cookie}`
    if (method !== 'GET') {
      headers.origin = ORIGIN
      headers['content-type'] = 'application/json'
    }
    const res = await built.app.request(path, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(o.body ?? {}) })
    const text = await res.text()
    const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, cookie: sc ? sc[1]! : null }
  }
  /** POST /api/admin/uploads with a raw body. */
  const upload = async (body: Uint8Array | Buffer, o: { cookie?: string; type?: string; origin?: string | null; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': ip(), 'content-type': o.type ?? 'image/png', ...o.headers }
    if (o.origin !== null) headers.origin = o.origin ?? ORIGIN
    if (o.cookie) headers.cookie = `pf_session=${o.cookie}`
    const res = await built.app.request('/api/admin/uploads', { method: 'POST', headers, body: new Uint8Array(body) })
    const text = await res.text()
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null }
  }
  /** GET any path without the JSON plumbing (media). */
  const raw = (path: string, init: RequestInit = {}) => built.app.request(path, { ...init, headers: { 'x-forwarded-for': ip(), ...(init.headers as Record<string, string>) } })
  return { ...built, call, upload, raw, limiter, bus }
}
type Harness = ReturnType<typeof makeApp>

async function account(h: Harness, role: UserRole = 'player') {
  const n = ++seq
  const r = await h.call('POST', '/api/auth/register', { body: { email: `e${n}-${Math.random().toString(36).slice(2, 8)}@example.com`, password: PASSWORD, trainerName: `Events${n}`, country: 'PE' } })
  expect(r.status).toBe(201)
  const user = (r.json as unknown as { user: PublicUser }).user
  if (role !== 'player') await database.db.update(users).set({ role }).where(eq(users.id, user.id))
  return { id: user.id, cookie: r.cookie! }
}
type Acct = Awaited<ReturnType<typeof account>>

const elevate = async (h: Harness, u: Acct) => expect((await h.call('POST', '/api/admin/reauth', { cookie: u.cookie, body: { password: PASSWORD } })).status).toBe(200)
const auditActions = async () => (await database.db.select().from(adminAudit).orderBy(asc(adminAudit.createdAt))).map((r) => r.action)
const E = '/api/admin/events'
const U = '/api/admin/uploads'
const asEvent = (r: { json: Record<string, unknown> | null }) => (r.json as unknown as AdminEventResponse).event

const overlay = (over: Partial<EventOverlayBody> = {}): EventOverlayBody => ({ featured: [{ species: 'pikachu', weightMult: 2 }], drops: [], missions: [], ...over })
const payload = (over: Record<string, unknown> = {}) => ({
  slug: 'spring-fest',
  name: { es: 'Fiesta de primavera', en: 'Spring fest' },
  description: { es: 'Pikachu aparece más', en: 'Pikachu shows up more' },
  startsAt: T0 + HOUR,
  endsAt: T0 + DAY,
  overlay: overlay(),
  ...over,
})

const png = (w = 640, h = 360, color = 'red') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()

/** An admin (with sudo) and a draft event. */
async function adminWithEvent(h: Harness, over: Record<string, unknown> = {}) {
  const a = await account(h, 'admin')
  await elevate(h, a)
  const created = await h.call('POST', E, { cookie: a.cookie, body: payload(over) })
  expect(created.status, JSON.stringify(created.json)).toBe(201)
  return { a, id: asEvent(created).id }
}

describe('permissions', () => {
  it('anonymous is 401, a plain player and support 403, on every events and uploads route', async () => {
    const h = makeApp()
    const p = await account(h)
    const s = await account(h, 'support')
    const id = '11111111-1111-4111-8111-111111111111'
    const routes: [string, string, unknown?][] = [
      ['GET', E],
      ['POST', E, payload()],
      ['GET', `${E}/${id}`],
      ['PUT', `${E}/${id}`, { name: { es: 'a', en: 'a' } }],
      ['DELETE', `${E}/${id}`],
      ['POST', `${E}/${id}/publish`, {}],
      ['POST', `${E}/${id}/archive`, {}],
      ['GET', U],
      ['DELETE', `${U}/${id}`],
    ]
    for (const [m, path, body] of routes) {
      expect((await h.call(m, path, { body })).status, `${m} ${path} anon`).toBe(401)
      for (const who of [p, s]) {
        const r = await h.call(m, path, { cookie: who.cookie, body })
        expect([r.status, r.json?.error], `${m} ${path}`).toEqual([403, 'forbidden'])
      }
    }
    expect((await h.upload(await png(), {})).status).toBe(401)
    expect((await h.upload(await png(), { cookie: p.cookie })).status).toBe(403)
    expect((await h.upload(await png(), { cookie: s.cookie })).status).toBe(403)
  })

  it('publish and archive (and edits of a published event) need the sudo mode', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const created = await h.call('POST', E, { cookie: a.cookie, body: payload() })
    expect(created.status).toBe(201)
    const id = asEvent(created).id
    for (const path of [`${E}/${id}/publish`, `${E}/${id}/archive`]) {
      const r = await h.call('POST', path, { cookie: a.cookie, body: {} })
      expect([r.status, r.json?.error], path).toEqual([403, 'elevation_required'])
    }
    expect((await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { name: { es: 'Otra', en: 'Other' } } })).status).toBe(200) // a draft needs no sudo
    await elevate(h, a)
    expect((await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    now += 31 * 60_000 // sudo lapses
    const r = await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { name: { es: 'Más', en: 'More' } } })
    expect([r.status, r.json?.error]).toEqual([403, 'elevation_required'])
  })
})

describe('drafts', () => {
  it('creates, reads, lists, updates and deletes a draft; every write is audited', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h)
    const got = asEvent(await h.call('GET', `${E}/${id}`, { cookie: a.cookie }))
    expect(got).toMatchObject({
      id,
      slug: 'spring-fest',
      status: 'draft',
      startsAt: T0 + HOUR,
      endsAt: T0 + DAY,
      revision: 1,
      imageId: null,
      image: null,
      active: false,
      scheduled: false,
      publishedAt: null,
      validation: { ok: true, smoke: false },
    })
    expect(got.createdBy).toMatchObject({ id: a.id })
    const list = (await h.call('GET', E, { cookie: a.cookie })).json as unknown as AdminEventsResponse
    expect(list.items.map((e) => e.id)).toEqual([id])
    expect(((await h.call('GET', `${E}?status=published`, { cookie: a.cookie })).json as unknown as AdminEventsResponse).items).toEqual([])

    const upd = await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { slug: 'summer-fest', overlay: overlay({ featured: [{ species: 'eevee', weightMult: 3 }] }) } })
    expect(upd.status).toBe(200)
    expect(asEvent(upd)).toMatchObject({ slug: 'summer-fest', revision: 1, overlay: { featured: [{ species: 'eevee', weightMult: 3 }] } })
    expect((await h.call('DELETE', `${E}/${id}`, { cookie: a.cookie })).status).toBe(204)
    expect((await h.call('GET', `${E}/${id}`, { cookie: a.cookie })).status).toBe(404)
    expect(await auditActions()).toEqual(['admin.reauth', 'event.create', 'event.update', 'event.delete'])
  })

  it('rejects malformed bodies (400), bad dates (400), duplicated slugs (409) and unknown images (422)', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h)
    const post = (body: unknown) => h.call('POST', E, { cookie: a.cookie, body })
    expect((await post({ ...payload({ slug: 'other' }), overlay: { ...overlay(), config: {} } })).json).toMatchObject({ error: 'invalid_body' })
    expect((await post(payload({ slug: 'Bad Slug' }))).json).toMatchObject({ error: 'invalid_body', fields: ['slug'] })
    expect((await post(payload({ slug: 'x', name: { es: '', en: 'x' } }))).status).toBe(400)
    expect((await post(payload({ slug: 'x', startsAt: T0 + DAY, endsAt: T0 + HOUR }))).json).toMatchObject({ error: 'invalid_dates' })
    expect((await post(payload({ slug: 'x', overlay: overlay({ featured: [{ species: 'pikachu', weightMult: 50 }] }) }))).status).toBe(400)
    expect((await post(payload())).json).toMatchObject({ error: 'slug_taken' })
    expect((await post(payload({ slug: 'x', imageId: '22222222-2222-4222-8222-222222222222' }))).json).toMatchObject({ error: 'unknown_image' })
    expect((await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: {} })).status).toBe(400)
    expect((await h.call('GET', `${E}/not-a-uuid`, { cookie: a.cookie })).status).toBe(404)
    // a second event cannot take the first one's slug by renaming
    const second = await h.call('POST', E, { cookie: a.cookie, body: payload({ slug: 'second' }) })
    expect((await h.call('PUT', `${E}/${asEvent(second).id}`, { cookie: a.cookie, body: { slug: 'spring-fest' } })).json).toMatchObject({ error: 'slug_taken' })
  })

  it('a draft with semantic errors is saved with its validation; publishing it is a 422', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h, { overlay: overlay({ featured: [{ species: 'missingno', weightMult: 2 }] }) })
    const ev = asEvent(await h.call('GET', `${E}/${id}`, { cookie: a.cookie }))
    expect(ev.validation).toMatchObject({ ok: false })
    expect(ev.validation!.errors).toContainEqual(expect.objectContaining({ code: 'unknown_species', path: 'featured.0.species' }))
    const r = await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })
    expect([r.status, r.json?.error]).toEqual([422, 'validation_failed'])
    expect((r.json as { errors: { code: string }[] }).errors.map((e) => e.code)).toContain('unknown_species')
    expect(asEvent(await h.call('GET', `${E}/${id}`, { cookie: a.cookie })).status).toBe('draft')
  })

  it('only drafts can be deleted', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h)
    expect((await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect((await h.call('DELETE', `${E}/${id}`, { cookie: a.cookie })).json).toMatchObject({ error: 'not_draft' })
    expect((await h.call('POST', `${E}/${id}/archive`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect((await h.call('DELETE', `${E}/${id}`, { cookie: a.cookie })).json).toMatchObject({ error: 'not_draft' })
  })
})

describe('publish, edit and archive', () => {
  it('publishing a draft schedules it (future start): revision 1, public listing, content not active yet', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h)
    expect(((await h.call('GET', '/api/live-events')).json as unknown as LiveEventsResponse).upcoming).toEqual([])
    const r = await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: { note: 'go' } })
    expect(r.status).toBe(200)
    expect(asEvent(r)).toMatchObject({ status: 'published', scheduled: true, active: false, revision: 1, publishedAt: T0, validation: { ok: true, smoke: true } })
    expect(asEvent(r).publishedBy).toMatchObject({ id: a.id })
    const pub = (await h.call('GET', '/api/live-events')).json as unknown as LiveEventsResponse
    expect(pub.active).toEqual([])
    expect(pub.upcoming.map((e) => e.slug)).toEqual(['spring-fest'])
    expect((await h.deps.content.current(now)).ctx.events).toEqual([])
    expect(await database.db.select().from(liveEventRevisions)).toMatchObject([{ eventId: id, revision: 1 }])
    expect(await auditActions()).toEqual(['admin.reauth', 'event.create', 'event.publish'])
    // not a draft any more
    expect((await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })).json).toMatchObject({ error: 'not_draft' })
  })

  it('refuses dates already over or more than 60 days ahead', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h, { startsAt: T0 - 2 * DAY, endsAt: T0 - DAY })
    expect((await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })).json).toMatchObject({ error: 'invalid_dates', reason: 'ended' })
    const far = await h.call('POST', E, { cookie: a.cookie, body: payload({ slug: 'far', startsAt: T0 + 90 * DAY, endsAt: T0 + 91 * DAY }) })
    expect((await h.call('POST', `${E}/${asEvent(far).id}/publish`, { cookie: a.cookie, body: {} })).json).toMatchObject({ error: 'invalid_dates', reason: 'too_far' })
  })

  it('big boosts need confirm (409 confirm_required) both to publish and to edit a published event', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h, { overlay: overlay({ legendaryChanceMult: 5 }) })
    const first = await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })
    expect([first.status, first.json?.error]).toEqual([409, 'confirm_required'])
    expect((await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: { confirm: true } })).status).toBe(200)
    const edit = await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { overlay: overlay({ legendaryChanceMult: 8 }) } })
    expect([edit.status, edit.json?.error]).toEqual([409, 'confirm_required'])
    const ok = await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { overlay: overlay({ legendaryChanceMult: 8 }), confirm: true } })
    expect(ok.status).toBe(200)
    expect(asEvent(ok)).toMatchObject({ revision: 2, overlay: { legendaryChanceMult: 8 } })
  })

  it('editing a published event bumps the revision, keeps a snapshot, locks the slug and applies at once', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h)
    await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })
    now = T0 + 2 * HOUR // the event is running
    await elevate(h, a) // sudo lasts 30 minutes
    const before = await h.deps.content.current(now)
    expect(before.ctx.spawn.get('pikachu')?.weightMult).toBe(2)
    const r = await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { overlay: overlay({ featured: [{ species: 'pikachu', weightMult: 3 }] }) } })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect(asEvent(r)).toMatchObject({ revision: 2, status: 'published', active: true, validation: { smoke: true } })
    const after = await h.deps.content.current(now)
    expect(after.ctx.spawn.get('pikachu')?.weightMult).toBe(3)
    expect(after.hash).not.toBe(before.hash)
    expect(after.eventRevs).toEqual({ [id]: 2 })
    const revs = await database.db.select().from(liveEventRevisions).orderBy(asc(liveEventRevisions.revision))
    expect(revs.map((x) => x.revision)).toEqual([1, 2])
    expect(revs[1]!.snapshot).toMatchObject({ overlay: { featured: [{ weightMult: 3 }] } })
    expect((await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { slug: 'renamed' } })).json).toMatchObject({ error: 'slug_locked' })
    expect(await auditActions()).toEqual(['admin.reauth', 'event.create', 'event.publish', 'admin.reauth', 'event.update'])
  })

  it('archiving removes the event from play and from the public API; an archived event cannot be edited', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h, {
      overlay: overlay({ drops: [{ item: 'golden-banana', perWaveChance: 0.2, max: 3 }], items: { 'golden-banana': { names: { es: 'Plátano dorado', en: 'Golden banana' } } } }),
    })
    await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })
    now = T0 + 2 * HOUR
    await elevate(h, a)
    expect((await h.deps.content.current(now)).ctx.events.map((e) => e.id)).toEqual([id])
    expect(((await h.call('GET', '/api/live-events')).json as unknown as LiveEventsResponse).active).toHaveLength(1)

    const r = await h.call('POST', `${E}/${id}/archive`, { cookie: a.cookie, body: { note: 'oops' } })
    expect(r.status).toBe(200)
    expect(asEvent(r)).toMatchObject({ status: 'archived', active: false })
    const cur = await h.deps.content.current(now)
    expect(cur.ctx.events).toEqual([])
    expect(cur.ctx.spawn.has('pikachu')).toBe(false)
    // …but the inventory keeps naming its item
    expect(contentBody(cur).eventItems).toHaveProperty('golden-banana')
    expect(await h.call('GET', '/api/live-events').then((x) => x.json)).toMatchObject({ active: [], upcoming: [], past: [] })
    expect((await h.call('PUT', `${E}/${id}`, { cookie: a.cookie, body: { name: { es: 'a', en: 'a' } } })).json).toMatchObject({ error: 'not_editable' })
    expect((await h.call('POST', `${E}/${id}/archive`, { cookie: a.cookie, body: {} })).json).toMatchObject({ error: 'not_published' })
    expect(await auditActions()).toContain('event.archive')
  })
})

describe('ContentService integration', () => {
  it('a published event enters the resolution while it runs, then leaves; SSE announces both edges', async () => {
    const h = makeApp()
    const seen: ServerEvent[] = []
    h.bus.subscribe({ userId: 'w', sessionId: 's', send: (e) => seen.push(e), close: () => {} })
    await h.deps.content.check() // boot: remembers the base
    const { a, id } = await adminWithEvent(h)
    expect((await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect(seen).toEqual([]) // scheduled for later and with no items: the hash did not change

    now = T0 + HOUR // the event starts
    const started = await h.deps.content.check(now)
    expect(started).toMatch(/^[a-f0-9]{64}$/)
    const live = await h.deps.content.current(now)
    expect(live.hash).toBe(started)
    expect(live.ctx.events.map((e) => e.id)).toEqual([id])
    expect(live.ctx.spawn.get('pikachu')?.weightMult).toBe(2)
    expect((await h.call('GET', '/api/content')).json).toMatchObject({ hash: started, events: [{ id, slug: 'spring-fest', startsAt: T0 + HOUR, endsAt: T0 + DAY }] })
    expect(seen).toEqual([{ type: 'content', hash: started }])

    now = T0 + DAY // the event ends (endsAt is exclusive)
    expect(await h.deps.content.check(now)).toBe('base')
    expect(seen).toEqual([
      { type: 'content', hash: started },
      { type: 'content', hash: 'base' },
    ])
    expect((await h.deps.content.current(now)).ctx.events).toEqual([])
    // the hash of the running event still resolves (sessions pinned to it)
    expect((await h.deps.content.byHash(started!))?.ctx.events.map((e) => e.id)).toEqual([id])
  })

  it('publishing an event with own items is announced at once (their names are known from then on)', async () => {
    const h = makeApp()
    const seen: ServerEvent[] = []
    h.bus.subscribe({ userId: 'w', sessionId: 's', send: (e) => seen.push(e), close: () => {} })
    await h.deps.content.check()
    const { a, id } = await adminWithEvent(h, { overlay: overlay({ items: { 'golden-banana': { names: { es: 'Plátano', en: 'Banana' } } }, drops: [{ item: 'golden-banana', perWaveChance: 0.1, max: 2 }] }) })
    await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })
    expect(seen).toHaveLength(1)
    now = T0 + 3 * DAY // long over: the item stays named
    expect(contentBody(await h.deps.content.current(now)).eventItems).toHaveProperty('golden-banana')
  })

  it('drafts never reach the resolution or the public API', async () => {
    const h = makeApp()
    await adminWithEvent(h)
    now = T0 + 2 * HOUR
    expect((await h.deps.content.current(now)).hash).toBe('base')
    expect((await h.call('GET', '/api/live-events')).json).toMatchObject({ active: [], upcoming: [], past: [] })
    expect((await h.call('GET', '/api/content')).json).toMatchObject({ hash: 'base', events: [] })
  })

  it('reads the events through the transaction it is given (no deadlock on the single PGlite connection)', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h)
    await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })
    now = T0 + 2 * HOUR + 5 * 60_000 // past the service's reload period: it queries again
    const hit = await database.db.transaction(async (tx) => (await h.deps.content.current(now, tx)).ctx.events.map((e) => e.id))
    expect(hit).toEqual([id])
  })

  it('the admin spawn preview can include any event, even a draft', async () => {
    const h = makeApp()
    const { a, id } = await adminWithEvent(h, { overlay: overlay({ featured: [{ species: 'pikachu', weightMult: 3 }] }) })
    const share = async (q: string) => {
      const r = await h.call('GET', `/api/admin/content/spawn-preview?${q}`, { cookie: a.cookie })
      expect(r.status, JSON.stringify(r.json)).toBe(200)
      return (r.json as unknown as AdminSpawnPreview).species.find((s) => s.slug === 'pikachu')
    }
    const without = await share('hour=12&weather=clear&trainerLevel=10')
    const withEvent = await share(`hour=12&weather=clear&trainerLevel=10&eventId=${id}`)
    expect(withEvent!.weightMult).toBe(3)
    expect(withEvent!.probability).toBeGreaterThan(without?.probability ?? 0)
    expect((await h.call('GET', `/api/admin/content/spawn-preview?eventId=33333333-3333-4333-8333-333333333333`, { cookie: a.cookie })).status).toBe(404)
    expect((await h.call('GET', `/api/admin/content/spawn-preview?eventId=nope`, { cookie: a.cookie })).status).toBe(400)
  })

  it('overlapping events resolve together, in (startsAt, id) order', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    await elevate(h, a)
    const ids: string[] = []
    for (const [slug, start, species] of [['late', T0 + 2 * HOUR, 'eevee'], ['early', T0 + HOUR, 'pikachu']] as const) {
      const c = await h.call('POST', E, { cookie: a.cookie, body: payload({ slug, startsAt: start, overlay: overlay({ featured: [{ species, weightMult: 3 }] }) }) })
      ids.push(asEvent(c).id)
      expect((await h.call('POST', `${E}/${ids.at(-1)}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    }
    const cur = await h.deps.content.current(T0 + 3 * HOUR)
    expect(cur.ctx.events.map((e) => e.slug)).toEqual(['early', 'late'])
  })
})

describe('/api/live-events', () => {
  const insert = async (slug: string, startsAt: number, endsAt: number, status: 'draft' | 'published' | 'archived' = 'published') => {
    const [row] = await database.db
      .insert(liveEvents)
      .values({ slug, status, startsAt: new Date(startsAt), endsAt: new Date(endsAt), name: { es: slug, en: slug }, description: { es: 'd', en: 'd' }, overlay: overlay(), createdAt: new Date(T0), updatedAt: new Date(T0) })
      .returning()
    return row!
  }

  it('splits active, upcoming (60 days) and past (90 days), and never shows drafts or archived events', async () => {
    const h = makeApp()
    await insert('running', T0 - HOUR, T0 + HOUR)
    await insert('soon', T0 + DAY, T0 + 2 * DAY)
    await insert('far', T0 + 61 * DAY, T0 + 62 * DAY)
    await insert('over', T0 - 5 * DAY, T0 - 4 * DAY)
    await insert('ancient', T0 - 200 * DAY, T0 - 199 * DAY)
    await insert('hidden-draft', T0 - HOUR, T0 + HOUR, 'draft')
    await insert('hidden-archived', T0 - HOUR, T0 + HOUR, 'archived')
    const r = await h.call('GET', '/api/live-events')
    expect(r.status).toBe(200)
    const body = r.json as unknown as LiveEventsResponse
    expect(body.active.map((e) => e.slug)).toEqual(['running'])
    expect(body.upcoming.map((e) => e.slug)).toEqual(['soon'])
    expect(body.past.map((e) => e.slug)).toEqual(['over'])
    expect(body).toMatchObject({ nextCursor: null, serverNow: T0 })
    // only public fields
    expect(Object.keys(body.active[0]!).sort()).toEqual(['description', 'drops', 'endsAt', 'featured', 'id', 'image', 'missions', 'name', 'slug', 'startsAt'])
    expect(JSON.stringify(body)).not.toMatch(/validation|createdBy|publishedBy|revision/)
  })

  it('pages the past by endsAt', async () => {
    const h = makeApp()
    for (let i = 1; i <= 25; i++) await insert(`past-${i}`, T0 - i * DAY - HOUR, T0 - i * DAY) // past-1 ended most recently
    const first = (await h.call('GET', '/api/live-events')).json as unknown as LiveEventsResponse
    expect(first.past).toHaveLength(20)
    expect(first.past[0]!.slug).toBe('past-1')
    expect(first.nextCursor).toBe(first.past[19]!.endsAt)
    const second = (await h.call('GET', `/api/live-events?before=${first.nextCursor}`)).json as unknown as LiveEventsResponse
    expect(second.past.map((e) => e.slug)).toEqual(['past-21', 'past-22', 'past-23', 'past-24', 'past-25'])
    expect(second.nextCursor).toBeNull()
    expect((await h.call('GET', '/api/live-events?before=abc')).status).toBe(400)
  })
})

describe('uploads', () => {
  it('stores a re-encoded webp, names it by hash, and reuses an identical one', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const r = await h.upload(await png(2000, 1200), { cookie: a.cookie })
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    const { upload, reused } = r.json as unknown as AdminUploadResponse
    expect(reused).toBe(false)
    expect(upload).toMatchObject({ width: 1600, height: 900, inUse: 0 })
    expect(upload.url).toBe(`/media/events/${upload.sha256}.webp`)
    expect(upload.thumbUrl).toBe(`/media/events/${upload.sha256}-480.webp`)
    expect(existsSync(join(uploadsDir, 'events', `${upload.sha256}.webp`))).toBe(true)
    expect(existsSync(join(uploadsDir, 'events', `${upload.sha256}-480.webp`))).toBe(true)

    const again = await h.upload(await png(2000, 1200), { cookie: a.cookie })
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({ reused: true, upload: { id: upload.id } })
    // the same picture sent as another format still re-encodes to the same hash only when pixels match: a PNG of another colour differs
    const other = await h.upload(await png(2000, 1200, 'blue'), { cookie: a.cookie })
    expect(other.status).toBe(201)
    const list = (await h.call('GET', U, { cookie: a.cookie })).json as unknown as AdminUploadsResponse
    expect(list.items).toHaveLength(2)
    expect(list.totalBytes).toBeGreaterThan(0)
    expect(list.limitBytes).toBe(500 * 1024 * 1024)
    expect(await auditActions()).toEqual(['upload.create', 'upload.create'])
  })

  it('rejects SVG, HTML, GIF and a Content-Type that lies (415), without storing anything', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><script>alert(1)</script></svg>')
    const html = Buffer.from('<!doctype html><script>alert(1)</script>')
    const gif = await sharp({ create: { width: 400, height: 300, channels: 3, background: 'red' } }).gif().toBuffer()
    for (const [body, type] of [
      [svg, 'image/svg+xml'],
      [svg, 'image/png'],
      [html, 'text/html'],
      [html, 'image/webp'],
      [gif, 'image/gif'],
      [gif, 'image/png'],
      [await png(), 'image/jpeg'],
      [await png(), 'application/octet-stream'],
      [await png(), 'application/json'],
      [await png(), 'multipart/form-data; boundary=x'],
    ] as const) {
      const r = await h.upload(body, { cookie: a.cookie, type })
      expect([r.status, r.json?.error], type).toEqual([415, r.json?.error === 'json_required' ? 'json_required' : 'unsupported_type'])
    }
    expect(await database.db.select().from(uploads)).toEqual([])
  })

  it('rejects too big (413), empty (400) and unusable images (422)', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const big = Buffer.concat([await png(), Buffer.alloc(3 * 1024 * 1024 + 1)]) // valid PNG header, over the 3 MB limit
    expect(await h.upload(big, { cookie: a.cookie })).toMatchObject({ status: 413, json: { error: 'body_too_large' } })
    expect(await h.upload(Buffer.alloc(0), { cookie: a.cookie })).toMatchObject({ status: 400 })
    expect(await h.upload(await png(300, 400), { cookie: a.cookie })).toMatchObject({ status: 422, json: { error: 'image_too_small' } })
    expect(await h.upload((await png()).subarray(0, 50), { cookie: a.cookie })).toMatchObject({ status: 422, json: { error: 'invalid_image' } })
    // a body whose length header lies cannot slip past the limit either
    const lying = await h.upload(big, { cookie: a.cookie, headers: { 'content-length': '100' } })
    expect([413, 422, 400]).toContain(lying.status)
    expect(await database.db.select().from(uploads)).toEqual([])
  })

  it('keeps the Origin check (the only CSRF exception is the content type of this one route)', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const body = await png()
    expect(await h.upload(body, { cookie: a.cookie, origin: null })).toMatchObject({ status: 403, json: { error: 'bad_origin' } })
    expect(await h.upload(body, { cookie: a.cookie, origin: 'https://evil.example' })).toMatchObject({ status: 403, json: { error: 'bad_origin' } })
    // other routes still demand JSON, even with an image content type
    const res = await h.raw('/api/admin/events', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'image/png', cookie: `pf_session=${a.cookie}` }, body: new Uint8Array(body) })
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([415, 'json_required'])
    const res2 = await h.raw('/api/admin/uploads', { method: 'PUT', headers: { origin: ORIGIN, 'content-type': 'image/png', cookie: `pf_session=${a.cookie}` }, body: new Uint8Array(body) })
    expect(res2.status).toBe(415) // only POST is exempt
  })

  it('is rate limited per staff user', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const svg = Buffer.from('<svg/>')
    let last = 0
    for (let i = 0; i < 21; i++) last = (await h.upload(svg, { cookie: a.cookie })).status
    expect(last).toBe(429)
  })

  it('serves /media with safe headers: image/webp, nosniff, empty CSP, immutable cache, ETag', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const { upload } = (await h.upload(await png(1000, 600), { cookie: a.cookie })).json as unknown as AdminUploadResponse
    for (const url of [upload.url, upload.thumbUrl]) {
      const res = await h.raw(url)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'")
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(res.headers.get('content-disposition')).toBeNull()
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
      expect(Number(res.headers.get('content-length'))).toBe(bytes.length)
      const etag = res.headers.get('etag')!
      expect((await h.raw(url, { headers: { 'if-none-match': etag } })).status).toBe(304)
    }
    const head = await h.raw(upload.url, { method: 'HEAD' })
    expect([head.status, (await head.arrayBuffer()).byteLength]).toEqual([200, 0])
    // no auth needed, and nothing else is reachable
    const sha = upload.sha256
    for (const bad of [`/media/events/${sha}.png`, `/media/events/${sha}.svg`, `/media/events/${'0'.repeat(64)}.webp`, '/media/events/..%2f..%2fpackage.json', `/media/events/${sha.toUpperCase()}.webp`, '/media/other/x.webp', `/media/events/${sha}.webp/x`]) {
      const res = await h.raw(bad)
      expect(res.status, bad).toBe(404)
      expect(res.headers.get('content-type') ?? '').not.toMatch(/html|svg/)
    }
  })

  it('an image an event references cannot be deleted; once free it goes, files included', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    await elevate(h, a)
    const { upload } = (await h.upload(await png(), { cookie: a.cookie })).json as unknown as AdminUploadResponse
    const created = await h.call('POST', E, { cookie: a.cookie, body: payload({ imageId: upload.id }) })
    expect(created.status).toBe(201)
    const ev = asEvent(created)
    expect(ev.image).toMatchObject({ url: upload.url, thumbUrl: upload.thumbUrl, width: 640, height: 360 })
    expect(((await h.call('GET', U, { cookie: a.cookie })).json as unknown as AdminUploadsResponse).items[0]).toMatchObject({ inUse: 1 })
    expect((await h.call('DELETE', `${U}/${upload.id}`, { cookie: a.cookie })).json).toMatchObject({ error: 'in_use' })
    // a published event shows it publicly
    await h.call('POST', `${E}/${ev.id}/publish`, { cookie: a.cookie, body: {} })
    expect(((await h.call('GET', '/api/live-events')).json as unknown as LiveEventsResponse).upcoming[0]!.image).toMatchObject({ url: upload.url })
    expect((await h.call('POST', `${E}/${ev.id}/archive`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect((await h.call('DELETE', `${U}/${upload.id}`, { cookie: a.cookie })).status).toBe(409) // archived events keep their image

    // a draft that drops the image frees it
    const d = await h.call('POST', E, { cookie: a.cookie, body: payload({ slug: 'draft-img', imageId: upload.id }) })
    expect(d.status).toBe(201)
    expect((await h.call('PUT', `${E}/${asEvent(d).id}`, { cookie: a.cookie, body: { imageId: null } })).status).toBe(200)
    expect((await h.call('DELETE', `${E}/${asEvent(d).id}`, { cookie: a.cookie })).status).toBe(204)
    await database.db.delete(liveEvents).where(eq(liveEvents.id, ev.id)) // removing the archived one by hand
    expect((await h.call('DELETE', `${U}/${upload.id}`, { cookie: a.cookie })).status).toBe(204)
    expect(existsSync(join(uploadsDir, 'events', `${upload.sha256}.webp`))).toBe(false)
    expect((await h.raw(upload.url)).status).toBe(404)
    expect(await auditActions()).toContain('upload.delete')
    expect((await h.call('DELETE', `${U}/${upload.id}`, { cookie: a.cookie })).status).toBe(404)
  })
})
