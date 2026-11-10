import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminSpawnPreview, AdminSpawnWeather } from '../../../../game/protocol'
import { Button, Select, Sprite, TextField } from '../../../components'
import { cx } from '../../../lib/cx'
import { asLocale, speciesName } from '../../../lib/names'
import { eventsAdminApi } from './api'
import { eventsErrorText } from './errors'
import { mergePreviews, type PreviewRow } from './preview'

const WEATHERS: AdminSpawnWeather[] = ['clear', 'sun', 'rain', 'snow', 'unknown']

/** "12.3%" (one decimal under 10 %). */
export function fmtShare(p: number, lng: string): string {
  return new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: p < 0.1 ? 1 : 0, minimumFractionDigits: p > 0 && p < 0.1 ? 1 : 0 }).format(p)
}

export interface SpawnPreviewProps {
  /** Saved event the preview is run for; null while it has not been saved. */
  eventId: string | null
  featured: readonly string[]
  /** The form has changes the server does not know yet: the preview reflects the saved version. */
  dirty: boolean
}

/** Wild pool before and after the event for one hour, weather and trainer level (`GET /admin/content/spawn-preview`). */
export function SpawnPreview({ eventId, featured, dirty }: SpawnPreviewProps) {
  const { t, i18n } = useTranslation()
  const [hour, setHour] = useState('12')
  const [weather, setWeather] = useState<AdminSpawnWeather>('clear')
  const [level, setLevel] = useState('10')
  const [state, setState] = useState<{ rows: PreviewRow[]; legendary: [number, number]; count: [number, number]; hour: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const h = Number(hour)
  const l = Number(level)
  const valid = Number.isInteger(h) && h >= 0 && h <= 23 && Number.isInteger(l) && l >= 1 && l <= 100

  const run = async () => {
    if (!eventId || !valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const q = { hour: h, weather, trainerLevel: l }
      const [without, withEvent] = (await Promise.all([eventsAdminApi.spawnPreview(q), eventsAdminApi.spawnPreview({ ...q, eventId })])) as [AdminSpawnPreview, AdminSpawnPreview]
      setState({ rows: mergePreviews(without, withEvent, featured), legendary: [without.legendaryChance, withEvent.legendaryChance], count: [without.count, withEvent.count], hour: h })
    } catch (e) {
      setError(eventsErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  const lng = asLocale(i18n.language)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-mist-300">{t('eventsAdmin.spawn.body')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label={t('eventsAdmin.spawn.hour')} inputMode="numeric" value={hour} onChange={(e) => setHour(e.target.value)} error={hour !== '' && !(Number.isInteger(h) && h >= 0 && h <= 23) ? t('eventsAdmin.spawn.hourRange') : null} />
        <Select label={t('eventsAdmin.spawn.weather')} value={weather} onChange={(v) => setWeather(v as AdminSpawnWeather)} options={WEATHERS.map((w) => ({ value: w, label: t(`eventsAdmin.spawn.weathers.${w}`) }))} />
        <TextField label={t('eventsAdmin.spawn.level')} inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value)} error={level !== '' && !(Number.isInteger(l) && l >= 1 && l <= 100) ? t('eventsAdmin.spawn.levelRange') : null} />
      </div>
      {!eventId && <p className="text-sm text-amber-400">{t('eventsAdmin.spawn.saveFirst')}</p>}
      {eventId && dirty && <p className="text-sm text-amber-400">{t('eventsAdmin.spawn.dirty')}</p>}
      <Button variant="secondary" icon="chart" onClick={() => void run()} disabled={!eventId || !valid || busy} className="self-start">
        {busy ? t('common.loading') : t('eventsAdmin.spawn.run')}
      </Button>
      <p className="min-h-5 text-sm break-words text-cheek-400" role="alert">
        {error}
      </p>
      {state && <SpawnTable rows={state.rows} legendary={state.legendary} count={state.count} hour={state.hour} lng={lng} />}
    </div>
  )
}

/** The comparison table, apart from the request so it can be rendered on its own. */
export function SpawnTable({ rows, legendary, count, hour, lng }: { rows: PreviewRow[]; legendary: [number, number]; count: [number, number]; hour: number; lng: 'es' | 'en' }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-mist-300">
        {t('eventsAdmin.spawn.summary', { hour, before: count[0], after: count[1], legBefore: fmtShare(legendary[0], lng), legAfter: fmtShare(legendary[1], lng) })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-left">
          <caption className="sr-only">{t('eventsAdmin.spawn.caption')}</caption>
          <thead>
            <tr className="text-sm text-mist-400">
              <th scope="col" className="py-1 pr-2 font-normal">
                {t('eventsAdmin.spawn.species')}
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                {t('eventsAdmin.spawn.before')}
              </th>
              <th scope="col" className="px-2 py-1 text-right font-normal">
                {t('eventsAdmin.spawn.after')}
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-normal">
                {t('eventsAdmin.spawn.delta')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className={cx('border-t border-dusk-700', r.featured && 'bg-dusk-900')}>
                <th scope="row" className="py-1 pr-2 font-normal">
                  <span className="flex items-center gap-2">
                    <span className="grid h-8 w-10 shrink-0 place-items-center">
                      <Sprite kind="icon" slug={r.slug} alt="" />
                    </span>
                    <span className="break-words">{speciesName(r.slug, lng)}</span>
                  </span>
                </th>
                <td className="px-2 py-1 text-right font-num text-lg">{fmtShare(r.before, lng)}</td>
                <td className="px-2 py-1 text-right font-num text-lg">{fmtShare(r.after, lng)}</td>
                <td className={cx('py-1 pl-2 text-right font-num text-lg', r.delta > 0 ? 'text-leaf-400' : r.delta < 0 ? 'text-cheek-400' : 'text-mist-400')}>
                  {r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}
                  {fmtShare(Math.abs(r.delta), lng)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
