/** Admin balance simulation (docs/admin-plan.md §7, delivery E10): comparison, worker, one-at-a-time runner, timeout, routes and permissions. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type { AdminContentVersionResponse, AdminSimReport, AdminSimRunResponse, AdminSimRunsResponse, PublicUser, UserRole } from '../src/game/protocol'
import { createApp } from './app'
import { simulateComparison, type SimInput } from './content/simCompare'
import { createSimRunner, type SimExecutor, type SimTimer } from './content/simRunner'
import { spawnSimWorker } from './content/simWorker'
import { openDatabase, type Database } from './db/client'
import { adminAudit, contentSimRuns, contentVersions, users } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'
import { RateLimiter } from './rate-limit'

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'correct horse battery'
const T0 = Date.UTC(2026, 10, 9, 12, 0)
const DAY = 86_400_000
const B = '/api/admin/content'
const SHINY = { config: { encounters: { shinyChance: 0.003 } } }

const tiny = (patch: unknown = SHINY): SimInput => ({
  params: { profiles: ['constant'], seeds: 1, weeks: 1 },
  active: { patch: {}, hash: 'base', versionId: null },
  proposed: { patch: patch as SimInput['proposed']['patch'], hash: 'p', versionId: 1 },
  eventItems: {},
})

describe('simulateComparison (1 profile, 1 seed, 1 week)', () => {
  it('plays both contents with the same seeds and reports the figures', () => {
    const ticks: number[] = []
    const r = simulateComparison(tiny({}), (d) => ticks.push(d))
    expect(ticks).toEqual([1, 2])
    expect(r.active.profiles).toHaveLength(1)
    const a = r.active.profiles[0]!
    expect(a.profile).toBe('constant')
    expect(a.n).toBe(1)
    expect(a.weeklyPoints).toHaveLength(1)
    expect(a.weeklyPoints[0]!.p50).toBeGreaterThan(0)
    expect(a.sessions).toBeGreaterThan(0)
    expect(a.catches).toBeGreaterThan(0)
    expect(a.leagueShare.base).toBe(1)
    expect(a.exhaustedShare).toBeGreaterThanOrEqual(0)
    expect(a.endEnergy).toBeGreaterThan(0)
    // Same (empty) patch on both sides: identical figures (deterministic seeds).
    expect(r.proposed.profiles).toEqual(r.active.profiles)
  })
})

describe('simWorker', () => {
  it('runs the comparison in a worker thread and reports progress', async () => {
    const progress: number[] = []
    const job = spawnSimWorker(tiny(), { onProgress: (d) => progress.push(d) })
    const r = await job.result
    expect(r.proposed.hash).toBe('p')
    expect(r.active.profiles[0]!.n).toBe(1)
    expect(progress.at(-1)).toBe(2)
  }, 60_000)

  it('cancel() terminates the worker and rejects', async () => {
    const job = spawnSimWorker({ ...tiny(), params: { profiles: ['constant'], seeds: 20, weeks: 8 } })
    job.cancel('timeout')
    await expect(job.result).rejects.toThrow('timeout')
  }, 60_000)
})

// --- Runner and routes with a fake executor and a manual timer ---------------------------------

const FAKE_REPORT = (input: SimInput): AdminSimReport => ({ params: input.params, active: { hash: input.active.hash, versionId: input.active.versionId, profiles: [] }, proposed: { hash: input.proposed.hash, versionId: input.proposed.versionId, profiles: [] }, ms: 1 })

function fakeExecutor() {
  const jobs: { input: SimInput; resolve: () => void; reject: (e: Error) => void; progress: (d: number, t: number) => void; cancelled: string | null }[] = []
  const execute: SimExecutor = (input, progress) => {
    let res!: (r: AdminSimReport) => void
    let rej!: (e: Error) => void
    const result = new Promise<AdminSimReport>((a, b) => {
      res = a
      rej = b
    })
    const j = { input, resolve: () => res(FAKE_REPORT(input)), reject: (e: Error) => rej(e), progress, cancelled: null as string | null }
    jobs.push(j)
    return {
      result,
      cancel: (reason = 'cancelled') => {
        j.cancelled = reason
        rej(new Error(reason))
      },
    }
  }
  return { execute, jobs }
}

function manualTimer() {
  const pending: { fn: () => void; ms: number; live: boolean }[] = []
  const timer: SimTimer = (fn, ms) => {
    const t = { fn, ms, live: true }
    pending.push(t)
    return () => {
      t.live = false
    }
  }
  const fire = () => {
    for (const t of pending) if (t.live) {
      t.live = false
      t.fn()
    }
  }
  return { timer, pending, fire }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1))
}

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
  await database.db.delete(contentSimRuns)
  await database.db.delete(contentVersions)
})

function makeApp() {
  const fake = fakeExecutor()
  const t = manualTimer()
  const sim = createSimRunner({ db: database.db, clock, execute: fake.execute, timer: t.timer })
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN })
  const built = createApp({ env, db: database.db, clock, limiter: new RateLimiter(clock), bus: new EventBus(), sim })
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
  return { call, sim, fake, t }
}
type Harness = ReturnType<typeof makeApp>

async function account(h: Harness, role: UserRole = 'player') {
  const n = ++seq
  const r = await h.call('POST', '/api/auth/register', { body: { email: `s${n}-${Math.random().toString(36).slice(2, 8)}@example.com`, password: PASSWORD, trainerName: `Sim${n}`, country: 'PE' } })
  expect(r.status).toBe(201)
  const user = (r.json as unknown as { user: PublicUser }).user
  if (role !== 'player') await database.db.update(users).set({ role }).where(eq(users.id, user.id))
  return { id: user.id, cookie: r.cookie! }
}

async function adminWithDraft(h: Harness, patch: unknown = SHINY) {
  const a = await account(h, 'admin')
  const created = await h.call('POST', `${B}/drafts`, { cookie: a.cookie, body: { from: 'empty', title: 'draft' } })
  expect(created.status).toBe(201)
  const id = (created.json as unknown as AdminContentVersionResponse).version.id
  expect((await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch } })).status).toBe(200)
  return { a, id }
}

const asRun = (r: { json: Record<string, unknown> | null }) => (r.json as unknown as AdminSimRunResponse).run

describe('simulation routes', () => {
  it('permissions: player 403 everywhere, support reads runs but cannot simulate', async () => {
    const h = makeApp()
    const p = await account(h)
    const s = await account(h, 'support')
    for (const [m, path] of [
      ['POST', `${B}/drafts/1/simulate`],
      ['GET', `${B}/sim-runs`],
      ['GET', `${B}/sim-runs/1`],
    ] as const) {
      expect((await h.call(m, path)).status).toBe(401)
      expect((await h.call(m, path, { cookie: p.cookie })).status).toBe(403)
    }
    expect((await h.call('GET', `${B}/sim-runs`, { cookie: s.cookie })).status).toBe(200)
    expect((await h.call('POST', `${B}/drafts/1/simulate`, { cookie: s.cookie, body: {} })).status).toBe(403)
  })

  it('runs one simulation at a time, stores the report, audits and clears the publish warning', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const before = await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie })
    expect((before.json as unknown as AdminContentVersionResponse).sim).toEqual({ recent: false, last: null })

    const r = await h.call('POST', `${B}/drafts/${id}/simulate`, { cookie: a.cookie, body: { profiles: ['constant', 'casual'], seeds: 2, weeks: 3 } })
    expect(r.status).toBe(202)
    const run = asRun(r)
    expect(run).toMatchObject({ versionId: id, status: 'running', params: { profiles: ['constant', 'casual'], seeds: 2, weeks: 3 }, activeHash: 'base', report: null })
    expect(h.fake.jobs).toHaveLength(1)
    expect(h.fake.jobs[0]!.input.proposed.patch).toEqual(SHINY)
    expect(h.t.pending[0]!.ms).toBe(5 * 60_000)

    // Busy while it runs (even for another draft).
    expect((await h.call('POST', `${B}/drafts/${id}/simulate`, { cookie: a.cookie, body: {} })).json?.error).toBe('busy')
    h.fake.jobs[0]!.progress(3, 8)
    const mid = await h.call('GET', `${B}/sim-runs/${run.id}`, { cookie: a.cookie })
    expect(asRun(mid).progress).toEqual({ done: 3, total: 8 })
    expect(((await h.call('GET', `${B}/sim-runs`, { cookie: a.cookie })).json as unknown as AdminSimRunsResponse).busy).toBe(true)

    h.fake.jobs[0]!.resolve()
    await flush()
    const done = asRun(await h.call('GET', `${B}/sim-runs/${run.id}`, { cookie: a.cookie }))
    expect(done.status).toBe('done')
    expect(done.report?.proposed.versionId).toBe(id)
    expect(done.finishedAt).toBe(T0)
    const list = (await h.call('GET', `${B}/sim-runs?versionId=${id}`, { cookie: a.cookie })).json as unknown as AdminSimRunsResponse
    expect(list.busy).toBe(false)
    expect(list.items.map((x) => x.id)).toEqual([run.id])
    expect(list.items[0]).not.toHaveProperty('report')

    const audits = await database.db.select().from(adminAudit).orderBy(asc(adminAudit.createdAt))
    expect(audits.map((x) => x.action)).toContain('content.simulate')

    // The draft is simulated now; a free slot accepts a new run.
    const after = (await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie })).json as unknown as AdminContentVersionResponse
    expect(after.sim?.recent).toBe(true)
    expect(after.sim?.last?.id).toBe(run.id)

    // Too old → the warning comes back.
    now = T0 + 8 * DAY
    expect(((await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie })).json as unknown as AdminContentVersionResponse).sim?.recent).toBe(false)
    now = T0
    // Editing the patch makes it unsimulated again.
    expect((await h.call('PUT', `${B}/drafts/${id}`, { cookie: a.cookie, body: { patch: { config: { encounters: { shinyChance: 0.0025 } } } } })).status).toBe(200)
    expect(((await h.call('GET', `${B}/versions/${id}`, { cookie: a.cookie })).json as unknown as AdminContentVersionResponse).sim?.recent).toBe(false)
  })

  it('cancels the run after the timeout', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const run = asRun(await h.call('POST', `${B}/drafts/${id}/simulate`, { cookie: a.cookie, body: {} }))
    h.t.fire()
    await flush()
    expect(h.fake.jobs[0]!.cancelled).toBe('timeout')
    const r = asRun(await h.call('GET', `${B}/sim-runs/${run.id}`, { cookie: a.cookie }))
    expect(r.status).toBe('timeout')
    expect(r.error).toMatch(/300 s/)
    // The slot is free again.
    expect((await h.call('POST', `${B}/drafts/${id}/simulate`, { cookie: a.cookie, body: {} })).status).toBe(202)
  })

  it('a failing worker marks the run failed and frees the slot', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const run = asRun(await h.call('POST', `${B}/drafts/${id}/simulate`, { cookie: a.cookie, body: {} }))
    h.fake.jobs[0]!.reject(new Error('boom'))
    await flush()
    const r = asRun(await h.call('GET', `${B}/sim-runs/${run.id}`, { cookie: a.cookie }))
    expect([r.status, r.error]).toEqual(['failed', 'boom'])
    expect(h.sim.current).toBeNull()
  })

  it('limits, drafts only, invalid patches', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    const post = (body: unknown, vid = id) => h.call('POST', `${B}/drafts/${vid}/simulate`, { cookie: a.cookie, body })
    expect((await post({ seeds: 21 })).json?.error).toBe('invalid_body')
    expect((await post({ weeks: 9 })).json?.error).toBe('invalid_body')
    expect((await post({ profiles: ['nobody'] })).json?.error).toBe('invalid_body')
    expect((await post({ profiles: ['constant', 'casual', 'marathoner', 'grinder'], seeds: 20, weeks: 8 })).json?.error).toBe('sim_too_big')
    expect((await post({}, 999_999)).status).toBe(404)
    const broken = await adminWithDraft(h, { config: { encounters: { shinyChance: 0.5 } } })
    expect((await h.call('POST', `${B}/drafts/${broken.id}/simulate`, { cookie: broken.a.cookie, body: {} })).json?.error).toBe('validation_failed')
    // None of the refusals kept the slot.
    expect(h.sim.current).toBeNull()
    expect((await post({})).status).toBe(202)
  })

  it('publishing without a recent simulation is allowed: warned in the response and the audit', async () => {
    const h = makeApp()
    const { a, id } = await adminWithDraft(h)
    expect((await h.call('POST', '/api/admin/reauth', { cookie: a.cookie, body: { password: PASSWORD } })).status).toBe(200)
    const pub = await h.call('POST', `${B}/drafts/${id}/publish`, { cookie: a.cookie, body: {} })
    expect(pub.status).toBe(200)
    expect((pub.json as unknown as AdminContentVersionResponse).sim).toEqual({ recent: false, last: null })
    const [row] = await database.db.select().from(adminAudit).where(eq(adminAudit.action, 'content.publish'))
    expect((row!.after as Record<string, unknown>).simRunId).toBeNull()

    // With a finished run of the same patch: the audit records it.
    const d2 = await adminWithDraft(h, { config: { encounters: { shinyChance: 0.0025 } } })
    const run = asRun(await h.call('POST', `${B}/drafts/${d2.id}/simulate`, { cookie: d2.a.cookie, body: {} }))
    h.fake.jobs[0]!.resolve()
    await flush()
    expect((await h.call('POST', '/api/admin/reauth', { cookie: d2.a.cookie, body: { password: PASSWORD } })).status).toBe(200)
    const pub2 = await h.call('POST', `${B}/drafts/${d2.id}/publish`, { cookie: d2.a.cookie, body: {} })
    expect((pub2.json as unknown as AdminContentVersionResponse).sim?.recent).toBe(true)
    const rows = await database.db.select().from(adminAudit).where(eq(adminAudit.action, 'content.publish')).orderBy(asc(adminAudit.createdAt))
    expect((rows.at(-1)!.after as Record<string, unknown>).simRunId).toBe(run.id)
  })

  it('marks runs left running by a previous process as interrupted', async () => {
    // A row left `running` by "the previous process", before this server touches the table.
    const [stale] = await database.db
      .insert(contentSimRuns)
      .values({ draftHash: 'x', activeHash: 'base', status: 'running', params: { profiles: ['constant'], seeds: 1, weeks: 1 } })
      .returning({ id: contentSimRuns.id })
    const h = makeApp()
    const a = await account(h, 'support')
    const r = asRun(await h.call('GET', `${B}/sim-runs/${stale!.id}`, { cookie: a.cookie }))
    expect(r.status).toBe('interrupted')
  })
})
