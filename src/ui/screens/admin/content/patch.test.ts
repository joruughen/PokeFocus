import { describe, expect, it } from 'vitest'
import { baseContext } from '../../../../engine/context'
import { CONFIG_LIMITS, CONFIG_LIST_LIMITS, CONFIG_TABLE_LIMITS, EDITABLE_CONFIG_PATHS } from '../../../../game/content/limits'
import {
  baseConfigValue,
  bigChangeFactor,
  changePercent,
  configGroups,
  displayBounds,
  effectiveConfigValue,
  fieldId,
  formatNumber,
  groupOfPath,
  isOverridden,
  overridesByGroup,
  parseNumber,
  pruneEmpty,
  sameJson,
  sectionOfPath,
  setConfigValue,
  setPath,
  toDisplay,
} from './patch'

describe('setPath', () => {
  it('sets a nested value without touching the input', () => {
    const a = { config: { a: { b: 1 } } }
    const b = setPath(a, 'config.a.c', 2)
    expect(b).toEqual({ config: { a: { b: 1, c: 2 } } })
    expect(a).toEqual({ config: { a: { b: 1 } } })
  })

  it('deleting the last leaf prunes the empty parents', () => {
    expect(setPath({ config: { a: { b: 1 } }, moves: { x: { power: 5 } } }, 'config.a.b', undefined)).toEqual({ moves: { x: { power: 5 } } })
  })

  it('keeps siblings when deleting', () => {
    expect(setPath({ config: { a: { b: 1, c: 2 } } }, 'config.a.b', undefined)).toEqual({ config: { a: { c: 2 } } })
  })

  it('pruneEmpty drops empty sections', () => {
    expect(pruneEmpty({ config: {}, species: { pikachu: { captureRate: 5 } } })).toEqual({ species: { pikachu: { captureRate: 5 } } })
  })

  it('sameJson ignores key order', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false)
  })
})

describe('config values against the base', () => {
  const base = baseContext().config

  it('reads the base and the effective value', () => {
    expect(baseConfigValue('encounters.shinyChance')).toBe(base.encounters.shinyChance)
    expect(effectiveConfigValue({}, 'encounters.shinyChance')).toBe(base.encounters.shinyChance)
    expect(effectiveConfigValue({ config: { encounters: { shinyChance: 0.01 } } }, 'encounters.shinyChance')).toBe(0.01)
  })

  it('a value equal to the base removes the override; another one adds it', () => {
    const over = setConfigValue({}, 'encounters.baseWaveSize', base.encounters.baseWaveSize + 1)
    expect(over).toEqual({ config: { encounters: { baseWaveSize: base.encounters.baseWaveSize + 1 } } })
    expect(isOverridden(over, 'encounters.baseWaveSize')).toBe(true)
    const back = setConfigValue(over, 'encounters.baseWaveSize', base.encounters.baseWaveSize)
    expect(back).toEqual({})
    expect(isOverridden(back, 'encounters.baseWaveSize')).toBe(false)
  })

  it('reset (undefined) removes the path; a list or table equal to the base also goes away', () => {
    const list = setConfigValue({}, 'encounters.longSessionLegendaryMult', [1, 2, 3])
    expect(list.config?.encounters?.longSessionLegendaryMult).toEqual([1, 2, 3])
    expect(setConfigValue(list, 'encounters.longSessionLegendaryMult', undefined)).toEqual({})
    const table = base.encounters.wildLevelByTrainerLevel.map((r) => ({ ...r }))
    expect(setConfigValue({}, 'encounters.wildLevelByTrainerLevel', table)).toEqual({})
  })

  it('counts overrides by group', () => {
    let p = setConfigValue({}, 'encounters.baseWaveSize', 6)
    p = setConfigValue(p, 'energy.costBase', 1.5)
    p = setConfigValue(p, 'encounters.minWaveSize', 2)
    const counts = overridesByGroup(p)
    expect(counts.get('encounters')).toBe(2)
    expect(counts.get('energy')).toBe(1)
    expect(counts.get('capture')).toBeUndefined()
  })
})

describe('numbers', () => {
  const prob = CONFIG_LIMITS.find((l) => l.path === 'encounters.shinyChance')!
  const int = CONFIG_LIMITS.find((l) => l.path === 'encounters.baseWaveSize')!

  it('probabilities are edited as percentages', () => {
    expect(toDisplay('prob', 0.025)).toBe(2.5)
    expect(displayBounds(prob)).toEqual({ min: 0, max: 2, step: 0.01 })
    const ok = parseNumber('1.5', prob)
    expect(ok).toEqual({ ok: true, value: 0.015 })
    expect(parseNumber('2.5', prob)).toEqual({ ok: false, problem: 'range' })
    expect(parseNumber('1,5', prob)).toEqual({ ok: true, value: 0.015 })
  })

  it('rejects empty, junk, out of range and non-integers', () => {
    expect(parseNumber('', int)).toEqual({ ok: false, problem: 'empty' })
    expect(parseNumber('abc', int)).toEqual({ ok: false, problem: 'invalid' })
    expect(parseNumber('2.5', int)).toEqual({ ok: false, problem: 'integer' })
    expect(parseNumber('0', int)).toEqual({ ok: false, problem: 'range' })
    expect(parseNumber('9', int)).toEqual({ ok: false, problem: 'range' })
    expect(parseNumber(' 5 ', int)).toEqual({ ok: true, value: 5 })
  })

  it('formats numbers and the change vs the base', () => {
    expect(formatNumber('prob', 0.015, 'en')).toBe('1.5%')
    expect(formatNumber('int', 4, 'en')).toBe('4')
    expect(changePercent(4, 6)).toBe(50)
    expect(changePercent(4, 2)).toBe(-50)
    expect(changePercent(0, 2)).toBeNull()
    expect(changePercent(3, 3)).toBeNull()
  })

  it('the big-change badge follows the server guard: ×3, probabilities ×5, or down to 0', () => {
    expect(bigChangeFactor('mult', 1, 3)).toBeNull()
    expect(bigChangeFactor('mult', 1, 3.1)).toBe(3)
    expect(bigChangeFactor('mult', 3, 0.9)).toBe(3)
    expect(bigChangeFactor('prob', 0.01, 0.04)).toBeNull()
    expect(bigChangeFactor('prob', 0.01, 0.06)).toBe(5)
    expect(bigChangeFactor('int', 4, 0)).toBe(3)
    expect(bigChangeFactor('int', 0, 5)).toBeNull()
  })
})

describe('the generated form', () => {
  it('covers every editable path exactly once', () => {
    const shown = configGroups().flatMap((g) => [...g.scalars, ...g.lists, ...g.tables].map((l) => l.path))
    expect(shown.length).toBe(CONFIG_LIMITS.length + CONFIG_LIST_LIMITS.length + CONFIG_TABLE_LIMITS.length)
    expect(new Set(shown).size).toBe(shown.length)
    expect([...shown].sort()).toEqual([...EDITABLE_CONFIG_PATHS].sort())
  })

  it('every editable path has a base value of the right shape', () => {
    for (const l of CONFIG_LIMITS) expect(typeof baseConfigValue(l.path), l.path).toBe('number')
    for (const l of CONFIG_LIST_LIMITS) expect(Array.isArray(baseConfigValue(l.path)), l.path).toBe(true)
    for (const l of CONFIG_TABLE_LIMITS) expect(Array.isArray(baseConfigValue(l.path)), l.path).toBe(true)
  })

  it('routes paths to their section and group', () => {
    expect(sectionOfPath('config.encounters.shinyChance')).toBe('params')
    expect(sectionOfPath('species.pikachu.spawn.hours.0')).toBe('species')
    expect(sectionOfPath('moves.tackle.power')).toBe('moves')
    expect(sectionOfPath('techniques.calm-mind')).toBe('advanced')
    expect(sectionOfPath('missions.dailyCount')).toBe('advanced')
    expect(sectionOfPath('')).toBe('review')
    expect(groupOfPath('config.energy.costBase')).toBe('energy')
    expect(groupOfPath('config.encounters.wildLevelByTrainerLevel.0.min')).toBe('encounters')
    expect(groupOfPath('species.pikachu')).toBeNull()
    expect(fieldId('config.encounters.shinyChance')).toBe('ce-config-encounters-shinyChance')
  })
})
