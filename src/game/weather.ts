/**
 * Which weather a session uses (GDD §9.2 "Clima"). Shared by the reducer and
 * the server's /api/weather route so the preview matches what a session gets.
 *
 * - The real weather (Open-Meteo, fetched by the server) of the profile
 *   location (rounded device coordinates) or, failing that, of the typed city.
 * - Nothing detected → no weather (Water/Ice off; Fire only via its afternoon
 *   window). Players cannot pick a weather.
 * - With DEV_TOOLS=1 a manual weather (`profile.weather`, set from the dev
 *   panel) overrides the detected one, so any condition can be tested on
 *   demand. Outside dev it is ignored, also in old saves that still carry one.
 */
import type { WeatherInput } from '../engine'

export type WeatherSource = 'detected' | 'manual' | 'none'

export function resolveSessionWeather(
  detected: WeatherInput | null | undefined,
  manual: WeatherInput | null | undefined,
  dev: boolean,
): { weather: WeatherInput | null; source: WeatherSource } {
  if (dev && manual) return { weather: manual, source: 'manual' }
  if (detected) return { weather: detected, source: 'detected' }
  return { weather: null, source: 'none' }
}

/** Size of a location cell, degrees (~11 km of latitude). */
export const LOCATION_STEP_DEG = 0.1

export interface GeoCell {
  lat: number
  lon: number
}

/** Round one coordinate to the cell grid (one decimal, no float noise). */
export function roundCoord(v: number): number {
  const r = Math.round(v / LOCATION_STEP_DEG) * LOCATION_STEP_DEG
  return cleanZero(Math.round(r * 10) / 10)
}

function cleanZero(r: number): number {
  return Object.is(r, -0) ? 0 : r
}

/**
 * Rounded cell of a position, or null if it is not a valid coordinate.
 * Longitude is wrapped into −180…180 (180 and −180 are the same meridian).
 */
export function toGeoCell(lat: number, lon: number): GeoCell | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 540) return null
  let l = roundCoord(lon)
  if (l > 180) l = roundCoord(l - 360)
  if (l <= -180) l = roundCoord(l + 360)
  return { lat: roundCoord(lat), lon: l }
}

/** Where the detected weather comes from. */
export type WeatherVia = 'location' | 'city'

/** GET /api/weather. */
export interface WeatherResponse {
  /** Profile city (null = not set). */
  city: string | null
  /** Stored rounded location (null = not set). */
  location: GeoCell | null
  /**
   * Real weather of the location (preferred) or the city; null if unknown
   * (nothing set, city not found, API down or slow). `place` is the matched
   * city name, null for a location.
   */
  detected: { weather: WeatherInput; place: string | null; via: WeatherVia; fetchedAt: number } | null
  /** What a session started now would use. */
  weather: WeatherInput | null
  source: WeatherSource
}
