/**
 * Data contract for the game data in `src/data/game/*.json`.
 *
 * These interfaces describe the JSON written by `scripts/import-pokeapi.ts`
 * into `data/generated/` and merged (with `data/overrides/`) by
 * `scripts/build-data.ts` into `src/data/game/`.
 *
 * Engine code must treat this data as read-only. Use the typed loaders in
 * `src/data/index.ts` instead of importing the JSON files directly.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Languages the game ships text for. */
export type LocaleCode = 'es' | 'en'

/** A text available in every supported language. */
export interface LocalizedText {
  es: string
  en: string
}

/** A text that may be missing in some languages (e.g. move/ability flavor text). */
export type PartialLocalizedText = Partial<LocalizedText>

/** The six battle stats, camelCased. Same keys everywhere (base stats, natures...). */
export type StatKey =
  | 'hp'
  | 'attack'
  | 'defense'
  | 'specialAttack'
  | 'specialDefense'
  | 'speed'

/** Stats a nature can raise or lower (everything except HP). */
export type NatureStatKey = Exclude<StatKey, 'hp'>

export type BaseStats = Record<StatKey, number>

/** The 18 Pokémon types, as PokeAPI slugs. */
export type TypeSlug =
  | 'normal'
  | 'fire'
  | 'water'
  | 'electric'
  | 'grass'
  | 'ice'
  | 'fighting'
  | 'poison'
  | 'ground'
  | 'flying'
  | 'psychic'
  | 'bug'
  | 'rock'
  | 'ghost'
  | 'dragon'
  | 'dark'
  | 'steel'
  | 'fairy'

// ---------------------------------------------------------------------------
// species.json  (Species[])
// ---------------------------------------------------------------------------

export type EvolutionTrigger = 'level' | 'item' | 'trade' | 'friendship' | 'other'

export type TimeOfDay = 'day' | 'night' | 'dusk'

/** One edge of the evolution tree: this species evolves into `to`. */
export interface Evolution {
  /** Species id of the evolution target (always inside the imported pack). */
  to: number
  trigger: EvolutionTrigger
  /** Set when `trigger === 'level'`. */
  minLevel?: number
  /** Item slug, set when `trigger === 'item'`. */
  item?: string
  timeOfDay?: TimeOfDay
  /** Set when `trigger === 'friendship'`. */
  minHappiness?: number
}

export interface SpeciesAbility {
  /** Ability slug; see `Ability.slug`. */
  slug: string
  isHidden: boolean
}

export interface LevelUpMove {
  /** Move slug; see `Move.slug`. */
  move: string
  /** Level it is learned at. 0 means "learned upon evolving into this species". */
  level: number
}

export interface Learnset {
  /** Sorted by level. The same move may appear more than once. */
  levelUp: LevelUpMove[]
  /** Move slugs, sorted alphabetically. */
  egg: string[]
  /** Move slugs, sorted alphabetically. */
  tutor: string[]
  /** Move slugs (TM/HM), sorted alphabetically. */
  machine: string[]
}

export interface SpeciesSprites {
  /** Small pixel-art box icon (png). */
  icon: string
  /** Animated Showdown sprite (gif). */
  showdown: string
  /** Animated Showdown sprite, shiny (gif). */
  showdownShiny: string
  /** Official artwork (png). */
  artwork: string
}

export interface Species {
  /** National dex id. */
  id: number
  slug: string
  names: LocalizedText
  /** Category, e.g. "Mouse Pokémon". */
  genus: LocalizedText
  /** One Pokédex entry per language, whitespace-normalized. */
  flavorText: LocalizedText
  /** Current typing (1 or 2 entries). */
  types: TypeSlug[]
  baseStats: BaseStats
  captureRate: number
  isLegendary: boolean
  isMythical: boolean
  evolutionChainId: number
  /**
   * 1 = base form, 2, 3. Computed from the evolution chain restricted to the
   * imported pack (a species whose pre-evolution is outside the pack, such as
   * Pikachu with Pichu, counts as stage 1).
   */
  stage: 1 | 2 | 3
  /** Species id of the pre-evolution, or null if none inside the pack. */
  evolvesFrom: number | null
  /** Outgoing evolutions; only targets inside the pack are listed. */
  evolutions: Evolution[]
  abilities: SpeciesAbility[]
  learnset: Learnset
  /** Version group the learnset was read from (normally `ultra-sun-ultra-moon`). */
  learnsetVersionGroup: string
  sprites: SpeciesSprites
  /** PokeFocus role from the curation overrides (GDD §20.1), shown in the UI. */
  role?: SpeciesRole
}

/** Main role of a species in PokeFocus (curation sheet, GDD §20.1). */
export type SpeciesRole =
  | 'scholar'
  | 'hunter'
  | 'sprinter'
  | 'marathoner'
  | 'technician'
  | 'guardian'
  | 'support'
  | 'allrounder'

// ---------------------------------------------------------------------------
// moves.json  (Move[])
// ---------------------------------------------------------------------------

export type DamageClass = 'physical' | 'special' | 'status'

export interface Move {
  slug: string
  id: number
  names: LocalizedText
  type: TypeSlug
  /** Null for moves without a fixed base power. */
  power: number | null
  damageClass: DamageClass
  /** Null for moves that never miss. */
  accuracy: number | null
  /** English effect summary (`es` may be added through overrides). */
  shortEffect: { en: string; es?: string }
  /** Move description per language; a language is omitted when PokeAPI has none. */
  flavorText: PartialLocalizedText
}

// ---------------------------------------------------------------------------
// abilities.json  (Ability[])
// ---------------------------------------------------------------------------

export interface Ability {
  slug: string
  id: number
  names: LocalizedText
  /** English effect summary (`es` may be added through overrides). */
  shortEffect: { en: string; es?: string }
  /** Ability description per language; a language is omitted when PokeAPI has none. */
  flavorText: PartialLocalizedText
}

// ---------------------------------------------------------------------------
// types.json  (TypesFile)
// ---------------------------------------------------------------------------

export interface TypeInfo {
  id: number
  slug: TypeSlug
  names: LocalizedText
}

/** Damage multiplier of one attacking type against one defending type. */
export type TypeMultiplier = 0 | 0.5 | 1 | 2

/** `chart[attacking][defending]`. Contains all 18 x 18 pairs. */
export type TypeChart = Record<TypeSlug, Record<TypeSlug, TypeMultiplier>>

/** Shape of `types.json`. */
export interface TypesFile {
  /** The 18 types, sorted by id. */
  types: TypeInfo[]
  chart: TypeChart
}

// ---------------------------------------------------------------------------
// natures.json  (Nature[])
// ---------------------------------------------------------------------------

export interface Nature {
  id: number
  slug: string
  names: LocalizedText
  /** Stat raised by 10%; null for neutral natures. */
  increased: NatureStatKey | null
  /** Stat lowered by 10%; null for neutral natures. */
  decreased: NatureStatKey | null
}

// ---------------------------------------------------------------------------
// items.json  (Item[])
// ---------------------------------------------------------------------------

export interface Item {
  id: number
  slug: string
  names: LocalizedText
  /** Pixel-art sprite URL. */
  sprite: string
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/** Everything `src/data/game/` contains, as loaded by `src/data/index.ts`. */
export interface GameData {
  species: Species[]
  moves: Move[]
  abilities: Ability[]
  types: TypesFile
  natures: Nature[]
  items: Item[]
}
