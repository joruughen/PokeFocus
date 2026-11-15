import { describe, expect, it } from 'vitest'
import { makeMon, makePlayer } from '../../../engine/test-helpers'
import { HIGH_LEVEL_RELEASE, releaseSummary } from './releaseSummary'

const mons = [
  makeMon('pidgey', 5, { uid: 't' }),
  makeMon('charmander', 5, { uid: 'a' }),
  makeMon('charmeleon', 20, { uid: 'b', nickname: 'Fuego' }),
  makeMon('squirtle', HIGH_LEVEL_RELEASE, { uid: 'c', isShiny: true }),
  makeMon('mewtwo', 10, { uid: 'd' }),
]
const player = { ...makePlayer([mons[0]!]), pokemon: Object.fromEntries(mons.map((m) => [m.uid, m])), teamPresets: [{ id: 't1', name: 'X', uids: ['a', 't'] }] }

describe('releaseSummary', () => {
  it('adds candies per line, most first, with the root species', () => {
    const s = releaseSummary(player, ['a', 'b', 'c'])
    expect(s.count).toBe(3)
    expect(s.totalCandies).toBe(4)
    expect(s.chains).toHaveLength(2)
    expect(s.chains[0]).toMatchObject({ rootSlug: 'charmander', count: 2, candies: 3 })
    expect(s.chains[1]).toMatchObject({ rootSlug: 'squirtle', count: 1, candies: 1 })
  })
  it('flags shiny, legendary, preset, nickname and high level Pokémon', () => {
    const s = releaseSummary(player, ['a', 'b', 'c', 'd'])
    expect(s.warnings.map((w) => w.kind)).toEqual(['shiny', 'legendary', 'preset', 'nickname', 'highLevel'])
    expect(s.warnings.find((w) => w.kind === 'preset')?.uids).toEqual(['a'])
    expect(s.warnings.find((w) => w.kind === 'highLevel')?.uids).toEqual(['c'])
  })
  it('has no warnings for a plain selection', () => {
    expect(releaseSummary(player, ['d', 'b']).warnings.map((w) => w.kind)).toEqual(['legendary', 'nickname'])
    const clean = { ...player, teamPresets: [] }
    expect(releaseSummary(clean, ['a']).warnings).toEqual([])
  })
  it('separates team members and unknown uids as blocked, and ignores repeats', () => {
    const s = releaseSummary(player, ['t', 'zz', 'a', 'a'])
    expect(s.uids).toEqual(['a'])
    expect(s.blocked).toEqual(['t', 'zz'])
    expect(s.totalCandies).toBe(1)
  })
})
