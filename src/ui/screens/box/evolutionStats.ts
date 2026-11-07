import { computeStats, defaultContext, type BaseStats, type EngineContext, type IndividualCore, type StatKey } from '../../../engine'
import { STAT_ORDER } from '../../components/StatRow'

export interface StatChange {
  stat: StatKey
  from: number
  to: number
  delta: number
}

export interface EvolutionStatChange {
  level: number
  /** One entry per stat, in the display order of the detail sheet. */
  changes: StatChange[]
  /** The stat that gains most (first in display order on a tie); `null` when nothing grows. */
  best: StatKey | null
}

/**
 * What the six stats would be if `pokemon` were already `toSlug`. Evolving only
 * swaps the species (`evolvePokemon` keeps level, IVs, nature, EXP and bond),
 * so this is `computeStats` on the same individual with the new species. It
 * never calls `evolvePokemon`: nothing is changed or saved.
 */
export function statChangeOnEvolution(pokemon: Pick<IndividualCore, 'speciesSlug' | 'level' | 'ivs' | 'nature'>, toSlug: string, ctx: EngineContext = defaultContext()): EvolutionStatChange {
  const now: BaseStats = computeStats(pokemon, ctx)
  const then: BaseStats = computeStats({ ...pokemon, speciesSlug: toSlug }, ctx)
  const changes = STAT_ORDER.map((stat) => ({ stat, from: now[stat], to: then[stat], delta: then[stat] - now[stat] }))
  let best: StatChange | null = null
  for (const c of changes) if (c.delta > 0 && (!best || c.delta > best.delta)) best = c
  return { level: pokemon.level, changes, best: best ? best.stat : null }
}
