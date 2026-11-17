/** Candy preview box: render smoke tests (server-side render, ES and EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { levelCap, previewCandies } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import i18n from '../../../i18n'
import { CandyPreviewBox } from './Growth'

const RAW = /candy\.preview|\{\{/

for (const lng of ['es', 'en'] as const) {
  describe(`candy preview (${lng})`, () => {
    it('shows level-up arrow, EXP, candies and dust', async () => {
      await i18n.changeLanguage(lng)
      const s = makePlayer([makeMon('charmander', 10, { uid: 'a' })], { dust: 5000, candies: { chains: { '2': 40 }, types: {} } })
      const r = previewCandies(s, 'a', { kind: 'species' }, 8)
      if (!r.ok) throw new Error(r.error)
      const html = renderToStaticMarkup(<CandyPreviewBox preview={r.value} asked={8} />)
      expect(html).toContain(i18n.t('candy.preview.levelUp', { from: r.value.levelFrom, to: r.value.levelTo }))
      expect(html).toContain(i18n.t('candy.preview.exp'))
      expect(html).not.toMatch(RAW)
      expect(html).not.toContain('role="status"')
    })

    it('warns when the level cap leaves candies unused', async () => {
      await i18n.changeLanguage(lng)
      const cap = levelCap(makePlayer([]))
      const s = makePlayer([makeMon('charmander', cap - 1, { uid: 'a' })], { dust: 100000, candies: { chains: { '2': 50 }, types: {} } })
      const r = previewCandies(s, 'a', { kind: 'species' }, 50)
      if (!r.ok) throw new Error(r.error)
      const html = renderToStaticMarkup(<CandyPreviewBox preview={r.value} asked={50} />)
      expect(html).toContain('role="status"')
      expect(html).not.toMatch(RAW)
    })
  })
}
