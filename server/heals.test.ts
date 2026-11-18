/** Integration tests for study-group heals (/api/heals). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { GameAction, GameSnapshot, GroupHealView, HealsResponse, PublicUser, ServerEvent, StudyGroupView } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { groupHeals } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 4, 15, 0)
const MIN = 60_000

let database: Database
let now = T0
const clock = () => now
let app: ReturnType<typeof createApp>
let bus: EventBus

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  bus = new EventBus()
  app = createApp({ env: loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, DEV_TOOLS: '0' }), db: database.db, clock, bus })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

let ipSeq = 0
async function call(method: string, path: string, cookie: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.1.0.${++ipSeq % 250}` }
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  if (cookie) headers.cookie = `pf_session=${cookie}`
  const res = await app.app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, res }
}

interface U {
  user: PublicUser
  cookie: string
  events: ServerEvent[]
}

let seq = 0
async function newUser(name?: string): Promise<U> {
  const n = ++seq
  const r = await call('POST', '/api/auth/register', null, { email: `h${n}@test.dev`, password: 'correct horse', trainerName: name ?? `Healer ${n}`, country: 'PE' })
  expect(r.status).toBe(201)
  const cookie = r.res.headers.get('set-cookie')!.match(/pf_session=([^;]*)/)![1]!
  const u: U = { user: (r.json as { user: PublicUser }).user, cookie, events: [] }
  bus.subscribe({ userId: u.user.id, sessionId: 's', send: (e) => u.events.push(e), close: () => {} })
  expect((await act(u, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'bulbasaur' })).status).toBe(200)
  return u
}

const act = (u: U, a: GameAction) => call('POST', '/api/game/action', u.cookie, a)
const heals = async (u: U) => (await call('GET', '/api/heals', u.cookie)).json as unknown as HealsResponse
const game = async (u: U) => (await call('GET', '/api/game', u.cookie)).json as unknown as GameSnapshot
const healEvents = (u: U) => u.events.filter((e): e is Extract<ServerEvent, { type: 'heal' }> => e.type === 'heal')

async function befriend(a: U, b: U) {
  expect((await call('POST', '/api/friends/request', a.cookie, { friendCode: b.user.friendCode })).status).toBe(201)
  expect((await call('POST', `/api/friends/${a.user.id}/accept`, b.cookie)).status).toBe(204)
}

async function create(host: U, friends: U[], minutes = 25) {
  const r = await call('POST', '/api/groups', host.cookie, { minutes, friendIds: friends.map((f) => f.user.id) })
  expect(r.status, JSON.stringify(r.json)).toBe(201)
  return r.json as unknown as StudyGroupView
}

async function claim(u: U) {
  const r = await act(u, { type: 'claim' })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
}

/** Fresh friends graph: host + others, everyone friends with the host (and each other). */
async function crew(n: number): Promise<U[]> {
  const us: U[] = []
  for (let i = 0; i < n; i++) us.push(await newUser())
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) await befriend(us[i]!, us[j]!)
  for (const u of us) u.events.length = 0
  return us
}


const energyOf = async (u: U, uid: string) => (await game(u)).doc.player!.pokemon[uid]!.energy.current
const send = (from: U, to: U, groupId: string, uid: string) => call('POST', '/api/heals', from.cookie, { groupId, toUserId: to.user.id, uid })

describe('study-group heals', () => {
  it('one heal per wave after the sender\'s session, accepted after the receiver\'s: limits, declines, cancels, expiry and the window', async () => {
    now = T0
    const [a, b, c, d] = (await crew(4)) as [U, U, U, U]
    const g = await create(a, [b, c, d], 50)
    for (const u of [b, c, d]) expect((await call('POST', `/api/groups/${g.id}/accept`, u.cookie)).status).toBe(200)
    expect((await call('POST', `/api/groups/${g.id}/start`, a.cookie)).status).toBe(200)
    for (const u of [a, b, c, d]) u.events.length = 0

    // While the sender studies (no waves yet): nothing to send.
    now = T0 + 51 * MIN
    expect((await heals(a)).group).toBeNull()
    const early = await send(a, b, g.id, 'whatever')
    expect(early.json).toEqual({ error: 'not_in_waves' })
    await claim(a)
    // Wave 1 of 2: one heal.
    const hs = await heals(a)
    expect(hs.amount).toBe(20)
    expect(hs.group).toMatchObject({ id: g.id, remaining: 1 })
    const target = (u: U) => hs.group!.targets.find((t) => t.userId === u.user.id)!
    expect(target(b).pokemon.length).toBeGreaterThan(0)
    const [pb, pc, pd] = [target(b).pokemon[0]!.uid, target(c).pokemon[0]!.uid, target(d).pokemon[0]!.uid]

    // Only a Pokémon of the receiver's team, only inside the group.
    expect((await send(a, b, g.id, 'nope')).json).toEqual({ error: 'unknown_pokemon' })
    const outsider = await newUser()
    expect((await send(a, outsider, g.id, pb)).json).toEqual({ error: 'not_in_group' })
    expect((await send(a, a, g.id, pb)).json).toEqual({ error: 'not_in_group' })

    const s1 = await send(a, b, g.id, pb)
    expect(s1.status, JSON.stringify(s1.json)).toBe(201)
    const h1 = s1.json as unknown as GroupHealView
    expect(h1).toMatchObject({ status: 'pending', amount: 20, pokemonUid: pb, from: { userId: a.user.id }, to: { userId: b.user.id } })
    expect(healEvents(b)).toMatchObject([{ type: 'heal', healId: h1.id, status: 'pending', userId: a.user.id }])
    // Wave 1 gave one heal; the next wave gives another one (to a different player).
    expect((await send(a, c, g.id, pc)).json).toEqual({ error: 'heal_limit' })
    expect((await heals(a)).group).toMatchObject({ remaining: 0 })
    expect((await act(a, { type: 'nextWave' })).status).toBe(200)
    expect((await heals(a)).group).toMatchObject({ remaining: 1 })
    expect((await send(a, b, g.id, pb)).json).toEqual({ error: 'heal_already_sent' })
    const s2 = await send(a, c, g.id, pc)
    expect(s2.status).toBe(201)
    const h2 = s2.json as unknown as GroupHealView
    expect((await send(a, d, g.id, pd)).json).toEqual({ error: 'heal_limit' })
    expect((await heals(a)).group).toMatchObject({ remaining: 0 })

    // The receiver is still studying: pending, cannot accept yet.
    expect((await heals(b)).incoming.map((h) => h.id)).toEqual([h1.id])
    expect((await call('POST', `/api/heals/${h1.id}/accept`, b.cookie)).json).toEqual({ error: 'session_active' })
    await claim(b)
    const before = await energyOf(b, pb)
    const acc = await call('POST', `/api/heals/${h1.id}/accept`, b.cookie)
    expect(acc.status, JSON.stringify(acc.json)).toBe(200)
    expect((acc.json as unknown as GroupHealView).status).toBe('accepted')
    const gained = (await energyOf(b, pb)) - before
    expect(gained).toBeGreaterThan(0)
    expect(gained).toBeLessThanOrEqual(20)
    expect(healEvents(a).at(-1)).toMatchObject({ status: 'accepted', userId: b.user.id })
    expect((await call('POST', `/api/heals/${h1.id}/accept`, b.cookie)).json).toEqual({ error: 'heal_closed' })
    expect((await heals(b)).incoming).toEqual([])

    // Only the receiver accepts or declines; only the sender cancels.
    expect((await call('POST', `/api/heals/${h2.id}/accept`, a.cookie)).status).toBe(404)
    expect((await call('POST', `/api/heals/${h2.id}/cancel`, c.cookie)).status).toBe(404)
    // A declined heal frees the slot: the sender picks someone else.
    expect((await call('POST', `/api/heals/${h2.id}/decline`, c.cookie)).status).toBe(200)
    expect(healEvents(a).at(-1)).toMatchObject({ status: 'declined', userId: c.user.id })
    expect((await heals(a)).group).toMatchObject({ remaining: 1 })
    const s3 = await send(a, d, g.id, pd)
    expect(s3.status).toBe(201)
    const h3 = s3.json as unknown as GroupHealView
    // ... and so does a cancel.
    expect((await call('POST', `/api/heals/${h3.id}/cancel`, a.cookie)).status).toBe(200)
    expect((await call('POST', `/api/heals/${h3.id}/cancel`, a.cookie)).json).toEqual({ error: 'heal_closed' })
    const s4 = await send(a, c, g.id, pc)
    expect(s4.status).toBe(201)
    const h4 = s4.json as unknown as GroupHealView

    // A pending heal lapses after its time to live.
    now += 13 * 60 * MIN
    expect((await heals(c)).incoming).toEqual([])
    const [row] = await database.db.select().from(groupHeals).where(eq(groupHeals.id, h4.id))
    expect(row?.status).toBe('expired')
    expect((await call('POST', `/api/heals/${h4.id}/accept`, c.cookie)).json).toEqual({ error: 'heal_closed' })

    // After the window nothing more can be sent.
    expect((await heals(a)).group).toBeNull()
    expect((await send(a, d, g.id, pd)).json).toEqual({ error: 'heal_window_closed' })
  })

  it('someone who abandons at minute 26 of 50 leaves the group but keeps one wave, so one heal (to one player)', async () => {
    now = T0
    const [a, b, c] = (await crew(3)) as [U, U, U]
    const g = await create(a, [b, c], 50)
    for (const u of [b, c]) await call('POST', `/api/groups/${g.id}/accept`, u.cookie)
    await call('POST', `/api/groups/${g.id}/start`, a.cookie)

    now = T0 + 26 * MIN
    const cancelled = await act(a, { type: 'cancel' })
    expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200)
    expect((await game(a)).doc.player?.encounter?.waves.length).toBe(1)
    const hs = await heals(a)
    expect(hs.group).toMatchObject({ id: g.id, remaining: 1 })
    const target = (u: U) => hs.group!.targets.find((t) => t.userId === u.user.id)!
    const [pb, pc] = [target(b).pokemon[0]!.uid, target(c).pokemon[0]!.uid]
    expect((await send(a, b, g.id, pb)).status).toBe(201)
    // One wave = one heal: the second friend has to wait for a wave that does not exist.
    expect((await send(a, c, g.id, pc)).json).toEqual({ error: 'heal_limit' })
    expect((await act(a, { type: 'nextWave' })).status).toBe(200)
    expect((await heals(a)).group).toBeNull()
  })
})
