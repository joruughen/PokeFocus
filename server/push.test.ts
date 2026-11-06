/**
 * Web Push tests (server/push.ts, /api/push/*, env VAPID_*). The push service is a
 * fake sender: nothing touches the network. Clock injected; PGlite in memory.
 */
import { createECDH, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import webpush from 'web-push'
import { defaultContext } from '../src/engine'
import {
  EMPTY_DOC,
  MAX_PUSH_SUBSCRIPTIONS,
  PUSH_GRACE_MS,
  PUSH_MAX_AGE_MS,
  PUSH_TAG,
  type GameDoc,
  type PushPayload,
  type SessionTimer,
} from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { playerDocs, pushSent, pushSubscriptions } from './db/schema'
import { loadEnv } from './env'
import { createPushService, endpointProblem, type PushSender, type PushTarget } from './push'
import { RateLimiter } from './rate-limit'

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 6, 12, 0)
const MIN = 60_000
const VAPID = webpush.generateVAPIDKeys()
const VAPID_ENV = { VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'mailto:ops@pokefocus.test' }
const CLAIM_MIN = defaultContext().config.session.claimWindowMinutes

let database: Database
let now = T0
const clock = () => now

// --- fake push service -----------------------------------------------------
interface SentCall {
  endpoint: string
  payload: PushPayload
  ttl: number
}
let sent: SentCall[] = []
/** Per-endpoint behaviour: a status code to fail with, 'throw' (network error) or 'hang'. */
let behaviour = new Map<string, number | 'throw'>()
const fakeSender: PushSender = async (t: PushTarget, payload, opts) => {
  const b = behaviour.get(t.endpoint)
  if (b === 'throw') throw new Error('ECONNRESET')
  if (typeof b === 'number') throw Object.assign(new Error('push service error'), { statusCode: b })
  sent.push({ endpoint: t.endpoint, payload: JSON.parse(payload) as PushPayload, ttl: opts.ttlSeconds })
  return { statusCode: 201 }
}

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  now = T0
  sent = []
  behaviour = new Map()
  await database.db.delete(pushSubscriptions)
  await database.db.delete(pushSent)
})

function makeApp(opts: { vapid?: boolean; env?: Record<string, string> } = {}) {
  const limiter = new RateLimiter(clock)
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, ...(opts.vapid === false ? {} : VAPID_ENV), ...opts.env })
  const created = createApp({ env, db: database.db, clock, limiter, pushSender: fakeSender })
  return { ...created, limiter, env }
}

let ipSeq = 0
async function call(a: ReturnType<typeof makeApp>, method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`, ...opts.headers }
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  if (opts.cookie) headers.cookie = `pf_session=${opts.cookie}`
  const res = await a.app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}) })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null
  } catch {
    json = null
  }
  const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
  return { status: res.status, json, text, res, cookie: sc ? sc[1]! : null }
}

interface U {
  id: string
  cookie: string
}
let userSeq = 0
async function register(a: ReturnType<typeof makeApp>): Promise<U> {
  const n = ++userSeq
  const r = await call(a, 'POST', '/api/auth/register', {
    body: { email: `push${n}@test.dev`, password: 'correct horse', trainerName: `Push ${n}`, country: 'PE' },
  })
  expect(r.status).toBe(201)
  return { id: (r.json as { user: { id: string } }).user.id, cookie: r.cookie! }
}

const p256dh = () => createECDH('prime256v1').generateKeys().toString('base64url')
const authKey = () => randomBytes(16).toString('base64url')
let epSeq = 0
const endpoint = (host = 'fcm.googleapis.com') => `https://${host}/fcm/send/ep-${++epSeq}-${randomBytes(6).toString('hex')}`
const subBody = (ep = endpoint()) => ({ endpoint: ep, keys: { p256dh: p256dh(), auth: authKey() } })

const subsOf = (userId: string) => database.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))

async function subscribe(a: ReturnType<typeof makeApp>, u: U, ep = endpoint()) {
  const r = await call(a, 'POST', '/api/push/subscribe', { cookie: u.cookie, body: subBody(ep) })
  expect(r.status).toBe(204)
  return ep
}

/** Write the player doc directly: a running (or not) timer and a locale. */
async function setDoc(userId: string, timer: Partial<SessionTimer> | null, locale: 'es' | 'en' = 'en') {
  const doc: GameDoc = {
    ...EMPTY_DOC,
    player: { profile: { locale } } as unknown as GameDoc['player'],
    timer: timer === null ? null : { sessionId: 's-1', endsAt: T0, pausedAt: null, pausedMs: 0, notified: false, ...timer },
  }
  await database.db
    .insert(playerDocs)
    .values({ userId, doc, version: 1 })
    .onConflictDoUpdate({ target: playerDocs.userId, set: { doc } })
}

// ---------------------------------------------------------------------------

describe('env: VAPID_*', () => {
  it('none = disabled, empty strings count as unset', () => {
    expect(loadEnv({}).vapid).toBeNull()
    expect(loadEnv({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }).vapid).toBeNull()
  })

  it('all three = enabled', () => {
    expect(loadEnv(VAPID_ENV).vapid).toEqual({ publicKey: VAPID.publicKey, privateKey: VAPID.privateKey, subject: 'mailto:ops@pokefocus.test' })
    expect(loadEnv({ ...VAPID_ENV, VAPID_SUBJECT: 'https://pokefocus.example' }).vapid?.subject).toBe('https://pokefocus.example')
  })

  const messageOf = (src: Record<string, string | undefined>) => {
    try {
      loadEnv(src)
    } catch (e) {
      return (e as Error).message
    }
    return ''
  }

  it('rejects a partial set without echoing the private key', () => {
    for (const partial of [
      { VAPID_PUBLIC_KEY: VAPID.publicKey },
      { VAPID_PRIVATE_KEY: VAPID.privateKey },
      { VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey },
      { VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'mailto:a@b.c' },
    ]) {
      const m = messageOf(partial)
      expect(m).toMatch(/^Invalid environment: .*all three/)
      expect(m).not.toContain(VAPID.privateKey)
    }
  })

  it('rejects malformed keys and subjects, never echoing values', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ VAPID_PUBLIC_KEY: VAPID.publicKey.slice(0, -4) }, /VAPID_PUBLIC_KEY/],
      [{ VAPID_PUBLIC_KEY: VAPID.privateKey }, /VAPID_PUBLIC_KEY/], // 32 bytes, not a point
      [{ VAPID_PUBLIC_KEY: 'C' + VAPID.publicKey.slice(1) }, /VAPID_PUBLIC_KEY/], // not 0x04-prefixed
      [{ VAPID_PRIVATE_KEY: VAPID.privateKey + 'AAAA' }, /VAPID_PRIVATE_KEY/],
      [{ VAPID_PRIVATE_KEY: VAPID.privateKey.replace(/.$/, '+') }, /VAPID_PRIVATE_KEY/], // not base64url
      [{ VAPID_PRIVATE_KEY: 'not a key!!' }, /VAPID_PRIVATE_KEY/],
      [{ VAPID_SUBJECT: 'ops@pokefocus.test' }, /VAPID_SUBJECT: must start with mailto: or https:\/\//],
      [{ VAPID_SUBJECT: 'http://pokefocus.example' }, /VAPID_SUBJECT/],
    ]
    for (const [patch, re] of cases) {
      const m = messageOf({ ...VAPID_ENV, ...patch })
      expect(m).toMatch(/^Invalid environment: /)
      expect(m).toMatch(re)
      expect(m).not.toContain(VAPID.privateKey.slice(0, 20))
      if (patch.VAPID_PRIVATE_KEY) expect(m).not.toContain(patch.VAPID_PRIVATE_KEY)
    }
  })
})

describe('endpoint allowlist', () => {
  it('accepts the real push services', () => {
    for (const host of [
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
      'api.push.apple.com',
      'wns2-par02p.notify.windows.com',
    ]) {
      expect(endpointProblem(`https://${host}/x/abc`)).toBeNull()
    }
    expect(endpointProblem('https://fcm.googleapis.com:443/fcm/send/abc')).toBeNull()
  })

  it('rejects everything else', () => {
    expect(endpointProblem('http://fcm.googleapis.com/fcm/send/abc')).toBe('not_https')
    expect(endpointProblem('ftp://fcm.googleapis.com/x')).toBe('not_https')
    expect(endpointProblem('https://evil.example/x')).toBe('host')
    expect(endpointProblem('https://fcm.googleapis.com.evil.com/x')).toBe('host')
    expect(endpointProblem('https://evilgoogleapis.com/x')).toBe('host')
    expect(endpointProblem('https://user:pw@fcm.googleapis.com/x')).toBe('credentials')
    expect(endpointProblem('https://fcm.googleapis.com:8443/x')).toBe('port')
    expect(endpointProblem('https://127.0.0.1/x')).toBe('host')
    expect(endpointProblem('not a url')).toBe('not_url')
    expect(endpointProblem(`https://fcm.googleapis.com/${'a'.repeat(2048)}`)).toBe('too_long')
  })
})

describe('/api/push routes', () => {
  it('config: enabled with the public key, never cached; needs a session', async () => {
    const a = makeApp()
    const u = await register(a)
    const r = await call(a, 'GET', '/api/push/config', { cookie: u.cookie })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ enabled: true, publicKey: VAPID.publicKey })
    expect(r.res.headers.get('cache-control')).toBe('no-store')
    expect((await call(a, 'GET', '/api/push/config')).status).toBe(401)
    expect((await call(a, 'POST', '/api/push/subscribe', { body: subBody() })).status).toBe(401)
  })

  it('disabled: config says so, subscribe / unsubscribe / test → 404 push_disabled', async () => {
    const a = makeApp({ vapid: false })
    const u = await register(a)
    const r = await call(a, 'GET', '/api/push/config', { cookie: u.cookie })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ enabled: false, publicKey: null })
    expect(r.res.headers.get('cache-control')).toBe('no-store')
    for (const [path, body] of [
      ['/api/push/subscribe', subBody()],
      ['/api/push/unsubscribe', { endpoint: endpoint() }],
      ['/api/push/test', {}],
    ] as const) {
      const x = await call(a, 'POST', path, { cookie: u.cookie, body })
      expect(x.status).toBe(404)
      expect(x.json).toEqual({ error: 'push_disabled' })
    }
    expect(await a.deps.push.runDue()).toBe(0)
  })

  it('subscribe validates the endpoint and the keys', async () => {
    const a = makeApp()
    const u = await register(a)
    const bad = [
      { ...subBody(), endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
      { ...subBody(), endpoint: 'https://evil.example/push' },
      { ...subBody(), endpoint: 'https://fcm.googleapis.com.evil.com/fcm/send/x' },
      { ...subBody(), endpoint: 'https://evilgoogleapis.com/fcm/send/x' },
      { ...subBody(), endpoint: 'https://a:b@fcm.googleapis.com/fcm/send/x' },
      { ...subBody(), endpoint: `https://fcm.googleapis.com/${'x'.repeat(2100)}` },
      { ...subBody(), keys: { p256dh: randomBytes(64).toString('base64url'), auth: authKey() } },
      { ...subBody(), keys: { p256dh: p256dh(), auth: randomBytes(15).toString('base64url') } },
      { ...subBody(), keys: { p256dh: p256dh(), auth: 'a'.repeat(200) } },
      { ...subBody(), keys: { p256dh: 'not base64!', auth: authKey() } },
      { endpoint: endpoint() },
      { endpoint: 42, keys: { p256dh: p256dh(), auth: authKey() } },
    ]
    for (const body of bad) {
      const r = await call(a, 'POST', '/api/push/subscribe', { cookie: u.cookie, body })
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400)
      expect(r.json).toMatchObject({ error: 'invalid_body' })
    }
    expect(await subsOf(u.id)).toEqual([])
    const ep = await subscribe(a, u)
    const rows = await subsOf(u.id)
    expect(rows.map((s) => s.endpoint)).toEqual([ep])
  })

  it('upsert: re-subscribing updates keys; another user takes the endpoint over', async () => {
    const a = makeApp()
    const [u1, u2] = [await register(a), await register(a)]
    const ep = endpoint('updates.push.services.mozilla.com')
    const first = subBody(ep)
    expect((await call(a, 'POST', '/api/push/subscribe', { cookie: u1.cookie, body: first, headers: { 'user-agent': 'Firefox' } })).status).toBe(204)
    const again = subBody(ep)
    expect((await call(a, 'POST', '/api/push/subscribe', { cookie: u1.cookie, body: again })).status).toBe(204)
    let rows = await subsOf(u1.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.p256dh).toBe(again.keys.p256dh)

    // Same browser, different login: the row moves.
    expect((await call(a, 'POST', '/api/push/subscribe', { cookie: u2.cookie, body: subBody(ep) })).status).toBe(204)
    expect(await subsOf(u1.id)).toEqual([])
    rows = await subsOf(u2.id)
    expect(rows.map((s) => s.endpoint)).toEqual([ep])
  })

  it(`caps at ${MAX_PUSH_SUBSCRIPTIONS} subscriptions per user (re-subscribing an own endpoint is fine)`, async () => {
    const a = makeApp()
    const u = await register(a)
    const eps: string[] = []
    for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS; i++) eps.push(await subscribe(a, u))
    const over = await call(a, 'POST', '/api/push/subscribe', { cookie: u.cookie, body: subBody() })
    expect(over.status).toBe(409)
    expect(over.json).toEqual({ error: 'too_many' })
    expect((await call(a, 'POST', '/api/push/subscribe', { cookie: u.cookie, body: subBody(eps[3]) })).status).toBe(204)
    expect(await subsOf(u.id)).toHaveLength(MAX_PUSH_SUBSCRIPTIONS)
  })

  it('unsubscribe removes only the caller’s own subscription and is idempotent', async () => {
    const a = makeApp()
    const [u1, u2] = [await register(a), await register(a)]
    const ep1 = await subscribe(a, u1)
    const ep2 = await subscribe(a, u2)
    expect((await call(a, 'POST', '/api/push/unsubscribe', { cookie: u1.cookie, body: { endpoint: ep2 } })).status).toBe(204)
    expect(await subsOf(u2.id)).toHaveLength(1)
    expect((await call(a, 'POST', '/api/push/unsubscribe', { cookie: u1.cookie, body: { endpoint: ep1 } })).status).toBe(204)
    expect(await subsOf(u1.id)).toEqual([])
    expect((await call(a, 'POST', '/api/push/unsubscribe', { cookie: u1.cookie, body: { endpoint: ep1 } })).status).toBe(204)
    expect((await call(a, 'POST', '/api/push/unsubscribe', { cookie: u1.cookie, body: {} })).status).toBe(400)
  })

  it('test: sends to every subscription, drops 410s, 409 without any', async () => {
    const a = makeApp()
    const u = await register(a)
    const none = await call(a, 'POST', '/api/push/test', { cookie: u.cookie })
    expect(none.status).toBe(409)
    expect(none.json).toEqual({ error: 'no_subscription' })

    const live1 = await subscribe(a, u)
    const live2 = await subscribe(a, u, endpoint('web.push.apple.com'))
    const gone = await subscribe(a, u)
    const flaky = await subscribe(a, u)
    behaviour.set(gone, 410)
    behaviour.set(flaky, 503)
    await setDoc(u.id, null, 'es')
    const r = await call(a, 'POST', '/api/push/test', { cookie: u.cookie })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ sent: 2 })
    expect(sent.map((s) => s.endpoint).sort()).toEqual([live1, live2].sort())
    expect(sent[0]!.payload).toEqual({ type: 'test', title: 'Avisos activados', body: 'Así te avisaremos cuando termine tu sesión.', tag: PUSH_TAG, url: '/' })
    const left = (await subsOf(u.id)).map((s) => s.endpoint).sort()
    expect(left).toEqual([live1, live2, flaky].sort())
    expect((await subsOf(u.id)).find((s) => s.endpoint === live1)!.lastSuccessAt?.getTime()).toBe(T0)
  })

  it('test: English payload by default (no player yet)', async () => {
    const a = makeApp()
    const u = await register(a)
    await subscribe(a, u)
    const r = await call(a, 'POST', '/api/push/test', { cookie: u.cookie })
    expect(r.status).toBe(200)
    expect(sent[0]!.payload).toMatchObject({ type: 'test', title: 'Notifications are on', body: 'This is how we will tell you when your session ends.' })
  })

  it('rate limits: subscribe/unsubscribe 30 / 15 min, test 5 / h, per user', async () => {
    const a = makeApp()
    const u = await register(a)
    const ep = await subscribe(a, u) // 1
    for (let i = 1; i < 30; i++) {
      const path = i % 2 ? '/api/push/unsubscribe' : '/api/push/subscribe'
      const body = i % 2 ? { endpoint: ep } : subBody(ep)
      expect((await call(a, 'POST', path, { cookie: u.cookie, body })).status).toBe(204)
    }
    const blocked = await call(a, 'POST', '/api/push/subscribe', { cookie: u.cookie, body: subBody(ep) })
    expect(blocked.status).toBe(429)
    expect(blocked.json).toMatchObject({ error: 'rate_limited' })
    expect(blocked.res.headers.get('retry-after')).toBeTruthy()
    // Another user is not affected.
    const other = await register(a)
    await subscribe(a, other)
    now += 15 * MIN
    await subscribe(a, u)

    for (let i = 0; i < 5; i++) expect((await call(a, 'POST', '/api/push/test', { cookie: u.cookie })).status).toBe(200)
    expect((await call(a, 'POST', '/api/push/test', { cookie: u.cookie })).status).toBe(429)
    now += 60 * MIN
    expect((await call(a, 'POST', '/api/push/test', { cookie: u.cookie })).status).toBe(200)
  })
})

describe('runDue (session-end push)', () => {
  async function setup(locale: 'es' | 'en' = 'en') {
    const a = makeApp()
    const u = await register(a)
    const ep = await subscribe(a, u)
    await setDoc(u.id, { sessionId: `s-${u.id}`, endsAt: T0 }, locale)
    return { a, u, ep, push: a.deps.push }
  }

  it('sends once at endsAt + grace, not before, with a 5-minute TTL', async () => {
    const { push, ep } = await setup()
    now = T0 + PUSH_GRACE_MS - 1
    expect(await push.runDue()).toBe(0)
    expect(sent).toEqual([])
    now = T0 + PUSH_GRACE_MS
    expect(await push.runDue()).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      endpoint: ep,
      ttl: CLAIM_MIN * 60,
      payload: { type: 'session-end', title: 'Session complete!', body: `Claim your rewards within the next ${CLAIM_MIN} minutes.`, tag: PUSH_TAG, url: '/' },
    })
    now += 15_000
    expect(await push.runDue()).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('Spanish payload, claim window from the game config', async () => {
    const { push } = await setup('es')
    now = T0 + PUSH_GRACE_MS
    await push.runDue()
    expect(sent[0]!.payload).toEqual({
      type: 'session-end',
      title: '¡Sesión completa!',
      body: `Reclama tus recompensas en los próximos ${CLAIM_MIN} minutos.`,
      tag: PUSH_TAG,
      url: '/',
    })
  })

  it('skips: notified, paused, stale, claimed (timer null), no subscriptions', async () => {
    const { push, u } = await setup()
    now = T0 + PUSH_GRACE_MS
    await setDoc(u.id, { sessionId: 'n', endsAt: T0, notified: true })
    expect(await push.runDue()).toBe(0)
    await setDoc(u.id, { sessionId: 'p', endsAt: T0, pausedAt: T0 - MIN })
    expect(await push.runDue()).toBe(0)
    await setDoc(u.id, null)
    expect(await push.runDue()).toBe(0)
    await setDoc(u.id, { sessionId: 'old', endsAt: now - PUSH_MAX_AGE_MS })
    expect(await push.runDue()).toBe(0)
    expect(sent).toEqual([])

    // A user without subscriptions with a due timer: nothing (and nothing claimed).
    const a = makeApp()
    const lonely = await register(a)
    await setDoc(lonely.id, { sessionId: 'l', endsAt: T0 })
    expect(await push.runDue()).toBe(0)
    expect(await database.db.select().from(pushSent)).toEqual([])
  })

  it('a later session of the same user gets its own push', async () => {
    const { push, u } = await setup()
    now = T0 + PUSH_GRACE_MS
    expect(await push.runDue()).toBe(1)
    await setDoc(u.id, { sessionId: 'next', endsAt: T0 + 30 * MIN })
    now = T0 + 30 * MIN + PUSH_GRACE_MS
    expect(await push.runDue()).toBe(1)
    expect(sent).toHaveLength(2)
  })

  it('at most once across overlapping runs and a restart', async () => {
    const { push, a } = await setup()
    now = T0 + PUSH_GRACE_MS
    const results = await Promise.all([push.runDue(), push.runDue(), push.runDue()])
    expect(results.reduce((x, y) => x + y, 0)).toBe(1)
    expect(sent).toHaveLength(1)
    const restarted = createPushService({ env: a.env, db: database.db, clock, sender: fakeSender })
    now += 15_000
    expect(await restarted.runDue()).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('retries after an all-transient failure, at most 3 attempts', async () => {
    const { push, ep, u } = await setup()
    behaviour.set(ep, 503)
    now = T0 + PUSH_GRACE_MS
    for (let i = 0; i < 5; i++) {
      expect(await push.runDue()).toBe(0)
      now += 15_000
    }
    const [row] = await database.db.select().from(pushSent).where(eq(pushSent.userId, u.id))
    expect(row!.attempts).toBe(3)
    expect(await subsOf(u.id)).toHaveLength(1) // kept
  })

  it('a thrown sender (network) also retries, and success stops it', async () => {
    const { push, ep, u } = await setup()
    behaviour.set(ep, 'throw')
    now = T0 + PUSH_GRACE_MS
    expect(await push.runDue()).toBe(0)
    behaviour.delete(ep)
    now += 15_000
    expect(await push.runDue()).toBe(1)
    now += 15_000
    expect(await push.runDue()).toBe(0)
    expect(sent).toHaveLength(1)
    const [row] = await database.db.select().from(pushSent).where(eq(pushSent.userId, u.id))
    expect(row!.attempts).toBe(2)
  })

  it('no retry when one subscription succeeded and another failed transiently', async () => {
    const { push, a, u } = await setup()
    const flaky = await subscribe(a, u)
    behaviour.set(flaky, 500)
    now = T0 + PUSH_GRACE_MS
    expect(await push.runDue()).toBe(1)
    now += 15_000
    expect(await push.runDue()).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('410 removes the subscription and does not retry; a 403 does not retry either', async () => {
    const { push, ep, u, a } = await setup()
    behaviour.set(ep, 410)
    now = T0 + PUSH_GRACE_MS
    expect(await push.runDue()).toBe(0)
    expect(await subsOf(u.id)).toEqual([])

    const v = await register(a)
    const ep2 = await subscribe(a, v)
    behaviour.set(ep2, 403)
    await setDoc(v.id, { sessionId: 'v', endsAt: T0 })
    expect(await push.runDue()).toBe(0)
    behaviour.delete(ep2)
    now += 15_000
    expect(await push.runDue()).toBe(0)
    expect(await subsOf(v.id)).toHaveLength(1)
  })

  it('a sender that throws synchronously does not break the run', async () => {
    const a = makeApp()
    const u = await register(a)
    await subscribe(a, u)
    await setDoc(u.id, { sessionId: 'sync', endsAt: T0 })
    const throwing: PushSender = () => {
      throw new Error('boom')
    }
    const svc = createPushService({ env: a.env, db: database.db, clock, sender: throwing })
    now = T0 + PUSH_GRACE_MS
    await expect(svc.runDue()).resolves.toBe(0)
  })
})

describe('production static: /sw.js', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pf-static-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>PokeFocus</title>')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const prodApp = () => makeApp({ env: { NODE_ENV: 'production', STATIC_DIR: dir } })

  it('a missing /sw.js is a 404, not the SPA index', async () => {
    const r = await call(prodApp(), 'GET', '/sw.js')
    expect(r.status).toBe(404)
    expect(r.text).not.toContain('<!doctype html>')
    // The SPA fallback still works for app routes.
    const spa = await call(prodApp(), 'GET', '/league')
    expect(spa.status).toBe(200)
    expect(spa.text).toContain('<title>PokeFocus</title>')
  })

  it('serves /sw.js as JavaScript, revalidated every time', async () => {
    writeFileSync(join(dir, 'sw.js'), "self.addEventListener('push', () => {})")
    const r = await call(prodApp(), 'GET', '/sw.js')
    expect(r.status).toBe(200)
    expect(r.res.headers.get('content-type')).toMatch(/^text\/javascript/)
    expect(r.res.headers.get('cache-control')).toBe('no-cache')
    expect(r.res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.text).toContain("addEventListener('push'")
  })
})
