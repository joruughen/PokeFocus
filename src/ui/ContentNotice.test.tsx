import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ContentNoticeBar } from './ContentNotice'

describe('ContentNotice', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`bar: message and reload button, no raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<ContentNoticeBar onReload={() => {}} />)
      expect(html).not.toMatch(/contentUpdate\./)
      expect(html).toContain(lng === 'es' ? 'Hay contenido nuevo' : 'There is new content')
      expect(html).toContain(lng === 'es' ? 'Recargar' : 'Reload')
    })
  }
})
