import { describe, expect, it } from 'vitest'
import { DAMAGE_POLICIES, type DamagePolicy } from './capture-policy.ts'
import { makeContext } from './experiments.ts'
import { runPipeline } from './pipeline.ts'
import { planProfile, PROFILE_IDS } from './profiles.ts'
import { renderReport } from './report.ts'
import { runPlayer } from './run.ts'
import { speciesValue } from './species-value.ts'

const ctx = makeContext()

function week1(seed: number | string = 1) {
  return runPlayer({ profile: 'constant', seed, weeks: 1, ctx, missions: true, captures: true, candies: true, soloStarter: false, detail: true })
}

describe('balance simulator (smoke, 1 week, 1 seed)', () => {
  it('is deterministic: same seed, same result', () => {
    const a = week1()
    const b = week1()
    expect(b.weeklyPoints).toEqual(a.weeklyPoints)
    expect(b.tally).toEqual(a.tally)
    expect(b.finalTeam).toEqual(a.finalTeam)
  })

  it('plays a plausible constant week', () => {
    const m = week1()
    expect(m.tally.sessionsTotal).toBe(28)
    expect(m.tally.sessionsRewarded).toBe(28)
    expect(m.weeklyPoints[0]).toBeGreaterThan(3_000)
    expect(m.weeklyPoints[0]).toBeLessThan(80_000)
    expect(m.tally.catchesTotal).toBeGreaterThan(10)
    expect(m.tally.dustEarned).toBeGreaterThan(0)
    expect(m.days).toHaveLength(7)
    // The mirror of the engine's condition environment must agree with the engine.
    expect(m.tally.condMismatch).toBe(0)
  })

  it('damage split policies all play; manual policies change the outcome', () => {
    const base = week1()
    const run = (damagePolicy: Exclude<DamagePolicy, 'auto'>) =>
      runPlayer({ profile: 'constant', seed: 1, weeks: 1, ctx, missions: true, captures: true, candies: true, soloStarter: false, detail: false, damagePolicy })
    for (const p of DAMAGE_POLICIES.filter((x): x is Exclude<DamagePolicy, 'auto'> => x !== 'auto')) {
      const m = run(p)
      expect(m.tally.catchesTotal).toBeGreaterThan(5)
      expect(m.tally).not.toEqual(base.tally)
    }
  })

  it('a different seed gives a different week', () => {
    expect(week1(2).weeklyPoints).not.toEqual(week1(1).weeklyPoints)
  })

  it('config overrides take effect', () => {
    const base = week1()
    const fast = runPlayer({ profile: 'constant', seed: 1, weeks: 1, ctx: makeContext({ rewards: { expPerMinute: 48 } }), missions: true, captures: true, candies: true, soloStarter: false, detail: false })
    const lv = (m: ReturnType<typeof week1>) => (m.days[6] as { starterExpLevel: number }).starterExpLevel
    expect(lv(fast)).toBeGreaterThan(lv(base))
  })

  it('every profile plans sessions and the grinder studies about 14 h a day', () => {
    for (const p of PROFILE_IDS) expect(planProfile(p, 1, 1).sessions.length).toBeGreaterThan(0)
    const g = planProfile('grinder', 1, 1)
    const minutes = g.sessions.reduce((a, s) => a + s.minutes, 0) / 7
    expect(minutes).toBeGreaterThan(700)
    expect(minutes).toBeLessThan(900)
  })

  it('values a species and renders a report', () => {
    expect(speciesValue(ctx, 'pikachu', 30, 1).ptsDay).toBeGreaterThan(100)
    const r = runPipeline({
      seeds: 1,
      weeks: 1,
      levelWeeks: 2,
      profiles: ['casual', 'constant'],
      missions: true,
      speciesWeeks: 1,
      propose: false,
      proposeSeeds: 1,
      species: false,
    })
    const md = renderReport(r, 'test')
    expect(md).toContain('## 1. Puntos semanales y ligas')
    expect(md).toContain('## 8. Recomendaciones')
  })
})
