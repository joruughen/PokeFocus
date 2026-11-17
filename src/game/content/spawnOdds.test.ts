import { describe, expect, it } from 'vitest'
import { baseContext } from '../../engine/context'
import { atLeastOne, baseSpawn, exampleWaveSizes, oneInN, canAppearAt, featuredOdds, speciesReach, trainerLevelForWildLevel, wavesPerAppearance } from './spawnOdds'
import { spawnPreview } from './preview'

const ctx = baseContext()
const sp = (slug: string) => ctx.speciesBySlug.get(slug)!

describe('base spawn odds (Pokédex)', () => {
  // With all of Kanto (158 species) a starter (capture rate 45) is about 0.4 % of the wilds.
  it('Bulbasaur is about 0.4 % of the wilds at a low trainer level', () => {
    const b = baseSpawn(ctx, 'bulbasaur', 1)
    expect(b?.kind).toBe('chance')
    if (b?.kind === 'chance') {
      expect(b.probability).toBeGreaterThan(0.003)
      expect(b.probability).toBeLessThan(0.006)
    }
  })

  it('matches the spawn preview under neutral conditions (no duplicated formula)', () => {
    const pre = spawnPreview(ctx, { hour: 12, weather: 'clear', trainerLevel: 10 })
    const want = pre.species.find((s) => s.slug === 'pikachu')!.probability
    expect(baseSpawn(ctx, 'pikachu', 10)).toEqual({ kind: 'chance', probability: want })
  })

  it('ignores live rules of the context', () => {
    const live = { ...ctx, spawn: new Map([['bulbasaur', { enabled: true, weightMult: 50 }]]) }
    expect(baseSpawn(live, 'bulbasaur', 1)).toEqual(baseSpawn(ctx, 'bulbasaur', 1))
  })

  it('Venusaur does not spawn at a low level: "from level N"', () => {
    const v = baseSpawn(ctx, 'venusaur', 1)
    expect(v?.kind).toBe('fromLevel')
    if (v?.kind === 'fromLevel') {
      expect(v.wildLevel).toBeGreaterThan(10)
      expect(trainerLevelForWildLevel(ctx, v.wildLevel)).toBe(v.trainerLevel)
      expect(baseSpawn(ctx, 'venusaur', v.trainerLevel)?.kind).toBe('chance')
    }
  })

  it('a legendary has its own rule, not a pool share', () => {
    expect(baseSpawn(ctx, 'mewtwo', 1)).toMatchObject({ kind: 'legendary', chance: ctx.config.encounters.legendaryChance, minLevel: ctx.config.encounters.legendaryMinLevel })
    expect(speciesReach(ctx, sp('mewtwo'))).toEqual({ kind: 'legendary' })
  })

  it('unknown species: null; repeated calls agree (cache)', () => {
    expect(baseSpawn(ctx, 'nope', 1)).toBeNull()
    expect(baseSpawn(ctx, 'bulbasaur', 5)).toEqual(baseSpawn(ctx, 'bulbasaur', 5))
  })

  it('a species whose wild level no trainer reaches is evolution-only', () => {
    const tiny = { ...ctx, config: { ...ctx.config, encounters: { ...ctx.config.encounters, wildLevelByTrainerLevel: [{ trainerLevel: 1, min: 2, max: 10 }] } } }
    expect(speciesReach(tiny, sp('venusaur')).kind).toBe('evolution')
    expect(baseSpawn(tiny, 'venusaur', 1)).toEqual({ kind: 'evolution' })
  })
})

describe('featured odds', () => {
  it('the multiplier raises the share; a species out of reach stays at 0 and is flagged', () => {
    const [b, v] = featuredOdds(ctx, [{ species: 'bulbasaur', weightMult: 3 }, { species: 'venusaur', weightMult: 3 }], 1)
    expect(b!.appears).toBe(true)
    expect(b!.with).toBeGreaterThan(b!.without * 2)
    expect(b!.with).toBeLessThan(0.07)
    expect(v!.appears).toBe(false)
    expect(v!.without).toBe(0)
    expect(v!.with).toBe(0)
    expect(v!.reach.kind).toBe('wild')
  })

  it('at a high level the same species appears', () => {
    const [v] = featuredOdds(ctx, [{ species: 'venusaur', weightMult: 3 }], 30)
    expect(v!.appears).toBe(true)
    expect(v!.with).toBeGreaterThan(v!.without)
  })

  it('canAppearAt follows the trainer level of the reach', () => {
    const r = speciesReach(ctx, sp('venusaur'))
    expect(canAppearAt(r, 1)).toBe(false)
    expect(r.kind === 'wild' && canAppearAt(r, r.trainerLevel)).toBe(true)
  })
})

describe('wavesPerAppearance', () => {
  it('1 every K waves', () => {
    expect(wavesPerAppearance(0.04, 4)).toBe(6)
    expect(wavesPerAppearance(0.5, 4)).toBe(1)
    expect(wavesPerAppearance(0, 4)).toBeNull()
  })
})

describe('friendly phrasing helpers', () => {
  it('1 in N: friendly rounding and the "fewer than" cap', () => {
    expect(oneInN(1 / 71)).toEqual({ n: 70, tiny: false })
    expect(oneInN(0.25)).toEqual({ n: 4, tiny: false })
    expect(oneInN(1 / 18)).toEqual({ n: 20, tiny: false })
    expect(oneInN(1 / 2000)).toEqual({ n: 500, tiny: true })
    expect(oneInN(0)).toBeNull()
  })

  it('example wave sizes come from the config (min, middle, top league)', () => {
    const e = ctx.config.encounters
    expect(exampleWaveSizes(ctx)).toEqual([e.minWaveSize, 6, Math.max(...Object.values(e.leagueMaxWaveSize))])
  })

  it('at least one in a wave: 1 − (1 − p)^n', () => {
    expect(atLeastOne(0.015, 6)).toBeCloseTo(0.0869, 3)
    expect(atLeastOne(0, 6)).toBe(0)
    expect(atLeastOne(1, 3)).toBe(1)
  })
})
