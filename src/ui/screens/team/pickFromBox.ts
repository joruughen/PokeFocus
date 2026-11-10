/**
 * "Add from the Box" on the Team screen: filter, condition multiplier and sort.
 * Filtering reuses the Box's `filteredMons` (search + type, only Box members);
 * numbers come from the engine (`energyAt`, `isAsleepAt`, `pokemonConditionMult`).
 * The state (search, type, sort) is its own store so it never fights the Box
 * screen's filters; it is kept while you leave and come back, not persisted.
 */
import { create } from 'zustand'
import {
  conditionTypes,
  defaultContext,
  energyAt,
  isAsleepAt,
  maxEnergyOf,
  pokemonConditionMult,
  type ConditionEnv,
  type LocaleCode,
  type OwnedPokemon,
  type PlayerState,
  type SpeciesRole,
  type TypeSlug,
} from '../../../engine'
import { filteredMons } from '../box/filters'

/** `now` = best condition multiplier if it studied now; the others are plain fields. */
export type PickSort = 'now' | 'level' | 'energy' | 'recent'
/** `exhausted` = 0 Energy, `asleep` = Rest sleep still on. Both can be added but never act. */
export type PickState = 'ready' | 'exhausted' | 'asleep'

export interface PickFilters {
  query: string
  type: TypeSlug | 'any'
  sort: PickSort
}

export interface PickFiltersStore extends PickFilters {
  set: (patch: Partial<PickFilters>) => void
  reset: () => void
}

const DEFAULTS: PickFilters = { query: '', type: 'any', sort: 'now' }

export const usePickFilters = create<PickFiltersStore>((set) => ({
  ...DEFAULTS,
  set: (patch) => set(patch),
  // The sort is a preference, not a filter: clearing keeps it.
  reset: () => set({ query: '', type: 'any' }),
}))

export function pickFiltersActive(f: Pick<PickFilters, 'query' | 'type'>): boolean {
  return f.query.trim() !== '' || f.type !== 'any'
}

/** One candidate with everything the row shows (no full `PokemonView`: that is far heavier than a list needs). */
export interface PickRow {
  mon: OwnedPokemon
  types: TypeSlug[]
  role: SpeciesRole | undefined
  energy: number
  maxEnergy: number
  /** Condition multiplier if it studied now (1 = none). */
  mult: number
  /** Type that gives `mult`, or null when there is no boost. */
  condType: TypeSlug | null
  state: PickState
}

/**
 * Rows for `mons` at `at`, with one shared `env` (build it once with
 * `conditionEnvNow`). A Box Pokémon of Bug type counts itself in the Bug
 * condition (`bugCount + 1`), the way it would once it is in the team.
 */
export function pickRows(player: PlayerState, mons: readonly OwnedPokemon[], at: number, env: ConditionEnv): PickRow[] {
  const ctx = defaultContext()
  const cfg = ctx.config
  const bugEnv: ConditionEnv = { ...env, bugCount: env.bugCount + 1 }
  const rows: PickRow[] = []
  for (const mon of mons) {
    const species = ctx.speciesBySlug.get(mon.speciesSlug)
    if (!species) continue
    const energy = energyAt(player, mon, at, ctx)
    const ctypes = conditionTypes(mon, at, ctx)
    const useEnv = !player.team.includes(mon.uid) && ctypes.includes('bug') ? bugEnv : env
    const cond = pokemonConditionMult(ctypes, useEnv, cfg)
    rows.push({
      mon,
      types: species.types,
      role: species.role,
      energy,
      maxEnergy: maxEnergyOf(mon, ctx),
      mult: cond.mult,
      condType: cond.mult > 1 ? cond.type : null,
      state: isAsleepAt(player, mon, at, ctx) ? 'asleep' : energy <= 0 ? 'exhausted' : 'ready',
    })
  }
  return rows
}

/**
 * Sorted copy: Pokémon that cannot act (asleep, exhausted) always go after
 * the rest; inside each group the chosen sort, then level, then recency.
 */
export function sortPickRows(rows: readonly PickRow[], sort: PickSort): PickRow[] {
  const by: Record<PickSort, (a: PickRow, b: PickRow) => number> = {
    now: (a, b) => b.mult - a.mult,
    level: (a, b) => b.mon.level - a.mon.level || b.mon.exp - a.mon.exp,
    energy: (a, b) => b.energy - a.energy,
    recent: (a, b) => b.mon.caughtAt - a.mon.caughtAt,
  }
  const out = (r: PickRow) => (r.state === 'ready' ? 0 : 1)
  return [...rows].sort(
    (a, b) =>
      out(a) - out(b) ||
      by[sort](a, b) ||
      b.mon.level - a.mon.level ||
      b.mon.caughtAt - a.mon.caughtAt ||
      a.mon.uid.localeCompare(b.mon.uid),
  )
}

/** Box members (not in the team) that match search and type, in the Box's own level order. */
export function boxCandidates(player: PlayerState, f: Pick<PickFilters, 'query' | 'type'>, lng: LocaleCode): OwnedPokemon[] {
  return filteredMons(player, { query: f.query, type: f.type, role: 'any', where: 'box', shinyOnly: false, sort: 'level' }, lng)
}

/** Number of Pokémon in the Box (not in the team) before any filter. */
export function boxSize(player: PlayerState): number {
  let n = 0
  for (const uid in player.pokemon) if (!player.team.includes(uid)) n++
  return n
}

/** The team after swapping `outUid` for `inUid` at the same position; null when `outUid` is not in the team or `inUid` already is. */
export function swapInTeam(team: readonly string[], outUid: string, inUid: string): string[] | null {
  const i = team.indexOf(outUid)
  if (i < 0 || team.includes(inUid)) return null
  const next = [...team]
  next[i] = inUid
  return next
}
