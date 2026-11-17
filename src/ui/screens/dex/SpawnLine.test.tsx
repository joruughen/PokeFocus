/** The Pokédex spawn line: «1 in N» for species that can appear, «from level N», legendaries apart (SSR, ES + EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { defaultContext } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { useGame } from '../../store/game'
import Dex from './Dex'

const RAW_KEY = /\bdex\.spawn\.[a-zA-Z]+/

/** The entry shown is the first caught species, so a player who caught only `slug` shows it. */
function render(slug: string, level: number): string {
  const player = makePlayer([makeMon(slug, 10, { uid: 'm' })], { pokedex: { caught: [slug], seen: [slug] } })
  Object.assign(useGame.getInitialState(), { player: { ...player, trainer: { ...player.trainer, level } } })
  return renderToStaticMarkup(<Dex />)
}

describe('Dex entry: spawn line', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`shows "1 in N" for a species that can appear, with a help tip (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render('bulbasaur', 1)
      expect(html).not.toMatch(RAW_KEY)
      const n = /(?:1 de cada|1 in) (\d+) (?:salvajes|wild)/.exec(html)
      expect(n).not.toBeNull()
      // ≈0.4 % with all of Kanto → about 1 in 260
      expect(Number(n![1])).toBeGreaterThanOrEqual(170)
      expect(Number(n![1])).toBeLessThanOrEqual(330)
      expect(html).toContain(i18n.t('dex.spawn.helpLabel'))
    })

    it(`says "from level N" for a species that cannot appear yet (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render('venusaur', 1)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toMatch(lng === 'es' ? /Aparece en salvajes desde nivel \d+/ : /Appears in the wild from level \d+/)
      expect(html).not.toMatch(lng === 'es' ? /1 de cada \d+ salvajes/ : /1 in \d+ wild/)
    })

    it(`legendaries have their own line (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render('mewtwo', 1)
      expect(html).not.toMatch(RAW_KEY)
      // A new player is in Base 1, where legendaries do not appear: the line names the league that has them.
      expect(html).toContain(i18n.t('dex.spawn.legendaryFromLeague', { league: i18n.t('league.names.master'), level: defaultContext().config.encounters.legendaryMinLevel }))
    })

    it(`an evolved form within level reach names the league that offers it (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render('ivysaur', 40)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(i18n.t('dex.spawn.fromLeague', { league: i18n.t('league.names.super') }))
    })
  }
})
