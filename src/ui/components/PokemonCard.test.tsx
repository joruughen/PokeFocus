/** A Ditto copying a teammate: copied sprite and types, own name, "Copia a …" tag (server-side render). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { pokemonView } from '../../engine'
import { makeMon, makePlayer, T0 } from '../../engine/test-helpers'
import { PokemonCard } from './PokemonCard'

function card(variant: 'stage' | 'compact', copy: boolean) {
  const char = makeMon('charmander', 20, { uid: 'char' })
  const ditto = makeMon('ditto', 20, { uid: 'ditto', isShiny: true, nickname: 'Blobby', ...(copy ? { copyOfUid: 'char' } : {}) })
  const view = pokemonView(makePlayer([char, ditto]), 'ditto', T0)!
  return renderToStaticMarkup(<PokemonCard view={view} variant={variant} />)
}

describe('PokemonCard with a copy', () => {
  for (const variant of ['stage', 'compact'] as const) {
    it(`draws the teammate (shiny of the Ditto), keeps the name and tags it (${variant})`, async () => {
      await i18n.changeLanguage('en')
      const html = card(variant, true)
      expect(html).toContain('Blobby')
      expect(html).toContain('Copying Charmander')
      // Dex numbers: Charmander 4, Ditto 132. The stage sprite is the SHINY one (the Ditto is shiny, Charmander is not).
      expect(html).toContain(variant === 'stage' ? '/sprites/showdown-shiny/4.gif' : '/sprites/icons/4.png')
      expect(html).not.toMatch(/sprites\/[a-z-]+\/132\./)
      expect(html).toContain('Fire')
      expect(html).toContain('truncate')
    })
    it(`without a copy it stays Ditto, no tag (${variant})`, async () => {
      await i18n.changeLanguage('es')
      const html = card(variant, false)
      expect(html).toMatch(/sprites\/[a-z-]+\/132\./)
      expect(html).not.toContain('Copia a')
    })
  }
})
