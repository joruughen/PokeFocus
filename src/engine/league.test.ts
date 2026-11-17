import { describe, expect, it } from 'vitest'
import { createEngineContext, defaultContext } from './context'
import {
  bestRank,
  leagueLadder,
  nextRankProgress,
  podiumDust,
  podiumSettled,
  rankForPoints,
  rankInterval,
  rankOf,
  rankUpDust,
  rankUpDustBetween,
  settlePodium,
  weekKey,
} from './league'
import { applySessionResult } from './session'
import { makeMon, makePlayer, runSession, T0 } from './test-helpers'

const cfg = defaultContext().config

describe('league ladder with subranks (GDD §14)', () => {
  const ladder = leagueLadder()

  it('has Base 1–5, Super 1–5, Ultra 1–5 and Master 1–25 (40 rungs)', () => {
    expect(ladder).toHaveLength(40)
    expect(ladder[0]).toMatchObject({ league: 'base', sub: 1, index: 0, points: 0 })
    expect(ladder[5]).toMatchObject({ league: 'super', sub: 1, points: cfg.leagues.weeklyThresholds.super })
    expect(ladder[10]).toMatchObject({ league: 'ultra', sub: 1, points: cfg.leagues.weeklyThresholds.ultra })
    expect(ladder[15]).toMatchObject({ league: 'master', sub: 1, points: cfg.leagues.weeklyThresholds.master })
    expect(ladder[39]).toMatchObject({ league: 'master', sub: 25, points: cfg.leagues.topRankPoints })
    expect(ladder[1]!.points).toBe(cfg.leagues.secondRankPoints)
  })

  it('grows strictly, with a steady ratio inside each league', () => {
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!.points).toBeGreaterThan(ladder[i - 1]!.points)
    const ratios = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ladder[from + i + 1]!.points / ladder[from + i]!.points)
    for (const [from, to] of [[1, 5], [5, 10], [10, 15], [15, 39]] as const) {
      const r = ratios(from, to)
      // 3 significant digits of rounding: the ratios of a league agree within 1 %.
      expect(Math.max(...r) / Math.min(...r)).toBeLessThan(1.01)
    }
    // Master asks for about 10 % more per rung.
    expect(ladder[16]!.points / ladder[15]!.points).toBeCloseTo(1.1, 1)
  })

  it('rankForPoints, rankOf and rankInterval agree', () => {
    expect(rankForPoints(0)).toMatchObject({ league: 'base', sub: 1 })
    expect(rankForPoints(cfg.leagues.secondRankPoints - 1)).toMatchObject({ league: 'base', sub: 1 })
    expect(rankForPoints(cfg.leagues.secondRankPoints)).toMatchObject({ league: 'base', sub: 2 })
    expect(rankForPoints(cfg.leagues.topRankPoints * 3)).toMatchObject({ league: 'master', sub: 25 })
    const s3 = rankOf('super', 3)
    expect(rankInterval(s3.index)).toEqual({ from: s3.points, to: rankOf('super', 4).points })
    expect(rankInterval(39).to).toBeNull()
    expect(rankOf('master', 99)).toMatchObject({ sub: 25 })
    // Monthly: the same ladder × monthlyMultiplier.
    expect(rankForPoints(s3.points * cfg.leagues.monthlyMultiplier, 'month')).toMatchObject({ league: 'super', sub: 3 })
    expect(rankForPoints(s3.points * cfg.leagues.monthlyMultiplier - 1, 'month')).toMatchObject({ league: 'super', sub: 2 })
  })

  it('a config without subranks keeps the four plain leagues', () => {
    const c = createEngineContext({ config: { leagues: { subranks: { base: 1, super: 1, ultra: 1, master: 1 } } } })
    expect(leagueLadder('week', c).map((r) => r.points)).toEqual([0, cfg.leagues.weeklyThresholds.super, cfg.leagues.weeklyThresholds.ultra, cfg.leagues.weeklyThresholds.master])
  })

  it('progress to the next rung', () => {
    const b2 = cfg.leagues.secondRankPoints
    const s = makePlayer([makeMon('pidgey', 10)], { league: { weeklyPoints: { [weekKey(makePlayer([makeMon('pidgey', 10)]), T0)]: b2 / 2 }, monthlyPoints: {}, bestLeague: 'base' } })
    const p = nextRankProgress(s, T0)!
    expect(p.next).toMatchObject({ league: 'base', sub: 2 })
    expect(p.pointsNeeded).toBe(b2 / 2)
    expect(p.progress).toBeCloseTo(0.5)
    const top = { ...s, league: { ...s.league, weeklyPoints: { [weekKey(s, T0)]: cfg.leagues.topRankPoints } } }
    expect(nextRankProgress(top, T0)).toBeNull()
  })
})

describe('league rewards (GDD §14)', () => {
  it('rank-up Dust: base + perRank · rung, summed over the rungs climbed', () => {
    const d = cfg.leagues.rankUpDust
    expect(rankUpDust(0, cfg)).toBe(0)
    expect(rankUpDust(1, cfg)).toBe(d.base + d.perRank)
    expect(rankUpDustBetween(0, 3, cfg)).toBe(3 * d.base + 6 * d.perRank)
    expect(rankUpDustBetween(4, 4, cfg)).toBe(0)
  })

  it('a claim pays the rungs it climbs, reports them and keeps the best rung', () => {
    const base = makePlayer([makeMon('pidgey', 30), makeMon('charmander', 30)])
    const { result, state } = runSession(base, 100, 5)
    const r = applySessionResult(state, result)
    if (!r.ok) throw new Error(r.error)
    const to = rankForPoints(result.totalPoints)
    expect(to.index).toBeGreaterThan(0)
    const up = r.value.events.find((e) => e.type === 'leagueUp')
    expect(up).toMatchObject({ type: 'leagueUp', from: 'base', fromSub: 1, to: to.league, toSub: to.sub, dust: rankUpDustBetween(0, to.index, cfg) })
    const levelDust = r.value.events.reduce((a, e) => a + (e.type === 'trainerLevelUp' ? (e.dust ?? 0) : 0), 0)
    expect(r.value.state.dust).toBe(state.dust + result.dust + levelDust + rankUpDustBetween(0, to.index, cfg))
    expect(r.value.state.league.bestRank).toBe(to.index)
    expect(bestRank(r.value.state)).toMatchObject({ league: to.league, sub: to.sub })
    // The session rolled its wilds with the rung it started in.
    expect(result.gen.rank).toEqual({ league: 'base', sub: 1 })
  })

  it('saves from before the subranks: the best rung is the first subrank of bestLeague', () => {
    const s = makePlayer([makeMon('pidgey', 10)], { league: { weeklyPoints: {}, monthlyPoints: {}, bestLeague: 'ultra' } })
    expect(s.league.bestRank).toBeUndefined()
    expect(bestRank(s)).toMatchObject({ league: 'ultra', sub: 1 })
  })

  it('podium Dust by place and rung, settled once per week', () => {
    const p = cfg.leagues.podium
    expect(podiumDust(10, 1, cfg)).toBe(Math.round((p.dustBase + p.dustPerRank * 10) * p.placeMult[0]!))
    expect(podiumDust(10, 3, cfg)).toBe(Math.round((p.dustBase + p.dustPerRank * 10) * p.placeMult[2]!))
    expect(podiumDust(10, 4, cfg)).toBe(0)
    const s = makePlayer([makeMon('pidgey', 10)])
    const a = settlePodium(s, { weekKey: '2026-11-02', index: 10, place: 2 })
    expect(a.dust).toBe(podiumDust(10, 2, cfg))
    expect(a.state.dust).toBe(s.dust + a.dust)
    expect(podiumSettled(a.state, '2026-11-02')).toBe(true)
    expect(settlePodium(a.state, { weekKey: '2026-11-02', index: 10, place: 1 })).toEqual({ state: a.state, dust: 0 })
    const none = settlePodium(s, { weekKey: '2026-11-02', index: 10, place: null })
    expect(none.dust).toBe(0)
    expect(podiumSettled(none.state, '2026-11-02')).toBe(true)
  })
})
