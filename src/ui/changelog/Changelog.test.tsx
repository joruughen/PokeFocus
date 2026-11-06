/** Render smoke test of the news page and the stage badge (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import Changelog from './Changelog'
import { CHANGELOG } from './entries'
import { APP_VERSION } from './release'
import { StageBadge } from './StageBadge'

describe('Changelog page', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`lists every version with no raw i18n keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<Changelog />)
      expect(html).not.toMatch(/\b(changelog|release|nav)\.[a-zA-Z]/)
      for (const e of CHANGELOG) {
        expect(html).toContain(e.version)
        expect(html).toContain(e.title[lng].replace(/'/g, '&#x27;'))
      }
      expect(html).toContain(lng === 'es' ? 'Estamos en alfa' : 'We are in alpha')
      expect(html.match(/<time /g)).toHaveLength(CHANGELOG.length)
    })

    it(`shows the stage and version in the badge (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<StageBadge />)
      expect(html).toContain(lng === 'es' ? 'Alfa' : 'Alpha')
      expect(html).toContain(`v${APP_VERSION}`)
      expect(html).toContain('href="#/changelog"')
      // Compact hides the visible version, but the accessible name keeps it.
      const compact = renderToStaticMarkup(<StageBadge compact />)
      expect(compact).not.toContain(`>v${APP_VERSION}<`)
      expect(compact).toContain(`aria-label="${lng === 'es' ? 'Alfa' : 'Alpha'} v${APP_VERSION}"`)
      expect(html).toContain(`>v${APP_VERSION}<`)
    })
  }
})
