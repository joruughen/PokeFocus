import { describe, expect, it } from 'vitest'
import { defaultContext } from './context'
import { wildQualityForRank } from './league'
import { createRng } from './rng'
import { STAT_KEYS } from './stats'
import type { WaveGenParams } from './state'
import { rollWild } from './waves'

const ctx = defaultContext()
const cfg = ctx.config

const gen = (league: 'base' | 'super' | 'ultra' | 'master', sub: number): WaveGenParams => ({
  focus: 1,
  trainerLevel: 30,
  soundDominant: null,
  teamTypes: [],
  typeWeightMults: {},
  syncNature: null,
  rank: { league, sub },
})

function sample(league: 'base' | 'super' | 'ultra' | 'master', sub: number, n = 1500) {
  const rng = createRng(`quality-${league}-${sub}`)
  let ivSum = 0
  let minIv = 99
  let hidden = 0
  let withHidden = 0
  for (let i = 0; i < n; i++) {
    const w = rollWild(rng, { waveIndex: 0, gen: gen(league, sub), activeConditionTypes: [], contributions: [], forceSpecies: 'ditto' }, ctx)
    for (const k of STAT_KEYS) {
      ivSum += w.ivs[k]
      minIv = Math.min(minIv, w.ivs[k])
    }
    withHidden++
    if (w.ability === 'imposter') hidden++
  }
  return { mean: ivSum / (n * STAT_KEYS.length), minIv, hiddenShare: hidden / withHidden }
}

describe('wild quality by league (GDD §10.2)', () => {
  it('grows with every rung and across leagues', () => {
    const rungs = [
      ['base', 1], ['base', 5], ['super', 1], ['super', 5], ['ultra', 1], ['ultra', 5], ['master', 1], ['master', 5], ['master', 25],
    ] as const
    const q = rungs.map(([l, s]) => wildQualityForRank({ league: l, sub: s }, cfg))
    for (let i = 1; i < q.length; i++) {
      expect(q[i]!.ivFloor).toBeGreaterThanOrEqual(q[i - 1]!.ivFloor)
      expect(q[i]!.hiddenAbilityChance).toBeGreaterThanOrEqual(q[i - 1]!.hiddenAbilityChance)
    }
    expect(q[0]).toEqual({ ivFloor: 0, hiddenAbilityChance: cfg.progression.hiddenAbilityChance })
    expect(q[7]!.ivFloor).toBeGreaterThan(q[0]!.ivFloor)
    // Past the ramp it stays at the top of its league.
    expect(q[8]).toEqual(q[7])
    expect(q.every((x) => x.ivFloor <= cfg.progression.ivMax)).toBe(true)
  })

  it('wilds never roll an IV under the floor of the rung, and higher rungs have better IVs on average', () => {
    const base = sample('base', 1)
    const sup = sample('super', 5)
    const master = sample('master', 5)
    expect(base.mean).toBeGreaterThan(14)
    expect(base.mean).toBeLessThan(17)
    expect(sup.minIv).toBeGreaterThanOrEqual(wildQualityForRank({ league: 'super', sub: 5 }, cfg).ivFloor)
    expect(master.minIv).toBeGreaterThanOrEqual(wildQualityForRank({ league: 'master', sub: 5 }, cfg).ivFloor)
    expect(sup.mean).toBeGreaterThan(base.mean + 3)
    expect(master.mean).toBeGreaterThan(sup.mean + 3)
  })

  it('the hidden ability turns up more in higher leagues', () => {
    const base = sample('base', 1, 4000)
    const master = sample('master', 5, 4000)
    expect(base.hiddenShare).toBeLessThan(0.09)
    expect(master.hiddenShare).toBeGreaterThan(0.15)
  })

  it('an encounter saved without a rung rolls as before (no floor)', () => {
    const rng = createRng('legacy')
    let low = false
    for (let i = 0; i < 300 && !low; i++) {
      const g = { ...gen('master', 5) }
      delete g.rank
      const w = rollWild(rng, { waveIndex: 0, gen: g, activeConditionTypes: [], contributions: [], forceSpecies: 'ditto' }, ctx)
      low = STAT_KEYS.some((k) => w.ivs[k] < 5)
    }
    expect(low).toBe(true)
  })
})
