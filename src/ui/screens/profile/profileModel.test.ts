import { describe, expect, it } from 'vitest'
import { createEngineContext, defaultContext, trainerExpForLevel, UNLOCK_GIFT_ITEMS } from '../../../engine'
import { makeMon, makePlayer, T0 } from '../../../engine/test-helpers'
import type { SessionSummary } from '../../../engine'
import { companionOf, lastDays, nextLevelReward, profileStats, streakStatus, trainerProgress, trainerUnlocks, weeklyMinutes } from './profileModel'

const ctx = defaultContext()
const cfg = ctx.config.trainer

function summary(patch: Partial<SessionSummary>): SessionSummary {
  return {
    id: 's', startedAt: T0, endedAt: T0, claimedAt: T0, dayKey: '2026-11-03', weekKey: '2026-11-02', minutes: 25, pausedSeconds: 0, focus: 1, screenshotLabels: null,
    lateClaim: false, rewardFactor: 1, points: 10, exp: 5, dust: 20, pokeBalls: 1, conditions: [], soundProfile: null, wilds: 4, caught: 1, techniqueActivations: 0, note: null, subjectTag: null,
    ...patch,
  }
}

describe('trainerProgress', () => {
  it('starts at level 1 with the whole first level ahead', () => {
    const p = trainerProgress({ level: 1, exp: 0 }, ctx)
    expect(p.levelStart).toBe(0)
    expect(p.nextLevelAt).toBe(trainerExpForLevel(2, ctx))
    expect(p.span).toBe(p.nextLevelAt)
    expect(p.missing).toBe(p.nextLevelAt)
    expect(p.fraction).toBe(0)
    expect(p.isMax).toBe(false)
  })

  it('measures EXP inside the level and what is missing for the next one', () => {
    const start = trainerExpForLevel(5, ctx)
    const next = trainerExpForLevel(6, ctx)
    const p = trainerProgress({ level: 5, exp: start + 30 }, ctx)
    expect(p.into).toBe(30)
    expect(p.span).toBe(next - start)
    expect(p.missing).toBe(next - start - 30)
    expect(p.fraction).toBeCloseTo(30 / (next - start))
  })

  it('turns the missing EXP into study minutes and new species with the config rates', () => {
    const p = trainerProgress({ level: 1, exp: 10 }, ctx)
    expect(p.minutes).toBe(Math.ceil(p.missing / cfg.expPerMinute))
    expect(p.species).toBe(Math.ceil(p.missing / cfg.expPerNewSpecies))
    const fast = createEngineContext({ config: { trainer: { expPerMinute: 2, expPerNewSpecies: 50 } } })
    const q = trainerProgress({ level: 1, exp: 11 }, fast)
    expect(q.minutes).toBe(Math.ceil((fast.config.trainer.expCoef * 1 - 11) / 2))
    expect(q.species).toBe(Math.ceil(q.missing / 50))
    const none = createEngineContext({ config: { trainer: { expPerMinute: 0, expPerNewSpecies: 0 } } })
    expect(trainerProgress({ level: 1, exp: 0 }, none).minutes).toBeNull()
    expect(trainerProgress({ level: 1, exp: 0 }, none).species).toBeNull()
  })

  it('is full at the maximum level, with nothing missing', () => {
    const p = trainerProgress({ level: cfg.maxLevel, exp: trainerExpForLevel(cfg.maxLevel, ctx) + 500 }, ctx)
    expect(p.isMax).toBe(true)
    expect(p.nextLevelAt).toBeNull()
    expect(p.span).toBeNull()
    expect(p.missing).toBe(0)
    expect(p.minutes).toBeNull()
    expect(p.fraction).toBe(1)
  })

  it('shows the reward of the next level (config), none at the maximum', () => {
    const r = nextLevelReward(4, ctx)!
    expect(r.level).toBe(5)
    expect(r.dust).toBeGreaterThan(0)
    expect(r.items['great-ball']).toBeGreaterThan(0) // every 5th level adds Great Balls
    expect(nextLevelReward(cfg.maxLevel, ctx)).toBeNull()
  })
})

describe('streakStatus', () => {
  const base = { current: 4, best: 9, lastDayKey: '2026-11-10' as string | null, gapBeforeLastDay: 0, protectUsedWeek: null }
  it('tells where the streak stands today', () => {
    expect(streakStatus({ ...base, lastDayKey: null, current: 0, best: 0 }, '2026-11-10').state).toBe('none')
    expect(streakStatus(base, '2026-11-10')).toEqual({ state: 'today', current: 4, best: 9 })
    expect(streakStatus(base, '2026-11-11')).toEqual({ state: 'atRisk', current: 4, best: 9 })
    expect(streakStatus(base, '2026-11-12')).toEqual({ state: 'lapsed', current: 4, best: 9 })
    expect(streakStatus(base, '2026-11-15')).toEqual({ state: 'lost', current: 0, best: 9 })
  })
  it('never reports a best below the current streak', () => {
    expect(streakStatus({ ...base, current: 6, best: 2 }, '2026-11-10').best).toBe(6)
  })
})

describe('trainerUnlocks', () => {
  it('lists the advanced items at the levels the config says, ascending', () => {
    const ladder = trainerUnlocks(1, ctx)
    const levels = ladder.map((l) => l.level)
    expect(levels).toEqual([...levels].sort((a, b) => a - b))
    for (const kind of ['mint', 'tera', 'bottleCap', 'abilityCapsule'] as const) {
      const at = ctx.config.advanced[kind].minTrainerLevel
      expect(ladder.find((l) => l.level === at)?.entries.some((e) => e.kind === kind), kind).toBe(true)
    }
  })

  it('follows the config: moving a level moves the entry', () => {
    const c = createEngineContext({ config: { advanced: { mint: { minTrainerLevel: 7 }, tera: { minTrainerLevel: 12, unlockGift: 4 } } } })
    const ladder = trainerUnlocks(1, c)
    expect(ladder.find((l) => l.level === 7)?.entries.map((e) => e.kind)).toContain('mint')
    expect(ladder.find((l) => l.level === 10)?.entries.map((e) => e.kind) ?? []).not.toContain('mint')
    expect(ladder.find((l) => l.level === 12)?.entries.find((e) => e.kind === 'tera')?.gift).toEqual({ item: UNLOCK_GIFT_ITEMS.tera, count: 4 })
  })

  it('has no gift where the config gives none, and no entries above the maximum level', () => {
    const c = createEngineContext({ config: { advanced: { tera: { unlockGift: 0 } } } })
    expect(trainerUnlocks(1, c).flatMap((l) => l.entries).find((e) => e.kind === 'tera')?.gift).toBeUndefined()
    for (const l of trainerUnlocks(1, ctx)) expect(l.level).toBeLessThanOrEqual(cfg.maxLevel)
  })

  it('marks the levels already reached as done', () => {
    const ladder = trainerUnlocks(20, ctx)
    for (const l of ladder) expect(l.done).toBe(l.level <= 20)
    expect(ladder.some((l) => !l.done)).toBe(true)
    expect(trainerUnlocks(cfg.maxLevel, ctx).every((l) => l.done)).toBe(true)
  })

  it('reads the mission tiers: the level where the daily rewards improve brings a Great Ball', () => {
    const at5 = trainerUnlocks(1, ctx).find((l) => l.level === 5)
    expect(at5?.entries.find((e) => e.kind === 'missions')?.item).toBe('great-ball')
  })
})

describe('profileStats', () => {
  it('is all zeros without sessions', () => {
    const st = profileStats(makePlayer([makeMon('pikachu', 5, { uid: 'a' })]), ctx)
    expect(st.sessions).toBe(0)
    expect(st.totalMinutes).toBe(0)
    expect(st.avgMinutes).toBe(0)
    expect(st.avgFocus).toBeNull()
    expect(st.studyDays).toBe(0)
    expect(st.shinyOwned).toBe(0)
    expect(st.speciesTotal).toBe(ctx.data.species.length)
  })

  it('sums the history: minutes, averages, days, dust and catches', () => {
    const history = [
      summary({ id: 'a', minutes: 25, focus: 1, dust: 10, caught: 1, dayKey: '2026-11-02' }),
      summary({ id: 'b', minutes: 50, focus: 0.5, dust: 30, caught: 2, dayKey: '2026-11-02' }),
      summary({ id: 'c', minutes: 100, focus: 0.9, dust: 0, caught: 0, dayKey: '2026-11-03' }),
    ]
    const st = profileStats(makePlayer([makeMon('pikachu', 5, { uid: 'a' })], { history }), ctx)
    expect(st.sessions).toBe(3)
    expect(st.totalMinutes).toBe(175)
    expect(st.avgMinutes).toBe(58)
    expect(st.longestMinutes).toBe(100)
    expect(st.avgFocus).toBeCloseTo(2.4 / 3)
    expect(st.studyDays).toBe(2)
    expect(st.dustEarned).toBe(40)
    expect(st.catches).toBe(3)
  })

  it('counts shiny, traded and legendary (Pokédex) and finds the longest Bond', () => {
    const legendary = ctx.data.species.find((s) => s.isLegendary)!.slug
    const a = makeMon('pikachu', 5, { uid: 'a', isShiny: true, bondMinutes: 30 })
    const b = makeMon('eevee', 5, { uid: 'b', bondMinutes: 90, traded: { originalTrainer: 'X', receivedFrom: 'X', receivedAt: T0, count: 1 } })
    const st = profileStats(makePlayer([a, b], { pokedex: { caught: ['pikachu', 'eevee', legendary], seen: ['pikachu', 'eevee', legendary, 'mew'] } }), ctx)
    expect(st.shinyOwned).toBe(1)
    expect(st.tradedOwned).toBe(1)
    expect(st.legendaryCaught).toBe(1)
    expect(st.speciesCaught).toBe(3)
    expect(st.speciesSeen).toBe(4)
    expect(st.longestBond?.uid).toBe('b')
  })

  it('weekly minutes: the last N weeks oldest first, empty weeks as 0, older sessions left out', () => {
    const history = [summary({ weekKey: '2026-11-02', minutes: 30 }), summary({ weekKey: '2026-11-02', minutes: 20 }), summary({ weekKey: '2026-10-19', minutes: 60 }), summary({ weekKey: '2026-08-03', minutes: 999 })]
    const w = weeklyMinutes(history, '2026-11-02', 4)
    expect(w.map((x) => x.weekKey)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
    expect(w.map((x) => x.minutes)).toEqual([0, 60, 0, 50])
  })

  it('last days: marks the days with minutes and today', () => {
    const days = { '2026-11-02': { minutes: 25, sessions: 1, firstStartMinute: 600 }, '2026-11-04': { minutes: 0, sessions: 0, firstStartMinute: 0 } }
    const d = lastDays(days, '2026-11-04', 3)
    expect(d.map((x) => x.dayKey)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
    expect(d.map((x) => x.studied)).toEqual([true, false, false])
    expect(d.map((x) => x.today)).toEqual([false, false, true])
  })

  it('the companion is the team leader, else the Pokémon with the most Bond', () => {
    const a = makeMon('pikachu', 5, { uid: 'a', bondMinutes: 5 })
    const b = makeMon('eevee', 5, { uid: 'b', bondMinutes: 50 })
    expect(companionOf(makePlayer([a, b]))?.uid).toBe('a')
    expect(companionOf(makePlayer([a, b], { team: [] }))?.uid).toBe('b')
  })
})
