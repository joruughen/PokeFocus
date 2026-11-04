/** Box filters and sort (kept while you open a detail and come back; not persisted). */
import { create } from 'zustand'
import { defaultContext, ivQuality, type LocaleCode, type OwnedPokemon, type PlayerState, type SpeciesRole, type TypeSlug } from '../../../engine'
import { speciesName } from '../../lib/names'

const ctx = defaultContext()

export type BoxSort = 'recent' | 'level' | 'species' | 'iv'
export type BoxWhere = 'all' | 'team' | 'box'

export interface BoxFilters {
  query: string
  type: TypeSlug | 'any'
  role: SpeciesRole | 'any'
  where: BoxWhere
  shinyOnly: boolean
  sort: BoxSort
  set: (patch: Partial<Omit<BoxFilters, 'set' | 'reset'>>) => void
  reset: () => void
}

const DEFAULTS = { query: '', type: 'any' as const, role: 'any' as const, where: 'all' as const, shinyOnly: false, sort: 'recent' as const }

export const useBoxFilters = create<BoxFilters>((set) => ({
  ...DEFAULTS,
  set: (patch) => set(patch),
  reset: () => set(DEFAULTS),
}))

export function filtersActive(f: BoxFilters): boolean {
  return f.query !== '' || f.type !== 'any' || f.role !== 'any' || f.where !== 'all' || f.shinyOnly
}

/** The player's Pokémon after filters and sort (same order as the grid; used for prev/next in the detail). */
export function filteredMons(player: PlayerState, f: Pick<BoxFilters, 'query' | 'type' | 'role' | 'where' | 'shinyOnly' | 'sort'>, lng: LocaleCode): OwnedPokemon[] {
  const q = f.query.trim().toLocaleLowerCase(lng)
  const list = Object.values(player.pokemon).filter((p) => {
    const sp = ctx.speciesBySlug.get(p.speciesSlug)
    if (!sp) return false
    if (f.type !== 'any' && !sp.types.includes(f.type)) return false
    if (f.role !== 'any' && sp.role !== f.role) return false
    const inTeam = player.team.includes(p.uid)
    if (f.where === 'team' && !inTeam) return false
    if (f.where === 'box' && inTeam) return false
    if (f.shinyOnly && !p.isShiny) return false
    if (q && !speciesName(p.speciesSlug, lng).toLocaleLowerCase(lng).includes(q) && !p.speciesSlug.includes(q)) return false
    return true
  })
  const dex = (p: OwnedPokemon) => ctx.speciesBySlug.get(p.speciesSlug)?.id ?? 0
  const cmp: Record<BoxSort, (a: OwnedPokemon, b: OwnedPokemon) => number> = {
    recent: (a, b) => b.caughtAt - a.caughtAt,
    level: (a, b) => b.level - a.level || b.exp - a.exp,
    species: (a, b) => dex(a) - dex(b) || b.level - a.level,
    iv: (a, b) => ivQuality(b.ivs).total - ivQuality(a.ivs).total,
  }
  return list.sort((a, b) => cmp[f.sort](a, b) || a.uid.localeCompare(b.uid))
}
