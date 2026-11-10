/**
 * Live content service (docs/admin-plan.md §1): active version and events,
 * hashing, /api/content, SSE broadcast and the per-session pinning.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { baseContext, type EventOverlay } from '../src/engine'
import type { ActionResponse, ContentResponse, GameAction, ServerEvent } from '../src/game/protocol'
import { createApp } from './app'
import { canonicalJson, contentHashOf, createContentService, type ContentService, type PublishedEvent } from './content/service'
import { openDatabase, type Database } from './db/client'
import { contentSnapshots, contentVersions } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 3, 10, 0)
const MIN = 60_000
const HOUR = 60 * MIN

let database: Database
let now = T0
const clock = () => now
const bus = new EventBus()
const published: PublishedEvent[] = []
let content: ContentService
let app: ReturnType<typeof createApp>
const received: ServerEvent[] = []
let ipSeq = 0

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  content = createContentService({ db: database.db, bus, clock, events: async () => published })
  app = createApp({ env: loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, DEV_TOOLS: '1' }), db: database.db, clock, bus, content })
  bus.subscribe({ userId: 'watcher', sessionId: 's', send: (e) => received.push(e), close: () => {} })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.1.0.${++ipSeq % 250}`, ...opts.headers }
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  if (opts.cookie) headers.cookie = `pf_session=${opts.cookie}`
  const res = await app.app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const text = await res.text()
  return { res, status: res.status, json: text ? (JSON.parse(text) as unknown) : null }
}

let userSeq = 0
async function register(): Promise<string> {
  const n = ++userSeq
  const r = await call('POST', '/api/auth/register', { body: { email: `content${n}@test.dev`, password: 'correct horse', trainerName: 'Ash', country: 'PE' } })
  expect(r.status).toBe(201)
  return r.res.headers.get('set-cookie')!.match(/pf_session=([^;]*)/)![1]!
}

/** A game action at game time `t` with a fixed seed (DEV_TOOLS app). */
async function act<T extends GameAction['type']>(cookie: string, action: Extract<GameAction, { type: T }>, t: number) {
  const r = await call('POST', '/api/game/action', { cookie, body: action, headers: { 'x-dev-now': String(t), 'x-dev-seed': `seed-${action.type}` } })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as ActionResponse<T>
}

/** createPlayer + start at `t0`; returns the cookie. */
async function startedPlayer(t0: number): Promise<string> {
  const cookie = await register()
  await act(cookie, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'bulbasaur' }, t0)
  await act(cookie, { type: 'start', minutes: 25 }, t0)
  return cookie
}

const SHINY_PATCH = { config: { encounters: { shinyChance: 1 } } }

describe('content hash', () => {
  it('canonical JSON ignores key order and undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(canonicalJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }))
  })
  it("nothing to apply = 'base'; anything else = sha256 that depends on the content", () => {
    expect(contentHashOf({ patch: {}, events: [], eventItems: {} })).toBe('base')
    const h = contentHashOf({ patch: SHINY_PATCH, events: [], eventItems: {} })
    expect(h).toMatch(/^[a-f0-9]{64}$/)
    expect(contentHashOf({ patch: { config: { encounters: { shinyChance: 1 } } }, events: [], eventItems: {} })).toBe(h)
    expect(contentHashOf({ patch: { config: { encounters: { shinyChance: 0.5 } } }, events: [], eventItems: {} })).not.toBe(h)
    expect(contentHashOf({ patch: SHINY_PATCH, events: [], eventItems: {} }, 'other-base')).not.toBe(h)
  })
})

describe('pinning (no version published yet)', () => {
  let control: ActionResponse<'claim'>

  it('without a published patch everything runs on the base context and the doc gets no contentHash', async () => {
    const r = await content.current(T0)
    expect(r.hash).toBe('base')
    expect(r.ctx).toBe(baseContext())
    const body = await call('GET', '/api/content')
    expect(body.status).toBe(200)
    expect(body.res.headers.get('etag')).toBe('"base"')
    expect(body.res.headers.get('cache-control')).toBe('no-cache')
    expect(body.json).toEqual({ hash: 'base', baseHash: content.baseHash, patch: {}, events: [], eventItems: {} } satisfies ContentResponse)

    // Control run: start at T0, claim at T0+26 min (no publication).
    const cookie = await startedPlayer(T0)
    control = await act(cookie, { type: 'claim' }, T0 + 26 * MIN)
    expect(control.doc.player!.encounter).not.toBeNull()
    expect('contentHash' in control.doc.player!.encounter!).toBe(false)
    expect(control.doc.player!.history.at(-1)).toBeDefined()
    expect(await database.db.select().from(contentSnapshots)).toHaveLength(0)
  })

  it('publishing in the middle of a session does not change that session (claim = control run)', async () => {
    const cookie = await startedPlayer(T0)
    const g = (await call('GET', '/api/game', { cookie })).json as { doc: ActionResponse<'start'>['doc'] }
    expect('contentHash' in g.doc.player!.activeSession!).toBe(false)

    received.length = 0
    const v = await content.publish({ patch: SHINY_PATCH, effectiveAt: T0 + MIN, title: 'all shiny' })
    expect(v.hash).toMatch(/^[a-f0-9]{64}$/)
    // Real clock (T0) is before effectiveAt: scheduled, nothing announced yet.
    expect(received).toEqual([])
    expect((await content.current(T0 + 2 * MIN)).ctx.config.encounters.shinyChance).toBe(1)

    const claim = await act(cookie, { type: 'claim' }, T0 + 26 * MIN)
    expect(claim.result.outcome.result).toEqual(control.result.outcome.result)
    expect(claim.doc.player!.encounter).toEqual(control.doc.player!.encounter)
    expect(claim.doc.player!.encounter!.waves.flatMap((w) => w.wilds).some((w) => !w.isShiny)).toBe(true)
  })

  it('the tick broadcasts the new hash once the scheduled version is active', async () => {
    received.length = 0
    now = T0 + 2 * MIN
    const hash = await content.check()
    const active = await content.current(now)
    expect(hash).toBe(active.hash)
    expect(received).toEqual([{ type: 'content', hash: active.hash }])
    expect(await content.check()).toBeNull()
    expect(received).toHaveLength(1)
  })
})

describe('pinning (version active at start)', () => {
  it('a session started after the publication runs on it, also its waves, and stores the snapshot', async () => {
    const t1 = T0 + 30 * MIN
    const active = await content.current(t1)
    expect(active.hash).not.toBe('base')
    const cookie = await startedPlayer(t1)
    const g = (await call('GET', '/api/game', { cookie })).json as { doc: ActionResponse<'start'>['doc'] }
    expect(g.doc.player!.activeSession!.contentHash).toBe(active.hash)
    const [snap] = await database.db.select().from(contentSnapshots).where(eq(contentSnapshots.hash, active.hash))
    expect(snap?.resolved.patch).toEqual(SHINY_PATCH)

    // A newer version published before the claim: the session keeps the one it started with.
    await content.publish({ patch: { config: { encounters: { shinyChance: 0 } } }, effectiveAt: t1 + MIN })
    const claim = await act(cookie, { type: 'claim' }, t1 + 26 * MIN)
    const wilds = claim.doc.player!.encounter!.waves.flatMap((w) => w.wilds)
    expect(wilds.length).toBeGreaterThan(0)
    expect(wilds.every((w) => w.isShiny)).toBe(true)
    expect(claim.doc.player!.encounter!.contentHash).toBe(active.hash)
    expect(claim.doc.player!.activeSession).toBeNull()

    // Wave actions run on the encounter's content (nextWave keeps the pin).
    const next = await act(cookie, { type: 'nextWave' }, t1 + 27 * MIN)
    if (next.doc.player!.encounter) expect(next.doc.player!.encounter.contentHash).toBe(active.hash)
  })

  it('a restarted server rebuilds a pinned content from content_snapshots', async () => {
    const [snap] = await database.db.select().from(contentSnapshots)
    const fresh = createContentService({ db: database.db, clock })
    const r = await fresh.byHash(snap!.hash)
    expect(r?.hash).toBe(snap!.hash)
    expect(r?.ctx.contentHash).toBe(snap!.hash)
    expect(r?.ctx.config.encounters.shinyChance).toBe(1)
    expect(await fresh.byHash('f'.repeat(64))).toBeNull()
  })
})

describe('/api/content', () => {
  it('ETag + 304, immutable by hash, 404 for unknown hashes, drafts never show', async () => {
    await database.db.insert(contentVersions).values({ status: 'draft', patch: { config: { encounters: { shinyChance: 0.9 } } }, effectiveAt: new Date(T0) })
    await content.reload()
    const t = String(T0 + 30 * MIN)
    const r = await call('GET', '/api/content', { headers: { 'x-dev-now': t } })
    const body = r.json as ContentResponse
    expect(body.patch).toEqual(SHINY_PATCH)
    expect(r.res.headers.get('etag')).toBe(`"${body.hash}"`)
    const again = await call('GET', '/api/content', { headers: { 'x-dev-now': t, 'if-none-match': `"${body.hash}"` } })
    expect(again.status).toBe(304)

    const byHash = await call('GET', `/api/content/${body.hash}`)
    expect(byHash.status).toBe(200)
    expect(byHash.json).toEqual(body)
    expect(byHash.res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect((await call('GET', '/api/content/base')).res.headers.get('cache-control')).toBe('no-cache')
    expect((await call('GET', `/api/content/${'0'.repeat(64)}`)).status).toBe(404)
    expect((await call('GET', '/api/content/nope')).status).toBe(404)
  })
})

describe('live events', () => {
  it('active only inside [startsAt, endsAt); start and end change the hash and are broadcast', async () => {
    const ev: EventOverlay = {
      id: 'ev1',
      slug: 'grass-week',
      startsAt: T0 + 5 * HOUR,
      endsAt: T0 + 6 * HOUR,
      featured: [{ species: 'oddish', weightMult: 3 }],
      drops: [],
      missions: [],
    }
    published.push({ overlay: ev, revision: 1 })
    await content.reload()
    now = T0 + 4 * HOUR
    await content.check()
    const before = await content.current(now)
    expect(before.events).toEqual([])

    received.length = 0
    now = T0 + 5 * HOUR
    const during = await content.current(now)
    expect(during.events.map((e) => e.id)).toEqual(['ev1'])
    expect(during.eventRevs).toEqual({ ev1: 1 })
    expect(during.ctx.spawn.get('oddish')?.weightMult).toBe(3)
    expect(during.hash).not.toBe(before.hash)
    expect(await content.check()).toBe(during.hash)

    now = T0 + 6 * HOUR
    expect((await content.current(now)).hash).toBe(before.hash)
    expect(await content.check()).toBe(before.hash)
    expect(received.map((e) => (e as { hash: string }).hash)).toEqual([during.hash, before.hash])
  })
})
