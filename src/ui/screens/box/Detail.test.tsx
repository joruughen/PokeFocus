/** Render smoke test of the Pokémon detail nameplate: role tag + the role/nature notice (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { makeMon, makePlayer, MIN, T0 } from '../../../engine/test-helpers'
import { useGame } from '../../store/game'
import { Detail } from './Detail'

/** Server rendering reads a zustand store's *initial* state, so patch that object in place. */
function load(nature: string) {
  const mon = makeMon('pidgey', 12, { uid: 'bird', nature, caughtAt: T0 - 12 * MIN })
  const player = makePlayer([makeMon('pikachu', 10, { uid: 'lead' })], { pokemon: { lead: makeMon('pikachu', 10, { uid: 'lead' }), bird: mon } })
  Object.assign(useGame.getInitialState(), { player })
}

const render = () => renderToStaticMarkup(<Detail uid="bird" />)

describe('Detail: species role vs nature', () => {
  for (const lng of ['es', 'en'] as const) {
    const natureName = (slug: string) => (lng === 'es' ? { relaxed: 'Plácida', jolly: 'Alegre', hardy: 'Fuerte', modest: 'Modesta' } : { relaxed: 'Relaxed', jolly: 'Jolly', hardy: 'Hardy', modest: 'Modest' })[slug as 'relaxed']

    it(`warns that a Relaxed Sprinter is slower than usual, near the role tag (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load('relaxed')
      const html = render()
      expect(html).not.toMatch(/roleInfo\.|roles\.[a-z]/) // no raw i18n keys
      const notice = i18n.t('roleInfo.against.sprinter', { nature: natureName('relaxed') })
      expect(html).toContain(notice.replace(/'/g, '&#x27;'))
      expect(html).toContain(lng === 'es' ? 'Ritmo' : 'Pace')
      // The role tag (with its "Rol" label) comes before the notice, both inside the nameplate.
      const role = html.indexOf(`aria-label="${i18n.t('roleInfo.aria', { name: i18n.t('roles.sprinter.name') })}"`)
      expect(role).toBeGreaterThan(-1)
      expect(role).toBeLessThan(html.indexOf(notice.slice(0, 20)))
      // The nature has its own help next to its name in the stats panel.
      expect(html).toContain(`aria-label="${i18n.t('roleInfo.natureAria')}"`)
    })

    it(`congratulates a Jolly Sprinter (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load('jolly')
      expect(render()).toContain(i18n.t('roleInfo.with.sprinter', { nature: natureName('jolly') }))
    })

    it(`shows no notice for a neutral or unrelated nature (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      for (const n of ['hardy', 'modest']) {
        load(n)
        const html = render()
        expect(html).not.toMatch(lng === 'es' ? /baja el Ritmo|sube el Ritmo/ : /lowers Pace|raises Pace/)
        expect(html).toContain(i18n.t('roles.sprinter.name')) // the role tag is still there
      }
    })
  }
})

describe('Detail: Stats | IVs card and the evolution preview', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`opens on the Stats tab (IV block moved to its own tab) and offers the collapsed evolution preview (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load('hardy')
      const html = render()
      expect(html).not.toMatch(/detail\.tab|evo\.preview|iv\.what/) // no raw keys
      expect(html).toMatch(new RegExp(`role="tab"[^>]*aria-selected="true"[^>]*>${i18n.t('detail.tabStats')}<`))
      expect(html).toContain(`>${i18n.t('detail.tabIvs')}</button>`)
      expect(html).not.toContain(i18n.t('iv.overall')) // the quality block lives in the IVs tab
      // Pidgey → Pidgeotto is offered (blocked by level, but still previewable): collapsed toggle, no numbers yet.
      expect(html).toContain(i18n.t('evo.previewShow'))
      expect(html).not.toContain(i18n.t('evo.previewTitle'))
    })
  }
})
