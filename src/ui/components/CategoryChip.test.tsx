import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { CategoryChip } from './CategoryChip'
import { TooltipProvider } from './Tooltip'

const NAMES = { es: { damage: 'Daño', passive: 'Pasiva', activable: 'Activable' }, en: { damage: 'Damage', passive: 'Passive', activable: 'Activable' } }

describe('CategoryChip', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`is a button with the category name and no raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      for (const kind of ['damage', 'passive', 'activable'] as const) {
        const html = renderToStaticMarkup(
          <TooltipProvider>
            <CategoryChip kind={kind} />
          </TooltipProvider>,
        )
        expect(html).toContain('<button')
        expect(html).toContain(NAMES[lng][kind])
        expect(html).toContain('cursor-help')
        expect(html).not.toMatch(/technique\./)
        // The help text exists in both languages.
        expect(i18n.t(`technique.kindHelp.${kind}`)).not.toMatch(/^technique\./)
      }
    })
  }
})
