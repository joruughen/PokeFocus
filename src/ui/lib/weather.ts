/**
 * Weather the next session would use, from GET /api/weather (real weather of
 * the profile location or city; the manual one only in dev). Cached for the
 * tab and refetched when the location, city or dev weather changes, or after
 * 10 min. Unknown (offline, still loading) = no weather.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { PlayerState, WeatherInput } from '../../engine'
import type { WeatherResponse } from '../../game/weather'
import { weatherApi } from '../api/endpoints'

const STALE_MS = 10 * 60_000

interface WeatherState {
  data: WeatherResponse | null
  /** Location + city + dev weather the data was fetched for. */
  key: string | null
  at: number
  loading: boolean
}

export const useWeatherStore = create<WeatherState>()(() => ({ data: null, key: null, at: 0, loading: false }))

function keyOf(profile: PlayerState['profile']): string {
  return JSON.stringify([profile.location ?? null, profile.city?.trim().toLowerCase() ?? null, profile.weather])
}

export async function refreshWeather(profile: PlayerState['profile']): Promise<void> {
  const key = keyOf(profile)
  if (useWeatherStore.getState().loading) return
  useWeatherStore.setState({ loading: true })
  try {
    const data = await weatherApi.get()
    useWeatherStore.setState({ data, key, at: Date.now(), loading: false })
  } catch {
    // Offline or server error: no weather in the preview.
    useWeatherStore.setState({ data: null, key, at: Date.now(), loading: false })
  }
}

/**
 * The weather response for this profile (fetching it when needed), or null
 * while unknown. `effective` is what a session started now would use.
 */
export function useSessionWeather(profile: PlayerState['profile']): { data: WeatherResponse | null; effective: WeatherInput | null; loading: boolean } {
  const s = useWeatherStore()
  const key = keyOf(profile)
  const fresh = s.key === key && Date.now() - s.at < STALE_MS
  useEffect(() => {
    if (!fresh && !s.loading) void refreshWeather(profile)
  })
  const data = s.key === key ? s.data : null
  return { data, effective: data ? data.weather : null, loading: s.loading }
}
