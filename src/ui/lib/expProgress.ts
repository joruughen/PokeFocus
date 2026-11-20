import type { PokemonView } from '../../engine'

export interface ExpProgress {
  /** Bar fill, always inside [0, max]. */
  value: number
  max: number
  /** Nothing left to fill: level cap (EXP keeps piling up) or max level. The bar shows full. */
  full: boolean
  /** EXP still missing for the next level, never negative. */
  remaining: number
}

/**
 * EXP bar numbers for a Pokémon sheet. The engine's `expIntoLevel` can fall outside [0, expForNextLevel]:
 * at the level cap EXP keeps accumulating (it exceeds the next threshold) and at the max level it sits on
 * the last threshold (0 into a level that does not exist), which used to draw an empty bar and a negative "to go".
 */
export function expProgress(view: PokemonView, maxLevel: number): ExpProgress {
  const max = Math.max(1, view.expForNextLevel)
  const full = view.pokemon.level >= maxLevel || view.expIntoLevel >= view.expForNextLevel
  const value = full ? max : Math.max(0, Math.min(max, view.expIntoLevel))
  return { value, max, full, remaining: Math.max(0, view.expForNextLevel - value) }
}
