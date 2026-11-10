import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { claimErrorText } from './errors'

describe('claimErrorText', () => {
  for (const lng of ['es', 'en'] as const) {
    describe(lng, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(lng)
      })
      const t = (k: string) => i18n.t(k, { lng })

      it('not_finished says the session has not ended, with no raw key', () => {
        const text = claimErrorText('not_finished', false)
        expect(text).toBe(t('errors.not_finished'))
        expect(text).not.toMatch(/errors\./)
      })

      it('not_finished with a shifted developer clock explains that the server ignores it', () => {
        const text = claimErrorText('not_finished', true)
        expect(text).toBe(t('errors.notFinishedDevClock'))
        expect(text).not.toMatch(/errors\./)
        expect(text).not.toBe(claimErrorText('not_finished', false))
        expect(text).toMatch(lng === 'es' ? /herramientas de desarrollo/ : /developer tools/)
      })

      it('no code or no_session is the generic claim failure; other codes use their own text', () => {
        expect(claimErrorText(null, false)).toBe(t('errors.claimFailed'))
        expect(claimErrorText('no_session', true)).toBe(t('errors.claimFailed'))
        expect(claimErrorText('paused', false)).toBe(t('errors.paused'))
      })
    })
  }
})
