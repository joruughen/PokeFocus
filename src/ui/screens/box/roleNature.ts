/**
 * Does a Pokémon's nature work against (or with) its species' role?
 *
 * The role belongs to the species (`Species.role`, set by hand in the curation sheet
 * `data/overrides/species.json`; it has no effect of its own). The nature belongs to the
 * individual and does change stats: +10% on one stat and −10% on another (engine
 * `natureMultiplier`; never HP). Each role is named after the stat it is about, so a
 * nature that lowers that stat makes the individual a weaker version of its role
 * (a Relaxed Pidgey, a Sprinter, loses Pace).
 */
import type { Nature, NatureStatKey, SpeciesRole, StatKey } from '../../../engine'

/**
 * The stat each role is about (PokeFocus names: scholar = Output, hunter = Catch,
 * sprinter = Pace, marathoner = Energy, technician = Technique, guardian = Grit).
 * `support` and `allrounder` are not tied to one stat.
 */
export const ROLE_STAT: Record<SpeciesRole, StatKey | null> = {
  scholar: 'specialAttack',
  hunter: 'attack',
  sprinter: 'speed',
  marathoner: 'hp',
  technician: 'specialDefense',
  guardian: 'defense',
  support: null,
  allrounder: null,
}

export interface RoleNatureFit {
  /** `against`: the nature lowers the role's stat. `with`: it raises it. */
  kind: 'against' | 'with'
  role: SpeciesRole
  stat: NatureStatKey
}

/** `null` when there is nothing to say: no role, no nature, a neutral or unrelated nature, or a role without a stat Natures can touch. */
export function roleNatureFit(role: SpeciesRole | undefined, nature: Pick<Nature, 'increased' | 'decreased'> | undefined): RoleNatureFit | null {
  if (!role || !nature) return null
  const stat = ROLE_STAT[role]
  if (!stat || stat === 'hp') return null // Natures never change Energy (HP)
  if (nature.decreased === stat) return { kind: 'against', role, stat }
  if (nature.increased === stat) return { kind: 'with', role, stat }
  return null
}
