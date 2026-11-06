import { describe, expect, it } from 'vitest'
import { conditionEnvAt, defaultContext, type OwnedPokemon, type PlayerState } from '../../../engine'
import { makeMon, makePlayer, MIN, T0 } from '../../../engine/test-helpers'
import { WEATHER_PRESETS } from '../../lib/conditions'
import { boxCandidates, boxSize, pickFiltersActive, pickRows, sortPickRows, swapInTeam } from './pickFromBox'

const cfg = defaultContext().config
const AT = T0

/** Team: pikachu. Box: charmander L10 (Fire), bulbasaur L20 (Grass), squirtle L5, pidgey L30 asleep, machop L40 exhausted, metapod L8 (Bug). */
function setup(): { player: PlayerState; rows: ReturnType<typeof pickRows> } {
  const mon = (slug: string, level: number, uid: string, patch: Partial<OwnedPokemon> = {}) => makeMon(slug, level, { uid, caughtAt: T0 - level * MIN, ...patch })
  const all = [
    mon('pikachu', 15, 'team1'),
    mon('charmander', 10, 'fire'),
    mon('bulbasaur', 20, 'grass'),
    mon('squirtle', 5, 'water'),
    mon('pidgey', 30, 'sleepy', { asleepNextSession: true, asleepSetAt: T0 - 10 * MIN }),
    mon('machop', 40, 'empty', { energy: { current: 0, updatedAt: T0 } }),
    mon('metapod', 8, 'bug'),
  ]
  const player = makePlayer([all[0]!], { pokemon: Object.fromEntries(all.map((p) => [p.uid, p])) })
  const env = conditionEnvAt(player, AT, 25, { weather: WEATHER_PRESETS.sun })
  return { player, rows: pickRows(player, all.slice(1), AT, env) }
}

const uids = (rows: { mon: OwnedPokemon }[]) => rows.map((r) => r.mon.uid)

describe('pickRows', () => {
  it('gives the condition multiplier and its type from one shared env', () => {
    const { rows } = setup()
    const by = Object.fromEntries(rows.map((r) => [r.mon.uid, r]))
    expect(by.fire!.condType).toBe('fire')
    expect(by.fire!.mult).toBeCloseTo(cfg.conditions.fire)
    expect(by.grass!.condType).toBe('grass')
    expect(by.water!.condType).toBeNull()
    expect(by.water!.mult).toBe(1)
  })

  it('a Box Bug counts itself in the Bug condition', () => {
    const { rows } = setup()
    const bug = rows.find((r) => r.mon.uid === 'bug')!
    expect(bug.condType).toBe('bug')
    expect(bug.mult).toBeCloseTo(1 + cfg.conditions.bugPerBug)
  })

  it('marks asleep and exhausted Pokémon', () => {
    const { rows } = setup()
    const by = Object.fromEntries(rows.map((r) => [r.mon.uid, r.state]))
    expect(by).toMatchObject({ sleepy: 'asleep', empty: 'exhausted', fire: 'ready', grass: 'ready' })
  })
})

describe('sortPickRows', () => {
  it('"now": best multiplier first, then level; unavailable ones last', () => {
    const { rows } = setup()
    const order = uids(sortPickRows(rows, 'now'))
    expect(order.slice(-2).sort()).toEqual(['empty', 'sleepy'])
    const ready = order.slice(0, -2)
    const mults = Object.fromEntries(rows.map((r) => [r.mon.uid, r.mult]))
    for (let i = 1; i < ready.length; i++) expect(mults[ready[i - 1]!]!).toBeGreaterThanOrEqual(mults[ready[i]!]!)
    // water has no boost, so it is after every boosted one
    expect(ready.indexOf('water')).toBe(ready.length - 1)
  })

  it('"level": highest level first, but asleep/exhausted still go after', () => {
    const { rows } = setup()
    expect(uids(sortPickRows(rows, 'level'))).toEqual(['grass', 'fire', 'bug', 'water', 'empty', 'sleepy'])
  })

  it('"energy": most Energy first', () => {
    const { rows } = setup()
    const sorted = sortPickRows(rows, 'energy')
    const ready = sorted.filter((r) => r.state === 'ready')
    for (let i = 1; i < ready.length; i++) expect(ready[i - 1]!.energy).toBeGreaterThanOrEqual(ready[i]!.energy)
    expect(sorted.at(-1)!.state).not.toBe('ready')
  })

  it('"recent": latest catch first', () => {
    const { rows } = setup()
    // caughtAt = T0 - level minutes, so a lower level is a more recent catch
    expect(uids(sortPickRows(rows, 'recent')).slice(0, 4)).toEqual(['water', 'bug', 'fire', 'grass'])
  })

  it('does not mutate its input and does not depend on the input order', () => {
    const { rows } = setup()
    const before = uids(rows)
    const a = uids(sortPickRows(rows, 'now'))
    expect(uids(rows)).toEqual(before)
    expect(uids(sortPickRows([...rows].reverse(), 'now'))).toEqual(a)
  })
})

describe('boxCandidates', () => {
  it('only Box members, filtered by name and type', () => {
    const { player } = setup()
    expect(boxSize(player)).toBe(6)
    const all = boxCandidates(player, { query: '', type: 'any' }, 'es')
    expect(all).toHaveLength(6)
    expect(all.map((p) => p.uid)).not.toContain('team1')
    expect(boxCandidates(player, { query: 'char', type: 'any' }, 'es').map((p) => p.uid)).toEqual(['fire'])
    expect(boxCandidates(player, { query: '', type: 'bug' }, 'es').map((p) => p.uid)).toEqual(['bug'])
    expect(boxCandidates(player, { query: 'zzz', type: 'any' }, 'es')).toEqual([])
  })
})

describe('helpers', () => {
  it('pickFiltersActive ignores a blank search and the default type', () => {
    expect(pickFiltersActive({ query: '  ', type: 'any' })).toBe(false)
    expect(pickFiltersActive({ query: 'a', type: 'any' })).toBe(true)
    expect(pickFiltersActive({ query: '', type: 'fire' })).toBe(true)
  })

  it('swapInTeam replaces at the same position, in one new array', () => {
    const team = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(swapInTeam(team, 'c', 'x')).toEqual(['a', 'b', 'x', 'd', 'e', 'f'])
    expect(team).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(swapInTeam(team, 'a', 'x')![0]).toBe('x')
    expect(swapInTeam(team, 'z', 'x')).toBeNull()
    expect(swapInTeam(team, 'a', 'b')).toBeNull()
  })
})
