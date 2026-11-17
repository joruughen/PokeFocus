/** Content tied to a live event: publish together with it, follow its dates, cancel when it is archived, and the «back» copy at its end. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type { AdminContentLiveResponse, AdminContentVersionResponse, AdminContentVersionsResponse, AdminEventResponse, EventOverlayBody, PublicUser, UserRole } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { adminAudit, contentVersions, liveEvents, users } from './db/schema'
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
  await database.db.delete(liveEvents)
})

function makeApp() {
  const limiter = new RateLimiter(clock)
  const bus = new EventBus()
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN })
  const built = createApp({ env, db: database.db, clock, limiter, bus })
  const call = async (method: string, path: string, o: { cookie?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': `10.7.${Math.floor(++seq / 250)}.${seq % 250}` }
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
  const r = await h.call('POST', '/api/auth/register', { body: { email: `l${n}-${Math.random().toString(36).slice(2, 8)}@example.com`, password: PASSWORD, trainerName: `Link${n}`, country: 'PE' } })
  expect(r.status).toBe(201)
  const user = (r.json as unknown as { user: PublicUser }).user
  if (role !== 'player') await database.db.update(users).set({ role }).where(eq(users.id, user.id))
  return { id: user.id, cookie: r.cookie! }
}
type Acct = Awaited<ReturnType<typeof account>>

const elevate = async (h: Harness, u: Acct) => expect((await h.call('POST', '/api/admin/reauth', { cookie: u.cookie, body: { password: PASSWORD } })).status).toBe(200)
const audits = async () => await database.db.select().from(adminAudit).orderBy(asc(adminAudit.createdAt), asc(adminAudit.id))
const C = '/api/admin/content'
const E = '/api/admin/events'
const wave = (n: number) => ({ config: { encounters: { roamingSessions: n } } })
const RISKY = { config: { encounters: { shinyChance: 0.01 } } } // x5.7 the base: needs confirm
const asVersion = (r: { json: Record<string, unknown> | null }) => r.json as unknown as AdminContentVersionResponse
const asEvent = (r: { json: Record<string, unknown> | null }) => (r.json as unknown as AdminEventResponse).event
const overlay = (): EventOverlayBody => ({ featured: [{ species: 'pikachu', weightMult: 2 }], drops: [], missions: [] })

/** An admin with sudo. */
async function admin(h: Harness) {
  const a = await account(h, 'admin')
  await elevate(h, a)
  return a
}

/** A published event (scheduled or running at `now`). */
async function publishedEvent(h: Harness, a: Acct, o: { slug?: string; startsAt?: number; endsAt?: number } = {}) {
  const created = await h.call('POST', E, {
    cookie: a.cookie,
    body: {
      slug: o.slug ?? 'spring-fest',
      name: { es: 'Fiesta', en: 'Fest' },
      description: { es: 'Texto', en: 'Text' },
      startsAt: o.startsAt ?? T0 + 2 * HOUR,
      endsAt: o.endsAt ?? T0 + DAY,
      overlay: overlay(),
    },
  })
  expect(created.status, JSON.stringify(created.json)).toBe(201)
  const id = asEvent(created).id
  const pub = await h.call('POST', `${E}/${id}/publish`, { cookie: a.cookie, body: {} })
  expect(pub.status, JSON.stringify(pub.json)).toBe(200)
  return id
}

/** A draft with `patch`. */
async function draft(h: Harness, a: Acct, patch: unknown, title = 'draft') {
  const created = await h.call('POST', `${C}/drafts`, { cookie: a.cookie, body: { from: 'empty', title } })
  expect(created.status).toBe(201)
  const id = asVersion(created).version.id
  expect((await h.call('PUT', `${C}/drafts/${id}`, { cookie: a.cookie, body: { patch } })).status).toBe(200)
  return id
}

/** A plain version in force at `now` (or scheduled with `effectiveAt`). */
async function plain(h: Harness, a: Acct, patch: unknown, effectiveAt?: number) {
  const id = await draft(h, a, patch, 'plain')
  const r = await h.call('POST', `${C}/drafts/${id}/publish`, { cookie: a.cookie, body: effectiveAt ? { effectiveAt } : {} })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return id
}

const row = async (id: number) => (await database.db.select().from(contentVersions).where(eq(contentVersions.id, id)))[0]!
const live = async (h: Harness, a: Acct) => (await h.call('GET', `${C}/live`, { cookie: a.cookie })).json as unknown as AdminContentLiveResponse
const publishLinked = (h: Harness, a: Acct, id: number, eventId: string, extra: Record<string, unknown> = {}) =>
  h.call('POST', `${C}/drafts/${id}/publish`, { cookie: a.cookie, body: { linkEventId: eventId, ...extra } })

describe('publish tied to an event', () => {
  it('a future event: effective at its start, scheduled, not in force before, with the event on the summary and audited as content.schedule', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(5))
    const r = await publishLinked(h, a, id, ev)
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const v = asVersion(r).version
    expect(v).toMatchObject({ status: 'published', effectiveAt: T0 + 2 * HOUR, scheduled: true, active: false, linkedRole: 'start', revertOfVersionId: null, revertStale: false })
    expect(v.linkedEvent).toMatchObject({ id: ev, slug: 'spring-fest', status: 'published', startsAt: T0 + 2 * HOUR, endsAt: T0 + DAY })
    expect(asVersion(r).revert).toBeUndefined()
    expect(await live(h, a)).toMatchObject({ hash: 'base', active: null, scheduled: { id, linkedEvent: { id: ev } } })
    const list = (await h.call('GET', `${C}/versions`, { cookie: a.cookie })).json as unknown as AdminContentVersionsResponse
    expect(list.items.find((x) => x.id === id)?.linkedEvent?.slug).toBe('spring-fest')
    const entry = (await audits()).find((x) => x.action === 'content.schedule')
    expect(entry).toMatchObject({ targetId: String(id), after: { linkedEventId: ev, eventSlug: 'spring-fest', linkedRole: 'start', effectiveAt: T0 + 2 * HOUR, immediate: false } })
    // The content takes effect with the event.
    now = T0 + 2 * HOUR
    expect(await live(h, a)).toMatchObject({ active: { id, active: true }, scheduled: null })
    expect((await row(id)).linkedEventId).toBe(ev)
  })

  it('an event that is already running: the version takes effect now', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a, { startsAt: T0 + HOUR, endsAt: T0 + DAY })
    now = T0 + 3 * HOUR
    await elevate(h, a) // the sudo mode lapsed with the clock
    const id = await draft(h, a, wave(5))
    const r = await publishLinked(h, a, id, ev)
    expect(r.status).toBe(200)
    expect(asVersion(r).version).toMatchObject({ effectiveAt: now, scheduled: false, active: true, linkedRole: 'start' })
    expect((await audits()).find((x) => x.action === 'content.schedule')).toMatchObject({ after: { immediate: true } })
    expect(await live(h, a)).toMatchObject({ active: { id } })
  })

  it('refuses a draft, an archived or an ended event, an unknown one, and the bad combinations', async () => {
    const h = makeApp()
    const a = await admin(h)
    const id = await draft(h, a, wave(5))
    // A draft event.
    const created = await h.call('POST', E, { cookie: a.cookie, body: { slug: 'only-draft', name: { es: 'a', en: 'a' }, description: { es: 'b', en: 'b' }, startsAt: T0 + HOUR, endsAt: T0 + DAY, overlay: overlay() } })
    const notPub = await publishLinked(h, a, id, asEvent(created).id)
    expect([notPub.status, notPub.json]).toEqual([409, expect.objectContaining({ error: 'event_not_linkable', reason: 'not_published' })])
    // Archived.
    const arch = await publishedEvent(h, a, { slug: 'archived-one' })
    expect((await h.call('POST', `${E}/${arch}/archive`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect((await publishLinked(h, a, id, arch)).json).toMatchObject({ error: 'event_not_linkable', reason: 'not_published' })
    // Ended.
    const short = await publishedEvent(h, a, { slug: 'short-one', startsAt: T0 + HOUR, endsAt: T0 + 2 * HOUR })
    now = T0 + 3 * HOUR
    await elevate(h, a)
    expect((await publishLinked(h, a, id, short)).json).toMatchObject({ error: 'event_not_linkable', reason: 'ended' })
    // Unknown; both a time and an event; the copy without an event.
    expect((await publishLinked(h, a, id, '11111111-1111-4111-8111-111111111111')).json).toMatchObject({ error: 'unknown_event' })
    const ok = await publishedEvent(h, a, { slug: 'ok-one', startsAt: now + HOUR, endsAt: now + DAY })
    expect((await publishLinked(h, a, id, ok, { effectiveAt: now + HOUR })).json).toMatchObject({ error: 'invalid_body' })
    const noLink = await h.call('POST', `${C}/drafts/${id}/publish`, { cookie: a.cookie, body: { revertWhenEnds: true } })
    expect([noLink.status, noLink.json?.error]).toEqual([400, 'invalid_body'])
    expect((await row(id)).status).toBe('draft') // none of them touched it
  })

  it('needs admin + sudo and the same ×3 / ×5 confirmation and validation as a normal publish', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const risky = await draft(h, a, RISKY)
    const blocked = await publishLinked(h, a, risky, ev)
    expect([blocked.status, blocked.json?.error]).toEqual([409, 'confirm_required'])
    expect((await row(risky)).status).toBe('draft')
    expect((await publishLinked(h, a, risky, ev, { confirm: true })).status).toBe(200)
    const bad = await draft(h, a, { config: { encounters: { shinyChance: 0.5 } } })
    expect((await publishLinked(h, a, bad, ev)).json).toMatchObject({ error: 'validation_failed' })
    // Support cannot; an admin without sudo gets elevation_required; and the draft stays a draft.
    const s = await account(h, 'support')
    expect((await publishLinked(h, s, bad, ev)).status).toBe(403)
    const b = await account(h, 'admin')
    const ok = await draft(h, a, wave(5))
    const noSudo = await publishLinked(h, b, ok, ev)
    expect([noSudo.status, noSudo.json?.error]).toEqual([403, 'elevation_required'])
    expect((await row(ok)).status).toBe('draft')
    expect((await audits()).filter((x) => x.action === 'content.schedule')).toHaveLength(1)
  })
})

describe('the version follows its event', () => {
  it('moves with the new dates (same transaction, audited), enters now when the new start is in the past, and leaves versions in force alone', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(5))
    await publishLinked(h, a, id, ev)
    const r = await h.call('PUT', `${E}/${ev}`, { cookie: a.cookie, body: { startsAt: T0 + 5 * HOUR, endsAt: T0 + 2 * DAY } })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect((r.json as unknown as AdminEventResponse).contentMoved).toEqual([id])
    expect((await row(id)).effectiveAt?.getTime()).toBe(T0 + 5 * HOUR)
    const moves = (await audits()).filter((x) => x.action === 'content.reschedule')
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ targetId: String(id), before: { effectiveAt: T0 + 2 * HOUR }, after: { effectiveAt: T0 + 5 * HOUR, eventId: ev, role: 'start' } })
    expect((await live(h, a)).scheduled).toMatchObject({ id, effectiveAt: T0 + 5 * HOUR })
    // An edit that does not touch the dates moves nothing.
    const same = await h.call('PUT', `${E}/${ev}`, { cookie: a.cookie, body: { name: { es: 'Otra', en: 'Other' } } })
    expect((same.json as unknown as AdminEventResponse).contentMoved).toBeUndefined()
    // The event now starts in the past: the content takes effect at once.
    const earlier = await h.call('PUT', `${E}/${ev}`, { cookie: a.cookie, body: { startsAt: T0 - HOUR } })
    expect((earlier.json as unknown as AdminEventResponse).contentMoved).toEqual([id])
    expect((await row(id)).effectiveAt?.getTime()).toBe(T0)
    expect(await live(h, a)).toMatchObject({ active: { id } })
    // Already in force: a later change of the event's dates does not touch it.
    const after = await h.call('PUT', `${E}/${ev}`, { cookie: a.cookie, body: { endsAt: T0 + 3 * DAY } })
    expect((after.json as unknown as AdminEventResponse).contentMoved).toBeUndefined()
    expect((await row(id)).effectiveAt?.getTime()).toBe(T0)
  })

  it('archiving before the start sends the scheduled versions back to drafts (like unschedule) and says so; the link is gone', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(5))
    await publishLinked(h, a, id, ev)
    const r = await h.call('POST', `${E}/${ev}/archive`, { cookie: a.cookie, body: {} })
    expect(r.status).toBe(200)
    expect((r.json as unknown as AdminEventResponse).contentCancelled).toEqual([id])
    expect(await row(id)).toMatchObject({ status: 'draft', effectiveAt: null, publishedBy: null, linkedEventId: null, linkedRole: null })
    expect(await live(h, a)).toMatchObject({ hash: 'base', scheduled: null })
    const un = (await audits()).find((x) => x.action === 'content.unschedule')
    expect(un).toMatchObject({ targetId: String(id), before: { status: 'published', linkedEventId: ev, linkedRole: 'start' }, after: { status: 'draft' } })
    // It is an ordinary draft again: it can be published on its own.
    expect((await h.call('POST', `${C}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })).status).toBe(200)
  })

  it('archiving after the start leaves the versions alone', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a, { startsAt: T0 + HOUR, endsAt: T0 + DAY })
    const id = await draft(h, a, wave(5))
    const r1 = await publishLinked(h, a, id, ev, { revertWhenEnds: true })
    const revertId = asVersion(r1).revert!.id
    now = T0 + 2 * HOUR
    const r = await h.call('POST', `${E}/${ev}/archive`, { cookie: a.cookie, body: {} })
    expect((r.json as unknown as AdminEventResponse).contentCancelled).toBeUndefined()
    expect(await row(id)).toMatchObject({ status: 'published', linkedEventId: ev })
    expect(await row(revertId)).toMatchObject({ status: 'published', linkedRole: 'end' })
    expect((await live(h, a)).active?.id).toBe(id)
  })

  it('the event editor lists what is tied to it', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(5), 'Bigger waves')
    const r1 = await publishLinked(h, a, id, ev, { revertWhenEnds: true })
    const revertId = asVersion(r1).revert!.id
    const got = (await h.call('GET', `${E}/${ev}`, { cookie: a.cookie })).json as unknown as AdminEventResponse
    expect(got.linkedContent).toEqual([
      { id, title: 'Bigger waves', role: 'start', effectiveAt: T0 + 2 * HOUR, active: false, scheduled: true, revertStale: false },
      { id: revertId, title: 'Back after spring-fest', role: 'end', effectiveAt: T0 + DAY, active: false, scheduled: true, revertStale: false },
    ])
  })
})

describe('go back when the event ends', () => {
  it('schedules a copy of what was in force before the start at the end of the event, tied to it with role end', async () => {
    const h = makeApp()
    const a = await admin(h)
    const before = await plain(h, a, wave(5))
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(6))
    const r = await publishLinked(h, a, id, ev, { revertWhenEnds: true })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    const back = asVersion(r).revert!
    expect(back).toMatchObject({ status: 'published', scheduled: true, effectiveAt: T0 + DAY, linkedRole: 'end', revertOfVersionId: id, parentId: before, linkedEvent: { id: ev } })
    const copy = await row(back.id)
    expect(copy.patch).toEqual(wave(5))
    expect(copy.hash).toBe((await row(before)).hash)
    const entries = (await audits()).filter((x) => x.action === 'content.schedule')
    expect(entries.map((x) => x.targetId).sort()).toEqual([String(id), String(back.id)].sort())
    const endEntry = entries.find((x) => x.targetId === String(back.id))!
    expect(endEntry).toMatchObject({ after: { linkedRole: 'end', revertOfVersionId: id, copiedFromVersionId: before, effectiveAt: T0 + DAY } })
    // Over time: before -> start version (event start) -> copy of «before» (event end).
    now = T0 + 2 * HOUR
    expect((await live(h, a)).active?.id).toBe(id)
    now = T0 + DAY
    expect((await live(h, a)).active?.id).toBe(back.id)
    expect((await live(h, a)).patch).toEqual(wave(5))
  })

  it('without anything in force before, the copy is the empty patch (the base content)', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(6))
    const back = asVersion(await publishLinked(h, a, id, ev, { revertWhenEnds: true })).revert!
    expect((await row(back.id)).patch).toEqual({})
    expect(back.parentId).toBeNull()
    now = T0 + DAY
    // An empty patch resolves to the base content itself (hash 'base', no active version).
    expect(await live(h, a)).toMatchObject({ hash: 'base', patch: {}, active: null, scheduled: null })
  })

  it('what was in force before is read at the start time: a version scheduled for earlier counts, one tied to the same event does not', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a, { startsAt: T0 + 6 * HOUR, endsAt: T0 + DAY })
    await plain(h, a, wave(5)) // in force now
    const sooner = await plain(h, a, wave(7), T0 + 3 * HOUR) // scheduled before the event
    await plain(h, a, wave(8), T0 + 12 * HOUR) // scheduled DURING the event: not «before»
    const first = await draft(h, a, wave(6))
    await publishLinked(h, a, first, ev)
    const second = await draft(h, a, wave(4))
    const back = asVersion(await publishLinked(h, a, second, ev, { revertWhenEnds: true })).revert!
    const copy = await row(back.id)
    expect(copy.patch).toEqual(wave(7))
    expect(copy.parentId).toBe(sooner)
  })

  it('moves with the event end, and is cancelled (back to a draft) with the event', async () => {
    const h = makeApp()
    const a = await admin(h)
    await plain(h, a, wave(5))
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(6))
    const back = asVersion(await publishLinked(h, a, id, ev, { revertWhenEnds: true })).revert!
    const moved = await h.call('PUT', `${E}/${ev}`, { cookie: a.cookie, body: { endsAt: T0 + 2 * DAY } })
    expect((moved.json as unknown as AdminEventResponse).contentMoved).toEqual([back.id])
    expect((await row(back.id)).effectiveAt?.getTime()).toBe(T0 + 2 * DAY)
    expect((await row(id)).effectiveAt?.getTime()).toBe(T0 + 2 * HOUR) // only the end moved
    const both = await h.call('PUT', `${E}/${ev}`, { cookie: a.cookie, body: { startsAt: T0 + 4 * HOUR, endsAt: T0 + 3 * DAY } })
    expect((both.json as unknown as AdminEventResponse).contentMoved).toEqual([id, back.id])
    const arch = await h.call('POST', `${E}/${ev}/archive`, { cookie: a.cookie, body: {} })
    expect((arch.json as unknown as AdminEventResponse).contentCancelled).toEqual([id, back.id])
    expect(await row(back.id)).toMatchObject({ status: 'draft', effectiveAt: null, linkedEventId: null, linkedRole: null, revertOfVersionId: null })
    expect(await row(id)).toMatchObject({ status: 'draft', linkedEventId: null })
  })

  it('cancelling the start version by hand takes its copy with it; cancelling the copy alone leaves the start version', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const one = await draft(h, a, wave(6))
    const backOne = asVersion(await publishLinked(h, a, one, ev, { revertWhenEnds: true })).revert!
    const un = await h.call('POST', `${C}/versions/${one}/unschedule`, { cookie: a.cookie, body: {} })
    expect(un.status).toBe(200)
    expect(asVersion(un).version).toMatchObject({ status: 'draft', linkedEvent: null, linkedRole: null })
    expect(await row(backOne.id)).toMatchObject({ status: 'draft', linkedEventId: null })
    expect((await audits()).filter((x) => x.action === 'content.unschedule').map((x) => x.targetId).sort()).toEqual([String(one), String(backOne.id)].sort())
    // Only the copy.
    const two = await draft(h, a, wave(6))
    const backTwo = asVersion(await publishLinked(h, a, two, ev, { revertWhenEnds: true })).revert!
    expect((await h.call('POST', `${C}/versions/${backTwo.id}/unschedule`, { cookie: a.cookie, body: {} })).status).toBe(200)
    expect(await row(two)).toMatchObject({ status: 'published', linkedRole: 'start' })
  })

  it('a version published by hand in the meantime does not cancel the copy: it stays scheduled and is flagged as out of date', async () => {
    const h = makeApp()
    const a = await admin(h)
    await plain(h, a, wave(5))
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(6))
    const back = asVersion(await publishLinked(h, a, id, ev, { revertWhenEnds: true })).revert!
    const flag = async () => {
      const list = (await h.call('GET', `${C}/versions`, { cookie: a.cookie })).json as unknown as AdminContentVersionsResponse
      return list.items.find((x) => x.id === back.id)!.revertStale
    }
    expect(await flag()).toBe(false)
    // Published now (before the event): the copy would restore an outdated baseline.
    const manual = await plain(h, a, wave(7))
    expect(await flag()).toBe(true)
    expect((await live(h, a)).scheduled).toMatchObject({ id }) // the next one is still the event's
    const got = (await h.call('GET', `${E}/${ev}`, { cookie: a.cookie })).json as unknown as AdminEventResponse
    expect(got.linkedContent?.find((x) => x.id === back.id)?.revertStale).toBe(true)
    // The copy still fires at the end of the event.
    now = T0 + DAY
    expect((await live(h, a)).active?.id).toBe(back.id)
    expect((await row(back.id)).patch).toEqual(wave(5))
    expect(manual).toBeGreaterThan(0)
  })

  it('a version scheduled inside the event window also flags the copy; one after the end does not', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const id = await draft(h, a, wave(6))
    const back = asVersion(await publishLinked(h, a, id, ev, { revertWhenEnds: true })).revert!
    const flag = async () => ((await h.call('GET', `${C}/versions`, { cookie: a.cookie })).json as unknown as AdminContentVersionsResponse).items.find((x) => x.id === back.id)!.revertStale
    await plain(h, a, wave(8), T0 + 2 * DAY) // after the end: it overrides the copy, which is what the admin wants
    expect(await flag()).toBe(false)
    await plain(h, a, wave(7), T0 + 5 * HOUR) // during the event
    expect(await flag()).toBe(true)
  })

  it('every tied write is audited by the same admin and a failed publish leaves no copy behind', async () => {
    const h = makeApp()
    const a = await admin(h)
    const ev = await publishedEvent(h, a)
    const bad = await draft(h, a, { config: { encounters: { shinyChance: 0.5 } } })
    expect((await publishLinked(h, a, bad, ev, { revertWhenEnds: true })).status).toBe(422)
    expect((await database.db.select().from(contentVersions)).filter((x) => x.linkedRole === 'end')).toHaveLength(0)
    const id = await draft(h, a, wave(6))
    await publishLinked(h, a, id, ev, { revertWhenEnds: true })
    const entries = (await audits()).filter((x) => x.action === 'content.schedule')
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((x) => x.actorId))).toEqual(new Set([a.id]))
  })
})
