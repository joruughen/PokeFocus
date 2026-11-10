import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminMetricsGranularity, AdminMetricsResponse } from '../../../../game/protocol'
import { adminApi, isApiError } from '../../../api'
import { Button, Panel, Segmented } from '../../../components'
import { errorText } from '../../../lib/errors'
import { MetricsView } from './MetricsView'

const DAY = 86_400_000

type RangeId = 'd7' | 'd28' | 'w12'
const RANGES: Record<RangeId, { days: number; granularity: AdminMetricsGranularity }> = {
  d7: { days: 7, granularity: 'day' },
  d28: { days: 28, granularity: 'day' },
  w12: { days: 84, granularity: 'week' },
}

/** Metrics tab of the admin screen (support and admin): fetches `/api/admin/metrics` for the chosen period. */
export default function MetricsPanel() {
  const { t } = useTranslation()
  const [range, setRange] = useState<RangeId>('d28')
  const [data, setData] = useState<AdminMetricsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (id: RangeId, signal?: { cancelled: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const { days, granularity } = RANGES[id]
      const to = Date.now()
      const res = await adminApi.metrics({ from: to - days * DAY, to, granularity })
      if (!signal?.cancelled) setData(res)
    } catch (e) {
      if (signal?.cancelled) return
      setData(null)
      setError(isApiError(e) && ['forbidden', 'range_too_large', 'invalid_body'].includes(e.code) ? t(`admin.metrics.errors.${e.code}`) : errorText(isApiError(e) ? e.code : 'network'))
    } finally {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const signal = { cancelled: false }
    void load(range, signal)
    return () => {
      signal.cancelled = true
    }
  }, [range, load])

  return (
    <Panel
      title={t('admin.metrics.title')}
      actions={
        <Segmented
          label={t('admin.metrics.range.label')}
          value={range}
          onChange={setRange}
          options={(Object.keys(RANGES) as RangeId[]).map((id) => ({ value: id, label: t(`admin.metrics.range.${id}`) }))}
        />
      }
    >
      <div className="flex flex-col gap-4" aria-busy={loading}>
        <p className="max-w-[60ch] text-mist-300">{t('admin.metrics.intro')}</p>
        {error ? (
          <div className="flex flex-col items-start gap-2" role="alert">
            <p className="text-cheek-400">{error}</p>
            <Button size="sm" variant="ghost" onClick={() => void load(range)}>
              {t('admin.metrics.retry')}
            </Button>
          </div>
        ) : data ? (
          <MetricsView data={data} />
        ) : (
          <p className="text-mist-300" role="status">
            {t('admin.metrics.loading')}
          </p>
        )}
      </div>
    </Panel>
  )
}
