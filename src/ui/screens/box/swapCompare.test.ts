import { describe, expect, it } from 'vitest'
import { pokemonView } from '../../../engine'
import { makeMon, makePlayer, T0 } from '../../../engine/test-helpers'
import { differenceCount, numberRows, onlyHere } from './swapCompare'

const a = makeMon('pikachu', 20, { uid: 'a' })
const b = makeMon('squirtle', 12, { uid: 'b' })
const player = makePlayer([a, b], { pokemon: { a, b } })
const va = pokemonView(player, 'a', T0)!
const vb = pokemonView(player, 'b', T0)!

describe('swap comparison model', () => {
  it('rates each number from each side and mirrors the verdicts', () => {
    const rows = numberRows(va, vb)
    const level = rows.find((r) => r.label === 'level')!
    expect(level).toMatchObject({ a: 20, b: 12, va: 'better', vb: 'worse' })
    expect(rows.map((r) => r.label)).toEqual(['level', 'energy', 'speed', 'specialAttack', 'attack', 'specialDefense', 'defense'])
    for (const r of rows) expect([r.va, r.vb]).toEqual(r.va === 'same' ? ['same', 'same'] : r.va === 'better' ? ['better', 'worse'] : ['worse', 'better'])
  })
  it('says same for an identical Pokemon and counts zero differences', () => {
    const twin = makeMon('pikachu', 20, { uid: 'c' })
    const p2 = makePlayer([a, twin], { pokemon: { a, c: twin } })
    const vc = pokemonView(p2, 'c', T0)!
    expect(numberRows(va, vc).every((r) => r.va === 'same')).toBe(true)
    expect(differenceCount(va, vc)).toBe(0)
    expect(differenceCount(va, vb)).toBeGreaterThan(3)
  })
  it('finds what is only on one side', () => {
    expect([...onlyHere(['x', 'y'], ['y', 'z'])]).toEqual(['x'])
  })
})
