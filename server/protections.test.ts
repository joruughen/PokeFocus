/** Auditoría A1/A2 + «servidor ocupado»: límites por jugador, tope de conexiones SSE y descarte de carga (503). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PublicUser } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { loadEnv } from './env'
import { EventBus, type Subscriber } from './events'

const ORIGIN = 'http://localhost:5173'
let database: Database
let ipSeq = 0

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
}, 60_000)
afterAll(async () => {
  await database?.close()
})

const makeApp = (extra: Record<string, string> = {}, bus = new EventBus()) =>
  createApp({ env: loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, DEV_TOOLS: '0', ...extra }), db: database.db, bus })

async function signUp(app: ReturnType<typeof makeApp>, n: number) {
  const res = await app.app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': `10.9.${n}.${++ipSeq % 250}` },
    body: JSON.stringify({ email: `prot${n}-${ipSeq}@test.dev`, password: 'correct horse', trainerName: `Prot ${n}`, country: 'PE' }),
  })
  expect(res.status).toBe(201)
  const cookie = /pf_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')![1]!
  return { cookie, user: ((await res.json()) as { user: PublicUser }).user }
}

const act = (app: ReturnType<typeof makeApp>, cookie: string, body: unknown) =>
  app.app.request('/api/game/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: `pf_session=${cookie}`, 'x-forwarded-for': '10.8.0.1' },
    body: JSON.stringify(body),
  })

describe('límite de acciones por jugador (A1)', () => {
  it('responde 429 con Retry-After al pasar de 120 acciones por minuto', async () => {
    const app = makeApp()
    const u = await signUp(app, 1)
    let limited: Response | null = null
    for (let i = 0; i < 125 && !limited; i++) {
      const r = await act(app, u.cookie, { type: 'pause' })
      if (r.status === 429) limited = r
    }
    expect(limited).not.toBeNull()
    expect(limited!.headers.get('retry-after')).toBeTruthy()
    expect(((await limited!.json()) as { error: string }).error).toBe('rate_limited')
  })

  it('otro jugador no se ve afectado por el límite del primero', async () => {
    const app = makeApp()
    const a = await signUp(app, 2)
    const b = await signUp(app, 3)
    for (let i = 0; i < 125; i++) await act(app, a.cookie, { type: 'pause' })
    expect((await act(app, b.cookie, { type: 'pause' })).status).not.toBe(429)
  })
})

describe('conexiones SSE acotadas (A2)', () => {
  it('con MAX_SSE_PER_USER=2 una tercera conexión cierra la más antigua', async () => {
    const bus = new EventBus()
    const app = makeApp({ MAX_SSE_PER_USER: '2' }, bus)
    const u = await signUp(app, 4)
    const open = async () => {
      const ctrl = new AbortController()
      const res = await app.app.request('/api/events', { headers: { cookie: `pf_session=${u.cookie}` }, signal: ctrl.signal })
      expect(res.status).toBe(200)
      return { res, ctrl }
    }
    const c1 = await open()
    await c1.res.body!.getReader().read() // la conexión ya está suscrita
    const c2 = await open()
    await c2.res.body!.getReader().read()
    expect(bus.count(u.user.id)).toBe(2)
    const c3 = await open()
    await c3.res.body!.getReader().read()
    await new Promise((r) => setTimeout(r, 150)) // el cierre de la antigua tarda ~50 ms
    expect(bus.count(u.user.id)).toBe(2)
    for (const c of [c1, c2, c3]) c.ctrl.abort()
  })

  it('con MAX_SSE_TOTAL alcanzado responde 503 server_busy', async () => {
    const bus = new EventBus()
    const app = makeApp({ MAX_SSE_TOTAL: '1' }, bus)
    const u = await signUp(app, 5)
    const fake: Subscriber = { userId: 'otro', sessionId: 's', send: () => {}, close: () => {} }
    bus.subscribe(fake)
    const res = await app.app.request('/api/events', { headers: { cookie: `pf_session=${u.cookie}` } })
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('10')
    expect(((await res.json()) as { error: string }).error).toBe('server_busy')
  })
})

describe('descarte de carga (503)', () => {
  it('con MAX_INFLIGHT=1 la segunda petición simultánea recibe 503 y /health sigue respondiendo', async () => {
    const app = makeApp({ MAX_INFLIGHT: '1' })
    const u = await signUp(app, 6)
    const get = () => app.app.request('/api/leaderboard', { headers: { cookie: `pf_session=${u.cookie}`, 'x-forwarded-for': '10.7.0.1' } })
    const results = await Promise.all([get(), get(), get(), get()])
    const statuses = results.map((r) => r.status)
    expect(statuses).toContain(200)
    expect(statuses).toContain(503)
    const busy = results.find((r) => r.status === 503)!
    expect(busy.headers.get('retry-after')).toBe('2')
    expect((await app.app.request('/api/health')).status).toBe(200)
  })

  it('MAX_INFLIGHT=0 lo desactiva', async () => {
    const app = makeApp({ MAX_INFLIGHT: '0' })
    const u = await signUp(app, 7)
    const get = () => app.app.request('/api/leaderboard', { headers: { cookie: `pf_session=${u.cookie}`, 'x-forwarded-for': '10.7.0.2' } })
    const results = await Promise.all([get(), get(), get(), get()])
    expect(results.every((r) => r.status === 200)).toBe(true)
  })
})
