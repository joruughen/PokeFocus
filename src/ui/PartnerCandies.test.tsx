import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import type { StudyCandyGrant } from '../engine'
import { PartnerCandies } from './screens/home/PartnerCandies'

const grants: StudyCandyGrant[] = [
  { chainId: '2', speciesSlug: 'pidgey', amount: 1, leader: false },
  { chainId: '4', speciesSlug: 'charmander', amount: 2, leader: true },
  { chainId: '7', speciesSlug: 'squirtle', amount: 1, leader: false },
]
const render = (g: readonly StudyCandyGrant[], done = false, perDay = 1) => renderToStaticMarkup(<PartnerCandies grants={g} done={done} minMinutes={25} perDay={perDay} />)

describe('PartnerCandies (session results)', () => {
  it('renders nothing when nothing was paid and nothing is pending to explain', () => {
    expect(render([], false)).toBe('')
  })

  for (const lng of ['es', 'en'] as const) {
    it(`lists every line with its amount, the leader first, and the total (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render(grants)
      expect(html).not.toMatch(/results\.[a-zA-Z]/)
      expect(html).toContain(lng === 'es' ? 'Caramelos de compañero' : 'Partner candies')
      expect(html).toContain('+4')
      expect(html.indexOf('Charmander')).toBeGreaterThan(-1)
      expect(html.indexOf('Charmander')).toBeLessThan(html.indexOf('Pidgey'))
      expect(html).toContain('+2')
      expect(html).toContain('25')
    })

    it(`explains that the day's candies were already paid (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render([], true)
      expect(html).not.toMatch(/results\.[a-zA-Z]/)
      expect(html).toContain(lng === 'es' ? 'Hoy ya cobraste' : 'already got')
    })

    it(`the note follows the daily cap (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      expect(render(grants, false, 1)).toContain(lng === 'es' ? 'tu primera sesión' : 'your first session')
      expect(render(grants, false, 2)).toContain(lng === 'es' ? 'primeras 2 sesiones' : 'first 2 sessions')
    })
  }
})
