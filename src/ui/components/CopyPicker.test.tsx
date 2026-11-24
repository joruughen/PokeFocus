/** Copy picker (Transformación): candidates as cards with the techniques they would lend (server-side render). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { makeMon } from '../../engine/test-helpers'
import i18n from '../../i18n'
import { CopyPicker } from './CopyPicker'

const esc = (s: string) => s.replace(/'/g, '&#x27;')
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const char = makeMon('charmander', 30, { uid: 'char', equippedMoves: ['ember', 'agility', 'scratch', 'growl'] })
const squ = makeMon('squirtle', 12, { uid: 'squ', equippedMoves: [] })
const noop = () => {}

describe('CopyPicker', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`lists each candidate with name, level, types and only the first N techniques (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const h = renderToStaticMarkup(<CopyPicker candidates={[char, squ]} slots={2} onPick={noop} />)
      const t = text(h)
      expect(h).not.toMatch(/transform\.[a-z]/) // no raw keys
      expect(h.match(/<li /g)).toHaveLength(2)
      expect(t).toContain(i18n.t('transform.pick.random'))
      expect(t).toContain(i18n.t('transform.pick.randomBody', { count: 2 }))
      expect(t).toContain(i18n.t('pokemon.levelShort') + '30')
      expect(h.match(/aria-pressed="false"/g)).toHaveLength(2)
      // slots = 2: two chips for Charmander, none of the 3rd/4th; Squirtle has none equipped.
      const chips = h.match(/<span class="inline-flex items-center gap-1\.5 bg-dusk-700/g) ?? []
      expect(chips).toHaveLength(2)
      expect(t).toContain(i18n.t('transform.pick.noMoves'))
      expect(h).not.toContain(esc(i18n.t('transform.pick.stop', { name: 'Ditto' })))
    })
  }

  it('marks the current one and offers going back to Ditto when onStop is given', async () => {
    await i18n.changeLanguage('es')
    const h = renderToStaticMarkup(<CopyPicker candidates={[char, squ]} slots={2} currentUid="char" onPick={noop} onStop={noop} />)
    expect(h.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(text(h)).toContain(i18n.t('transform.pick.current'))
    expect(text(h)).toContain('Volver a ser Ditto')
  })

  it('disables everything while busy and the random pick with no candidates', async () => {
    await i18n.changeLanguage('en')
    const busy = renderToStaticMarkup(<CopyPicker candidates={[char]} slots={2} onPick={noop} busy />)
    expect(busy.match(/<button[^>]*\sdisabled=""/g)?.length).toBe(2)
    const empty = renderToStaticMarkup(<CopyPicker candidates={[]} slots={2} onPick={noop} />)
    expect(empty).toMatch(/<button[^>]*\sdisabled=""/)
    expect(empty).not.toContain('<li ')
  })
})
