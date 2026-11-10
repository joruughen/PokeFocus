/**
 * Password pepper end to end: accounts created before the pepper existed keep logging in and
 * are re-hashed with it; rotation via PASSWORD_PEPPER_PREVIOUS moves them to the new pepper.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { pepperFrom } from './auth/password'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { users } from './db/schema'
import { loadEnv } from './env'

const ORIGIN = 'http://localhost:5173'
const A = 'pepper-A-0123456789abcdefghijklmnopqrstuv'
const B = 'pepper-B-0123456789abcdefghijklmnopqrstuv'
const EMAIL = 'pepper@test.dev'
const PASSWORD = 'correct horse'

let database: Database
let ipSeq = 0

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

const appWith = (extra: Record<string, string>) =>
  createApp({ env: loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, ...extra }), db: database.db, clock: () => Date.UTC(2026, 10, 10) })

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown, cookie?: string) {
  const res = await app.app.request(path, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-forwarded-for': `10.9.0.${++ipSeq}`,
      ...(cookie ? { cookie: `pf_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
  return { status: res.status, cookie: sc ? sc[1]! : null }
}

const storedHash = async () => (await database.db.select({ h: users.passwordHash }).from(users).where(eq(users.email, EMAIL)))[0]!.h
const login = (app: ReturnType<typeof createApp>, password = PASSWORD) => post(app, '/api/auth/login', { email: EMAIL, password })

describe('password pepper (login upgrade and rotation)', () => {
  it('a legacy account logs in once the pepper is set and is re-hashed with it', async () => {
    const legacyApp = appWith({})
    expect((await post(legacyApp, '/api/auth/register', { email: EMAIL, password: PASSWORD, trainerName: 'Pepper', country: 'PE' })).status).toBe(201)
    const legacy = await storedHash()
    expect(legacy.startsWith('scrypt$')).toBe(true)

    const appA = appWith({ PASSWORD_PEPPER: A })
    expect((await login(appA, 'wrong password')).status).toBe(401)
    expect(await storedHash()).toBe(legacy) // a failed login never touches the hash
    expect((await login(appA)).status).toBe(200)
    const upgraded = await storedHash()
    expect(upgraded.startsWith(`scryptp$${pepperFrom(A).id}$`)).toBe(true)

    // Already on the current pepper: a second login does not rewrite it.
    expect((await login(appA)).status).toBe(200)
    expect(await storedHash()).toBe(upgraded)

    // The hash now needs the pepper: a server without it (or with another one) rejects it.
    expect((await login(legacyApp)).status).toBe(401)
    expect((await login(appWith({ PASSWORD_PEPPER: B }))).status).toBe(401)
  })

  it('rotation: the previous pepper still logs in and moves the account to the new one', async () => {
    const rotated = appWith({ PASSWORD_PEPPER: B, PASSWORD_PEPPER_PREVIOUS: A })
    expect((await login(rotated)).status).toBe(200)
    expect((await storedHash()).startsWith(`scryptp$${pepperFrom(B).id}$`)).toBe(true)
    expect((await login(appWith({ PASSWORD_PEPPER: B }))).status).toBe(200)
  })

  it('register and password change hash with the current pepper', async () => {
    const appB = appWith({ PASSWORD_PEPPER: B })
    const r = await login(appB)
    expect((await post(appB, '/api/auth/password', { current: PASSWORD, next: 'battery staple' }, r.cookie!)).status).toBeLessThan(300)
    expect((await storedHash()).startsWith(`scryptp$${pepperFrom(B).id}$`)).toBe(true)
    expect((await login(appB, 'battery staple')).status).toBe(200)

    expect((await post(appB, '/api/auth/register', { email: 'fresh@test.dev', password: PASSWORD, trainerName: 'Fresh', country: 'PE' })).status).toBe(201)
    const [fresh] = await database.db.select({ h: users.passwordHash }).from(users).where(eq(users.email, 'fresh@test.dev'))
    expect(fresh!.h.startsWith(`scryptp$${pepperFrom(B).id}$`)).toBe(true)
  })
})
