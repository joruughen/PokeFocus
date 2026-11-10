import { useTranslation } from 'react-i18next'
import type { AdminMetricsResponse } from '../../../../game/protocol'
import { BarChart, Panel, ProgressBar } from '../../../components'
import { fmtInt, fmtPct } from '../../../lib/format'
import { retention, shortDay, summarize } from './summary'

/** One decimal, locale aware (1,5 / 1.5). */
const dec = (n: number, lng: string) => new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(n)

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-dusk-900 p-3 inset-shadow-well">
      <dt className="text-sm text-mist-400">{label}</dt>
      <dd className="font-num text-2xl leading-tight">{value}</dd>
    </div>
  )
}

/**
 * Presentational part of the metrics panel: cards, simple bar charts (each with a
 * text label and the full table below as the accessible fallback) and the Focus split.
 */
export function MetricsView({ data }: { data: AdminMetricsResponse }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const s = summarize(data)
  const unit = t(`admin.metrics.unit.${data.granularity}`)
  const first = data.buckets[0]?.start ?? ''
  const last = data.buckets[data.buckets.length - 1]?.start ?? ''
  const label = (key: 'playersLabel' | 'sessionsLabel' | 'minutesLabel') => t(`admin.metrics.charts.${key}`, { unit, from: first, to: last })
  const series = (pick: (b: AdminMetricsResponse['buckets'][number]) => number) =>
    data.buckets.map((b) => ({ label: shortDay(b.start), value: pick(b), tip: t('admin.metrics.charts.tip', { start: b.start, value: fmtInt(pick(b), lng) }) }))
  const hasRetention =data.buckets.some((b) => b.prevActive > 0)

  if (s.sessions === 0) return <p className="text-mist-300">{t('admin.metrics.empty')}</p>

  const focusRows = [
    { key: 'full', share: s.focus.full, count: data.totals.focusFull },
    { key: 'mid', share: s.focus.mid, count: data.totals.focusMid },
    { key: 'low', share: s.focus.low, count: data.totals.focusLow },
  ] as const

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label={t('admin.metrics.cards.players')} value={fmtInt(s.players, lng)} />
        <Card label={t('admin.metrics.cards.sessions')} value={fmtInt(s.sessions, lng)} />
        <Card label={t('admin.metrics.cards.hours')} value={dec(s.hours, lng)} />
        <Card label={t('admin.metrics.cards.perPlayer')} value={dec(s.sessionsPerPlayer, lng)} />
        <Card label={t('admin.metrics.cards.catchesPerSession')} value={dec(s.catchesPerSession, lng)} />
        <Card label={t('admin.metrics.cards.shiniesPer100')} value={dec(s.shiniesPer100, lng)} />
        <Card label={t('admin.metrics.cards.legendariesPer100')} value={dec(s.legendariesPer100, lng)} />
      </dl>

      <div className="grid gap-6">
        <Panel variant="frame" headingLevel={3} title={t('admin.metrics.charts.players', { unit })}>
          <BarChart data={series((b) => b.activePlayers)} label={label('playersLabel')} format={(v) => fmtInt(v, lng)} />
        </Panel>
        <Panel variant="frame" headingLevel={3} title={t('admin.metrics.charts.sessions', { unit })}>
          <BarChart data={series((b) => b.sessions)} label={label('sessionsLabel')} format={(v) => fmtInt(v, lng)} />
        </Panel>
        <Panel variant="frame" headingLevel={3} title={t('admin.metrics.charts.minutes', { unit })}>
          <BarChart data={series((b) => b.minutes)} label={label('minutesLabel')} format={(v) => fmtInt(v, lng)} />
        </Panel>
        <Panel variant="frame" headingLevel={3} title={t('admin.metrics.focus.title')}>
          <p className="mb-3 text-sm text-mist-400">{t('admin.metrics.focus.body')}</p>
          <div className="flex flex-col gap-3">
            {focusRows.map((r) => (
              <ProgressBar
                key={r.key}
                value={r.share}
                max={1}
                label={t(`admin.metrics.focus.${r.key}`)}
                valueText={t('admin.metrics.focus.share', { count: r.count, pct: fmtPct(r.share, lng) })}
              />
            ))}
          </div>
        </Panel>
      </div>

      <Panel variant="frame" headingLevel={3} title={t('admin.metrics.retention.title')}>
        <p className="mb-2 text-sm text-mist-400">{t('admin.metrics.retention.body', { unit })}</p>
        {hasRetention ? (
          <BarChart
            data={data.buckets.map((b) => {
              const r = retention(b)
              return {
                label: shortDay(b.start),
                value: Math.round((r ?? 0) * 100),
                tip: r === null ? undefined : t('admin.metrics.retention.value', { pct: fmtPct(r, lng), returned: b.returned, prev: b.prevActive }),
              }
            })}
            label={t('admin.metrics.retention.label', { unit, from: first, to: last })}
            format={(v) => `${v}%`}
            max={100}
          />
        ) : (
          <p className="text-mist-300">{t('admin.metrics.retention.none')}</p>
        )}
      </Panel>

      <details className="bg-dusk-900 p-3 inset-shadow-well">
        <summary className="cursor-pointer font-display text-base">{t('admin.metrics.table.summary')}</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">{t('admin.metrics.table.caption', { unit })}</caption>
            <thead className="text-mist-400">
              <tr>
                {(['start', 'players', 'sessions', 'minutes', 'catches', 'shinies', 'legendaries', 'retention'] as const).map((k) => (
                  <th key={k} scope="col" className="py-1 pr-3 font-normal">
                    {t(`admin.metrics.table.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-num">
              {data.buckets.map((b) => {
                const r = retention(b)
                return (
                  <tr key={b.start} className="border-t border-dusk-700">
                    <th scope="row" className="py-1 pr-3 font-normal">
                      {b.start}
                    </th>
                    <td className="pr-3">{fmtInt(b.activePlayers, lng)}</td>
                    <td className="pr-3">{fmtInt(b.sessions, lng)}</td>
                    <td className="pr-3">{fmtInt(b.minutes, lng)}</td>
                    <td className="pr-3">{fmtInt(b.catches, lng)}</td>
                    <td className="pr-3">{fmtInt(b.shinies, lng)}</td>
                    <td className="pr-3">{fmtInt(b.legendaries, lng)}</td>
                    <td>{r === null ? '-' : t('admin.metrics.retention.value', { pct: fmtPct(r, lng), returned: b.returned, prev: b.prevActive })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
      <p className="text-sm text-mist-400">{t('admin.metrics.note')}</p>
    </div>
  )
}
