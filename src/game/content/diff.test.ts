import { describe, expect, it } from 'vitest'
import { baseContext } from '../../engine/context'
import { diffPatches, flattenPatch } from './diff'
import { spawnPreview } from './preview'

describe('diffPatches', () => {
  it('flattens objects to leaves; arrays and technique/ability definitions are leaves', () => {
    const m = flattenPatch({ config: { a: { b: 1 }, list: [1, 2] }, techniques: { x: { kind: 'y', n: 1 } } })
    expect([...m.keys()].sort()).toEqual(['config.a.b', 'config.list', 'techniques.x'])
  })

  it('reports added / changed / removed with the base value when known, ignoring key order', () => {
    const base = baseContext()
    const d = diffPatches(
      { config: { encounters: { shinyChance: 0.003 }, rewards: { dustPerMinute: 6 } }, moves: { tackle: { power: 40 } } },
      { moves: { tackle: { power: 45 } }, config: { encounters: { shinyChance: 0.003 } }, species: { pidgey: { captureRate: 100 } } },
    )
    expect(d).toEqual([
      { path: 'config.rewards.dustPerMinute', kind: 'removed', before: 6, after: base.config.rewards.dustPerMinute },
      { path: 'moves.tackle.power', kind: 'changed', before: 40, after: 45 },
      { path: 'species.pidgey.captureRate', kind: 'added', before: base.speciesBySlug.get('pidgey')!.captureRate, after: 100 },
    ])
    expect(diffPatches({}, {})).toEqual([])
  })
})

describe('spawnPreview', () => {
  it('base content: probabilities add up to 1 and rules are empty', () => {
    const p = spawnPreview(baseContext(), { hour: 12, weather: 'clear', trainerLevel: 1 })
    expect(p.species.reduce((n, s) => n + s.probability, 0)).toBeCloseTo(1, 6)
    expect(p.rules).toEqual([])
    expect(p.wildLevel.min).toBeLessThanOrEqual(p.wildLevel.max)
  })
})
