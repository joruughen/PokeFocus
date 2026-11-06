/**
 * Device location for the real weather (GDD §9.2 "Clima"). The browser
 * Geolocation API needs a secure context (localhost or HTTPS). The position
 * is rounded to a ~0.1° cell (~10 km) here, before anything is sent: the
 * exact coordinates never leave the device.
 */
import { toGeoCell, type GeoCell } from '../../game/weather'

export type LocationError = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout'

/** Why geolocation cannot be used here, or null if it can be tried. */
export function locationUnavailable(): 'insecure' | 'unsupported' | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  if (!('geolocation' in navigator)) return 'unsupported'
  return null
}

/** Ask for the position (inside a click) and round it to a cell. */
export function requestLocationCell(): Promise<{ ok: true; cell: GeoCell } | { ok: false; error: LocationError }> {
  const why = locationUnavailable()
  if (why) return Promise.resolve({ ok: false, error: why })
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const cell = toGeoCell(pos.coords.latitude, pos.coords.longitude)
        resolve(cell ? { ok: true, cell } : { ok: false, error: 'unavailable' })
      },
      (err) => resolve({ ok: false, error: err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable' }),
      // A city-level fix is enough: no GPS, a cached position up to 1 h old is fine.
      { enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 15_000 },
    )
  })
}
