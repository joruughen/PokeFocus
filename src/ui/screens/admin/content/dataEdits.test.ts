import { describe, expect, it } from 'vitest'
import { baseContext } from '../../../../engine/context'
import { filterMoves, filterSpecies, moveOverride, parseRaw, rawText, resetSpecies, setMoveField, setRawSection, setSpeciesField, speciesRow } from './dataEdits'

const species = baseContext().data.species
const moves = baseContext().data.moves
const bulbasaur = species.find((s) => s.slug === 'bulbasaur')!
const pikachu = species.find((s) => s.slug === 'pikachu')!

describe('species edits', () => {
  it('a species with no override shows the neutral rule', () => {
    expect(speciesRow({}, bulbasaur)).toEqual({ captureRate: 45, enabled: true, weightMult: 1, minTrainerLevel: 1, weather: [], hours: [], modified: false })
  })

  it('sets and clears each field; neutral values leave no trace', () => {
    let p = setSpeciesField({}, bulbasaur, 'captureRate', 60)
    p = setSpeciesField(p, bulbasaur, 'spawn.enabled', false)
    p = setSpeciesField(p, bulbasaur, 'spawn.weightMult', 2)
    p = setSpeciesField(p, bulbasaur, 'spawn.weather', ['rain'])
    p = setSpeciesField(p, bulbasaur, 'spawn.hours', [[8, 20]])
    expect(p).toEqual({ species: { bulbasaur: { captureRate: 60, spawn: { enabled: false, weightMult: 2, weather: ['rain'], hours: [[8, 20]] } } } })
    expect(speciesRow(p, bulbasaur)).toMatchObject({ captureRate: 60, enabled: false, weightMult: 2, weather: ['rain'], hours: [[8, 20]], modified: true })

    p = setSpeciesField(p, bulbasaur, 'captureRate', 45)
    p = setSpeciesField(p, bulbasaur, 'spawn.enabled', true)
    p = setSpeciesField(p, bulbasaur, 'spawn.weightMult', 1)
    p = setSpeciesField(p, bulbasaur, 'spawn.weather', [])
    p = setSpeciesField(p, bulbasaur, 'spawn.hours', [])
    expect(p).toEqual({})
  })

  it('does not touch other species, and reset removes only one', () => {
    let p = setSpeciesField({}, bulbasaur, 'captureRate', 60)
    p = setSpeciesField(p, pikachu, 'spawn.weightMult', 3)
    expect(resetSpecies(p, 'bulbasaur')).toEqual({ species: { pikachu: { spawn: { weightMult: 3 } } } })
  })

  it('filters by text, type, stage and modified', () => {
    const name = (s: string) => s
    const all = { query: '', type: 'all' as const, stage: 0 as const, onlyModified: false }
    expect(filterSpecies(species, {}, all, name)).toHaveLength(species.length)
    expect(filterSpecies(species, {}, { ...all, query: 'PIKA' }, name).map((s) => s.slug)).toContain('pikachu')
    expect(filterSpecies(species, {}, { ...all, type: 'electric' }, name).every((s) => s.types.includes('electric'))).toBe(true)
    expect(filterSpecies(species, {}, { ...all, stage: 3 }, name).every((s) => s.stage === 3)).toBe(true)
    const p = setSpeciesField({}, pikachu, 'captureRate', 100)
    expect(filterSpecies(species, p, { ...all, onlyModified: true }, name).map((s) => s.slug)).toEqual(['pikachu'])
    expect(filterSpecies(species, {}, { ...all, query: String(pikachu.id) }, name).map((s) => s.slug)).toContain('pikachu')
  })
})

describe('move edits', () => {
  const tackle = moves.find((m) => m.power !== null && m.accuracy !== null)!

  it('sets power and accuracy and removes them when back to the base', () => {
    let p = setMoveField({}, tackle, 'power', tackle.power! + 10)
    p = setMoveField(p, tackle, 'accuracy', 80 === tackle.accuracy ? 70 : 80)
    expect(moveOverride(p, tackle.slug, 'power')).toBe(tackle.power! + 10)
    p = setMoveField(p, tackle, 'power', tackle.power!)
    p = setMoveField(p, tackle, 'accuracy', tackle.accuracy!)
    expect(p).toEqual({})
  })

  it('filters by name', () => {
    expect(filterMoves(moves, {}, tackle.slug.slice(0, 4), false, (s) => s).map((m) => m.slug)).toContain(tackle.slug)
    expect(filterMoves(moves, {}, '', true, (s) => s)).toEqual([])
  })
})

describe('raw sections', () => {
  it('parses objects only', () => {
    expect(parseRaw('')).toEqual({ ok: true, value: {} })
    expect(parseRaw('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseRaw('{nope')).toEqual({ ok: false, reason: 'syntax' })
    expect(parseRaw('[1]')).toEqual({ ok: false, reason: 'object' })
    expect(parseRaw('3')).toEqual({ ok: false, reason: 'object' })
  })

  it('replaces a whole section and an empty object removes it', () => {
    const p = setRawSection({ config: { encounters: { baseWaveSize: 5 } } }, 'missions', { dailyCount: 4 })
    expect(p.missions).toEqual({ dailyCount: 4 })
    expect(p.config).toBeDefined()
    expect(setRawSection(p, 'missions', {}).missions).toBeUndefined()
    expect(rawText({}, 'techniques')).toBe('{}')
    expect(JSON.parse(rawText(p, 'missions'))).toEqual({ dailyCount: 4 })
  })
})
