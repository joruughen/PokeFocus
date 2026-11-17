/** Live content admin API (docs/admin-plan.md §4, delivery E5): permissions, drafts, validation, diff, publish/schedule, rollback, spawn preview. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type {
  AnnouncementsResponse,
  AdminContentLiveResponse,
  AdminContentValidateResponse,
  AdminContentVersionResponse,
  AdminContentVersionsResponse,
  AdminSpawnPreview,
  PublicUser,
  ServerEvent,
  UserRole,
} from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { adminAudit, contentVersions, users } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'
import { RateLimiter } from './rate-limit'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'correct horse battery'
const T0 = Date.UTC(2026, 10, 9, 12, 0)
const HOUR = 3_600_000
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
  await database.db.delete(contentVersions)
})

function makeApp() {
  const limiter = new RateLimiter(clock)
  const bus = new EventBus()
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN })
  const built = createApp({ env, db: database.db, clock, limiter, bus })
  const call = async (method: string, path: string, o: { cookie?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': `10.8.${Math.floor(++seq / 250)}.${seq % 250}` }
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
  return { ...built, call, limiter, bus }
}
type Harness = ReturnType<typeof makeApp>

async function account(h: Harness, role: UserRole = 'player') {
  const n = ++seq
  const r = await h.call('POST', '/api/auth/register', { body: { email: `c${n}-${Math.random().toString(36).slice(2, 8)}@example.com`, password: PASSWORD, trainerName: `Editor${n}`, country: 'PE' } })
  expect(r.status).toBe(201)
  const user = (r.json as unknown as { user: PublicUser }).user
  if (role !== 'player') await database.db.update(users).set({ role }).where(eq(users.id, user.id))
  return { id: user.id, cookie: r.cookie! }
}
type Acct = Awaited<ReturnType<typeof account>>

const elevate = async (h: Harness, u: Acct) => expect((await h.call('POST', '/api/admin/reauth', { cookie: u.cookie, body: { password: PASSWORD } })).status).toBe(200)
const auditActions = async () => (await database.db.select().from(adminAudit).orderBy(asc(adminAudit.createdAt))).map((r) => r.action)
const B = '/api/admin/content'
const SHINY = { config: { encounters: { shinyChance: 0.003 } } }
const RISKY = { config: { encounters: { shinyChance: 0.01 } } } // x5.7 the base: needs confirm
const BROKEN = { config: { encounters: { shinyChance: 0.5 } } } // above the limit
const asVersion = (r: { json: Record<string, unknown> | null }) => r.json as unknown as AdminContentVersionResponse

/** An admin with sudo and a draft with `patch` saved. */
async function adminWithDraft(h: Harness, patch: unknown = SHINY) {
  const a = await account(h, 'admin')
  await elevate(h, a)
  const created = await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty', title: 'draft' } })
  expect(created.status).toBe(201)
  const id = asVersion(created).version.id
  expect((await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch } })).status).toBe(200)
  return { a, id }
}

describe('permissions', () => {
  it('anonymous is 401 and a plain player 403 on every route', async () => {
    const h = makeApp()
    const p = await account(h)
    const routes: [string, string, unknown?][] = [
      ['GET', `${B}/live`],
      ['GET', `${B}/versions`],
      ['GET', `${B}/versions/1`],
      ['POST', `${B}/drafts`, {}],
      ['PUT', `${B}/drafts/1`, { title: 'x' }],
      ['DELETE', `${B}/drafts/1`],
      ['POST', `${B}/drafts/1/validate`, {}],
      ['POST', `${B}/drafts/1/publish`, {}],
      ['POST', `${B}/versions/1/rollback`, {}],
      ['GET', `${B}/spawn-preview`],
    ]
    for (const [m, path, body] of routes) {
      expect((await h.call(m, path, { body })).status, `${m} ${path} anon`).toBe(401)
      const r = await h.call(m, path, { cookie: p.cookie, body })
      expect([r.status, r.json?.error], `${m} ${path} player`).toEqual([403, 'forbidden'])
    }
  })

  it('support reads live, versions and a version, but cannot write, validate, publish or preview', async () => {
    const h = makeApp()
    const { id } = await adminWithDraft(h)
    const s = await account(h, 'support')
    await elevate(h, s)
    for (const path of [`${B}/live`, `${B}/versions`, `${B}/versions/${id}`]) expect((await h.call('GET', path, { cookie: s.cookie })).status, path).toBe(200)
    const writes: [string, string, unknown?][] = [
      ['POST', `${B}/drafts`, {}],
      ['PUT', `${B}/drafts/${id}`, { title: 'x' }],
      ['DELETE', `${B}/drafts/${id}`],
      ['POST', `${B}/drafts/${id}/validate`, {}],
      ['POST', `${B}/drafts/${id}/publish`, {}],
      ['POST', `${B}/versions/${id}/rollback`, {}],
      ['GET', `${B}/spawn-preview`],
    ]
    for (const [m, path, body] of writes) {
      const r = await h.call(m, path, { cookie: s.cookie, body })
      expect([r.status, r.json?.error], `${m} ${path}`).toEqual([403, 'forbidden'])
    }
  })

  it('publish and rollback need the sudo mode (and it lapses after 30 minutes)', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const created = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty' } }))
    const id = created.version.id
    const no = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })
    expect([no.status, no.json?.error]).toEqual([403, 'elevation_required'])
    const no2 = await h.call('POST', `${B}/versions/${id}/rollback`, { cookie: a.cookie, body: {} })
    expect([no2.status, no2.json?.error]).toEqual([403, 'elevation_required'])
    // Drafts, validation and preview do not need it.
    expect((await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch: SHINY } })).status).toBe(200)
    expect((await h.call('POST', `${B}/drafts/${id}/validate`, { cookie: a.cookie })).status).toBe(200)
    expect((await h.call('GET', `${B}/spawn-preview`, { cookie: a.cookie })).status).toBe(200)
    await elevate(h, a)
    expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    now += 31 * 60_000
    const lapsed = await h.call('POST', `${B}/versions/${id}/rollback`, { cookie: a.cookie, body: {} })
    expect([lapsed.status, lapsed.json?.error]).toEqual([403, 'elevation_required'])
  })
})

describe('drafts', () => {
  it('creates from scratch or from the active version, lists with authors and reads one', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const empty = asVersion(await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie }))
    expect(empty.version).toMatchObject({ id, status: 'draft', title: 'draft', parentId: null, effectiveAt: null, active: false, scheduled: false, patch: SHINY })
    expect(empty.version.createdBy).toMatchObject({ id: a.id })
    expect(empty.version.validationDetail).toMatchObject({ ok: true, smoke: false })
    expect(empty.diff).toEqual([{ path: 'config.encounters.shinyChance', kind: 'added', before: expect.any(Number), after: 0.003 }])

    // Publish it, then a new draft "from the active" copies its patch and parent.
    expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    const copy = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: {} }))
    expect(copy.version).toMatchObject({ status: 'draft', patch: SHINY, parentId: id })
    expect(copy.diff).toEqual([])

    const list = (await h.call('GET', `${B}/versions`, { cookie: a.cookie })).json as unknown as AdminContentVersionsResponse
    expect(list.items.map((v) => [v.id, v.status, v.active])).toEqual([
      [copy.version.id, 'draft', false],
      [id, 'published', true],
    ])
    expect(list.items[1]).toMatchObject({ createdBy: { id: a.id }, publishedBy: { id: a.id }, publishedAt: T0, effectiveAt: T0 })
    const onlyDrafts = (await h.call('GET', `${B}/versions?status=draft`, { cookie: a.cookie })).json as unknown as AdminContentVersionsResponse
    expect(onlyDrafts.items.map((v) => v.id)).toEqual([copy.version.id])
    expect((await h.call('GET', `${B}/versions?status=nope`, { cookie: a.cookie })).status).toBe(400)
  })

  it('creates from a given older version (fromVersionId) and 404s on an unknown one', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const r = await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { fromVersionId: id } })
    expect(asVersion(r).version).toMatchObject({ patch: SHINY, parentId: id })
    expect((await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { fromVersionId: 99999 } })).status).toBe(404)
  })

  it('edits keep the draft even with errors (the validation is stored); title and note alone are fine', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const bad = await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch: BROKEN, title: 'broken', note: 'n' } })
    expect(bad.status).toBe(200)
    const v = asVersion(bad).version
    expect(v).toMatchObject({ title: 'broken', note: 'n', patch: BROKEN })
    expect(v.validationDetail?.ok).toBe(false)
    expect(v.validationDetail?.errors.length).toBeGreaterThan(0)
    expect(v.validation).toMatchObject({ ok: false })

    const meta = asVersion(await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { title: null } }))
    expect(meta.version.title).toBeNull()
    expect(meta.version.patch).toEqual(BROKEN)
    expect((await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: {} })).status).toBe(400)
    expect((await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch: [1] } })).status).toBe(400)
  })

  it('deletes a draft only; published versions are immutable (409 not_draft)', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const other = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty' } })).version.id
    expect((await h.call('DELETE', `${B}/drafts/${other}`, { cookie: a.cookie })).status).toBe(204)
    expect((await h.call('GET', `${B}/versions/${other}`, { cookie: a.cookie })).status).toBe(404)
    expect((await h.call('DELETE', `${B}/drafts/${other}`, { cookie: a.cookie })).status).toBe(404)

    expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    for (const [m, path, body] of [
      ['PUT', `${B}/drafts/${id}`, { title: 'x' }],
      ['DELETE', `${B}/drafts/${id}`, undefined],
      ['POST', `${B}/drafts/${id}/validate`, {}],
      ['POST', `${B}/drafts/${id}/publish`, {}],
    ] as const) {
      const r = await h.call(m, path, { cookie: a.cookie, body })
      expect([r.status, r.json?.error], `${m} ${path}`).toEqual([409, 'not_draft'])
    }
    expect((await h.call('GET', `${B}/versions/abc`, { cookie: a.cookie })).status).toBe(404)
  })

  it('caps the open drafts (409 too_many_drafts)', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    for (let i = 0; i < 20; i++) expect((await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty' } })).status).toBe(201)
    const r = await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty' } })
    expect([r.status, r.json?.error]).toEqual([409, 'too_many_drafts'])
  })

  it('drafts are never served by /api/content', async () => {
    const h = makeApp()
    await adminWithDraft(h, SHINY)
    const r = await h.call('GET', '/api/content')
    expect(r.json).toMatchObject({ hash: 'base', patch: {} })
  })
})

describe('validate and diff', () => {
  it('runs the full validation with the smoke test, stores it and returns the diff against the active patch', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, SHINY)
    const ok = (await h.call('POST', `${B}/drafts/${id}/validate`, { cookie: a.cookie })).json as unknown as AdminContentValidateResponse
    expect(ok.validation).toMatchObject({ ok: true, smoke: true, errors: [], requiresConfirm: false })
    expect(ok.diff.map((d) => d.path)).toEqual(['config.encounters.shinyChance'])
    const stored = asVersion(await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie }))
    expect(stored.version.validationDetail?.smoke).toBe(true)

    await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch: RISKY } })
    const risky = (await h.call('POST', `${B}/drafts/${id}/validate`, { cookie: a.cookie })).json as unknown as AdminContentValidateResponse
    expect(risky.validation).toMatchObject({ ok: true, requiresConfirm: true })
    expect(risky.validation.warnings.some((w) => w.requiresConfirm)).toBe(true)

    await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch: BROKEN } })
    const broken = (await h.call('POST', `${B}/drafts/${id}/validate`, { cookie: a.cookie })).json as unknown as AdminContentValidateResponse
    expect(broken.validation.ok).toBe(false)
  })

  it('diffs a draft against the active version: added, changed and removed paths with before/after', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, { config: { encounters: { shinyChance: 0.003 }, rewards: { dustPerMinute: 6 } } })
    expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    const d = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: {} })).version.id
    await h.call('PUT', `${B}/drafts/${d}`, { cookie: a.cookie, body: { patch: { config: { encounters: { shinyChance: 0.004 } }, species: { pidgey: { captureRate: 100 } } } } })
    const diff = asVersion(await h.call('GET', `${B}/versions/${d}`, { cookie: a.cookie })).diff
    expect(diff).toEqual([
      { path: 'config.encounters.shinyChance', kind: 'changed', before: 0.003, after: 0.004 },
      { path: 'config.rewards.dustPerMinute', kind: 'removed', before: 6, after: expect.any(Number) },
      { path: 'species.pidgey.captureRate', kind: 'added', before: expect.any(Number), after: 100 },
    ])
    // The active version diffs against itself: nothing.
    expect(asVersion(await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie })).diff).toEqual([])
  })
})

describe('publish and schedule', () => {
  it('publishes now: becomes active, /api/content serves it, SSE announces the hash, audited', async () => {
    const h = makeApp()
    const events: ServerEvent[] = []
    h.bus.subscribe({ userId: 'w', sessionId: 's', send: (e) => events.push(e), close: () => {} })
    await h.deps.content.check() // first check after boot: remembers the base
    const { a, id } = await adminWithDraft(h)
    const r = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { note: 'go live' } })
    expect(r.status).toBe(200)
    const v = asVersion(r).version
    expect(v).toMatchObject({ status: 'published', active: true, scheduled: false, effectiveAt: T0, publishedAt: T0, note: 'go live' })
    expect(v.publishedBy).toMatchObject({ id: a.id })
    expect(v.validationDetail).toMatchObject({ ok: true, smoke: true })

    const pub = await h.call('GET', '/api/content')
    expect(pub.json).toMatchObject({ patch: SHINY, hash: v.hash === null ? '' : expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(events).toEqual([{ type: 'content', hash: (pub.json as { hash: string }).hash }])

    const live = (await h.call('GET', `${B}/live`, { cookie: a.cookie })).json as unknown as AdminContentLiveResponse
    expect(live).toMatchObject({ hash: (pub.json as { hash: string }).hash, active: { id }, scheduled: null, events: [] })
    expect(await auditActions()).toEqual(['admin.reauth', 'content.draft.create', 'content.draft.update', 'content.publish'])
  })

  it('a note for players is stored with the version, audited, plain text and served by /api/announcements once in force', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const noteOf = async () => ((await h.call('GET', '/api/announcements')).json as unknown as AnnouncementsResponse).contentNote
    expect(await noteOf()).toBeNull()
    const playerNote = { es: 'Subimos la probabilidad de legendarios', en: 'Legendary odds are up' }
    const r = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { playerNote } })
    expect(r.status).toBe(200)
    expect(asVersion(r).version.playerNote).toEqual(playerNote)
    expect(await noteOf()).toEqual({ versionId: id, effectiveAt: T0, note: playerNote })
    const row = (await database.db.select().from(contentVersions).where(eq(contentVersions.id, id)))[0]!
    expect(row.playerNote).toEqual(playerNote)
    const audit = (await database.db.select().from(adminAudit).where(eq(adminAudit.action, 'content.publish')))[0]!
    expect(audit.after).toMatchObject({ playerNote })
    // It stops being offered after two weeks.
    now = T0 + 14 * DAY + 1
    expect(await noteOf()).toBeNull()
  })

  it('a scheduled version shows its note only when it takes effect; cancelling the schedule drops the note', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const at = T0 + 2 * HOUR
    const noteOf = async () => ((await h.call('GET', '/api/announcements')).json as unknown as AnnouncementsResponse).contentNote
    await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { effectiveAt: at, playerNote: { en: 'Soon' } } })
    expect(await noteOf()).toBeNull()
    now = at + 1
    expect(await noteOf()).toEqual({ versionId: id, effectiveAt: at, note: { en: 'Soon' } })

    const h2 = makeApp()
    now = T0
    const second = await adminWithDraft(h2)
    await h2.call('POST', `${B}/drafts/${second.id}/publish`, { cookie: second.a.cookie, body: { effectiveAt: T0 + 3 * HOUR, playerNote: { en: 'Never' } } })
    expect((await h2.call('POST', `${B}/versions/${second.id}/unschedule`, { cookie: second.a.cookie, body: {} })).status).toBe(200)
    const [r] = await database.db.select().from(contentVersions).where(eq(contentVersions.id, second.id))
    expect(r!.playerNote).toBeNull()
    now = T0 + 4 * HOUR
    expect(((await h2.call('GET', '/api/announcements')).json as unknown as AnnouncementsResponse).contentNote?.versionId).not.toBe(second.id)
  })

  it('rejects a note with HTML, control characters, too long or empty (400 invalid_body) and publishes nothing', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const bad: unknown[] = [{ es: '<img src=x onerror=alert(1)>' }, { en: 'x'.repeat(201) }, { es: ' ' }, {}, { es: 'a\nb' }, 'text']
    for (const playerNote of bad) {
      const r = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { playerNote } })
      expect([r.status, r.json?.error], JSON.stringify(playerNote)).toEqual([400, 'invalid_body'])
    }
    expect((await database.db.select().from(contentVersions).where(eq(contentVersions.id, id)))[0]!.status).toBe('draft')
    expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { playerNote: { es: 'x'.repeat(200) } } })).status).toBe(200)
  })

  it('schedules for the future: not active until then; /live shows it as next; audited as content.schedule', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const at = T0 + 2 * HOUR
    const r = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { effectiveAt: at } })
    expect(r.status).toBe(200)
    expect(asVersion(r).version).toMatchObject({ status: 'published', active: false, scheduled: true, effectiveAt: at })
    expect(((await h.call('GET', '/api/content')).json as { hash: string }).hash).toBe('base')
    const live = (await h.call('GET', `${B}/live`, { cookie: a.cookie })).json as unknown as AdminContentLiveResponse
    expect(live).toMatchObject({ hash: 'base', active: null, scheduled: { id, scheduled: true } })
    now = at + 1
    expect(((await h.call('GET', '/api/content')).json as { patch: unknown }).patch).toEqual(SHINY)
    const later = (await h.call('GET', `${B}/live`, { cookie: a.cookie })).json as unknown as AdminContentLiveResponse
    expect(later).toMatchObject({ active: { id, active: true }, scheduled: null })
    expect(await auditActions()).toContain('content.schedule')
  })

  it('effectiveAt must be in the future and at most 60 days ahead (400 invalid_effective_at)', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    for (const at of [T0, T0 - HOUR, T0 + 61 * DAY]) {
      const r = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { effectiveAt: at } })
      expect([r.status, r.json?.error], String(at)).toEqual([400, 'invalid_effective_at'])
    }
  })

  it('errors block with 422 and the list; nothing is published or audited', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, BROKEN)
    const r = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { confirm: true } })
    expect([r.status, r.json?.error]).toEqual([422, 'validation_failed'])
    expect((r.json!.errors as unknown[]).length).toBeGreaterThan(0)
    expect(asVersion(await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie })).version.status).toBe('draft')
    expect(await auditActions()).not.toContain('content.publish')
  })

  it('changes beyond x3 / x5 need confirm: true (409 confirm_required with the warnings)', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, RISKY)
    const no = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })
    expect([no.status, no.json?.error, no.json?.requiresConfirm]).toEqual([409, 'confirm_required', true])
    expect((no.json!.warnings as { requiresConfirm?: boolean }[]).every((w) => w.requiresConfirm)).toBe(true)
    const no2 = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { confirm: false } })
    expect(no2.status).toBe(409)
    const yes = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { confirm: true } })
    expect(yes.status).toBe(200)
    expect(asVersion(yes).version.status).toBe('published')
  })

  it('rate limits publishing (429 rate_limited)', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    await elevate(h, a)
    const id = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty' } })).version.id
    // 10 per 15 minutes: bad bodies count too (invalid effectiveAt is checked after the limit).
    let last = 0
    for (let i = 0; i < 11; i++) last = (await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { effectiveAt: T0 - 1 } })).status
    expect(last).toBe(429)
  })
})

describe('rollback', () => {
  it('publishes a NEW version copying an older patch, in force now, with the parent and an audit row', async () => {
    const h = makeApp()
    const events: ServerEvent[] = []
    h.bus.subscribe({ userId: 'w', sessionId: 's', send: (e) => events.push(e), close: () => {} })
    const { a, id: first } = await adminWithDraft(h, SHINY)
    expect((await h.call('POST', `${B}/drafts/${first}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    now += HOUR
    await elevate(h, a)
    const second = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: {} })).version.id
    await h.call('PUT', `${B}/drafts/${second}`, { cookie: a.cookie, body: { patch: { config: { encounters: { shinyChance: 0.004 } } } } })
    expect((await h.call('POST', `${B}/drafts/${second}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect(((await h.call('GET', '/api/content')).json as { patch: unknown }).patch).toEqual({ config: { encounters: { shinyChance: 0.004 } } })

    now += HOUR
    await elevate(h, a)
    events.length = 0
    const rb = await h.call('POST', `${B}/versions/${first}/rollback`, { cookie: a.cookie, body: { note: 'bad idea' } })
    expect(rb.status).toBe(201)
    const v = asVersion(rb).version
    expect(v.id).toBeGreaterThan(second)
    expect(v).toMatchObject({ status: 'published', parentId: first, active: true, patch: SHINY, effectiveAt: now, note: 'bad idea' })
    expect(((await h.call('GET', '/api/content')).json as { patch: unknown }).patch).toEqual(SHINY)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'content' })
    // The earlier versions are untouched.
    const old = asVersion(await h.call('GET', `${B}/versions/${second}`, { cookie: a.cookie })).version
    expect(old).toMatchObject({ status: 'published', active: false })
    const rows = await database.db.select().from(adminAudit).where(eq(adminAudit.action, 'content.rollback'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ targetId: String(v.id), note: 'bad idea', actorId: a.id })
  })

  it('refuses drafts, scheduled-for-later versions and unknown ids', async () => {
    const h = makeApp()
    const { a, id: draft } = await adminWithDraft(h)
    const r = await h.call('POST', `${B}/versions/${draft}/rollback`, { cookie: a.cookie, body: {} })
    expect([r.status, r.json?.error]).toEqual([409, 'not_published'])
    expect((await h.call('POST', `${B}/drafts/${draft}/publish`, { cookie: a.cookie, body: { effectiveAt: T0 + DAY } })).status).toBe(200)
    const later = await h.call('POST', `${B}/versions/${draft}/rollback`, { cookie: a.cookie, body: {} })
    expect([later.status, later.json?.error]).toEqual([409, 'not_published'])
    expect((await h.call('POST', `${B}/versions/99999/rollback`, { cookie: a.cookie, body: {} })).status).toBe(404)
  })
})

describe('unschedule', () => {
  const schedule = async (h: Harness, a: Acct, id: number, at = T0 + 2 * HOUR) => expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { effectiveAt: at } })).status).toBe(200)

  it('sends a scheduled version back to a draft: not next any more, never active, audited as content.unschedule', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    await schedule(h, a, id)
    const r = await h.call('POST', `${B}/versions/${id}/unschedule`, { cookie: a.cookie, body: {} })
    expect(r.status).toBe(200)
    expect(asVersion(r).version).toMatchObject({ id, status: 'draft', effectiveAt: null, scheduled: false, active: false, publishedAt: null, publishedBy: null, patch: SHINY })
    const live = (await h.call('GET', `${B}/live`, { cookie: a.cookie })).json as unknown as AdminContentLiveResponse
    expect(live).toMatchObject({ hash: 'base', active: null, scheduled: null })
    now += 3 * HOUR // past the cancelled time: still the base
    expect(((await h.call('GET', '/api/content')).json as { hash: string }).hash).toBe('base')
    expect(await auditActions()).toContain('content.unschedule')
    // It is an ordinary draft again: it can be published.
    await elevate(h, a)
    expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
  })

  it('needs admin + sudo and refuses drafts, versions already in force and unknown ids (409 not_scheduled)', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const draft = await h.call('POST', `${B}/versions/${id}/unschedule`, { cookie: a.cookie, body: {} })
    expect([draft.status, draft.json?.error]).toEqual([409, 'not_scheduled'])
    await schedule(h, a, id)
    const s = await account(h, 'support')
    await elevate(h, s)
    expect((await h.call('POST', `${B}/versions/${id}/unschedule`, { cookie: s.cookie, body: {} })).status).toBe(403)
    now += 31 * 60_000 // sudo lapses
    const lapsed = await h.call('POST', `${B}/versions/${id}/unschedule`, { cookie: a.cookie, body: {} })
    expect([lapsed.status, lapsed.json?.error]).toEqual([403, 'elevation_required'])
    await elevate(h, a)
    now = T0 + 2 * HOUR + 1 // it has entered into force
    await elevate(h, a)
    const live = await h.call('POST', `${B}/versions/${id}/unschedule`, { cookie: a.cookie, body: {} })
    expect([live.status, live.json?.error]).toEqual([409, 'not_scheduled'])
    expect((await h.call('POST', `${B}/versions/99999/unschedule`, { cookie: a.cookie, body: {} })).status).toBe(404)
  })

  it('announces the hash again when the cancelled version was the next one only after it was in force (no change before)', async () => {
    const h = makeApp()
    const events: ServerEvent[] = []
    h.bus.subscribe({ userId: 'w', sessionId: 's', send: (e) => events.push(e), close: () => {} })
    await h.deps.content.check()
    const { a, id } = await adminWithDraft(h)
    await schedule(h, a, id)
    events.length = 0
    expect((await h.call('POST', `${B}/versions/${id}/unschedule`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect(events).toEqual([]) // the live hash did not change
  })
})

describe('big-change guard against what is live', () => {
  it('a draft made from live does not ask again for values already live; one that moves them further does', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, RISKY)
    expect((await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: { confirm: true } })).status).toBe(200)
    const copy = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'active' } })).version.id
    // Add an unrelated, small change: the x5.7 shiny chance is already live and is not touched.
    const patch = { config: { encounters: { shinyChance: 0.01 }, rewards: { dustPerMinute: 7 } } }
    const v = asVersion(await h.call('PUT', `${B}/drafts/${copy}`, { cookie: a.cookie, body: { patch } })).version
    expect(v.validation).toMatchObject({ requiresConfirm: false })
    const ok = await h.call('POST', `${B}/drafts/${copy}/publish`, { cookie: a.cookie, body: {} })
    expect(ok.status).toBe(200)
    // Dropping it back to the base (x5.7 down from what is live) does need the tick.
    const next = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'active' } })).version.id
    const big = asVersion(await h.call('PUT', `${B}/drafts/${next}`, { cookie: a.cookie, body: { patch: {} } })).version
    expect(big.validation?.requiresConfirm).toBe(true)
  })
})

describe('spawn preview', () => {
  const preview = async (h: Harness, a: Acct, qs = '') => {
    const r = await h.call('GET', `${B}/spawn-preview${qs}`, { cookie: a.cookie })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    return r.json as unknown as AdminSpawnPreview
  }

  it('lists the species of the active content with probabilities that add up to 1 and no legendaries', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const p = await preview(h, a)
    expect(p).toMatchObject({ versionId: null, hash: 'base', hour: 12, weather: 'clear', trainerLevel: 1 })
    expect(p.count).toBe(p.species.length)
    expect(p.count).toBeGreaterThanOrEqual(5)
    expect(p.species.reduce((n, s) => n + s.probability, 0)).toBeCloseTo(1, 6)
    expect(p.species[0]!.probability).toBeGreaterThanOrEqual(p.species.at(-1)!.probability)
    expect(p.rules).toEqual([])
    expect(p.legendaryChance).toBeGreaterThan(0)
  })

  it('previews a draft: a disabled species vanishes and an hour or weather rule applies by slot', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, { species: { pidgey: { spawn: { enabled: false } }, caterpie: { spawn: { hours: [[20, 6]], weather: ['rain'] } } } })
    const base = await preview(h, a, '?hour=22&weather=rain')
    expect(base.species.map((s) => s.slug)).toContain('pidgey')
    expect(base.species.map((s) => s.slug)).toContain('caterpie')

    const p = await preview(h, a, `?versionId=${id}&hour=22&weather=rain`)
    expect(p.versionId).toBe(id)
    expect(p.species.map((s) => s.slug)).not.toContain('pidgey')
    expect(p.species.map((s) => s.slug)).toContain('caterpie')
    expect(p.rules.map((r) => r.slug)).toEqual(['caterpie', 'pidgey'])
    // Outside its hours or weather the rule removes caterpie.
    expect((await preview(h, a, `?versionId=${id}&hour=12&weather=rain`)).species.map((s) => s.slug)).not.toContain('caterpie')
    expect((await preview(h, a, `?versionId=${id}&hour=22&weather=clear`)).species.map((s) => s.slug)).not.toContain('caterpie')
    expect((await preview(h, a, `?versionId=${id}&hour=22&weather=unknown`)).species.map((s) => s.slug)).not.toContain('caterpie')
  })

  it('a weight multiplier shifts the probabilities; bad queries are 400, unknown versions 404', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, { species: { pidgey: { spawn: { weightMult: 4 } } } })
    const base = (await preview(h, a)).species.find((s) => s.slug === 'pidgey')!
    const boosted = (await preview(h, a, `?versionId=${id}`)).species.find((s) => s.slug === 'pidgey')!
    expect(boosted.weightMult).toBe(4)
    expect(boosted.probability).toBeGreaterThan(base.probability)
    for (const qs of ['?hour=24', '?hour=x', '?weather=fog', '?trainerLevel=0', '?versionId=0']) expect((await h.call('GET', `${B}/spawn-preview${qs}`, { cookie: a.cookie })).status, qs).toBe(400)
    expect((await h.call('GET', `${B}/spawn-preview?versionId=99999`, { cookie: a.cookie })).status).toBe(404)
  })

  it('a draft with an invalid shape is 422 invalid_patch', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h, BROKEN)
    const r = await h.call('GET', `${B}/spawn-preview?versionId=${id}`, { cookie: a.cookie })
    expect([r.status, r.json?.error]).toEqual([422, 'invalid_patch'])
  })
})

describe('audit', () => {
  it('every mutation writes its audit row in the same transaction (draft create/update/delete)', async () => {
    const h = makeApp()
    const a = await account(h, 'admin')
    const id = asVersion(await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty', title: 't' } })).version.id
    await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch: SHINY } })
    await h.call('DELETE', `${B}/drafts/${id}`, { cookie: a.cookie })
    expect(await auditActions()).toEqual(['content.draft.create', 'content.draft.update', 'content.draft.delete'])
    // Failed writes leave no trace.
    await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { title: 'x' } })
    expect(await auditActions()).toHaveLength(3)
  })
})
