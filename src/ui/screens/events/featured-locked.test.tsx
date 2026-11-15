/** Featured species that cannot show up at the player's level: dimmed and tagged, never hidden (pop-up + events page, ES + EN). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { defaultContext } from '../../../engine'
import type { LiveEventPublic } from '../../../game/protocol'
import { speciesReach } from '../../../game/content/spawnOdds'
import { EventCard } from './EventCard'
import { EventPopupBody } from './EventPopup'
import { lockedReach } from './FeaturedList'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 9, 15, 0)
const RAW_KEY = /\b(events|eventsAdmin)\.[a-zA-Z]+\.?[a-zA-Z]*\b(?![^<]*>)/

const ev = (): LiveEventPublic => ({
  id: 'e1',
  slug: 'starters',
  name: { es: 'Iniciales', en: 'Starters' },
  description: { es: 'Hola', en: 'Hi' },
  image: null,
  startsAt: NOW - HOUR,
  endsAt: NOW + 24 * HOUR,
  announceRev: 0,
  featured: [
    { species: 'bulbasaur', weightMult: 3 },
    { species: 'venusaur', weightMult: 3 },
  ],
  drops: [],
  missions: [],
})

const venusaur = speciesReach(defaultContext(), defaultContext().speciesBySlug.get('venusaur')!)
const needed = venusaur.kind === 'wild' ? venusaur.trainerLevel : 99

describe('lockedReach', () => {
  it('marks what cannot spawn at the level; no level, no marks', () => {
    expect(lockedReach('bulbasaur', 1)).toBeNull()
    expect(lockedReach('venusaur', 1)).toMatchObject({ kind: 'wild' })
    expect(lockedReach('venusaur', needed)).toBeNull()
    expect(lockedReach('venusaur', undefined)).toBeNull()
    expect(lockedReach('mewtwo', 1)).toBeNull() // legendaries are a separate roll
  })
})

describe('featured species not available at the player level', () => {
  for (const lng of ['es', 'en'] as const) {
    const tag = (n: number) => i18n.t('events.featuredFrom', { level: n })
    for (const [what, render] of [
      ['pop-up', (lvl?: number) => renderToStaticMarkup(<EventPopupBody event={ev()} phase="active" trainerLevel={lvl} />)],
      ['events page', (lvl?: number) => renderToStaticMarkup(<EventCard event={ev()} now={NOW} baseShinyChance={0.0025} trainerLevel={lvl} />)],
    ] as const) {
      it(`${what}: the high-level one is dimmed with its tag and a note, the other is normal (${lng})`, async () => {
        await i18n.changeLanguage(lng)
        const html = render(1)
        expect(html).not.toMatch(RAW_KEY)
        // both stay listed
        expect(html).toContain(lng === 'es' ? 'Venusaur' : 'Venusaur')
        expect(html).toContain(lng === 'es' ? 'Bulbasaur' : 'Bulbasaur')
        expect(html.match(/data-locked="true"/g)).toHaveLength(1)
        expect(html).toContain(tag(needed))
        expect(html).toContain(i18n.t('events.featuredFromNote'))
        expect(html).toContain('×3')
      })

      it(`${what}: no marks once the level is reached, or when the level is unknown (${lng})`, async () => {
        await i18n.changeLanguage(lng)
        for (const lvl of [needed, undefined]) {
          const html = render(lvl)
          expect(html).not.toContain('data-locked')
          expect(html).not.toContain(i18n.t('events.featuredFromNote'))
        }
      })
    }
  }
})
