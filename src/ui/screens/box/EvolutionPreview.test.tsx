/** Evolution card: the collapsed "stat changes" toggle and the open preview (server-side render). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { makeMon } from '../../../engine/test-helpers'
import i18n from '../../../i18n'
import { EvolutionPreview } from './EvolutionPreview'
import { statChangeOnEvolution } from './evolutionStats'

const mon = makeMon('pidgey', 12, { nature: 'jolly' })
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('EvolutionPreview', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`is collapsed by default: only the toggle, no numbers (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const h = renderToStaticMarkup(<EvolutionPreview pokemon={mon} to="pidgeotto" />)
      expect(h).toContain(i18n.t('evo.previewShow'))
      expect(h).toContain('aria-expanded="false"')
      expect(h).not.toContain(i18n.t('evo.previewTitle'))
      expect(h).not.toMatch(/evo\./)
    })

    it(`open: six rows "now → new (+N)", the biggest gain marked, level and the carry-over note (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const h = renderToStaticMarkup(<EvolutionPreview pokemon={mon} to="pidgeotto" defaultOpen />)
      const t = text(h)
      expect(h).not.toMatch(/evo\.|stats\.[a-z]+\.name/)
      expect(h).toContain('aria-expanded="true"')
      expect(t).toContain(i18n.t('evo.previewHide'))
      expect(t).toContain(i18n.t('evo.previewTitle'))
      const r = statChangeOnEvolution(mon, 'pidgeotto')
      expect(h.match(/<li /g)).toHaveLength(6)
      for (const c of r.changes) {
        expect(t).toContain(`${c.from} → ${c.to}`)
        expect(t).toContain(`(+${c.delta})`)
        expect(h).toContain(`aria-label="${i18n.t('evo.previewRow', { stat: i18n.t(`stats.${c.stat}.name`), from: c.from, to: c.to, delta: `+${c.delta}` })}"`)
      }
      expect(r.best).not.toBeNull()
      expect(t.split(i18n.t('evo.previewBest')).length - 1).toBe(1) // exactly one highlighted stat
      expect(h.indexOf(i18n.t('evo.previewBest'))).toBeGreaterThan(h.indexOf(i18n.t(`stats.${r.best!}.name`)))
      expect(t).toContain(i18n.t('evo.previewNote', { level: 12 }))
    })
  }

  it('shows a drop with a minus sign and does not mark it', async () => {
    await i18n.changeLanguage('en')
    const h = renderToStaticMarkup(<EvolutionPreview pokemon={makeMon('caterpie', 30)} to="metapod" defaultOpen />)
    expect(text(h)).toMatch(/\(−\d+\)/)
  })
})
