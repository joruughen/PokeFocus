/** Integration tests for study groups (/api/groups + the game action hooks). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ActionResponse, GameAction, GameSnapshot, GroupsResponse, PublicUser, ServerEvent, StudyGroupView } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { activeStudySessions, studyGroupMembers } from './db/schema'
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
  const r = await call('POST', '/api/auth/register', null, { email: `g${n}@test.dev`, password: 'correct horse', trainerName: name ?? `Group ${n}`, country: 'PE' })
  expect(r.status).toBe(201)
  const cookie = r.res.headers.get('set-cookie')!.match(/pf_session=([^;]*)/)![1]!
  const u: U = { user: (r.json as { user: PublicUser }).user, cookie, events: [] }
  bus.subscribe({ userId: u.user.id, sessionId: 's', send: (e) => u.events.push(e), close: () => {} })
  expect((await act(u, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'bulbasaur' })).status).toBe(200)
  return u
}

const act = (u: U, a: GameAction) => call('POST', '/api/game/action', u.cookie, a)
const groups = async (u: U) => (await call('GET', '/api/groups', u.cookie)).json as unknown as GroupsResponse
const game = async (u: U) => (await call('GET', '/api/game', u.cookie)).json as unknown as GameSnapshot
const groupEvents = (u: U) => u.events.filter((e): e is Extract<ServerEvent, { type: 'group' }> => e.type === 'group')

async function befriend(a: U, b: U) {
  expect((await call('POST', '/api/friends/request', a.cookie, { friendCode: b.user.friendCode })).status).toBe(201)
  expect((await call('POST', `/api/friends/${a.user.id}/accept`, b.cookie)).status).toBe(204)
}

async function create(host: U, friends: U[], minutes = 25) {
  const r = await call('POST', '/api/groups', host.cookie, { minutes, friendIds: friends.map((f) => f.user.id) })
  expect(r.status, JSON.stringify(r.json)).toBe(201)
  return r.json as unknown as StudyGroupView
}

async function claimOverlap(u: U): Promise<number | null | undefined> {
  const r = await act(u, { type: 'claim' })
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return (r.json as unknown as ActionResponse<'claim'>).result.outcome.result.friendOverlap
}

/** Fresh friends graph: host + others, everyone friends with the host (and each other). */
async function crew(n: number): Promise<U[]> {
  const us: U[] = []
  for (let i = 0; i < n; i++) us.push(await newUser())
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) await befriend(us[i]!, us[j]!)
  for (const u of us) u.events.length = 0
  return us
}

describe('study groups', () => {
  it('two friends: invite (SSE) → accept → host starts → same start → claim with full overlap', async () => {
    now = T0
    const [a, b] = (await crew(2)) as [U, U]
    const g = await create(a, [b])
    expect(g).toMatchObject({ status: 'lobby', minutes: 25, hostId: a.user.id, me: { host: true }, invites: [{ userId: b.user.id, status: 'pending' }] })
    expect(groupEvents(b)).toMatchObject([{ type: 'group', groupId: g.id, kind: 'invite', userId: a.user.id, trainerName: a.user.trainerName }])

    const gb = await groups(b)
    expect(gb.current).toBeNull()
    expect(gb.invites.map((i) => i.id)).toEqual([g.id])
    expect((await groups(a)).current?.id).toBe(g.id)

    const acc = await call('POST', `/api/groups/${g.id}/accept`, b.cookie)
    expect(acc.status).toBe(200)
    expect((acc.json as unknown as StudyGroupView).me).toEqual({ host: false, invite: 'accepted', member: false })
    expect(groupEvents(a).map((e) => e.kind)).toEqual(['invite', 'accept'])
    expect((await groups(b)).current?.id).toBe(g.id)

    // only the host can start
    expect((await call('POST', `/api/groups/${g.id}/start`, b.cookie)).json).toEqual({ error: 'not_host' })

    now = T0 + 2 * MIN
    const st = await call('POST', `/api/groups/${g.id}/start`, a.cookie)
    expect(st.status).toBe(200)
    const view = st.json as unknown as StudyGroupView
    expect(view.status).toBe('started')
    expect(view.members.map((m) => [m.userId, m.joinedAt, m.endsAt])).toEqual(
      expect.arrayContaining([
        [a.user.id, now, now + 25 * MIN],
        [b.user.id, now, now + 25 * MIN],
      ]),
    )
    const [da, db] = [await game(a), await game(b)]
    expect(da.doc.player?.activeSession).toMatchObject({ startedAt: now, plannedMinutes: 25 })
    expect(db.doc.player?.activeSession).toMatchObject({ startedAt: now, plannedMinutes: 25 })
    expect(b.events.some((e) => e.type === 'game')).toBe(true)
    expect(groupEvents(b).at(-1)).toMatchObject({ kind: 'start' })
    expect((await groups(b)).current).toMatchObject({ id: g.id, me: { member: true, invite: 'joined' } })

    now += 26 * MIN
    expect(await claimOverlap(a)).toBe(1)
    expect(await claimOverlap(b)).toBe(1)
    const rows = await database.db.select().from(studyGroupMembers).where(eq(studyGroupMembers.groupId, g.id))
    expect(rows.every((r) => r.leftReason === 'finished')).toBe(true)
    expect((await groups(a)).current).toBeNull()
  })

  it('pausing leaves the group (others are told); the session goes on solo; overlap is proportional', async () => {
    now = T0
    const [a, b] = (await crew(2)) as [U, U]
    const g = await create(a, [b])
    await call('POST', `/api/groups/${g.id}/accept`, b.cookie)
    await call('POST', `/api/groups/${g.id}/start`, a.cookie)
    a.events.length = 0

    now = T0 + 10 * MIN
    expect((await act(b, { type: 'pause' })).status).toBe(200)
    expect(groupEvents(a)).toMatchObject([{ kind: 'leave', reason: 'pause', userId: b.user.id }])
    const view = (await groups(a)).current!
    expect(view.members.find((m) => m.userId === b.user.id)).toMatchObject({ leftAt: now, leftReason: 'pause' })
    // B still sees the group of its (now solo) session
    expect((await groups(b)).current?.id).toBe(g.id)

    now = T0 + 12 * MIN
    expect((await act(b, { type: 'resume' })).status).toBe(200)
    // no re-joining: still out
    expect((await groups(a)).current!.members.find((m) => m.userId === b.user.id)?.leftAt).toBe(T0 + 10 * MIN)
    expect((await call('POST', `/api/groups/${g.id}/accept`, b.cookie)).status).toBe(409)

    now = T0 + 27 * MIN
    expect(await claimOverlap(a)).toBeCloseTo(10 / 25)
    expect(await claimOverlap(b)).toBeCloseTo(10 / 25)
  })

  it('three friends: cancel leaves, late join counts from the join, alone stops accruing', async () => {
    now = T0
    const [a, b, c] = (await crew(3)) as [U, U, U]
    const g = await create(a, [b, c], 25)
    await call('POST', `/api/groups/${g.id}/accept`, b.cookie)
    await call('POST', `/api/groups/${g.id}/start`, a.cookie)
    // C did not answer: still invited, can join late
    expect((await groups(c)).invites.map((i) => i.status)).toEqual(['started'])

    now = T0 + 5 * MIN
    expect((await act(b, { type: 'cancel' })).status).toBe(200)
    expect(groupEvents(a).at(-1)).toMatchObject({ kind: 'leave', reason: 'cancel', userId: b.user.id })

    now = T0 + 15 * MIN
    const late = await call('POST', `/api/groups/${g.id}/accept`, c.cookie)
    expect(late.status).toBe(200)
    expect((late.json as unknown as StudyGroupView).me).toEqual({ host: false, invite: 'joined', member: true })
    expect((await game(c)).doc.player?.activeSession).toMatchObject({ startedAt: now, plannedMinutes: 25 })
    expect(groupEvents(a).at(-1)).toMatchObject({ kind: 'join', userId: c.user.id })

    // A: with B 0–5, with C 15–25 → 15 of 25.
    now = T0 + 26 * MIN
    expect(await claimOverlap(a)).toBeCloseTo(15 / 25)
    // C: with A 15–25 of its own 15–40 → 10 of 25; alone afterwards.
    now = T0 + 41 * MIN
    expect(await claimOverlap(c)).toBeCloseTo(10 / 25)
    // B cancelled: no claim, no overlap stored anywhere.
    expect((await game(b)).doc.player?.activeSession).toBeNull()
  })

  it('leave route: the session continues solo; late join impossible once nobody is left', async () => {
    now = T0
    const [a, b, c] = (await crew(3)) as [U, U, U]
    const g = await create(a, [b, c])
    await call('POST', `/api/groups/${g.id}/accept`, b.cookie)
    await call('POST', `/api/groups/${g.id}/start`, a.cookie)
    now = T0 + 3 * MIN
    expect((await call('POST', `/api/groups/${g.id}/leave`, b.cookie)).status).toBe(204)
    expect((await game(b)).doc.player?.activeSession).not.toBeNull()
    expect((await call('POST', `/api/groups/${g.id}/leave`, b.cookie)).json).toEqual({ error: 'not_in_group' })
    now = T0 + 4 * MIN
    await act(a, { type: 'pause' })
    // everyone is out → the invite is gone and accepting fails
    expect((await groups(c)).invites).toEqual([])
    expect((await call('POST', `/api/groups/${g.id}/accept`, c.cookie)).json).toEqual({ error: 'group_ended' })
    await act(a, { type: 'resume' })
    now = T0 + 40 * MIN
    expect(await claimOverlap(a)).toBeCloseTo(3 / 25)
    expect(await claimOverlap(b)).toBeCloseTo(3 / 25)
  })

  it('solo sessions have friendOverlap null', async () => {
    now = T0
    const [a] = (await crew(1)) as [U]
    await act(a, { type: 'start', minutes: 25 })
    now = T0 + 26 * MIN
    expect(await claimOverlap(a)).toBeNull()
  })

  it('validation: friends only, one active session, one lobby, expiry, decline, disband, solo start drops the lobby', async () => {
    now = T0
    const [a, b, c] = (await crew(3)) as [U, U, U]
    const stranger = await newUser()
    const bad = await call('POST', '/api/groups', a.cookie, { minutes: 25, friendIds: [stranger.user.id] })
    expect(bad.json).toEqual({ error: 'not_friends' })
    expect((await call('POST', '/api/groups', a.cookie, { minutes: 25, friendIds: [a.user.id] })).json).toEqual({ error: 'cannot_invite_self' })
    expect((await call('POST', '/api/groups', a.cookie, { minutes: 5, friendIds: [b.user.id] })).status).toBe(400)
    expect((await call('POST', '/api/groups', a.cookie, { minutes: 25, friendIds: [] })).status).toBe(400)
    expect((await call('POST', '/api/groups', a.cookie, { minutes: 25, friendIds: ['nope'] })).status).toBe(400)

    const g = await create(a, [b])
    expect((await call('POST', '/api/groups', a.cookie, { minutes: 25, friendIds: [c.user.id] })).json).toEqual({ error: 'already_in_group' })
    // stranger cannot see it
    expect((await call('GET', `/api/groups/${g.id}`, stranger.cookie)).status).toBe(404)
    expect((await call('GET', `/api/groups/${g.id}`, b.cookie)).status).toBe(200)
    // invite more: host only, friends only
    expect((await call('POST', `/api/groups/${g.id}/invite`, b.cookie, { friendIds: [c.user.id] })).json).toEqual({ error: 'not_host' })
    expect((await call('POST', `/api/groups/${g.id}/invite`, a.cookie, { friendIds: [stranger.user.id] })).json).toEqual({ error: 'not_friends' })
    const more = await call('POST', `/api/groups/${g.id}/invite`, a.cookie, { friendIds: [c.user.id] })
    expect((more.json as unknown as StudyGroupView).invites.map((i) => i.userId)).toEqual([b.user.id, c.user.id])

    // decline, then re-invite makes it pending again
    expect((await call('POST', `/api/groups/${g.id}/decline`, c.cookie)).status).toBe(204)
    expect((await groups(c)).invites).toEqual([])
    await call('POST', `/api/groups/${g.id}/invite`, a.cookie, { friendIds: [c.user.id] })
    expect((await groups(c)).invites.map((i) => i.id)).toEqual([g.id])

    // an invitee with a running solo session cannot accept
    await act(c, { type: 'start', minutes: 25 })
    expect((await call('POST', `/api/groups/${g.id}/accept`, c.cookie)).json).toEqual({ error: 'session_active' })
    await act(c, { type: 'cancel' })

    // B accepts, then starts a solo session: it drops the lobby (accepted → declined)
    await call('POST', `/api/groups/${g.id}/accept`, b.cookie)
    a.events.length = 0
    await act(b, { type: 'start', minutes: 25 })
    expect(groupEvents(a)).toMatchObject([{ kind: 'decline', userId: b.user.id }])
    expect((await groups(b)).current).toBeNull()
    await act(b, { type: 'cancel' })

    // lobby expiry
    now = T0 + 31 * MIN
    expect((await groups(a)).current).toBeNull()
    expect((await call('POST', `/api/groups/${g.id}/accept`, c.cookie)).json).toEqual({ error: 'group_ended' })
    expect((await call('POST', `/api/groups/${g.id}/start`, a.cookie)).json).toEqual({ error: 'group_ended' })

    // host disbands a fresh lobby; a solo start of the host also disbands
    const g2 = await create(a, [b])
    expect((await call('POST', `/api/groups/${g2.id}/leave`, a.cookie)).status).toBe(204)
    expect((await groups(b)).invites).toEqual([])
    const g3 = await create(a, [b])
    b.events.length = 0
    await act(a, { type: 'start', minutes: 25 })
    expect(groupEvents(b)).toMatchObject([{ groupId: g3.id, kind: 'disband' }])
    // a host with a running session cannot create a group
    expect((await call('POST', '/api/groups', a.cookie, { minutes: 25, friendIds: [b.user.id] })).json).toEqual({ error: 'session_active' })
  })

  it('an accepted member who cannot start is marked failed; the rest start', async () => {
    now = T0
    const [a, b, c] = (await crew(3)) as [U, U, U]
    const g = await create(a, [b, c])
    await call('POST', `/api/groups/${g.id}/accept`, b.cookie)
    await call('POST', `/api/groups/${g.id}/accept`, c.cookie)
    // C has a session registered elsewhere (another device/doc)
    await database.db.insert(activeStudySessions).values({ userId: c.user.id, sessionId: 'elsewhere', startedAt: new Date(now) })
    const st = await call('POST', `/api/groups/${g.id}/start`, a.cookie)
    expect(st.status).toBe(200)
    const view = st.json as unknown as StudyGroupView
    expect(view.members.map((m) => m.userId).sort()).toEqual([a.user.id, b.user.id].sort())
    expect(view.invites.find((i) => i.userId === c.user.id)?.status).toBe('failed')
    expect((await game(c)).doc.player?.activeSession).toBeNull()
    expect(groupEvents(c).some((e) => e.kind === 'failed' && e.userId === c.user.id)).toBe(true)
    await database.db.delete(activeStudySessions).where(eq(activeStudySessions.userId, c.user.id))
  })

  it('rate limits invitations per user', async () => {
    now = T0
    const [a, b] = (await crew(2)) as [U, U]
    const g = await create(a, [b])
    let last = 0
    for (let i = 0; i < 20; i++) last = (await call('POST', `/api/groups/${g.id}/invite`, a.cookie, { friendIds: [b.user.id] })).status
    expect(last).toBe(429)
  })
})
