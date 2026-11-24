import { describe, expect, it } from 'vitest'
import { pokemonView, type OwnedPokemon, type PlayerState } from '../../engine'
import { makeMon, makePlayer, T0 } from '../../engine/test-helpers'
import { lookOf, lookOfMon } from './look'

function setup(dittoShiny: boolean, targetShiny: boolean): PlayerState {
  const ditto = makeMon('ditto', 30, { uid: 'ditto', isShiny: dittoShiny, copyOfUid: 'char' })
  const char = makeMon('charmander', 30, { uid: 'char', isShiny: targetShiny })
  return makePlayer([char, ditto])
}
const get = (s: PlayerState, uid: string) => s.pokemon[uid] as OwnedPokemon

describe('lookOfMon', () => {
  it('a Pokémon that copies nobody keeps its own look', () => {
    const s = setup(false, true)
    expect(lookOfMon(s, get(s, 'char'))).toEqual({ slug: 'charmander', shiny: true })
  })
  it('a Ditto copying a teammate: their species, the Ditto shiny flag', () => {
    const s = setup(true, false)
    expect(lookOfMon(s, get(s, 'ditto'))).toEqual({ slug: 'charmander', shiny: true })
    const s2 = setup(false, true)
    expect(lookOfMon(s2, get(s2, 'ditto'))).toEqual({ slug: 'charmander', shiny: false })
  })
  it('the copied one left the team: it looks like Ditto again', () => {
    const s = { ...setup(true, false), team: ['ditto'] }
    expect(lookOfMon(s, get(s, 'ditto'))).toEqual({ slug: 'ditto', shiny: true })
  })
})

describe('lookOf', () => {
  it('matches lookOfMon for the same Pokémon', () => {
    const s = setup(true, false)
    const view = pokemonView(s, 'ditto', T0)
    expect(lookOf(view!)).toEqual(lookOfMon(s, get(s, 'ditto')))
    expect(lookOf(pokemonView(s, 'char', T0)!)).toEqual({ slug: 'charmander', shiny: false })
  })
})
