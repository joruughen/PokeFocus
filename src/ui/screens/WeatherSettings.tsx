import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, TextField, toast } from '../components'
import { errorText } from '../lib/errors'
import { refreshWeather } from '../lib/weather'
import { useGame } from '../store/game'
import { useBusy, usePlayer } from '../store/selectors'
import { UseLocationButton, WeatherStatus } from './home/WeatherPicker'

/**
 * Settings → weather: the device location (rounded to ~10 km, wins), the
 * typed city (fallback), and what is detected now. There is no manual
 * weather: when nothing is detected the session has no weather.
 */
export function WeatherSettings() {
  const { t } = useTranslation()
  const player = usePlayer()
  const updateProfile = useGame((s) => s.updateProfile)
  const busy = useBusy()
  const saved = player.profile.city ?? ''
  const [city, setCity] = useState(saved)
  useEffect(() => setCity(saved), [saved])
  const dirty = city.trim() !== saved.trim()
  const location = player.profile.location ?? null

  const save = async () => {
    const v = city.trim()
    const err = await updateProfile({ city: v ? v : null })
    if (err) toast.add({ title: errorText(err), type: 'danger' })
    else void refreshWeather({ ...player.profile, city: v || null })
  }

  const clearLocation = async () => {
    const err = await updateProfile({ location: null })
    if (err) toast.add({ title: errorText(err), type: 'danger' })
    else {
      toast.add({ title: t('location.cleared') })
      void refreshWeather({ ...player.profile, location: null })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-base text-mist-100">{t('location.title')}</p>
        <p className="max-w-[60ch] text-sm text-mist-300">{location ? t('location.on') : t('location.note')}</p>
        <div className="flex flex-wrap gap-3">
          <UseLocationButton profile={player.profile} />
          {location && (
            <Button variant="ghost" icon="close" disabled={busy} onClick={() => void clearLocation()}>
              {t('location.clear')}
            </Button>
          )}
        </div>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) void save()
        }}
      >
        <TextField
          label={location ? t('weather.cityFallback') : t('weather.city')}
          value={city}
          maxLength={80}
          autoComplete="address-level2"
          placeholder={t('weather.cityPlaceholder')}
          onChange={(e) => setCity(e.target.value)}
          className="min-w-0 flex-1 basis-56"
        />
        <Button type="submit" variant="secondary" disabled={!dirty || busy}>
          {t('weather.citySave')}
        </Button>
      </form>
      <WeatherStatus profile={player.profile} />
    </div>
  )
}
