/** League screen: current rank, progress to the next one, best rank and what each league gives (SSR, ES + EN). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { defaultContext, rankOf, weekKey } from '../../../engine'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { useGame } from '../../store/game'
import League from './League'

const RAW_KEY = /\b(league|leaderboard)\.[a-zA-Z]+\b(?![^<]*>)/

function render(points: number, best?: number): string {
  const base = makePlayer([makeMon('pikachu', 10, { uid: 'm' })])
  const player = { ...base, league: { weeklyPoints: { [weekKey(base, Date.now())]: points }, monthlyPoints: {}, bestLeague: 'ultra' as const, ...(best !== undefined && { bestRank: best }) } }
  Object.assign(useGame.getInitialState(), { player })
  return renderToStaticMarkup(<League />)
}

describe('League screen', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`shows league and subrank, points to the next rank, the best rank and each league's waves and wilds (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const s3 = rankOf('super', 3)
      const s4 = rankOf('super', 4)
      const html = render(s3.points + 100, rankOf('master', 2).index)
      expect(html).not.toMatch(RAW_KEY)
      expect(html).toContain(lng === 'es' ? 'Liga Super 3' : 'Super League 3')
      const missing = new Intl.NumberFormat(lng).format(s4.points - s3.points - 100)
      expect(html).toContain(i18n.t('league.toNext', { points: missing, rank: lng === 'es' ? 'Liga Super 4' : 'Super League 4' }))
      expect(html).toContain(i18n.t('league.best', { rank: lng === 'es' ? 'Liga Maestra 2' : 'Master League 2' }))
      expect(html).toContain(i18n.t('league.waves', { from: 2, to: 4 }))
      expect(html).toContain(i18n.t('league.waves', { from: 7, to: 10 }))
      for (const k of ['s1', 's12', 's123', 'all']) expect(html).toContain(i18n.t(`league.stages.${k}`))
      // Each league says how its wilds improve with the rungs (minimum IVs and hidden ability).
      expect(html).toContain(i18n.t('league.quality', { from: 0, to: 3, hFrom: lng === 'es' ? '5 %' : '5%', hTo: lng === 'es' ? '6 %' : '6%' }).split(':')[0])
      // One pip per rank: 5 + 5 + 5 + 25.
      expect(html.match(/aria-current="step"/g)).toHaveLength(1)
      expect(defaultContext().config.leagues.subranks.master).toBe(25)
    })

    it(`a save from before the subranks shows the first rank of its best league (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      expect(render(0)).toContain(i18n.t('league.best', { rank: lng === 'es' ? 'Liga Ultra 1' : 'Ultra League 1' }))
    })
  }
})
