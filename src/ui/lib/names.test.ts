import { describe, expect, it } from 'vitest'
import { pokemonFullName, pokemonName } from './names'

describe('pokemon names with nicknames', () => {
  it('shows the nickname when there is one, else the species', () => {
    expect(pokemonName({ speciesSlug: 'pikachu', nickname: 'Monito' }, 'es')).toBe('Monito')
    expect(pokemonName({ speciesSlug: 'pikachu' }, 'es')).toBe('Pikachu')
    expect(pokemonName({ speciesSlug: 'pikachu', nickname: '   ' }, 'en')).toBe('Pikachu')
    expect(pokemonName({ speciesSlug: 'pikachu', nickname: null }, 'en')).toBe('Pikachu')
  })
  it('falls back to a slug when the Pokemon is gone (released)', () => {
    expect(pokemonName(undefined, 'es', 'pikachu')).toBe('Pikachu')
    expect(pokemonName(undefined, 'es')).toBe('')
  })
  it('puts the species in parentheses for tooltips', () => {
    expect(pokemonFullName({ speciesSlug: 'pikachu', nickname: 'Monito' }, 'es')).toBe('Monito (Pikachu)')
    expect(pokemonFullName({ speciesSlug: 'pikachu' }, 'es')).toBe('Pikachu')
  })
})
