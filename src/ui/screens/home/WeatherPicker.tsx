/**
 * Weather UI (GDD §9.2 "Clima"): the real weather of the profile location
 * (rounded device position) or typed city. Players cannot pick a weather:
 * when nothing is detected, the session has none. The manual override lives
 * only in the dev panel (DEV_TOOLS=1).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlayerState, WeatherInput } from '../../../engine'
import { Button, PixelIcon, toast } from '../../components'
import { weatherKind } from '../../lib/conditions'
import { errorText } from '../../lib/errors'
import { locationUnavailable, requestLocationCell } from '../../lib/location'
import { refreshWeather, useSessionWeather } from '../../lib/weather'
import { useGame } from '../../store/game'
import { useBusy } from '../../store/selectors'

/** "Rain · 14 °C" */
export function weatherLabel(w: WeatherInput, t: (k: string, o?: Record<string, unknown>) => string): string {
  const kind = t(`weather.${weatherKind(w)}`)
  return w.tempC === null ? kind : t('weather.kindTemp', { kind, temp: Math.round(w.tempC) })
}

/** One line: what was detected, and from where, or why there is no weather. */
export function WeatherStatus({ profile }: { profile: PlayerState['profile'] }) {
  const { t } = useTranslation()
  const { data, loading } = useSessionWeather(profile)
  const hasSource = Boolean(profile.location || profile.city)
  let text: string
  if (!data) text = loading ? t('weather.checking') : hasSource ? t('weather.unavailable') : t('weather.noSource')
  else {
    const d = data.detected
    const where = d ? (d.via === 'location' ? t('weather.yourLocation') : (d.place ?? data.city ?? '')) : ''
    if (data.source === 'manual') text = t('weather.devOverride', { weather: data.weather ? weatherLabel(data.weather, t) : '' })
    else if (d) text = t('weather.detected', { place: where, weather: weatherLabel(d.weather, t) })
    else if (data.location) text = t('weather.locationFailed')
    else if (data.city) text = t('weather.notFound', { city: data.city })
    else text = t('weather.noSource')
  }
  return (
    <p className="flex items-start gap-2 text-sm text-mist-300" role="status">
      <PixelIcon name="globe" size={16} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

/** "Usar mi ubicación": asks the browser, rounds to ~10 km and saves the cell in the profile. */
export function UseLocationButton({ profile, size = 'md' }: { profile: PlayerState['profile']; size?: 'sm' | 'md' }) {
  const { t } = useTranslation()
  const updateProfile = useGame((s) => s.updateProfile)
  const busy = useBusy()
  const [asking, setAsking] = useState(false)
  const why = locationUnavailable()
  if (why) return <p className="text-sm text-mist-400">{t(`location.error.${why}`)}</p>

  const use = async () => {
    setAsking(true)
    const r = await requestLocationCell()
    setAsking(false)
    if (!r.ok) {
      toast.add({ title: t(`location.error.${r.error}`), type: 'danger' })
      return
    }
    const err = await updateProfile({ location: r.cell })
    if (err) toast.add({ title: errorText(err), type: 'danger' })
    else {
      toast.add({ title: t('location.saved'), type: 'success' })
      void refreshWeather({ ...profile, location: r.cell })
    }
  }
  return (
    <Button variant="secondary" size={size} icon="globe" disabled={asking || busy} onClick={() => void use()}>
      {asking ? t('location.asking') : profile.location ? t('location.update') : t('location.use')}
    </Button>
  )
}

/**
 * PreSession block: the weather a session started now would get, and a
 * compact "use my location" prompt while no location is set.
 */
export function WeatherPicker({ profile }: { profile: PlayerState['profile'] }) {
  const { t } = useTranslation()
  const { effective } = useSessionWeather(profile)
  const wk = weatherKind(effective)
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg">{t('home.plan.weather')}</h3>
      <WeatherStatus profile={profile} />
      {!profile.location && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <UseLocationButton profile={profile} size="sm" />
          {!locationUnavailable() && <span className="text-sm text-mist-400">{t('location.privacyShort')}</span>}
        </div>
      )}
      <p className="text-sm text-mist-400">{effective ? t(`weather.effect.${wk}`) : t('weather.effect.none')}</p>
    </div>
  )
}
