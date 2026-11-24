/** League news: how notices merge, when they show (pure) and the window markup (ES + EN, no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { defaultContext, podiumDust, rankOf, rankUpDustBetween, type LeagueNotice } from '../../engine'
import { LeagueNoticeBody } from './LeagueNoticeDialog'
import { decideLeagueNotice, leagueNoticesKey, mergeLeagueNotices, type LeagueNoticeContext } from './leagueNotice'

const cfg = defaultContext().config
const WEEK = '2026-11-16'
const climb = (from: number, to: number, weekKey = WEEK): LeagueNotice => ({ kind: 'rankUp', weekKey, from, to, dust: rankUpDustBetween(from, to, cfg), at: 1000 + to })
const s3 = rankOf('super', 3)
const podium: LeagueNotice = { kind: 'podium', weekKey: '2026-11-09', rank: s3.index, place: 2, scope: 'country', dust: podiumDust(s3.index, 2, cfg), at: 500 }

describe('mergeLeagueNotices', () => {
  it('nothing pending: null', () => {
    expect(mergeLeagueNotices(undefined)).toBeNull()
    expect(mergeLeagueNotices([])).toBeNull()
  })

  it('rungs inside one league are a toast; a new league or a podium is a window', () => {
    const inside = mergeLeagueNotices([climb(1, 3)])!
    expect(inside.how).toBe('toast')
    expect(inside.climb).toMatchObject({ from: { league: 'base', sub: 2 }, to: { league: 'base', sub: 4 } })
    expect(inside.dust).toBe(rankUpDustBetween(1, 3, cfg))
    expect(mergeLeagueNotices([climb(3, 6)])!.how).toBe('dialog')
    const both = mergeLeagueNotices([podium, climb(0, 2)])!
    expect(both.how).toBe('dialog')
    expect(both.podiums).toEqual([expect.objectContaining({ place: 2, scope: 'country', rank: expect.objectContaining({ league: 'super', sub: 3 }) })])
    expect(both.dust).toBe(podiumDust(s3.index, 2, cfg) + rankUpDustBetween(0, 2, cfg))
  })

  it('the key changes when a notice is added', () => {
    expect(leagueNoticesKey([climb(0, 1)])).not.toBe(leagueNoticesKey([climb(0, 1), climb(1, 2)]))
  })
})

describe('decideLeagueNotice', () => {
  const ctx = (over: Partial<LeagueNoticeContext> = {}): LeagueNoticeContext => ({ news: mergeLeagueNotices([climb(3, 6)]), phase: 'idle', hintOpen: false, otherDialogOpen: false, whatsNewPending: false, levelUpOwed: false, ...over })

  it('opens at a calm moment only, after the level-up window', () => {
    expect(decideLeagueNotice(ctx())).toBe('dialog')
    expect(decideLeagueNotice(ctx({ news: null }))).toBe('none')
    for (const phase of ['focus', 'paused', 'waves', 'break']) expect(decideLeagueNotice(ctx({ phase }))).toBe('wait')
    expect(decideLeagueNotice(ctx({ hintOpen: true }))).toBe('wait')
    expect(decideLeagueNotice(ctx({ otherDialogOpen: true }))).toBe('wait')
    expect(decideLeagueNotice(ctx({ whatsNewPending: true }))).toBe('wait')
    expect(decideLeagueNotice(ctx({ levelUpOwed: true }))).toBe('wait')
  })

  it('a toast only waits for the home loop', () => {
    const news = mergeLeagueNotices([climb(1, 2)])
    expect(decideLeagueNotice(ctx({ news, otherDialogOpen: true, levelUpOwed: true }))).toBe('toast')
    expect(decideLeagueNotice(ctx({ news, phase: 'focus' }))).toBe('wait')
  })
})

describe('LeagueNoticeBody', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`shows the rank reached, the podium and the Dust (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const news = mergeLeagueNotices([podium, climb(3, 6)])!
      const html = renderToStaticMarkup(<LeagueNoticeBody news={news} />)
      expect(html).not.toMatch(/\b(league|items)\.[a-zA-Z]+\b(?![^<]*>)/)
      expect(html).toContain(lng === 'es' ? 'Liga Super 2' : 'Super League 2')
      expect(html).toContain(lng === 'es' ? 'puesto 2 de Liga Super 3 en tu país' : 'place 2 of Super League 3 in your country')
      expect(html).toContain(`+${news.dust}`)
    })

    it(`tells that the wilds get better after a climb (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<LeagueNoticeBody news={mergeLeagueNotices([climb(3, 6)])!} />)
      // Rung 6 = Super League 2: IV floor 5, hidden ability 7,5 % of the time.
      expect(html).toContain(lng === 'es' ? 'Ahora tus salvajes son mejores' : 'Your wilds are better now')
      expect(html).not.toMatch(/\{\{/)
    })
  }
})
