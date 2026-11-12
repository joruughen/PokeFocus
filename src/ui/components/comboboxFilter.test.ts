import { describe, expect, it } from 'vitest'
import { exactOption, filterOptions, normalizeSearch, type Searchable } from './comboboxFilter'

const species: Searchable[] = [
  { value: 'bulbasaur', label: 'Bulbasaur', code: 1, keywords: ['bulbasaur'] },
  { value: 'pikachu', label: 'Pikachu', code: 25, keywords: ['pikachu'] },
  { value: 'raichu', label: 'Raichu', code: 26, keywords: ['raichu'] },
  { value: 'sandslash', label: 'Sandslash', code: 28, keywords: ['Sandslash'] },
  { value: 'nidoran-f', label: 'Nidoran♀', code: 29, keywords: ['Nidoran F'] },
  { value: 'mr-mime', label: 'Mr. Mime', code: 122, keywords: ['Sr. Mime'] },
  { value: 'pichu', label: 'Pichu', code: 172 },
  { value: 'snorlax', label: 'Snorlax', code: 143, keywords: ['Snorlax'] },
  { value: 'deoxys', label: 'Deoxys', code: 250 },
  { value: 'ho-oh', label: 'Ho-Oh', code: 250 },
]
const values = (xs: Searchable[]) => xs.map((x) => x.value)

describe('normalizeSearch', () => {
  it('drops accents and case and tidies spaces', () => {
    expect(normalizeSearch('  PoCIÓN   Súper ')).toBe('pocion super')
    expect(normalizeSearch('Flabébé')).toBe('flabebe')
  })
})

describe('filterOptions', () => {
  it('keeps every option in order with an empty query', () => {
    expect(values(filterOptions(species, ''))).toEqual(values(species))
    expect(values(filterOptions(species, '   '))).toEqual(values(species))
  })

  it('ignores accents and capitals in both the text and the options', () => {
    const items: Searchable[] = [
      { value: 'potion', label: 'Poción' },
      { value: 'ether', label: 'Éter' },
    ]
    expect(values(filterOptions(items, 'pocion'))).toEqual(['potion'])
    expect(values(filterOptions(items, 'POCIÓN'))).toEqual(['potion'])
    expect(values(filterOptions(items, 'eter'))).toEqual(['ether'])
  })

  it('lists names that start with the text, then the rest in the original order', () => {
    expect(values(filterOptions(species, 'pi'))).toEqual(['pikachu', 'pichu'])
    expect(values(filterOptions(species, 'ch'))).toEqual(['pikachu', 'raichu', 'pichu'])
  })

  it('ranks a prefix above a word start above a contains', () => {
    const items: Searchable[] = [
      { value: 'a', label: 'Super Potion' },
      { value: 'b', label: 'Potion' },
      { value: 'c', label: 'Hyper Potions' },
      { value: 'd', label: 'Repotion' },
    ]
    expect(values(filterOptions(items, 'pot'))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('puts an exact match first', () => {
    const items: Searchable[] = [
      { value: 'potion-x', label: 'Potion X' },
      { value: 'potion', label: 'Potion' },
    ]
    expect(values(filterOptions(items, 'potion'))).toEqual(['potion', 'potion-x'])
  })

  it('finds by slug and by the other language', () => {
    expect(values(filterOptions(species, 'mr-mi'))).toEqual(['mr-mime'])
    expect(values(filterOptions(species, 'sr mime'))).toEqual(['mr-mime'])
    expect(values(filterOptions(species, 'nidoran f'))).toEqual(['nidoran-f'])
  })

  it('finds by number: exact first, then numbers that start with it, never numbers that merely contain it', () => {
    expect(values(filterOptions(species, '25'))).toEqual(['pikachu', 'deoxys', 'ho-oh'])
    expect(values(filterOptions(species, '#25'))).toEqual(['pikachu', 'deoxys', 'ho-oh'])
    expect(values(filterOptions(species, '025'))).toEqual(['pikachu', 'deoxys', 'ho-oh'])
    // 1 is exact for Bulbasaur; 122, 143 and 172 start with it (in the original order).
    expect(values(filterOptions(species, '1'))).toEqual(['bulbasaur', 'mr-mime', 'pichu', 'snorlax'])
    // 5 is in 250 and 25 but starts none.
    expect(values(filterOptions(species, '5'))).toEqual([])
  })

  it('needs every word, in any order', () => {
    const items: Searchable[] = [
      { value: 'a', label: 'Hyper Potion' },
      { value: 'b', label: 'Max Potion' },
      { value: 'c', label: 'Max Revive' },
    ]
    expect(values(filterOptions(items, 'potion max'))).toEqual(['b'])
    expect(values(filterOptions(items, 'max'))).toEqual(['b', 'c'])
    expect(filterOptions(items, 'zzz')).toEqual([])
  })

  it('does not mutate the options', () => {
    const copy = [...species]
    filterOptions(species, 'pi')
    expect(species).toEqual(copy)
  })
})

describe('exactOption', () => {
  it('matches the value or the label, ignoring case and accents', () => {
    expect(exactOption(species, 'PIKACHU')?.value).toBe('pikachu')
    expect(exactOption(species, 'Mr. Mime')?.value).toBe('mr-mime')
    expect(exactOption(species, 'mr-mime')?.value).toBe('mr-mime')
    expect(exactOption(species, 'pika')).toBeUndefined()
    expect(exactOption(species, '')).toBeUndefined()
  })
})
