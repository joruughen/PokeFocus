import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { MaintenanceNoticeBar } from './MaintenanceBanner'
import type { NoticeView } from './lib/maintenance'

const NOW = Date.UTC(2026, 10, 7, 0, 0)
const HOUR = 3_600_000
const upcoming: NoticeView = { phase: 'upcoming', notice: { id: 'u', startsAt: NOW + HOUR, endsAt: NOW + 3 * HOUR, note: null } }
const active: NoticeView = { phase: 'active', notice: { id: 'a', startsAt: NOW - HOUR, endsAt: NOW + HOUR, note: 'Updating the database' } }

describe('MaintenanceNoticeBar', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`upcoming: title, window, countdown and a dismiss button (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<MaintenanceNoticeBar view={upcoming} now={NOW} onDismiss={() => {}} />)
      expect(html).not.toMatch(/maintenance\.[a-zA-Z]/)
      expect(html).toContain(lng === 'es' ? 'Mantenimiento programado' : 'Scheduled maintenance')
      expect(html).toContain(lng === 'es' ? 'dentro de 1 hora' : 'in 1 hour')
      expect(html).toContain('role="status"')
      expect(html).toContain(lng === 'es' ? 'Ocultar aviso' : 'Hide notice')
    })

    it(`active: no dismiss button, shows the note (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<MaintenanceNoticeBar view={active} now={NOW} onDismiss={() => {}} />)
      expect(html).toContain(lng === 'es' ? 'Mantenimiento en curso' : 'Maintenance in progress')
      expect(html).toContain('Updating the database')
      expect(html).not.toContain('<button')
    })
  }

  it('shows the admin note as text, never as markup', async () => {
    await i18n.changeLanguage('en')
    const view: NoticeView = { ...upcoming, notice: { ...upcoming.notice, note: '<img src=x onerror=alert(1)>' } }
    const html = renderToStaticMarkup(<MaintenanceNoticeBar view={view} now={NOW} />)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
