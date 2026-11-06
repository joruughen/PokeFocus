/** Render test of the push row in every state (server-side render, no DOM). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { pushErrorKey, PushSettingsView, type PushViewState } from './PushSettings'

const STATES: PushViewState[] = ['checking', 'unsupported', 'server-off', 'denied', 'off', 'on']
const noop = () => undefined

describe('PushSettingsView', () => {
  for (const lng of ['es', 'en'] as const) {
    for (const state of STATES) {
      it(`${state} (${lng})`, async () => {
        await i18n.changeLanguage(lng)
        const html = renderToStaticMarkup(<PushSettingsView state={state} busy={false} onToggle={noop} onTest={noop} />)
        expect(html).not.toMatch(/settings\.push\./)
        expect(html).toContain(lng === 'es' ? 'Avisos aunque la pestaña esté dormida o cerrada' : 'Notices even when the tab is asleep or closed')
        expect(html).toContain('aria-live="polite"')
        expect(html.includes(i18n.t('settings.push.test'))).toBe(state === 'on')
      })
    }
    it(`busy and error texts (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<PushSettingsView state="off" busy onToggle={noop} onTest={noop} />)
      expect(html).toContain(i18n.t('settings.push.busy'))
      for (const code of ['no_subscription', 'push_disabled', 'rate_limited', 'network', 'too_many', 'dismissed', 'denied', 'whatever', undefined]) {
        const text = i18n.t(pushErrorKey(code))
        expect(text).not.toMatch(/settings\.push/)
      }
      expect(i18n.t('settings.push.testSent')).toBe(lng === 'es' ? 'Aviso enviado' : 'Notice sent')
    })
  }
})
