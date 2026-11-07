import { describe, expect, it } from 'vitest'
import en from '../../../i18n/locales/en.json'
import es from '../../../i18n/locales/es.json'
import { computeStats, defaultContext, STAT_KEYS, type BaseStats } from '../../../engine'
import { statBreakdown } from './statBreakdown'

const ctx = defaultContext()
const ivs = (n: number): BaseStats => ({ hp: n, attack: n, defense: n, specialAttack: n, specialDefense: n, speed: n })
const natures = [...ctx.naturesBySlug.keys()]

describe('statBreakdown', () => {
  it('species+level, nature and IV always add up to the number on screen', () => {
    for (const speciesSlug of ['bulbasaur', 'pidgey', 'geodude', 'ivysaur', 'caterpie']) {
      for (const level of [1, 5, 22, 50, 100]) {
        for (const nature of natures) {
          for (const iv of [0, 11, 31]) {
            const p = { speciesSlug, level, ivs: ivs(iv), nature }
            const all = computeStats(p, ctx)
            for (const k of STAT_KEYS) {
              const b = statBreakdown(p, k, ctx)
              expect(b.total).toBe(all[k])
              expect(b.base + b.nature + b.iv).toBe(b.total)
            }
          }
        }
      }
    }
  })

  it('the species part does not depend on the IV or the nature, and grows with the level', () => {
    const at = (level: number, nature: string, iv: number) => statBreakdown({ speciesSlug: 'bulbasaur', level, ivs: ivs(iv), nature }, 'specialAttack', ctx).base
    expect(at(20, 'hardy', 0)).toBe(at(20, 'modest', 31))
    expect(at(40, 'hardy', 0)).toBeGreaterThan(at(20, 'hardy', 0))
  })

  it('the IV part is what the IV adds: 0 with IV 0, never negative, bigger at a higher level', () => {
    const iv = (level: number, v: number) => statBreakdown({ speciesSlug: 'bulbasaur', level, ivs: ivs(v), nature: 'hardy' }, 'hp', ctx).iv
    expect(iv(30, 0)).toBe(0)
    expect(iv(30, 31)).toBeGreaterThan(0)
    expect(iv(60, 31)).toBeGreaterThan(iv(20, 31))
  })

  it('the nature part is positive for the raised stat, negative for the lowered one and zero otherwise (and never for Energy)', () => {
    const modest = ctx.naturesBySlug.get('modest')! // +specialAttack −attack
    const p = { speciesSlug: 'bulbasaur', level: 50, ivs: ivs(15), nature: 'modest' }
    expect(statBreakdown(p, modest.increased!, ctx).nature).toBeGreaterThan(0)
    expect(statBreakdown(p, modest.decreased!, ctx).nature).toBeLessThan(0)
    expect(statBreakdown(p, 'hp', ctx).nature).toBe(0)
    expect(statBreakdown({ ...p, nature: 'hardy' }, 'specialAttack', ctx).nature).toBe(0)
  })
})

describe('internal stat names are not shown to players', () => {
  it('the original Pokémon stat names (PS, Special Attack…) are gone from the stat texts', () => {
    for (const loc of [es, en]) {
      expect((loc.stats as Record<string, unknown>).basedOn).toBeUndefined()
      for (const k of STAT_KEYS) expect((loc.stats[k] as Record<string, unknown>).base).toBeUndefined()
    }
  })
})
