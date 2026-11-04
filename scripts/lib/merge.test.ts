import { describe, expect, it } from 'vitest'
import { deepMerge, mergeGameData, stripNotes, type Json } from './merge.ts'

const species: Json = [
  { slug: 'bulbasaur', id: 1, baseStats: { hp: 45, attack: 49, speed: 45 }, types: ['grass', 'poison'] },
  { slug: 'pikachu', id: 25, baseStats: { hp: 35, attack: 55, speed: 90 }, types: ['electric'] },
]

const types: Json = {
  types: [{ id: 1, slug: 'normal', names: { es: 'Normal', en: 'Normal' } }],
  chart: { normal: { normal: 1, ghost: 0 }, fire: { normal: 1, grass: 2 } },
}

describe('deepMerge', () => {
  it('merges objects field by field and lets the override win', () => {
    const merged = deepMerge({ a: 1, nested: { x: 1, y: 2 } }, { nested: { y: 3, z: 4 } })
    expect(merged).toEqual({ a: 1, nested: { x: 1, y: 3, z: 4 } })
  })

  it('replaces arrays instead of merging them', () => {
    expect(deepMerge({ types: ['grass', 'poison'] }, { types: ['fire'] })).toEqual({ types: ['fire'] })
  })

  it('lets null and scalars replace values', () => {
    expect(deepMerge({ a: { b: 1 }, c: 2 }, { a: null, c: 3 })).toEqual({ a: null, c: 3 })
  })

  it('does not mutate its inputs', () => {
    const base = { nested: { x: 1 } }
    const override = { nested: { y: 2 } }
    deepMerge(base, override)
    expect(base).toEqual({ nested: { x: 1 } })
    expect(override).toEqual({ nested: { y: 2 } })
  })
})

describe('stripNotes', () => {
  it('removes _note keys at every depth', () => {
    const stripped = stripNotes({ _note: 'a', x: { _note: 'b', y: 1 }, list: [{ _note: 'c', z: 2 }] })
    expect(stripped).toEqual({ x: { y: 1 }, list: [{ z: 2 }] })
  })
})

describe('mergeGameData', () => {
  it('copies generated data unchanged when there are no overrides', () => {
    const { output, errors } = mergeGameData({ 'species.json': species }, {})
    expect(errors).toEqual([])
    expect(output['species.json']).toEqual(species)
  })

  it('merges overrides by slug and leaves other records untouched', () => {
    const { output, errors } = mergeGameData(
      { 'species.json': species },
      { 'species.json': { pikachu: { baseStats: { speed: 100 }, captureRate: 120 } } },
    )
    expect(errors).toEqual([])
    const [bulbasaur, pikachu] = output['species.json'] as Record<string, Json>[]
    expect(bulbasaur).toEqual((species as Json[])[0])
    expect(pikachu).toEqual({
      slug: 'pikachu',
      id: 25,
      baseStats: { hp: 35, attack: 55, speed: 100 },
      types: ['electric'],
      captureRate: 120,
    })
  })

  it('replaces arrays from the override (types)', () => {
    const { output } = mergeGameData(
      { 'species.json': species },
      { 'species.json': { bulbasaur: { types: ['grass'] } } },
    )
    expect((output['species.json'] as Record<string, Json>[])[0]?.types).toEqual(['grass'])
  })

  it('strips _note fields from the output', () => {
    const { output, errors } = mergeGameData(
      { 'species.json': species },
      {
        'species.json': {
          pikachu: { _note: 'buffed on purpose', baseStats: { _note: 'speed only', speed: 95 } },
        },
      },
    )
    expect(errors).toEqual([])
    expect(JSON.stringify(output)).not.toContain('_note')
    expect((output['species.json'] as Record<string, Json>[])[1]?.baseStats).toEqual({
      hp: 35,
      attack: 55,
      speed: 95,
    })
  })

  it('reports an error for an override slug that is not in the generated data', () => {
    const { errors } = mergeGameData(
      { 'species.json': species },
      { 'species.json': { missingno: { baseStats: { hp: 1 } } } },
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('missingno')
    expect(errors[0]).toContain('species.json')
  })

  it('reports an error for an override file without a generated counterpart', () => {
    const { errors } = mergeGameData({ 'species.json': species }, { 'extras.json': { a: 1 } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('extras.json')
  })

  it('passes custom-*.json files through as-is, even with unknown slugs and _note', () => {
    const custom: Json = { fakemon: { _note: 'mine', id: 9001 } }
    const { output, errors } = mergeGameData({ 'species.json': species }, { 'custom-species.json': custom })
    expect(errors).toEqual([])
    expect(output['custom-species.json']).toEqual(custom)
    expect(output['species.json']).toEqual(species)
  })

  it('merges an object-rooted file (types.json): chart deep-merged, types keyed by slug', () => {
    const { output, errors } = mergeGameData(
      { 'types.json': types },
      {
        'types.json': {
          chart: { fire: { grass: 1 } },
          types: { normal: { names: { es: 'Norm.' } } },
        },
      },
    )
    expect(errors).toEqual([])
    expect(output['types.json']).toEqual({
      types: [{ id: 1, slug: 'normal', names: { es: 'Norm.', en: 'Normal' } }],
      chart: { normal: { normal: 1, ghost: 0 }, fire: { normal: 1, grass: 1 } },
    })
  })

  it('validates slugs inside object-rooted files too', () => {
    const { errors } = mergeGameData({ 'types.json': types }, { 'types.json': { types: { nope: {} } } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('nope')
  })

  it('collects every error instead of stopping at the first', () => {
    const { errors } = mergeGameData(
      { 'species.json': species },
      { 'species.json': { a: {}, b: {} }, 'ghost.json': {} },
    )
    expect(errors).toHaveLength(3)
  })
})
