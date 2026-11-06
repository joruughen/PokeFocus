import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ActionResponse, GameAction } from '../src/game/protocol'
import type { WeatherResponse } from '../src/game/weather'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { loadEnv } from './env'
import { soundProfileSchema } from './validation'
import { createWeatherService, FORECAST_URL, GEOCODING_URL, parseCurrent, type FetchLike } from './weather'

const MIN = 60_000

// ---------------------------------------------------------------------------
// Fake Open-Meteo
// ---------------------------------------------------------------------------

interface FakeOpts {
  /** WMO code of the current weather. */
  code?: number
  temp?: number
  isDay?: 0 | 1
  /** Throw on every request. */
  fail?: boolean
  /** Delay every response (ms). */
  delayMs?: number
  /** Geocoder finds nothing. */
  unknownCity?: boolean
}

function fakeFetch(o: FakeOpts = {}) {
  const calls: string[] = []
  const fn: FetchLike = async (url, init) => {
    calls.push(url)
    if (o.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, o.delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new Error('aborted'))
        })
      })
    }
    if (o.fail) throw new Error('network down')
    if (url.startsWith(GEOCODING_URL)) {
      const results = o.unknownCity
        ? []
        : [
            { name: 'Lima', country: 'United States', country_code: 'US', admin1: 'Ohio', latitude: 40.7, longitude: -84.1 },
            { name: 'Lima', country: 'Peru', country_code: 'PE', admin1: 'Lima', latitude: -12.05, longitude: -77.04 },
          ]
      return Response.json(o.unknownCity ? {} : { results })
    }
    if (url.startsWith(FORECAST_URL)) {
      return Response.json({ current: { temperature_2m: o.temp ?? 18.24, weather_code: o.code ?? 61, is_day: o.isDay ?? 1, rain: 0, showers: 0, snowfall: 0 } })
    }
    return new Response('not found', { status: 404 })
  }
  return { fn, calls }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

describe('weather service', () => {
  it('geocodes the city, maps the current weather and caches it ~30 min per city', async () => {
    let t = 1_000_000
    const f = fakeFetch({ code: 61, temp: 18.24 })
    const svc = createWeatherService({ fetch: f.fn, clock: () => t })
    const a = await svc.current('Lima, Peru')
    expect(a?.weather).toEqual({ rain: true, sun: false, snow: false, tempC: 18.2 })
    expect(a?.place).toBe('Lima, Peru')
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1]).toContain('latitude=-12.05') // the country hint picks Peru, not Ohio
    // Same city (any spacing/case) inside the TTL: no new request.
    t += 29 * MIN
    expect((await svc.current('  lima,  PERU '))?.weather.rain).toBe(true)
    expect(f.calls).toHaveLength(2)
    // After the TTL: fetched again.
    t += 2 * MIN
    await svc.current('Lima, Peru')
    expect(f.calls).toHaveLength(4)
  })

  it('no city → null without any request', async () => {
    const f = fakeFetch()
    const svc = createWeatherService({ fetch: f.fn, clock: () => 0 })
    expect(await svc.current(null)).toBeNull()
    expect(await svc.current('   ')).toBeNull()
    expect(f.calls).toHaveLength(0)
  })

  it('a failure returns null and is cached briefly', async () => {
    let t = 0
    const f = fakeFetch({ fail: true })
    const svc = createWeatherService({ fetch: f.fn, clock: () => t, failTtlMs: 5 * MIN })
    expect(await svc.current('Lima')).toBeNull()
    expect(await svc.current('Lima')).toBeNull()
    expect(f.calls).toHaveLength(1)
    t += 6 * MIN
    expect(await svc.current('Lima')).toBeNull()
    expect(f.calls).toHaveLength(2)
  })

  it('unknown city → null', async () => {
    const svc = createWeatherService({ fetch: fakeFetch({ unknownCity: true }).fn, clock: () => 0 })
    expect(await svc.current('Atlantis')).toBeNull()
  })

  it('a slow API never blocks the caller past the deadline, and fills the cache later', async () => {
    const f = fakeFetch({ delayMs: 60, code: 0 })
    const svc = createWeatherService({ fetch: f.fn, clock: () => 0, deadlineMs: 20, requestTimeoutMs: 1000 })
    const t0 = Date.now()
    expect(await svc.current('Lima')).toBeNull()
    expect(Date.now() - t0).toBeLessThan(55)
    await new Promise((r) => setTimeout(r, 200))
    expect((await svc.current('Lima'))?.weather.sun).toBe(true)
    expect(f.calls).toHaveLength(2) // the late lookup was reused, not repeated
  })

  it('concurrent lookups of one city share the request', async () => {
    const f = fakeFetch({ delayMs: 5 })
    const svc = createWeatherService({ fetch: f.fn, clock: () => 0 })
    await Promise.all([svc.current('Lima'), svc.current('lima'), svc.current('LIMA')])
    expect(f.calls).toHaveLength(2)
  })
})

describe('parseCurrent', () => {
  const cur = (c: Record<string, unknown>) => parseCurrent({ current: c })
  it('maps WMO codes', () => {
    expect(cur({ weather_code: 0, temperature_2m: 26, is_day: 1 })).toEqual({ rain: false, sun: true, snow: false, tempC: 26 })
    expect(cur({ weather_code: 0, temperature_2m: 20, is_day: 0 })?.sun).toBe(false) // clear night is not "sunny"
    expect(cur({ weather_code: 3, temperature_2m: 10 })).toEqual({ rain: false, sun: false, snow: false, tempC: 10 })
    expect(cur({ weather_code: 81, temperature_2m: 15 })?.rain).toBe(true)
    expect(cur({ weather_code: 2, rain: 0.4, temperature_2m: 15 })?.rain).toBe(true)
    expect(cur({ weather_code: 73, temperature_2m: -2 })).toEqual({ rain: false, sun: false, snow: true, tempC: -2 })
  })
  it('rejects garbage', () => {
    expect(parseCurrent(null)).toBeNull()
    expect(parseCurrent({})).toBeNull()
    expect(cur({})).toBeNull()
  })
})

describe('soundProfile validation', () => {
  it('accepts shares in 0–1 summing to ≤ 1.05', () => {
    expect(soundProfileSchema.safeParse({ silence: 0.6, music: 0.3, voice: 0.1, noise: 0 }).success).toBe(true)
    expect(soundProfileSchema.safeParse({ silence: 0.35, music: 0.35, voice: 0.35, noise: 0 }).success).toBe(true) // 1.05
  })
  it('rejects out-of-range values, a sum over 1.05 and missing keys', () => {
    expect(soundProfileSchema.safeParse({ silence: 1.2, music: 0, voice: 0, noise: 0 }).success).toBe(false)
    expect(soundProfileSchema.safeParse({ silence: -0.1, music: 0.5, voice: 0, noise: 0 }).success).toBe(false)
    expect(soundProfileSchema.safeParse({ silence: 0.5, music: 0.5, voice: 0.1, noise: 0 }).success).toBe(false)
    expect(soundProfileSchema.safeParse({ silence: 1 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Through the API
// ---------------------------------------------------------------------------

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 3, 10, 0)
let database: Database
let now = T0
let ipSeq = 0
const fetchState: FakeOpts = { code: 61, temp: 14 }
const calls: string[] = []
const liveFake: FetchLike = (url, init) => {
  const f = fakeFetch(fetchState)
  calls.push(url)
  return f.fn(url, init)
}
let app: ReturnType<typeof createApp>
let devApp: ReturnType<typeof createApp>

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  const base = { NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN }
  app = createApp({ env: loadEnv({ ...base, DEV_TOOLS: '0' }), db: database.db, clock: () => now, fetch: liveFake })
  devApp = createApp({ env: loadEnv({ ...base, DEV_TOOLS: '1' }), db: database.db, clock: () => now, fetch: liveFake })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

async function call(method: string, path: string, cookie: string | null, body?: unknown, which = app) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.1.0.${++ipSeq % 250}` }
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  if (cookie) headers.cookie = `pf_session=${cookie}`
  const res = await which.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  const sc = res.headers.get('set-cookie')?.match(/pf_session=([^;]*)/)
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null, cookie: sc ? sc[1]! : null }
}

let userSeq = 0
async function newUser(): Promise<string> {
  const n = ++userSeq
  const r = await call('POST', '/api/auth/register', null, { email: `w${n}@test.dev`, password: 'correct horse', trainerName: `Weather ${n}`, country: 'PE' })
  expect(r.status).toBe(201)
  const cookie = r.cookie!
  expect((await act(cookie, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'charmander' })).status).toBe(200)
  return cookie
}

const act = (cookie: string, a: GameAction, which = app) => call('POST', '/api/game/action', cookie, a, which)

describe('session weather through the API', () => {
  it('start stores the city weather on the session; claim uses it and validates soundProfile', async () => {
    now = T0
    const cookie = await newUser()
    expect((await act(cookie, { type: 'updateProfile', patch: { city: 'Lima, Peru' } })).status).toBe(200)
    const st = await act(cookie, { type: 'start', minutes: 25 })
    expect(st.status).toBe(200)
    const doc = (st.json as unknown as ActionResponse<'start'>).doc
    expect(doc.player?.activeSession?.weather).toEqual({ rain: true, sun: false, snow: false, tempC: 14 })

    now = T0 + 26 * MIN
    const bad = await act(cookie, { type: 'claim', soundProfile: { silence: 0.9, music: 0.9, voice: 0, noise: 0 } })
    expect(bad.status).toBe(400)
    const ok = await act(cookie, { type: 'claim', soundProfile: { silence: 0.6, music: 0.3, voice: 0.1, noise: 0 } })
    expect(ok.status).toBe(200)
    const r = (ok.json as unknown as ActionResponse<'claim'>).result.outcome.result
    expect(r.conditions).toContain('water')
    expect(r.conditions).toContain('flying')
    expect(r.soundProfile).toEqual({ silence: 0.6, music: 0.3, voice: 0.1, noise: 0 })
  })

  it('API down → the manual weather is the fallback; GET /api/weather reports it', async () => {
    now = T0 + 24 * 60 * MIN
    const cookie = await newUser()
    await act(cookie, { type: 'updateProfile', patch: { city: 'Nowhere Town' } })
    await act(cookie, { type: 'setWeather', weather: { rain: false, sun: true, snow: false, tempC: 27 } })
    fetchState.fail = true
    try {
      const w = (await call('GET', '/api/weather', cookie)).json as unknown as WeatherResponse
      expect(w).toMatchObject({ city: 'Nowhere Town', detected: null, source: 'manual', weather: { sun: true } })
      const st = await act(cookie, { type: 'start', minutes: 25 })
      expect((st.json as unknown as ActionResponse<'start'>).doc.player?.activeSession?.weather).toEqual({ rain: false, sun: true, snow: false, tempC: 27 })
    } finally {
      fetchState.fail = false
    }
  })

  it('GET /api/weather: detected weather; dev manual overrides it', async () => {
    now = T0 + 48 * 60 * MIN
    const cookie = await newUser()
    expect(((await call('GET', '/api/weather', cookie)).json as unknown as WeatherResponse).source).toBe('none')
    await act(cookie, { type: 'updateProfile', patch: { city: 'Cusco' } })
    const w = (await call('GET', '/api/weather', cookie)).json as unknown as WeatherResponse
    expect(w.source).toBe('detected')
    expect(w.detected?.weather.rain).toBe(true)
    await act(cookie, { type: 'setWeather', weather: { rain: false, sun: false, snow: true, tempC: -3 } })
    expect(((await call('GET', '/api/weather', cookie)).json as unknown as WeatherResponse).source).toBe('detected')
    expect(((await call('GET', '/api/weather', cookie, undefined, devApp)).json as unknown as WeatherResponse).source).toBe('manual')
    expect((await call('GET', '/api/weather', null)).status).toBe(401)
  })
})
