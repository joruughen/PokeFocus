/** View model of the saved teams: which members still exist and whether a preset is the team in use. */
import { presetMembers, teamPresets, type OwnedPokemon, type PlayerState, type TeamPreset } from '../../../engine'

export interface PresetRow {
  preset: TeamPreset
  /** Members that still exist, in the preset's order (slot 0 = leader). */
  members: OwnedPokemon[]
  /** Members of the preset that were released since it was saved. */
  missing: number
  /** The preset is exactly the team in use now (same Pokémon, same order and leader). */
  active: boolean
}

export function presetRows(player: PlayerState): PresetRow[] {
  return teamPresets(player).map((preset) => {
    const { uids, missing } = presetMembers(player, preset)
    return {
      preset,
      members: uids.map((u) => player.pokemon[u]!),
      missing,
      active: missing === 0 && uids.length === player.team.length && uids.every((u, i) => u === player.team[i]),
    }
  })
}
