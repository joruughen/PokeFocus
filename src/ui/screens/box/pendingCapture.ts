/** Pure helpers of the pending-capture window (Box full, GDD §12.9) and its small open/close store. */
import { create } from 'zustand'
import { defaultContext, isBoxFull, releaseCandyGain, type LocaleCode, type OwnedPokemon, type PlayerState } from '../../../engine'
import { lineRoot } from '../shared/EvoLine'
import { filteredMons } from './filters'
import { releaseSummary, type ReleaseWarningKind } from './releaseSummary'

/** Is the window open? Opened by the Waves screen after the throw, or by the "Decide" buttons. */
export const usePendingUi = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

export const pendingOf = (player: PlayerState): OwnedPokemon[] => player.pendingCaptures ?? []

export type SwapSort = 'weakest' | 'recent' | 'species'

/** Box Pokémon that can be released for a swap (not in the team), searched and sorted. */
export function swapCandidates(player: PlayerState, query: string, sort: SwapSort, lng: LocaleCode): OwnedPokemon[] {
  const f = { query, type: 'any' as const, role: 'any' as const, where: 'box' as const, shinyOnly: false }
  if (sort === 'weakest') return filteredMons(player, { ...f, sort: 'level' }, lng).reverse()
  return filteredMons(player, { ...f, sort }, lng)
}

/** Why releasing this Pokémon (or converting this capture) deserves an extra confirmation. */
export function riskOf(player: PlayerState, mon: OwnedPokemon): ReleaseWarningKind[] {
  const solo = { ...player, team: [], pokemon: { ...player.pokemon, [mon.uid]: mon } }
  return releaseSummary(solo, [mon.uid]).warnings.map((w) => w.kind)
}

/** Candies a release (or converting) of this species gives, and the root species of its line. */
export function candyOf(slug: string): { gain: number; rootSlug: string } {
  const ctx = defaultContext()
  const sp = ctx.speciesBySlug.get(slug)
  return { gain: releaseCandyGain(slug, ctx).gain, rootSlug: sp ? lineRoot(sp).slug : slug }
}

export function isLegendarySlug(slug: string): boolean {
  const sp = defaultContext().speciesBySlug.get(slug)
  return Boolean(sp && (sp.isLegendary || sp.isMythical))
}

/** Room in the Box now (the "Keep" button only exists then). */
export function boxHasRoom(player: PlayerState): boolean {
  return !isBoxFull(player)
}
