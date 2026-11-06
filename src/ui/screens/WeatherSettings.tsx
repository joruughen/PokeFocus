import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, TextField, toast } from '../components'
import { errorText } from '../lib/errors'
import { refreshWeather } from '../lib/weather'
import { useGame } from '../store/game'
import { useBusy, usePlayer } from '../store/selectors'
import { ManualWeather, WeatherStatus } from './home/WeatherPicker'

/**
 * Settings → weather: the profile city (real weather from Open-Meteo, fetched
 * by the server when a session starts), what is detected now, and the manual
 * weather, which is the fallback when nothing is detected.
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

  const save = async () => {
    const v = city.trim()
    const err = await updateProfile({ city: v ? v : null })
    if (err) toast.add({ title: errorText(err), type: 'danger' })
    else void refreshWeather({ ...player.profile, city: v || null })
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) void save()
        }}
      >
        <TextField
          label={t('weather.city')}
          value={city}
          maxLength={80}
          autoComplete="address-level2"
          placeholder={t('weather.cityPlaceholder')}
          onChange={(e) => setCity(e.target.value)}
          className="min-w-56 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={!dirty || busy}>
          {t('weather.citySave')}
        </Button>
      </form>
      <WeatherStatus profile={player.profile} />
      <div>
        <p className="font-display text-lg">{t('weather.manual')}</p>
        <p className="mb-2 text-sm text-mist-300">{t('weather.manualNote')}</p>
        <ManualWeather profile={player.profile} compact />
      </div>
    </div>
  )
}
