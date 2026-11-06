/**
 * Weather UI (GDD §9.2 "Clima"): the detected weather of the profile city
 * and the manual selector, which is the fallback when it cannot be detected
 * (and the override with DEV_TOOLS=1 on the server).
 */
import { useTranslation } from 'react-i18next'
import type { PlayerState, WeatherInput } from '../../../engine'
import { PixelIcon, Segmented, toast } from '../../components'
import { WEATHER_PRESETS, weatherKind, type WeatherKind } from '../../lib/conditions'
import { errorText } from '../../lib/errors'
import { useSessionWeather } from '../../lib/weather'
import { useGame } from '../../store/game'

const KINDS = ['clear', 'sun', 'rain', 'cold'] as const

/** "Rain · 14 °C" */
export function weatherLabel(w: WeatherInput, t: (k: string, o?: Record<string, unknown>) => string): string {
  const kind = t(`weather.${weatherKind(w)}`)
  return w.tempC === null ? kind : t('weather.kindTemp', { kind, temp: Math.round(w.tempC) })
}

/** One line: what was detected, or why the manual weather is used. */
export function WeatherStatus({ profile }: { profile: PlayerState['profile'] }) {
  const { t } = useTranslation()
  const { data, loading } = useSessionWeather(profile)
  let text: string
  if (!data) text = loading ? t('weather.checking') : profile.city ? t('weather.unavailable') : t('weather.noCity')
  else if (data.detected && data.source === 'detected') text = t('weather.detected', { place: data.detected.place, weather: weatherLabel(data.detected.weather, t) })
  else if (data.detected && data.source === 'manual') text = t('weather.devOverride', { place: data.detected.place, weather: weatherLabel(data.detected.weather, t) })
  else if (data.city) text = t('weather.notFound', { city: data.city })
  else text = t('weather.noCity')
  return (
    <p className="flex items-start gap-2 text-sm text-mist-300" role="status">
      <PixelIcon name="globe" size={16} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

/** Manual weather selector. */
export function ManualWeather({ profile, compact = false }: { profile: PlayerState['profile']; compact?: boolean }) {
  const { t } = useTranslation()
  const setWeather = useGame((s) => s.setWeather)
  return (
    <Segmented<WeatherKind>
      label={t('weather.manual')}
      value={weatherKind(profile.weather)}
      onChange={(w) => void setWeather(WEATHER_PRESETS[w]).then((err) => err && toast.add({ title: errorText(err), type: 'danger' }))}
      options={KINDS.map((w) => ({
        value: w,
        ariaLabel: t(`weather.${w}`),
        label: (
          <>
            <PixelIcon name={w} size={20} />
            <span className={compact ? 'max-sm:sr-only' : undefined}>{t(`weather.${w}`)}</span>
          </>
        ),
      }))}
    />
  )
}

/**
 * PreSession block: the detected weather when there is one; otherwise the
 * manual selector as today.
 */
export function WeatherPicker({ profile }: { profile: PlayerState['profile'] }) {
  const { t } = useTranslation()
  const { data, effective } = useSessionWeather(profile)
  const detected = data?.source === 'detected'
  const wk = weatherKind(effective)
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg">{t('home.plan.weather')}</h3>
      <WeatherStatus profile={profile} />
      {!detected && <ManualWeather profile={profile} />}
      <p className="text-sm text-mist-400">{t(`weather.effect.${wk}`)}</p>
    </div>
  )
}
