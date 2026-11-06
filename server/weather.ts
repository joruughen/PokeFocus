/**
 * Real weather where the player studies (GDD §9.2 "Clima") from Open-Meteo,
 * no API key. Used when a session starts and by GET /api/weather.
 *
 * - The profile location (a ~0.1° cell rounded by the client) goes straight
 *   to the forecast API, no geocoding. Without a location, or if its lookup
 *   fails, the typed city is geocoded by name.
 * - Results are cached per cell / per city (`ttlMs`, ~30 min); a failure is
 *   cached for a short `failTtlMs` so a dead API is not hit on every start.
 *   Coordinates are only kept in this in-memory cache (bounded, never logged).
 * - `current()` never waits more than `deadlineMs` (2 s): a slow lookup keeps
 *   running in the background and fills the cache for the next call, but the
 *   caller gets null (= no weather).
 * - Concurrent lookups of the same key share one request.
 * - `fetch` is injected (Deps) so tests use a fake.
 */
import type { WeatherInput } from '../src/engine'
import { toGeoCell, type GeoCell, type WeatherVia } from '../src/game/weather'

export type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>

export interface DetectedWeather {
  weather: WeatherInput
  /** Place the geocoder matched ("Lima, Peru"); null for a location. */
  place: string | null
  via: WeatherVia
  fetchedAt: number
}

export interface WeatherQuery {
  location?: GeoCell | null
  city?: string | null
}

export interface WeatherService {
  /** Current weather of the location, else of the city, or null (nothing set, unknown city, network error or timeout). */
  current(query: WeatherQuery): Promise<DetectedWeather | null>
}

export interface WeatherOptions {
  fetch: FetchLike
  clock: () => number
  ttlMs?: number
  failTtlMs?: number
  /** Max wait for the caller. */
  deadlineMs?: number
  /** Abort a single HTTP request after this long (lets a slow lookup still fill the cache). */
  requestTimeoutMs?: number
  maxEntries?: number
}

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

const MIN = 60_000

interface Entry {
  value: DetectedWeather | null
  expiresAt: number
}

export function cityKey(city: string): string {
  return 'city:' + city.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function createWeatherService(opts: WeatherOptions): WeatherService {
  const ttl = opts.ttlMs ?? 30 * MIN
  const failTtl = opts.failTtlMs ?? 5 * MIN
  const deadline = opts.deadlineMs ?? 2000
  const reqTimeout = opts.requestTimeoutMs ?? 8000
  const maxEntries = opts.maxEntries ?? 500
  const cache = new Map<string, Entry>()
  const inflight = new Map<string, Promise<DetectedWeather | null>>()

  const getJson = async (url: string): Promise<unknown> => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), reqTimeout)
    try {
      const res = await opts.fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`http_${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  const store = (key: string, value: DetectedWeather | null) => {
    if (cache.size >= maxEntries && !cache.has(key)) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(key, { value, expiresAt: opts.clock() + (value ? ttl : failTtl) })
  }

  const forecast = async (lat: number, lon: number): Promise<WeatherInput | null> =>
    parseCurrent(await getJson(`${FORECAST_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day,rain,showers,snowfall&timezone=auto`))

  /** Cached, de-duplicated lookup of one key. */
  const cached = (key: string, run: () => Promise<DetectedWeather | null>): Promise<DetectedWeather | null> => {
    const hit = cache.get(key)
    if (hit && hit.expiresAt > opts.clock()) return Promise.resolve(hit.value)
    let p = inflight.get(key)
    if (!p) {
      p = (async () => {
        try {
          const value = await run()
          store(key, value)
          return value
        } catch {
          store(key, null)
          return null
        } finally {
          inflight.delete(key)
        }
      })()
      inflight.set(key, p)
    }
    return p
  }

  const byCell = (cell: GeoCell) =>
    cached(cellKey(cell), async () => {
      const weather = await forecast(cell.lat, cell.lon)
      return weather ? { weather, place: null, via: 'location' as const, fetchedAt: opts.clock() } : null
    })

  const byCity = (city: string) =>
    cached(cityKey(city), async () => {
      const place = await geocode(getJson, city)
      if (!place) return null
      const weather = await forecast(place.latitude, place.longitude)
      return weather ? { weather, place: place.label, via: 'city' as const, fetchedAt: opts.clock() } : null
    })

  return {
    async current(query) {
      // Re-round on the server: whatever was stored, only the cell is ever sent out.
      const cell = query.location ? toGeoCell(query.location.lat, query.location.lon) : null
      const city = query.city?.trim() || null
      if (!cell && !city) return null
      const p = (async () => {
        const a = cell ? await byCell(cell) : null
        return a ?? (city ? await byCity(city) : null)
      })()
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadline)
      })
      try {
        return await Promise.race([p, timeout])
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export function cellKey(cell: GeoCell): string {
  return `@${cell.lat.toFixed(1)},${cell.lon.toFixed(1)}`
}

// ---------------------------------------------------------------------------
// Open-Meteo parsing (pure)
// ---------------------------------------------------------------------------

interface Place {
  latitude: number
  longitude: number
  label: string
}

/**
 * "Lima" or "Lima, Peru" / "Springfield, Illinois": the name before the comma
 * is searched, the rest (if any) picks the result whose country, country code
 * or region matches.
 */
async function geocode(getJson: (url: string) => Promise<unknown>, city: string): Promise<Place | null> {
  const [name = '', ...rest] = city.split(',').map((s) => s.trim())
  if (!name) return null
  const hint = rest.join(' ').toLowerCase().trim()
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(name)}&count=10&language=en&format=json`
  const data = (await getJson(url)) as { results?: unknown }
  const results = Array.isArray(data?.results) ? (data.results as Record<string, unknown>[]) : []
  const valid = results.filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
  if (valid.length === 0) return null
  const tokens = hint.split(/[\s,]+/).filter(Boolean)
  // Exact words only for short codes ("PE" must not match inside "Spain"); longer names may span words ("United States").
  const matches = (r: Record<string, unknown>) =>
    [r.country, r.country_code, r.admin1].some((v) => {
      if (typeof v !== 'string' || !v) return false
      const f = v.toLowerCase()
      return tokens.includes(f) || (f.length > 3 && hint.includes(f))
    })
  const best = (hint && valid.find(matches)) || valid[0]!
  const label = [best.name, best.country].filter((v) => typeof v === 'string' && v).join(', ')
  return { latitude: best.latitude as number, longitude: best.longitude as number, label }
}

/** WMO weather codes (Open-Meteo `weather_code`). */
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
/** Clear sky and mainly clear count as sunny in daytime. */
const SUN_CODES = new Set([0, 1])

export function parseCurrent(data: unknown): WeatherInput | null {
  const cur = (data as { current?: Record<string, unknown> } | null)?.current
  if (!cur || typeof cur !== 'object') return null
  const code = typeof cur.weather_code === 'number' ? cur.weather_code : null
  const temp = typeof cur.temperature_2m === 'number' && Number.isFinite(cur.temperature_2m) ? Math.round(cur.temperature_2m * 10) / 10 : null
  if (code === null && temp === null) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const snow = (code !== null && SNOW_CODES.has(code)) || num(cur.snowfall) > 0
  const rain = !snow && ((code !== null && RAIN_CODES.has(code)) || num(cur.rain) + num(cur.showers) > 0)
  const day = cur.is_day === undefined ? true : cur.is_day === 1
  const sun = !rain && !snow && day && code !== null && SUN_CODES.has(code)
  return { rain, sun, snow, tempC: temp }
}
