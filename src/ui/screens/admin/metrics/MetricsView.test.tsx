import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AdminMetricsBucket, AdminMetricsResponse } from '../../../../game/protocol'
import i18n from '../../../../i18n'
import { MetricsView } from './MetricsView'
import { ratio, retention, summarize } from './summary'

const bucket = (start: string, over: Partial<AdminMetricsBucket> = {}): AdminMetricsBucket => ({
  start,
  activePlayers: 2,
  sessions: 4,
  minutes: 100,
  points: 400,
  wilds: 12,
  catches: 8,
  shinies: 1,
  legendaries: 0,
  focusLow: 1,
  focusMid: 1,
  focusFull: 2,
  prevActive: 2,
  returned: 1,
  ...over,
})

const data: AdminMetricsResponse = {
  from: Date.UTC(2026, 10, 3),
  to: Date.UTC(2026, 10, 5),
  granularity: 'day',
  serverNow: Date.UTC(2026, 10, 5),
  buckets: [bucket('2026-11-03', { prevActive: 0, returned: 0 }), bucket('2026-11-04')],
  totals: { activePlayers: 3, sessions: 8, minutes: 200, points: 800, wilds: 24, catches: 16, shinies: 2, legendaries: 0, focusLow: 2, focusMid: 2, focusFull: 4 },
}

describe('metrics summary', () => {
  it('derives the per-session and per-100 rates', () => {
    const s = summarize(data)
    expect(s).toMatchObject({ players: 3, sessions: 8, catchesPerSession: 2, shiniesPer100: 25, legendariesPer100: 0 })
    expect(s.hours).toBeCloseTo(200 / 60)
    expect(s.sessionsPerPlayer).toBeCloseTo(8 / 3)
    expect(s.focus).toEqual({ full: 0.5, mid: 0.25, low: 0.25 })
  })
  it('never divides by zero', () => {
    expect(ratio(5, 0)).toBe(0)
    expect(retention(bucket('x', { prevActive: 0 }))).toBeNull()
    expect(retention(bucket('x'))).toBe(0.5)
  })
})

describe('MetricsView', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`renders cards, labelled charts and the data table without raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<MetricsView data={data} />)
      expect(html).not.toMatch(/\badmin\.metrics\./)
      expect(html).toContain(lng === 'es' ? 'Jugadores activos' : 'Active players')
      expect(html).toContain('role="img"') // charts carry a text label
      expect(html).toContain('<table')
      expect(html).toContain('2026-11-04')
    })
    it(`says so when there are no sessions (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const empty: AdminMetricsResponse = { ...data, totals: { ...data.totals, sessions: 0, activePlayers: 0 } }
      const html = renderToStaticMarkup(<MetricsView data={empty} />)
      expect(html).toContain(lng === 'es' ? 'Todavía no hay sesiones' : 'No sessions in this period yet')
      expect(html).not.toContain('<table')
    })
  }
})
