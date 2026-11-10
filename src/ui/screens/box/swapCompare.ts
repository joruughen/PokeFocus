/**
 * Numbers behind the "swap a team member" comparison window (pure: it only
 * reads two engine `PokemonView`s). The incoming Pokémon is column A, the one
 * leaving is column B. `better` is from each side's own point of view.
 */
import type { PokemonView, StatKey } from '../../../engine'
import { STAT_ORDER } from '../../components'

export type Verdict = 'better' | 'worse' | 'same'

export interface NumberRow {
  key: string
  /** Stat key for the label (`stats.<key>.name`), or a special row. */
  label: StatKey | 'level' | 'energy'
  a: number
  b: number
  /** Verdict of side A and side B (mirrored). */
  va: Verdict
  vb: Verdict
}

function verdict(x: number, other: number): Verdict {
  // Compare what the player sees (rounded), so "62 vs 62.4" never shows an arrow for nothing.
  const dx = Math.round(x)
  const dy = Math.round(other)
  return dx === dy ? 'same' : dx > dy ? 'better' : 'worse'
}

/** Level, current Energy and the five working stats (the sixth, Energy max, is the Energy row), higher = better. */
export function numberRows(a: PokemonView, b: PokemonView): NumberRow[] {
  const row = (label: NumberRow['label'], x: number, y: number): NumberRow => ({ key: label, label, a: x, b: y, va: verdict(x, y), vb: verdict(y, x) })
  return [
    row('level', a.pokemon.level, b.pokemon.level),
    row('energy', a.energy, b.energy),
    ...STAT_ORDER.filter((k) => k !== 'hp').map((k) => row(k, a.stats[k], b.stats[k])),
  ]
}

/** Slugs in `mine` that the other side does not have (highlighted as a difference). */
export function onlyHere(mine: readonly string[], other: readonly string[]): Set<string> {
  const o = new Set(other)
  return new Set(mine.filter((s) => !o.has(s)))
}

/** Number of rows (numbers, types, role, ability, techniques) that differ: a quick "nothing changes" check for tests and copy. */
export function differenceCount(a: PokemonView, b: PokemonView): number {
  const n = numberRows(a, b).filter((r) => r.va !== 'same').length
  const sameSet = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((s) => y.includes(s))
  return (
    n +
    (sameSet(a.types, b.types) ? 0 : 1) +
    (a.species.role === b.species.role ? 0 : 1) +
    ((a.pokemon.ability ?? '') === (b.pokemon.ability ?? '') ? 0 : 1) +
    (sameSet(a.pokemon.equippedMoves, b.pokemon.equippedMoves) ? 0 : 1)
  )
}
