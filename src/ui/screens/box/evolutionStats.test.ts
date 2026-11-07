import { describe, expect, it } from 'vitest'
import { computeStats, defaultContext, effectiveBase, getSpecies, natureMultiplier, statValue, type BaseStats } from '../../../engine'
import { makeMon } from '../../../engine/test-helpers'
import { statChangeOnEvolution } from './evolutionStats'

const ctx = defaultContext()
const IVS: BaseStats = { hp: 3, attack: 31, defense: 0, specialAttack: 17, specialDefense: 9, speed: 24 }

describe('statChangeOnEvolution', () => {
  const mon = makeMon('pidgey', 18, { ivs: IVS, nature: 'jolly' })
  const r = statChangeOnEvolution(mon, 'pidgeotto')

  it('Pidgey -> Pidgeotto at level 18: now = computeStats(Pidgey), new = computeStats(Pidgeotto) with the same level, IVs and nature', () => {
    const now = computeStats(mon, ctx)
    const then = computeStats({ ...mon, speciesSlug: 'pidgeotto' }, ctx)
    expect(r.level).toBe(18)
    expect(r.changes.map((c) => c.stat)).toEqual(['hp', 'speed', 'specialAttack', 'attack', 'specialDefense', 'defense'])
    for (const c of r.changes) expect({ from: c.from, to: c.to, delta: c.delta }).toEqual({ from: now[c.stat], to: then[c.stat], delta: then[c.stat] - now[c.stat] })
  })

  it('every stat of a normal evolution goes up, never down', () => {
    for (const [from, to] of [['pidgey', 'pidgeotto'], ['pidgeotto', 'pidgeot'], ['charmander', 'charmeleon'], ['charmeleon', 'charizard'], ['bulbasaur', 'ivysaur']] as const) {
      for (const level of [5, 18, 36, 50]) {
        const out = statChangeOnEvolution(makeMon(from, level, { ivs: IVS, nature: 'jolly' }), to)
        for (const c of out.changes) expect(c.delta, `${from}->${to} L${level} ${c.stat}`).toBeGreaterThanOrEqual(0)
        expect(out.changes.some((c) => c.delta > 0)).toBe(true)
      }
    }
  })

  it('HP uses its own formula (+level +10, no nature) and the others use the nature multiplier', () => {
    const to = getSpecies('pidgeotto', ctx)
    const hp = r.changes.find((c) => c.stat === 'hp')!
    expect(hp.to).toBe(Math.floor(((2 * effectiveBase('hp', to.baseStats.hp, ctx.config) + IVS.hp) * 18) / 100) + 18 + 10)
    expect(hp.to).toBe(statValue('hp', effectiveBase('hp', to.baseStats.hp, ctx.config), IVS.hp, 18, 1))
    // Jolly: +Pace (speed), -Output (specialAttack). Pace = floor((core + 5) * 1.1), Output = floor((core + 5) * 0.9).
    const nature = ctx.naturesBySlug.get('jolly')!
    expect(natureMultiplier(nature, 'speed')).toBe(1.1)
    const speed = r.changes.find((c) => c.stat === 'speed')!
    const core = Math.floor(((2 * effectiveBase('speed', to.baseStats.speed, ctx.config) + IVS.speed) * 18) / 100)
    expect(speed.to).toBe(Math.floor((core + 5) * 1.1))
    expect(nature.decreased).toBe('specialAttack')
    const out = r.changes.find((c) => c.stat === 'specialAttack')!
    const coreO = Math.floor(((2 * effectiveBase('specialAttack', to.baseStats.specialAttack, ctx.config) + IVS.specialAttack) * 18) / 100)
    expect(out.to).toBe(Math.floor((coreO + 5) * 0.9))
  })

  it('highlights the stat with the biggest gain and does not touch the Pokémon', () => {
    const top = Math.max(...r.changes.map((c) => c.delta))
    expect(top).toBeGreaterThan(0)
    expect(r.changes.find((c) => c.stat === r.best)!.delta).toBe(top)
    expect(r.changes.filter((c) => c.delta === top)[0]!.stat).toBe(r.best) // first one on a tie
    expect(mon.speciesSlug).toBe('pidgey')
    expect(mon.ivs).toEqual(IVS)
    expect(mon.nature).toBe('jolly')
  })

  it('a different nature or IVs change the new stats (they are carried over, not reset)', () => {
    const hardy = statChangeOnEvolution({ ...mon, nature: 'hardy' }, 'pidgeotto')
    expect(hardy.changes.find((c) => c.stat === 'speed')!.to).toBeLessThan(r.changes.find((c) => c.stat === 'speed')!.to)
    const perfect = statChangeOnEvolution({ ...mon, ivs: { hp: 31, attack: 31, defense: 31, specialAttack: 31, specialDefense: 31, speed: 31 } }, 'pidgeotto')
    expect(perfect.changes.find((c) => c.stat === 'defense')!.to).toBeGreaterThanOrEqual(r.changes.find((c) => c.stat === 'defense')!.to)
  })

  it('reports a drop as a negative delta (Caterpie -> Metapod lowers Pace) and never highlights it', () => {
    const out = statChangeOnEvolution(makeMon('caterpie', 30), 'metapod')
    const speed = out.changes.find((c) => c.stat === 'speed')!
    expect(speed.delta).toBeLessThan(0)
    expect(speed.delta).toBe(speed.to - speed.from)
    expect(out.best).not.toBe('speed')
    expect(out.changes.find((c) => c.stat === out.best)!.delta).toBeGreaterThan(0)
  })

  it('best is null when nothing grows', () => {
    expect(statChangeOnEvolution(mon, 'pidgey').best).toBeNull()
  })
})
