import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminSpawnPreview, AdminSpawnWeather } from '../../../../game/protocol'
import { Segmented, Select, Sprite } from '../../../components'
import { asLocale, speciesName } from '../../../lib/names'
import { cx } from '../../../lib/cx'
import { contentApi } from './api'
import { NumberInput } from './fields'
import { appearDisappear, previewRows } from './previewRows'
import { DATA_LIMITS } from '../../../../game/content/limits'

const WEATHERS: AdminSpawnWeather[] = ['clear', 'sun', 'rain', 'snow', 'unknown']
const HOUR = { kind: 'int' as const, min: 0, max: 23, step: 1, unit: 'h' }
const LEVEL = DATA_LIMITS.minTrainerLevel
const SHOWN = 30

export interface SpawnPreviewProps {
  /** The draft to preview (null = just the live content). */
  draftId: number | null
  /** Save pending edits first so the server previews what is on screen. */
  flush?: () => Promise<boolean>
  /** Bumped by the editor on every saved change: reload. */
  revision: number | string
  /** Events active now, to preview with one on top. */
  events: { id: string; slug: string }[]
}

type State = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; live: AdminSpawnPreview; draft: AdminSpawnPreview | null }

/** Which species the wild pool offers for an hour × weather × trainer level, live vs the draft side by side. */
export function SpawnPreview({ draftId, flush, revision, events }: SpawnPreviewProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const [hour, setHour] = useState(12)
  const [weather, setWeather] = useState<AdminSpawnWeather>('clear')
  const [level, setLevel] = useState(10)
  const [eventId, setEventId] = useState('')
  const [all, setAll] = useState(false)
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (flush && draftId !== null) await flush()
          const base = { hour, weather, trainerLevel: level, ...(eventId && { eventId }) }
          const [a, b] = await Promise.all([contentApi.spawnPreview(base), draftId !== null ? contentApi.spawnPreview({ ...base, versionId: draftId }) : Promise.resolve(null)])
          if (live) setState({ status: 'ready', live: a, draft: b })
        } catch (e) {
          if (live) setState({ status: 'error', code: (e as { code?: string }).code ?? 'network' })
        }
      })()
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `flush` is stable enough; reload on the inputs and on saved edits
  }, [hour, weather, level, eventId, draftId, revision])

  const rows = state.status === 'ready' ? previewRows(state.live, state.draft) : []
  const shown = all ? rows : rows.slice(0, SHOWN)
  const diff = appearDisappear(rows)
  const pct = (p: number) => (p === 0 ? '—' : `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(p * 100)}%`)

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-mist-300">{t('admin.content.preview.intro')}</p>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span id="pv-hour" className="font-display text-base text-mist-300">
            {t('admin.content.preview.hour')}
          </span>
          <NumberInput labelledBy="pv-hour" bounds={HOUR} value={hour} onCommit={setHour} className="w-24" />
        </div>
        <div className="flex flex-col gap-1">
          <span id="pv-level" className="font-display text-base text-mist-300">
            {t('admin.content.preview.level')}
          </span>
          <NumberInput labelledBy="pv-level" bounds={LEVEL} value={level} onCommit={setLevel} className="w-24" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-display text-base text-mist-300">{t('admin.content.preview.weather')}</span>
          <Segmented label={t('admin.content.preview.weather')} value={weather} onChange={setWeather} options={WEATHERS.map((w) => ({ value: w, label: t(`admin.content.weather.${w}`) }))} />
        </div>
        {events.length > 0 && (
          <Select
            label={t('admin.content.preview.event')}
            value={eventId}
            onChange={setEventId}
            className="min-w-48"
            options={[{ value: '', label: t('admin.content.preview.noEvent') }, ...events.map((e) => ({ value: e.id, label: e.slug }))]}
          />
        )}
      </div>

      <div aria-live="polite" className="min-h-6">
        {state.status === 'loading' && <p className="text-mist-300">{t('common.loading')}</p>}
        {state.status === 'error' && (
          <p role="alert" className="text-cheek-400">
            {t('admin.content.preview.failed')}
          </p>
        )}
        {state.status === 'ready' && (
          <p className="text-sm text-mist-300">
            {t('admin.content.preview.summary', {
              min: state.live.wildLevel.min,
              max: state.live.wildLevel.max,
              live: state.live.count,
              legendary: new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 2 }).format(state.draft?.legendaryChance ?? state.live.legendaryChance),
            })}
            {state.draft && ` · ${t('admin.content.preview.compare', { draft: state.draft.count, appear: diff.appear, vanish: diff.vanish })}`}
          </p>
        )}
      </div>

      {state.status === 'ready' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-separate border-spacing-y-1 text-left">
            <caption className="sr-only">{t('admin.content.preview.title')}</caption>
            <thead>
              <tr className="text-sm text-mist-400">
                <th scope="col" className="font-normal">
                  {t('admin.content.species.name')}
                </th>
                <th scope="col" className="text-right font-normal">
                  {t('admin.content.preview.live')}
                </th>
                {state.draft && (
                  <>
                    <th scope="col" className="text-right font-normal">
                      {t('admin.content.preview.draft')}
                    </th>
                    <th scope="col" className="text-right font-normal">
                      {t('admin.content.preview.delta')}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.slug} className="bg-dusk-900">
                  <td className="p-1.5">
                    <span className="flex items-center gap-2">
                      <Sprite kind="icon" slug={r.slug} alt="" />
                      {speciesName(r.slug, lng)}
                    </span>
                  </td>
                  <td className="p-1.5 text-right font-num">{pct(r.live)}</td>
                  {state.draft && (
                    <>
                      <td className="p-1.5 text-right font-num">{pct(r.draft)}</td>
                      <td className={cx('p-1.5 text-right font-num', r.delta > 0 ? 'text-leaf-400' : r.delta < 0 ? 'text-cheek-400' : 'text-mist-400')}>
                        {r.delta === 0 ? '—' : `${r.delta > 0 ? '+' : '−'}${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(Math.abs(r.delta) * 100)}`}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > SHOWN && (
            <button type="button" className="mt-2 text-volt-400 underline" onClick={() => setAll((v) => !v)}>
              {t(all ? 'admin.content.preview.less' : 'admin.content.preview.all', { count: rows.length })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
