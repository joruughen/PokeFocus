/** Render smoke test of the Bag page (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import i18n from '../../../i18n'
import { useGame } from '../../store/game'
import Bag from './Bag'

const chain = String(defaultContext().speciesBySlug.get('pikachu')!.evolutionChainId)

function load(inventory: Record<string, number>, candies = { chains: { [chain]: 4 } as Record<string, number>, types: { fire: 2 } as Record<string, number> }) {
  const clef = makeMon('clefairy', 20, { uid: 'clef', nickname: 'Hada' })
  const pika = makeMon('pikachu', 12, { uid: 'pika' })
  const player = makePlayer([pika], { pokemon: { pika, clef }, inventory, candies: candies as never, dust: 12345 })
  Object.assign(useGame.getInitialState(), { player })
}

describe('Bag page', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`renders Dust, categories, descriptions and Pokémon links without raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load({ 'poke-ball': 5, potion: 2, 'moon-stone': 1, 'tera-shard': 3, 'bottle-cap': 1 })
      const html = renderToStaticMarkup(<Bag />)
      expect(html).not.toMatch(/\b(bag|nav|items|box|energy)\.[a-zA-Z]+/)
      expect(html).toContain(i18n.t('items.dust'))
      expect(html).toContain(lng === 'es' ? '12.345' : '12,345')
      for (const c of ['all', 'ball', 'heal', 'evolution', 'candy', 'training']) expect(html).toContain(i18n.t(`bag.cat.${c}`).replace('&', '&amp;'))
      // Advanced items are locked at trainer level 1: real description + the unlock level, no "no use yet".
      expect(html).toContain(i18n.t('bag.lockedAt', { level: 20 }))
      expect(html).toContain(i18n.t('bag.lockedAt', { level: 40 }))
      expect(html).not.toContain(i18n.t('bag.desc.other'))
      expect(html).toContain(i18n.t('bag.search'))
      expect(html).toContain(lng === 'es' ? 'Piedra Lunar' : 'Moon Stone')
      expect(html).toContain(lng === 'es' ? 'Caramelos de Pikachu' : 'Pikachu candies')
      expect(html).toContain(i18n.t('bag.desc.evolution').replace("'", '&#x27;'))
      // Items show only their description: no list of the Pokémon that can use them (stones, potions, candies…).
      expect(html).not.toContain('href="#/box/clef"')
      expect(html).not.toContain('href="#/box/pika"')
      expect(html).not.toContain(i18n.t('bag.users.evolution'))
      expect(html).not.toContain(i18n.t('bag.users.chainCandy'))
    })

    it(`shows a teaching empty state for an empty bag (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load({}, { chains: {}, types: {} })
      const html = renderToStaticMarkup(<Bag />)
      expect(html).toContain(i18n.t('bag.empty.title'))
      expect(html).not.toMatch(/\bbag\.[a-zA-Z]+/)
    })
  }

  it('hides categories you have nothing in', async () => {
    await i18n.changeLanguage('es')
    load({ 'poke-ball': 1 }, { chains: {}, types: {} })
    const html = renderToStaticMarkup(<Bag />)
    expect(html).toContain('Balls')
    expect(html).not.toContain('Curación')
    expect(html).not.toContain('Misiones y eventos')
  })
})
