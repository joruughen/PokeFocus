/** Render smoke test of the Pokédex entry: the species role as the outlined RoleBadge (server-side render, no DOM needed). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { defaultContext } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { useGame } from '../../store/game'
import Dex from './Dex'

const ctx = defaultContext()

/** Server rendering reads a zustand store's *initial* state, so patch that object in place. */
function load(slug: string) {
  const mon = makeMon(slug, 10, { uid: 'm' })
  const player = makePlayer([mon], { pokedex: { caught: [slug], seen: [slug] } })
  Object.assign(useGame.getInitialState(), { player })
}

describe('Dex entry: species role', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`shows the role as the outlined tag with its one-line body, not as plain text (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const slug = 'pikachu'
      const role = ctx.speciesBySlug.get(slug)!.role!
      load(slug)
      const html = renderToStaticMarkup(<Dex />)
      expect(html).not.toMatch(/roles?\.[a-z]|roleInfo\./) // no raw i18n keys
      const name = i18n.t(`roles.${role}.name`)
      // The tag: a button with the help label, the "Rol" prefix (md size) and the name, on the dark panel.
      const from = html.indexOf(`aria-label="${i18n.t('roleInfo.aria', { name })}"`)
      expect(from).toBeGreaterThan(-1)
      const tag = html.slice(from, html.indexOf('</button>', from))
      expect(tag).toContain(`>${i18n.t('roleInfo.prefix')}<`)
      expect(tag).toContain(name)
      expect(tag).toContain('border-mist-300') // dark surface, not onLight (border-dusk-700)
      expect(tag).not.toContain('border-dusk-700')
      // The one-line body is still there, and the name is no longer a bare span of its own.
      expect(html).toContain(i18n.t(`roles.${role}.body`).replace(/'/g, '&#x27;'))
      expect(html).not.toContain(`<span class="font-display text-base text-mist-100">${name}</span>`)
    })

    it(`shows no role tag for a species that was never seen (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      Object.assign(useGame.getInitialState(), { player: makePlayer([makeMon('pikachu', 10, { uid: 'm' })], { pokedex: { caught: [], seen: [] } }) })
      const html = renderToStaticMarkup(<Dex />)
      expect(html).not.toContain(i18n.t('roleInfo.prefix') + '<')
      expect(html).toContain(i18n.t('dex.unknownBody').replace(/'/g, '&#x27;'))
    })
  }
})
