import { copyTarget, type OwnedPokemon, type PlayerState, type PokemonView } from '../../engine'

/** How a team member is drawn: the species whose sprite to use and whether it is the shiny one. */
export interface Look {
  slug: string
  shiny: boolean
}

/**
 * A Pokémon copying a teammate (Ditto) is drawn as the teammate's species, but the shiny flag stays
 * its OWN: a shiny Ditto shows the shiny sprite of whoever it copies, a normal Ditto never does.
 */
export function lookOf(view: Pick<PokemonView, 'pokemon' | 'copy'>): Look {
  return { slug: view.copy?.speciesSlug ?? view.pokemon.speciesSlug, shiny: view.pokemon.isShiny }
}

/** Same as `lookOf`, from the state (when there is no view at hand). `teamUids`: the team to check against (default: the current one). */
export function lookOfMon(state: Pick<PlayerState, 'pokemon' | 'team'>, p: OwnedPokemon, teamUids: readonly string[] = state.team): Look {
  const target = copyTarget(state, p, undefined, teamUids)
  return { slug: target?.speciesSlug ?? p.speciesSlug, shiny: p.isShiny }
}
