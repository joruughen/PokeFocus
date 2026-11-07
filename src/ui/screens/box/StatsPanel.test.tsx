/** The Estadísticas | IVs card of the Pokémon detail sheet (server-side render, ES and EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultContext, pokemonView, type BaseStats } from '../../../engine'
import { makeMon, makePlayer, MIN, T0 } from '../../../engine/test-helpers'
import i18n from '../../../i18n'
import { StatsPanel, ivStatTier, type StatsTab } from './StatsPanel'

const IVS: BaseStats = { hp: 31, attack: 0, defense: 12, specialAttack: 20, specialDefense: 26, speed: 8 }

function html(tab?: StatsTab) {
  const mon = makeMon('pidgey', 12, { uid: 'bird', ivs: IVS, nature: 'jolly', caughtAt: T0 - 12 * MIN })
  const player = makePlayer([mon])
  const view = pokemonView(player, 'bird', T0, defaultContext())!
  return renderToStaticMarkup(<StatsPanel view={view} initialTab={tab} />)
}

const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const tab = (h: string, name: string) => new RegExp(`<button[^>]*role="tab"[^>]*>${name}</button>`).test(h)

describe('StatsPanel tabs', () => {
  for (const lng of ['es', 'en'] as const) {
    const L = lng === 'es' ? { stats: 'Estadísticas', energy: 'Energía', nature: 'Naturaleza', quality: 'Calidad general', per: 'Por estadística' } : { stats: 'Stats', energy: 'Energy', nature: 'Nature', quality: 'Overall quality', per: 'Per stat' }

    it(`has the two tabs, Stats selected by default, with the current stats (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const h = html()
      expect(h).not.toMatch(/detail\.|iv\.|stats\.[a-z]+\.name/)
      expect(tab(h, L.stats)).toBe(true)
      expect(tab(h, 'IVs')).toBe(true)
      expect(h).toMatch(new RegExp(`role="tab"[^>]*aria-selected="true"[^>]*>${L.stats}<`))
      expect(h).toContain(`aria-label="${i18n.t('detail.tabsLabel')}"`)
      const t = text(h)
      for (const k of ['hp', 'speed', 'specialAttack', 'attack', 'specialDefense', 'defense']) expect(t).toContain(i18n.t(`stats.${k}.name`))
      expect(t).toContain(L.nature)
      expect(t).toContain(i18n.t('detail.ability'))
      expect(t).toContain(i18n.t('detail.met'))
      // The nature markers and the help are still there; the IV block is not in the Stats tab.
      expect(h).toContain(i18n.t('stats.natureUp'))
      expect(h).toContain(`aria-label="${i18n.t('roleInfo.natureAria')}"`)
      expect(h).toContain(i18n.t('detail.every', { time: '' }).slice(0, 6))
      expect(h).not.toContain(i18n.t('iv.what'))
      expect(h).not.toContain(L.quality)
    })

    it(`IVs tab: overall quality, the three sentences, per-stat quality and no exact numbers (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const h = html('ivs')
      expect(h).not.toMatch(/iv\.[a-z]|detail\.tab/) // no raw keys
      expect(h).toMatch(new RegExp(`role="tab"[^>]*aria-selected="true"[^>]*>IVs<`))
      const t = text(h)
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')
      for (const k of ['what', 'fixed', 'effect']) expect(h).toContain(esc(i18n.t(`iv.${k}`)))
      expect(t).toContain(L.quality)
      expect(t).toContain(L.per)
      // 31+0+12+20+26+8 = 97 of 186 = 52%: tier 2 "Good" overall.
      expect(h).toContain(`aria-label="${i18n.t('iv.label', { word: i18n.t('iv.tier.2') })}"`)
      // Per stat: Energy is perfect (31), Catch is weak (0), Pace (8) is Average. Perfect gets the "Max" chip.
      const stat = (k: string, tier: number) => `aria-label="${i18n.t('iv.statLabel', { stat: i18n.t(`stats.${k}.name`), word: i18n.t(`iv.tier.${tier}`) })}"`
      expect(h).toContain(stat('hp', 4))
      expect(h).toContain(stat('attack', 0))
      expect(h).toContain(stat('speed', 1))
      expect(t).toContain(i18n.t('iv.max'))
      expect(t.split(i18n.t('iv.max')).length - 1).toBe(1)
      // The exact IV values are never printed (they are not shown as numbers in the game).
      expect(t.replace(i18n.t('iv.what'), '')).not.toMatch(/\b31\b|\b97\b|\b186\b|\b20\b|\b12\b/)
      // The help button of the IV hint.
      expect(h).toContain(i18n.t('hint.helpFor', { title: i18n.t('hints.detail.iv.title') }))
    })
  }

  it('the per-stat tier uses the engine thresholds on 0-31', () => {
    expect([0, 7, 8, 15, 16, 23, 24, 29, 30, 31].map(ivStatTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})
