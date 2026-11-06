/**
 * Account tests: the 30-day lock on the trainer name and the country (PATCH /api/auth/me) and
 * the `anonymousRankings` privacy flag (and how it masks names in the leaderboard).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { weekKeyOf } from '../src/engine'
import { COUNTRY_LOCK_DAYS, NAME_LOCK_DAYS } from '../src/game/protocol'
import type { GameSnapshot, LeaderboardResponse, LeaderboardRow, PublicUser, ServerEvent } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { leagueScores, playerDocs, users } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 3, 10, 0)
const DAY = 86_400_000

let database: Database
let now = T0
const clock = () => now
let prod: ReturnType<typeof createApp>
let dev: ReturnType<typeof createApp>
const bus = new EventBus()
let ipSeq = 0

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  const base = { NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN }
  prod = createApp({ env: loadEnv({ ...base, DEV_TOOLS: '0' }), db: database.db, clock, bus })
  dev = createApp({ env: loadEnv({ ...base, DEV_TOOLS: '1' }), db: database.db, clock, bus })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; app?: ReturnType<typeof createApp> } = {}) {
  // A fresh IP every call: the register / login limits are per IP.
  const headers: Record<string, string> = { 'x-forwarded-for': `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` }
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  if (opts.cookie) headers.cookie = `pf_session=${opts.cookie}`
  const res = await (opts.app ?? prod).app.request(path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : null
  const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
  return { status: res.status, json, cookie: sc ? sc[1]! : null }
}

interface U {
  user: PublicUser
  cookie: string
}
let userSeq = 0
async function register(patch: Partial<{ trainerName: string; country: string }> = {}): Promise<U> {
  const n = ++userSeq
  const body = { email: `acct${n}@test.dev`, password: 'correct horse', trainerName: `Acct ${n}`, country: 'PE', ...patch }
  const r = await call('POST', '/api/auth/register', { body })
  expect(r.status).toBe(201)
  return { user: (r.json as { user: PublicUser }).user, cookie: r.cookie! }
}

const patchMe = (u: U, body: unknown, app?: ReturnType<typeof createApp>) => call('PATCH', '/api/auth/me', { cookie: u.cookie, body, app })
const userOf = (r: { json: Record<string, unknown> | null }) => (r.json as { user: PublicUser }).user
const getMe = async (u: U) => userOf(await call('GET', '/api/auth/me', { cookie: u.cookie }))

describe('account lock: trainer name and country', () => {
  it('contract constants are 30 days', () => {
    expect(NAME_LOCK_DAYS).toBe(30)
    expect(COUNTRY_LOCK_DAYS).toBe(30)
  })

  it('register, login and /me return the new fields (null, null, false)', async () => {
    now = T0
    const u = await register()
    expect(u.user).toMatchObject({ nameChangedAt: null, countryChangedAt: null, anonymousRankings: false })
    const email = `login${++userSeq}@test.dev`
    await call('POST', '/api/auth/register', { body: { email, password: 'correct horse', trainerName: 'Logger', country: 'PE' } })
    const login = await call('POST', '/api/auth/login', { body: { email, password: 'correct horse' } })
    expect(userOf(login)).toMatchObject({ nameChangedAt: null, countryChangedAt: null, anonymousRankings: false })
    expect(await getMe(u)).toEqual(u.user)
  })

  it('the first name change is free; the second within 30 days is 409 name_locked with unlockAt', async () => {
    now = T0
    const u = await register({ trainerName: 'First Name' })
    const r1 = await patchMe(u, { trainerName: 'Second Name' })
    expect(r1.status).toBe(200)
    expect(userOf(r1)).toMatchObject({ trainerName: 'Second Name', nameChangedAt: T0, countryChangedAt: null })

    now = T0 + 10 * DAY
    const r2 = await patchMe(u, { trainerName: 'Third Name' })
    expect(r2.status).toBe(409)
    expect(r2.json).toEqual({ error: 'name_locked', unlockAt: T0 + 30 * DAY })
    expect(await getMe(u)).toMatchObject({ trainerName: 'Second Name', nameChangedAt: T0 })
    now = T0
  })

  it('the name is allowed again exactly at 30 days (not 1 ms before) and the lock restarts', async () => {
    now = T0
    const u = await register()
    await patchMe(u, { trainerName: 'Lock Start' })
    now = T0 + 30 * DAY - 1
    const early = await patchMe(u, { trainerName: 'Too Early' })
    expect(early.status).toBe(409)
    expect(early.json).toEqual({ error: 'name_locked', unlockAt: T0 + 30 * DAY })

    now = T0 + 30 * DAY
    const exact = await patchMe(u, { trainerName: 'Right On Time' })
    expect(exact.status).toBe(200)
    expect(userOf(exact)).toMatchObject({ trainerName: 'Right On Time', nameChangedAt: T0 + 30 * DAY })

    now = T0 + 31 * DAY
    const again = await patchMe(u, { trainerName: 'Locked Again' })
    expect(again.json).toEqual({ error: 'name_locked', unlockAt: T0 + 60 * DAY })
    now = T0
  })

  it('the country has the same lock: free first change, 409 country_locked, allowed at 30 days', async () => {
    now = T0
    const u = await register({ country: 'PE' })
    const r1 = await patchMe(u, { country: 'cl' })
    expect(r1.status).toBe(200)
    expect(userOf(r1)).toMatchObject({ country: 'CL', countryChangedAt: T0, nameChangedAt: null })

    now = T0 + 29 * DAY
    const r2 = await patchMe(u, { country: 'US' })
    expect(r2.status).toBe(409)
    expect(r2.json).toEqual({ error: 'country_locked', unlockAt: T0 + 30 * DAY })
    expect((await getMe(u)).country).toBe('CL')

    now = T0 + 30 * DAY
    const r3 = await patchMe(u, { country: 'US' })
    expect(r3.status).toBe(200)
    expect(userOf(r3)).toMatchObject({ country: 'US', countryChangedAt: T0 + 30 * DAY })
    now = T0
  })

  it('sending the current value is a no-op: no lock, no timestamp, never an error', async () => {
    now = T0
    const u = await register({ trainerName: 'Same Name', country: 'PE' })
    const same = await patchMe(u, { trainerName: 'Same Name', country: 'pe' })
    expect(same.status).toBe(200)
    expect(userOf(same)).toMatchObject({ trainerName: 'Same Name', country: 'PE', nameChangedAt: null, countryChangedAt: null })

    // So the first real change is still free…
    now = T0 + DAY
    const first = await patchMe(u, { trainerName: 'New Name' })
    expect(first.status).toBe(200)
    expect(userOf(first).nameChangedAt).toBe(T0 + DAY)

    // …and re-sending the same value while locked succeeds and does not move the timestamp.
    now = T0 + 5 * DAY
    const resend = await patchMe(u, { trainerName: 'New Name' })
    expect(resend.status).toBe(200)
    expect(userOf(resend)).toMatchObject({ trainerName: 'New Name', nameChangedAt: T0 + DAY })
    // The lock still ends 30 days after the real change, not after the no-op.
    now = T0 + 31 * DAY
    expect((await patchMe(u, { trainerName: 'Newer Name' })).status).toBe(200)
    now = T0
  })

  it('name and country locks are independent', async () => {
    now = T0
    const u = await register({ country: 'PE' })
    await patchMe(u, { trainerName: 'Indep One' })

    // Country is still free while the name is locked.
    now = T0 + 2 * DAY
    const c = await patchMe(u, { country: 'CL' })
    expect(c.status).toBe(200)
    expect(userOf(c)).toMatchObject({ nameChangedAt: T0, countryChangedAt: T0 + 2 * DAY })

    // Each unlocks on its own date.
    now = T0 + 30 * DAY
    expect((await patchMe(u, { country: 'AR' })).json).toEqual({ error: 'country_locked', unlockAt: T0 + 32 * DAY })
    const n = await patchMe(u, { trainerName: 'Indep Two' })
    expect(n.status).toBe(200)
    now = T0 + 32 * DAY
    expect((await patchMe(u, { country: 'AR' })).status).toBe(200)
    now = T0
  })

  it('a request mixing an allowed and a locked change applies nothing', async () => {
    now = T0
    const u = await register({ trainerName: 'Mix Start', country: 'PE' })
    await patchMe(u, { trainerName: 'Mix Locked' })

    now = T0 + DAY
    // Name locked, country free: the free country change is not applied either.
    const a = await patchMe(u, { trainerName: 'Mix Other', country: 'CL', anonymousRankings: true })
    expect(a.status).toBe(409)
    expect(a.json).toMatchObject({ error: 'name_locked', unlockAt: T0 + 30 * DAY })
    expect(await getMe(u)).toMatchObject({ trainerName: 'Mix Locked', country: 'PE', countryChangedAt: null, anonymousRankings: false })

    // Country locked, name free (a second account: its name was never changed).
    const v = await register({ trainerName: 'Mix Two', country: 'PE' })
    await patchMe(v, { country: 'CL' })
    now = T0 + 2 * DAY
    const b = await patchMe(v, { trainerName: 'Mix Two Free', country: 'US' })
    expect(b.status).toBe(409)
    expect(b.json).toMatchObject({ error: 'country_locked', unlockAt: T0 + DAY + 30 * DAY })
    expect(await getMe(v)).toMatchObject({ trainerName: 'Mix Two', nameChangedAt: null, country: 'CL' })

    // Both locked: the name is reported first.
    const w = await register({ trainerName: 'Mix Three', country: 'PE' })
    await patchMe(w, { trainerName: 'Mix Three B', country: 'CL' })
    now = T0 + 3 * DAY
    const c = await patchMe(w, { trainerName: 'Mix Three C', country: 'US' })
    expect(c.json).toMatchObject({ error: 'name_locked', unlockAt: T0 + 2 * DAY + 30 * DAY })
    now = T0
  })

  it('a locked field sent with its current value does not block a free change of the other', async () => {
    now = T0
    const u = await register({ trainerName: 'Keep Name', country: 'PE' })
    await patchMe(u, { trainerName: 'Kept Name' })
    now = T0 + DAY
    const r = await patchMe(u, { trainerName: 'Kept Name', country: 'CL' })
    expect(r.status).toBe(200)
    expect(userOf(r)).toMatchObject({ trainerName: 'Kept Name', nameChangedAt: T0, country: 'CL', countryChangedAt: T0 + DAY })
    now = T0
  })

  it('DEV_TOOLS ignores the locks (and still stamps the change)', async () => {
    now = T0
    const u = await register({ country: 'PE' })
    expect((await patchMe(u, { trainerName: 'Dev One', country: 'CL' }, dev)).status).toBe(200)
    now = T0 + 1000
    const r = await patchMe(u, { trainerName: 'Dev Two', country: 'US' }, dev)
    expect(r.status).toBe(200)
    expect(userOf(r)).toMatchObject({ trainerName: 'Dev Two', country: 'US', nameChangedAt: T0 + 1000, countryChangedAt: T0 + 1000 })
    // The production app still enforces the (dev-stamped) lock on the same data.
    now = T0 + 2000
    expect((await patchMe(u, { trainerName: 'Dev Three' })).json).toEqual({ error: 'name_locked', unlockAt: T0 + 1000 + 30 * DAY })
    now = T0
  })

  it('two concurrent changes cannot both pass the lock', async () => {
    now = T0
    const u = await register({ trainerName: 'Race Start' })
    const [a, b] = await Promise.all([patchMe(u, { trainerName: 'Race Alpha' }), patchMe(u, { trainerName: 'Race Bravo' })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const loser = a.status === 409 ? a : b
    expect(loser.json).toEqual({ error: 'name_locked', unlockAt: T0 + 30 * DAY })
    const winner = (a.status === 200 ? a : b).json as { user: PublicUser }
    expect((await getMe(u)).trainerName).toBe(winner.user.trainerName)

    const [c, d] = await Promise.all([patchMe(u, { country: 'CL' }), patchMe(u, { country: 'US' })])
    expect([c.status, d.status].sort()).toEqual([200, 409])
    expect((c.status === 409 ? c : d).json).toMatchObject({ error: 'country_locked' })
  })

  it('validation: an empty patch and bad types are 400; rows from before the migration (nulls) keep working', async () => {
    now = T0
    const u = await register()
    expect((await patchMe(u, {})).status).toBe(400)
    expect((await patchMe(u, { anonymousRankings: 'yes' })).status).toBe(400)
    // A legacy row: both timestamps null, flag false (the column defaults) → first change free.
    await database.db.update(users).set({ trainerNameChangedAt: null, countryChangedAt: null, anonymousRankings: false }).where(eq(users.id, u.user.id))
    expect((await patchMe(u, { trainerName: 'Legacy Name' })).status).toBe(200)
  })

  it('the name inside the game doc stays in sync; a rejected change leaves it alone', async () => {
    now = T0
    const u = await register({ trainerName: 'Doc Start' })
    await call('POST', '/api/game/action', { cookie: u.cookie, body: { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'squirtle' } })
    const seen: ServerEvent[] = []
    const off = bus.subscribe({ userId: u.user.id, sessionId: 's', send: (e) => seen.push(e), close: () => {} })
    const docName = async () => ((await call('GET', '/api/game', { cookie: u.cookie })).json as unknown as GameSnapshot).doc.player?.profile.trainerName

    expect(await docName()).toBe('Doc Start')
    const r = await patchMe(u, { trainerName: 'Doc Renamed' })
    expect(r.status).toBe(200)
    expect(await docName()).toBe('Doc Renamed')
    expect(seen).toEqual([{ type: 'game', version: 2 }])

    now = T0 + DAY
    expect((await patchMe(u, { trainerName: 'Doc Blocked' })).status).toBe(409)
    expect(await docName()).toBe('Doc Renamed')
    expect(seen).toHaveLength(1) // no event for a rejected request
    off()
    now = T0
  })
})

describe('anonymousRankings', () => {
  it('toggles without a lock, is returned by PATCH and /auth/me, and leaves the lock fields alone', async () => {
    now = T0
    const u = await register()
    const on = await patchMe(u, { anonymousRankings: true })
    expect(on.status).toBe(200)
    expect(userOf(on)).toMatchObject({ anonymousRankings: true, nameChangedAt: null, countryChangedAt: null })
    expect((await getMe(u)).anonymousRankings).toBe(true)

    // Off and on again, the same instant: never locked.
    expect(userOf(await patchMe(u, { anonymousRankings: false })).anonymousRankings).toBe(false)
    expect(userOf(await patchMe(u, { anonymousRankings: true })).anonymousRankings).toBe(true)
    // Sending the current value is fine too.
    expect(userOf(await patchMe(u, { anonymousRankings: true })).anonymousRankings).toBe(true)
    expect((await getMe(u)).anonymousRankings).toBe(true)

    // Together with a (free) name change in the same request.
    const both = await patchMe(u, { trainerName: 'Anon Name', anonymousRankings: false })
    expect(userOf(both)).toMatchObject({ trainerName: 'Anon Name', anonymousRankings: false, nameChangedAt: T0 })
    // The flag keeps working while the name is locked.
    now = T0 + DAY
    expect(userOf(await patchMe(u, { anonymousRankings: true })).anonymousRankings).toBe(true)
    now = T0
  })
})

describe('leaderboard privacy', () => {
  const lb = async (viewer: U, scope: string) =>
    (await call('GET', `/api/leaderboard?scope=${scope}&period=week`, { cookie: viewer.cookie })).json as unknown as LeaderboardResponse
  const byName = (rows: LeaderboardRow[]) => rows.map((r) => [r.trainerName, r.anonymous, r.me] as const)

  async function seed(week: number, scores: [U, number][]) {
    const key = weekKeyOf(T0 + week * 7 * DAY, 0)
    for (const [u, points] of scores) {
      await database.db.insert(leagueScores).values({ userId: u.user.id, period: 'week', periodKey: key, points, updatedAt: new Date(T0 + points) })
    }
  }

  it('global and country hide anonymous names except the caller\'s own row; friends never hide', async () => {
    const week = 1
    now = T0 + week * 7 * DAY
    const viewer = await register({ trainerName: 'Pv Viewer', country: 'PE' })
    const hiddenPe = await register({ trainerName: 'Pv Hidden Pe', country: 'PE' })
    const shownPe = await register({ trainerName: 'Pv Shown Pe', country: 'PE' })
    const hiddenUs = await register({ trainerName: 'Pv Hidden Us', country: 'US' })
    await patchMe(hiddenPe, { anonymousRankings: true })
    await patchMe(hiddenUs, { anonymousRankings: true })
    await seed(week, [
      [hiddenPe, 500],
      [shownPe, 400],
      [hiddenUs, 300],
      [viewer, 200],
    ])

    // global as a plain viewer
    const g = await lb(viewer, 'global')
    expect(byName(g.rows)).toEqual([
      [null, true, false],
      ['Pv Shown Pe', false, false],
      [null, true, false],
      ['Pv Viewer', false, true],
    ])
    // the masked row keeps the other fields (rank, points, country…)
    expect(g.rows[0]).toMatchObject({ rank: 1, userId: hiddenPe.user.id, points: 500, country: 'PE' })
    expect(JSON.stringify(g)).not.toContain('Pv Hidden')
    expect(g.mine).toMatchObject({ trainerName: 'Pv Viewer', anonymous: false, me: true, rank: 4 })

    // country as a plain viewer: only PE, still masked
    const c = await lb(viewer, 'country')
    expect(byName(c.rows)).toEqual([
      [null, true, false],
      ['Pv Shown Pe', false, false],
      ['Pv Viewer', false, true],
    ])

    // The viewer turns the flag on: own row keeps the real name, flagged anonymous…
    await patchMe(viewer, { anonymousRankings: true })
    const g2 = await lb(viewer, 'global')
    expect(g2.rows[3]).toMatchObject({ trainerName: 'Pv Viewer', anonymous: true, me: true })
    expect(g2.mine).toMatchObject({ trainerName: 'Pv Viewer', anonymous: true, me: true })
    expect((await lb(viewer, 'country')).mine).toMatchObject({ trainerName: 'Pv Viewer', anonymous: true })
    // …and the others see them masked.
    const g3 = await lb(shownPe, 'global')
    expect(byName(g3.rows)).toEqual([
      [null, true, false],
      ['Pv Shown Pe', false, true],
      [null, true, false],
      [null, true, false],
    ])
    expect(g3.rows[3]).toMatchObject({ userId: viewer.user.id, trainerName: null, anonymous: true })
    // The anonymous caller sees their own name even though they are anonymous.
    const own = await lb(hiddenPe, 'global')
    expect(own.rows[0]).toMatchObject({ trainerName: 'Pv Hidden Pe', anonymous: true, me: true })
    expect(own.rows[2]).toMatchObject({ trainerName: null, anonymous: true, me: false })

    // friends: names are never hidden (the viewer is friends with the anonymous US trainer)
    const before = await lb(viewer, 'friends')
    expect(byName(before.rows)).toEqual([['Pv Viewer', true, true]])
    await call('POST', '/api/friends/request', { cookie: viewer.cookie, body: { friendCode: hiddenUs.user.friendCode } })
    await call('POST', `/api/friends/${viewer.user.id}/accept`, { cookie: hiddenUs.cookie })
    const f = await lb(viewer, 'friends')
    expect(byName(f.rows)).toEqual([
      ['Pv Hidden Us', true, false],
      ['Pv Viewer', true, true],
    ])
    expect(f.mine).toMatchObject({ trainerName: 'Pv Viewer', anonymous: true })
    // …while global still hides that same friend.
    expect((await lb(viewer, 'global')).rows.find((r) => r.userId === hiddenUs.user.id)?.trainerName).toBeNull()

    // Turning the flag off shows the name again.
    await patchMe(hiddenPe, { anonymousRankings: false })
    expect((await lb(viewer, 'global')).rows[0]).toMatchObject({ trainerName: 'Pv Hidden Pe', anonymous: false })
    now = T0
  }, 30_000)

  it('`mine` outside the top 100 follows the same rule (own name, anonymous flag)', async () => {
    const week = 2
    now = T0 + week * 7 * DAY
    const key = weekKeyOf(now, 0)
    const viewer = await register({ trainerName: 'Mine Viewer', country: 'PE' })
    await patchMe(viewer, { anonymousRankings: true })
    // 100 fillers above the viewer push them out of `rows`.
    const fillers = Array.from({ length: 100 }, (_, i) => ({
      email: `filler${week}-${i}@test.dev`,
      passwordHash: 'x',
      trainerName: `Filler ${i}`,
      country: 'PE',
      friendCode: `F${week}${String(i).padStart(5, '0')}`.slice(0, 8),
      anonymousRankings: i % 2 === 0,
    }))
    const rows = await database.db.insert(users).values(fillers).returning({ id: users.id })
    await database.db.insert(leagueScores).values(rows.map((r) => ({ userId: r.id, period: 'week' as const, periodKey: key, points: 1000, updatedAt: new Date(T0) })))
    await seed(week, [[viewer, 10]])

    const g = await lb(viewer, 'global')
    expect(g.rows).toHaveLength(100)
    expect(g.rows.some((r) => r.me)).toBe(false)
    expect(g.total).toBe(101)
    expect(g.mine).toMatchObject({ rank: 101, trainerName: 'Mine Viewer', anonymous: true, me: true })
    // Fillers: the anonymous ones are masked, the others show their names.
    expect(g.rows.filter((r) => r.trainerName === null)).toHaveLength(50)
    expect(g.rows.filter((r) => r.trainerName !== null && !r.anonymous)).toHaveLength(50)
    expect((await lb(viewer, 'country')).mine).toMatchObject({ rank: 101, trainerName: 'Mine Viewer', anonymous: true })

    // A user who is not anonymous gets `anonymous: false` on `mine`.
    await patchMe(viewer, { anonymousRankings: false })
    expect((await lb(viewer, 'global')).mine).toMatchObject({ trainerName: 'Mine Viewer', anonymous: false })
    now = T0
  }, 30_000)

  it('player docs are untouched by the flag (the game screens always show the real name)', async () => {
    now = T0
    const u = await register({ trainerName: 'Doc Anon' })
    await call('POST', '/api/game/action', { cookie: u.cookie, body: { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'squirtle' } })
    await patchMe(u, { anonymousRankings: true })
    const [row] = await database.db.select().from(playerDocs).where(eq(playerDocs.userId, u.user.id))
    expect(row?.doc.player?.profile.trainerName).toBe('Doc Anon')
    expect(row?.version).toBe(1) // the flag does not bump the game doc
  })
})
