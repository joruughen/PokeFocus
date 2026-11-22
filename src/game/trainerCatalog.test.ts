/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import {
  countByGroup,
  countBySub,
  filterTrainers,
  isTrainerSprite,
  normalizeSearch,
  randomTrainer,
  resolveTrainerSprite,
  TRAINER_AUTHORS,
  TRAINER_CATALOG,
  TRAINER_GENS,
  TRAINER_GROUPS,
  trainerEntry,
} from './trainerCatalog'
import { defaultTrainerSprite, TRAINER_CORE } from './trainers'

// Lazy glob: only the file names are needed (the PNG sizes are checked in scripts/trainers.test.ts).
const files = new Set(Object.keys(import.meta.glob('../../public/sprites/trainers/*.png', { query: '?url' })).map((f) => f.replace(/^.*\//, '').replace(/\.png$/, '')))
const label = (slug: string) => trainerEntry(slug)?.label

describe('catalogue', () => {
  it('has all of Showdown\'s trainer sprites, once each, with plain slugs', () => {
    expect(TRAINER_CATALOG.length).toBeGreaterThanOrEqual(1500)
    expect(new Set(TRAINER_CATALOG.map((e) => e.slug)).size).toBe(TRAINER_CATALOG.length)
    for (const e of TRAINER_CATALOG) expect(e.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/)
  })

  it('every sprite has its PNG, and every PNG is in the catalogue (npm run download:trainers)', () => {
    for (const e of TRAINER_CATALOG) expect(files.has(e.slug), e.slug).toBe(true)
    expect(files.size).toBe(TRAINER_CATALOG.length)
  })

  it('starts with the featured 24, in core order, and every sprite is in exactly one group', () => {
    expect(TRAINER_CATALOG.slice(0, 24).map((e) => e.slug)).toEqual([...TRAINER_CORE])
    expect(TRAINER_CATALOG.slice(0, 24).every((e) => e.group === 'featured')).toBe(true)
    const by = Object.fromEntries(TRAINER_GROUPS.map((g) => [g, TRAINER_CATALOG.filter((e) => e.group === g).length]))
    expect(Object.values(by).reduce((a, b) => a + b, 0)).toBe(TRAINER_CATALOG.length)
    expect(by.featured).toBe(24)
    for (const g of TRAINER_GROUPS) expect(by[g], g).toBeGreaterThan(0)
  })

  it('groups: older games by generation, fan art by author', () => {
    expect(TRAINER_GENS).toEqual(['gen1', 'gen2', 'gen3', 'gen4', 'gen5'])
    expect(trainerEntry('acetrainer-gen3rs')).toMatchObject({ group: 'older', sub: 'gen3', credit: '' })
    expect(trainerEntry('aarune')).toMatchObject({ group: 'fan', sub: 'kyledove', credit: 'kyledove' })
    expect(trainerEntry('aaron')).toMatchObject({ group: 'classic', sub: '' })
    expect(TRAINER_AUTHORS[0]).toMatchObject({ author: 'kyledove' })
    expect(TRAINER_AUTHORS.reduce((n, a) => n + a.count, 0)).toBe(TRAINER_CATALOG.filter((e) => e.group === 'fan').length)
  })
})

describe('names', () => {
  it('turns slugs into readable names', () => {
    expect(label('acetrainer')).toBe('Ace Trainer')
    expect(label('bugcatcher')).toBe('Bug Catcher')
    expect(label('acetrainerf')).toBe('Ace Trainer (F)')
    expect(label('swimmerm-gen3')).toBe('Swimmer (M) (Gen 3)')
    expect(label('acetrainer-gen3rs')).toBe('Ace Trainer (Gen 3 RS)')
    expect(label('blue-gen1champion')).toBe('Blue (Gen 1 Champion)')
    expect(label('pokemonbreederf-gen3frlg')).toBe('Pokémon Breeder (F) (Gen 3 FRLG)')
    expect(label('blue-gen1rbtwo')).toBe('Blue (Gen 1 RB Two)')
    expect(label('ash-alola')).toBe('Ash Alola')
    expect(label('acerola-masters2')).toBe('Acerola Masters 2')
    expect(label('lass')).toBe('Lass')
    expect(label('ltsurge')).toBe('Lt. Surge')
  })

  it('never leaves an empty name', () => {
    for (const e of TRAINER_CATALOG) expect(e.label.trim().length, e.slug).toBeGreaterThan(0)
  })
})

describe('search', () => {
  it('ignores case, accents, spaces and hyphens', () => {
    expect(normalizeSearch('Poké Fan')).toBe('pokefan')
    expect(filterTrainers({ group: 'all', query: 'bug catcher' }).map((e) => e.slug)).toContain('bugcatcher')
    expect(filterTrainers({ group: 'all', query: 'BUG-CATCHER' }).map((e) => e.slug)).toContain('bugcatcher')
    expect(filterTrainers({ group: 'all', query: 'poke fan' }).map((e) => e.slug)).toContain('pokefan')
  })

  it('every word must match: name, slug or author', () => {
    const r = filterTrainers({ group: 'all', query: 'ace trainer gen3' }).map((e) => e.slug)
    expect(r).toContain('acetrainer-gen3')
    expect(r).not.toContain('acetrainer')
    expect(filterTrainers({ group: 'all', query: 'kyledove' }).every((e) => e.credit === 'kyledove')).toBe(true)
    expect(filterTrainers({ group: 'all', query: 'zzzzzz' })).toEqual([])
  })

  it('can also match the translated name of the featured ones', () => {
    const localName = (slug: string) => (slug === 'blackbelt' ? 'Cinturón negro' : undefined)
    expect(filterTrainers({ group: 'all', query: 'cinturon negro', localName }).map((e) => e.slug)).toEqual(['blackbelt'])
    expect(filterTrainers({ group: 'all', query: 'cinturon negro' })).toEqual([])
  })

  it('filters by group and sub-filter, and counts per group', () => {
    const fan = filterTrainers({ group: 'fan', sub: 'Horo' })
    expect(fan.length).toBe(TRAINER_AUTHORS.find((a) => a.author === 'Horo')!.count)
    expect(fan.every((e) => e.group === 'fan' && e.sub === 'Horo')).toBe(true)
    expect(filterTrainers({ group: 'older', sub: 'gen5' }).every((e) => e.sub === 'gen5')).toBe(true)
    const c = countByGroup('')
    expect(c.all).toBe(TRAINER_CATALOG.length)
    expect(c.featured + c.classic + c.older + c.fan).toBe(c.all)
    const q = countByGroup('lass')
    expect(q.all).toBe(filterTrainers({ group: 'all', query: 'lass' }).length)
    expect(q.featured + q.classic + q.older + q.fan).toBe(q.all)
    const gens = countBySub('older', '')
    expect([...gens.values()].reduce((a, b) => a + b, 0)).toBe(c.older)
  })

  it('«Surprise me» picks from the list, never the current one', () => {
    const list = filterTrainers({ group: 'featured' })
    for (let i = 0; i < 50; i++) expect(randomTrainer(list, 'hilbert')!.slug).not.toBe('hilbert')
    expect(randomTrainer(list, 'hilbert', () => 0)!.slug).toBe('hilda')
    expect(randomTrainer([], undefined)).toBeNull()
    expect(randomTrainer(list.slice(0, 1), 'hilbert')).toBeNull()
  })
})

describe('allowed slugs', () => {
  it('accepts any catalogue sprite and nothing else', () => {
    expect(isTrainerSprite('hilbert')).toBe(true)
    expect(isTrainerSprite('aarune')).toBe(true)
    expect(isTrainerSprite('acetrainer-gen3rs')).toBe(true)
    for (const bad of ['Hilbert', '../etc/passwd', '', null, undefined, 7, 'nope']) expect(isTrainerSprite(bad)).toBe(false)
  })

  it('resolves the saved choice, falling back to the default (also for a sprite that left the catalogue)', () => {
    expect(resolveTrainerSprite('u-1', 'aarune')).toBe('aarune')
    expect(resolveTrainerSprite('u-1', null)).toBe(defaultTrainerSprite('u-1'))
    expect(resolveTrainerSprite('u-1', undefined)).toBe(defaultTrainerSprite('u-1'))
    expect(resolveTrainerSprite('u-1', 'removed-slug')).toBe(defaultTrainerSprite('u-1'))
  })
})
