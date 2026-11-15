/** Admin editor: estimated odds next to each featured species, the "cannot appear" notices and the validator warning text (ES + EN). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import { validateEventOverlay } from '../../../../game/content'
import { FeaturedOddsNote, oddsOfDraft, ReferenceLevelPicker } from './FeaturedOdds'
import { issueText } from './errors'

const RAW_KEY = /\beventsAdmin\.[a-zA-Z]+\.?[a-zA-Z.]*\b(?![^<]*>)/

describe('oddsOfDraft', () => {
  it('reads the text multipliers (comma or dot) and skips unusable rows', () => {
    const m = oddsOfDraft(
      [
        { species: 'bulbasaur', weightMult: '3' },
        { species: 'pikachu', weightMult: '2,5' },
        { species: '', weightMult: '3' },
        { species: 'eevee', weightMult: 'abc' },
      ],
      10,
    )
    expect([...m.keys()].sort()).toEqual(['bulbasaur', 'pikachu'])
    expect(m.get('bulbasaur')!.with).toBeGreaterThan(m.get('bulbasaur')!.without)
  })
})

describe('FeaturedOddsNote', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`a species that appears: without / with the event and the sentence for the description (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const odds = oddsOfDraft([{ species: 'bulbasaur', weightMult: '3' }], 1).get('bulbasaur')
      const html = renderToStaticMarkup(<FeaturedOddsNote odds={odds} level={1} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toMatch(lng === 'es' ? /sin el evento 1 de cada \d+ · con el evento 1 de cada \d+/ : /without the event 1 in \d+ · with the event 1 in \d+/)
      expect(html).toMatch(lng === 'es' ? /Para la descripción: 1 de cada \d+ salvajes es Bulbasaur; en una oleada de ~4 salvajes la probabilidad de ver al menos uno es ≈\d+/ : /For the description: 1 in \d+ wild Pokémon is Bulbasaur; in a wave of ~4 wild Pokémon the chance of seeing at least one is ≈\d+/)
      expect(html).toMatch(lng === 'es' ? /1 cada \d+ oleadas/ : /1 every \d+ waves/)
      expect(html).not.toContain('text-amber-400')
    })

    it(`a species that cannot appear at the reference level is flagged (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const odds = oddsOfDraft([{ species: 'venusaur', weightMult: '3' }], 1).get('venusaur')
      const html = renderToStaticMarkup(<FeaturedOddsNote odds={odds} level={1} />)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain('text-amber-400')
      expect(html).toMatch(lng === 'es' ? /A nivel de entrenador 1 no puede aparecer: sale en salvajes desde nivel \d+ \(entrenador nivel \d+\)/ : /At trainer level 1 it cannot appear: it shows up in the wild from level \d+ \(trainer level \d+\)/)
    })

    it(`a legendary says featuring it does not change the frequency; the level picker lists 1/10/20/30 (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const odds = oddsOfDraft([{ species: 'mewtwo', weightMult: '3' }], 10).get('mewtwo')
      expect(renderToStaticMarkup(<FeaturedOddsNote odds={odds} level={10} />)).toContain(i18n.t('eventsAdmin.featured.odds.legendary'))
      const picker = renderToStaticMarkup(<ReferenceLevelPicker value={10} onChange={() => undefined} />)
      expect(picker).not.toMatch(RAW_KEY)
      for (const l of [1, 10, 20, 30]) expect(picker).toContain(`${i18n.t('pokemon.levelShort')} ${l}`)
    })
  }
})

describe('validator warning text', () => {
  const ev = (species: string) => ({
    id: 'ev1',
    slug: 'spring-fest',
    startsAt: Date.UTC(2026, 11, 1),
    endsAt: Date.UTC(2026, 11, 8),
    featured: [{ species, weightMult: 3 }],
    drops: [],
    missions: [],
  })

  for (const lng of ['es', 'en'] as const) {
    it(`reads as a sentence with the species name, not a raw code (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const r = validateEventOverlay(ev('dragonite'), { smoke: false })
      const w = r.warnings.find((x) => x.code === 'featured_high_level')
      expect(w).toBeDefined()
      const text = issueText(w!)
      expect(text).toContain('Dragonite')
      expect(text).not.toContain('{{')
      expect(text).not.toContain('eventsAdmin.')
      expect(text).toContain(String(w!.params!.trainerLevel))
    })
  }
})
