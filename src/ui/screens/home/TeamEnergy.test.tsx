/** Render tests of the team Energy grid and the wild card "Hits" row (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { pokemonView, type PokemonView } from '../../../engine'
import { makeMon, makePlayer, T0 } from '../../../engine/test-helpers'
import { TeamEnergy } from './TeamEnergy'
import { HittersRow } from './Waves'

function views(): PokemonView[] {
  const team = [
    makeMon('charmander', 20, { uid: 'L' }),
    makeMon('bulbasaur', 20, { uid: 'A' }),
    makeMon('pidgey', 20, { uid: 'B', energy: { current: 0, updatedAt: T0 } }),
    makeMon('squirtle', 20, { uid: 'C' }),
    makeMon('pikachu', 20, { uid: 'D' }),
    makeMon('geodude', 20, { uid: 'E' }),
  ]
  const player = makePlayer(team)
  return team.map((p) => pokemonView(player, p.uid, T0)!)
}

describe('TeamEnergy', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`shows every member's Energy, the exhausted one and the next target (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<TeamEnergy views={views()} leaderUid="L" target="A" hit={{ uid: 'C', from: 40, text: '-12', key: 1 }} />)
      expect(html).not.toMatch(/teamEnergy\.[a-zA-Z]/) // no raw i18n keys
      expect(html.match(/role="meter"/g)).toHaveLength(6)
      expect(html).toContain(i18n.t('teamEnergy.out'))
      expect(html).toContain(i18n.t('teamEnergy.nextTarget'))
      expect(html).toContain('-12')
      // Two columns on phones (390 px), three from `sm`.
      expect(html).toContain('grid-cols-2')
      expect(html).toContain('sm:grid-cols-3')
    })
  }
})

describe('TeamEnergy nicknames', () => {
  it('shows the nickname (not only the species) and keeps the species in the tooltip', async () => {
    await i18n.changeLanguage('en')
    const team = [makeMon('charmander', 20, { uid: 'L', nickname: 'Brasita' }), makeMon('bulbasaur', 20, { uid: 'A' })]
    const player = makePlayer(team)
    const vs = team.map((p) => pokemonView(player, p.uid, T0)!)
    const html = renderToStaticMarkup(<TeamEnergy views={vs} leaderUid="L" />)
    expect(html).toContain('Brasita')
    expect(html).toContain('title="Brasita (Charmander)"')
    expect(html).toContain('Bulbasaur')
  })
})

describe('HittersRow', () => {
  it('lists every hitter and wraps instead of cutting at two', async () => {
    await i18n.changeLanguage('es')
    const hitters = ['bulbasaur', 'charmander', 'squirtle', 'pidgey'].map((slug, i) => ({ uid: `u${i}`, slug, hits: 120 - i }))
    const html = renderToStaticMarkup(<HittersRow hitters={hitters} />)
    expect(html).toContain('flex-wrap')
    expect(html).toContain('min-w-0')
    for (const h of hitters) expect(html).toContain(`×${h.hits}`)
    expect(html).not.toMatch(/\+\d/)
  })

  it('renders nothing without hitters', () => {
    expect(renderToStaticMarkup(<HittersRow hitters={[]} />)).toBe('')
  })
})
