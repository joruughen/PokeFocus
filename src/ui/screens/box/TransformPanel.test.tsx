/** "Transformación" section of the Pokémon sheet: states without copy, copying, no candidates and in a running session (server-side render). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { makeMon, makePlayer, runSession } from '../../../engine/test-helpers'
import type { PlayerState } from '../../../engine'
import i18n from '../../../i18n'
import { useGame } from '../../store/game'
import { Detail } from './Detail'

const DISABLED = /\sdisabled=""/
const esc = (s: string) => s.replace(/'/g, '&#x27;')
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

function load(player: PlayerState) {
  Object.assign(useGame.getInitialState(), { player })
}
const ditto = (patch = {}) => makeMon('ditto', 30, { uid: 'ditto', ...patch })
const char = () => makeMon('charmander', 30, { uid: 'char', equippedMoves: ['ember', 'agility'] })
const render = (uid = 'ditto') => renderToStaticMarkup(<Detail uid={uid} />)
/** The `<button ...>label</button>` of a label, to check its disabled attribute. */
const button = (h: string, label: string) => h.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${esc(label)}</button>`))?.[0] ?? ''

describe('Detail: Transformación section', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`not copying: "It is Ditto", an enabled Transform button and the species' own types (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load(makePlayer([char(), ditto()]))
      const h = render()
      expect(h).not.toMatch(/transform\.[a-z]/)
      expect(text(h)).toContain(i18n.t('transform.panel.title'))
      expect(text(h)).toContain(i18n.t('transform.panel.isBase', { name: 'Ditto' }))
      const b = button(h, i18n.t('transform.panel.transform'))
      expect(b).not.toBe('')
      expect(b).not.toMatch(DISABLED)
      expect(h).not.toContain(i18n.t('transform.pick.stop', { name: 'Ditto' }))
    })

    it(`copying: shows who, the copied techniques with their legend, a Change and a stop button (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      load(makePlayer([char(), ditto({ copyOfUid: 'char' })]))
      const h = render()
      const charName = 'Charmander'
      expect(text(h)).toContain(i18n.t('transform.panel.copying', { name: charName }))
      expect(text(h)).toContain(i18n.t('transform.panel.copiedFrom', { name: charName }))
      expect(text(h)).toContain(i18n.t('transform.panel.types'))
      expect(button(h, i18n.t('transform.panel.change'))).not.toMatch(DISABLED)
      expect(button(h, i18n.t('transform.pick.stop', { name: 'Ditto' }))).not.toMatch(DISABLED)
      expect(h).toContain('sprites/showdown/4.gif') // the header shows Charmander (#4), not Ditto (#132)
      expect(h).not.toContain('sprites/showdown/132.gif')
    })
  }

  it('without candidates (Ditto alone in the team): disabled, with the hint', async () => {
    await i18n.changeLanguage('es')
    load(makePlayer([ditto()]))
    const h = render()
    expect(button(h, 'Transformarse')).toMatch(DISABLED)
    expect(text(h)).toContain('Necesita a otro Pokémon en el equipo')
  })

  it('a Ditto in the Box can still choose among the current team', async () => {
    await i18n.changeLanguage('es')
    load(makePlayer([char()], { pokemon: { char: char(), ditto: ditto() } }))
    const h = render()
    expect(button(h, 'Transformarse')).not.toMatch(DISABLED)
    expect(text(h)).not.toContain('Necesita a otro Pokémon')
  })

  it('in a running session: disabled with its hint, also the stop button', async () => {
    await i18n.changeLanguage('en')
    const base = makePlayer([char(), ditto({ copyOfUid: 'char' })])
    load(runSession(base, 25).state)
    const h = render()
    expect(button(h, 'Change')).toMatch(DISABLED)
    expect(button(h, 'Go back to being Ditto')).toMatch(DISABLED)
    expect(h).toContain(esc("Can't change during the session"))
  })

  it('a Pokémon that cannot copy has no section', async () => {
    await i18n.changeLanguage('es')
    load(makePlayer([char(), ditto()]))
    expect(render('char')).not.toContain('Transformación')
  })
})
