import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import Admin from './Admin'

describe('Admin screen', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`starts locked: asks for the token and shows no controls (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<Admin />)
      expect(html).not.toMatch(/\badmin\.[a-zA-Z]/)
      expect(html).toContain(lng === 'es' ? 'Token de administración' : 'Admin token')
      expect(html).toContain('type="password"')
      expect(html).not.toContain('datetime-local')
    })
  }
})
