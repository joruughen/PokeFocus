/**
 * Which weather a session uses (GDD §9.2 "Clima"). Shared by the reducer and
 * the server's /api/weather route so the preview matches what a session gets.
 *
 * - The real weather of the profile city (Open-Meteo, fetched by the server)
 *   wins when it is known.
 * - Otherwise the manual weather from Settings (`profile.weather`) is the
 *   fallback, or null.
 * - With DEV_TOOLS=1 a manual weather overrides the detected one, so any
 *   condition can be tested on demand.
 */
import type { WeatherInput } from '../engine'

export type WeatherSource = 'detected' | 'manual' | 'none'

export function resolveSessionWeather(
  detected: WeatherInput | null | undefined,
  manual: WeatherInput | null,
  dev: boolean,
): { weather: WeatherInput | null; source: WeatherSource } {
  if (dev && manual) return { weather: manual, source: 'manual' }
  if (detected) return { weather: detected, source: 'detected' }
  if (manual) return { weather: manual, source: 'manual' }
  return { weather: null, source: 'none' }
}

/** GET /api/weather. */
export interface WeatherResponse {
  /** Profile city (null = not set). */
  city: string | null
  /** Real weather of the city, null if unknown (no city, not found, API down or slow). */
  detected: { weather: WeatherInput; place: string; fetchedAt: number } | null
  /** What a session started now would use. */
  weather: WeatherInput | null
  source: WeatherSource
}
