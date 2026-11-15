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

describe('Detail: advanced items (F4)', () => {
  function loadAdvanced(level: number) {
    const bird = makeMon('pidgey', 30, {
      uid: 'bird',
      nature: 'relaxed',
      mintNature: 'jolly',
      ability: 'keen-eye',
      teraType: 'dark',
      teraUntil: Date.now() + 5 * 3_600_000, // the sheet uses the real clock
      teraSessionsLeft: 3,
      bottleCapped: ['speed'],
      tmMoves: [],
    })
    const player = makePlayer([bird], {
      trainer: { level, exp: 0 },
      pokemon: { bird },
      inventory: { 'tera-shard': 2, 'technical-machine': 1, 'modest-mint': 1, 'bottle-cap': 1, 'ability-capsule': 1 },
    })
    Object.assign(useGame.getInitialState(), { player })
  }

  for (const lng of ['es', 'en'] as const) {
    it(`shows the five items, the active Tera and the mint effect, without raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      loadAdvanced(30)
      const html = render()
      expect(html).not.toMatch(/training\.|bag\.|errors\./)
      for (const k of ['tera', 'tm', 'mint', 'bottleCap', 'abilityCapsule']) expect(html).toContain(i18n.t(`training.${k}.name`))
      expect(html).toContain(i18n.t('training.title'))
      // Tera badge on the nameplate and its time/sessions left.
      expect(html).toContain(`${i18n.t('training.tera.badge')} ${lng === 'es' ? 'Siniestro' : 'Dark'}`)
      // (the sheet rounds "now" down to the minute, so it may read 5 h 1 min)
      expect(html).toMatch(lng === 'es' ? /Quedan 5 h( 1 min)? o 3 sesiones, lo que ocurra antes/ : /5 h( 1 min)? or 3 sessions left, whichever ends first/)
      // Relaxed Pidgey with a Jolly mint: original nature shown, effect from the mint.
      expect(html).toContain(i18n.t('training.mint.byMint', { nature: lng === 'es' ? 'Alegre' : 'Jolly' }))
      expect(html).not.toContain(i18n.t('training.lockedAt', { level: 20 }))
    })

    it(`shows the trainer level each item needs while locked (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      loadAdvanced(1)
      const html = render()
      for (const level of [10, 20, 25, 30]) expect(html).toContain(i18n.t('training.lockedAt', { level }))
    })
  }
})
