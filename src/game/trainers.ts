/**
 * Trainer sprites: the character a player picks in their profile and that stands next to their team in the
 * study-group scenes (GDD §9.2). Pokémon Showdown trainer PNGs (80×80), the whole catalogue, downloaded by
 * `npm run download:trainers` into `public/sprites/trainers/<slug>.png`.
 *
 * This module is the light part (the client's scenes import it): the hand-picked core, the default character and
 * the sprite URL. The full list, labels, groups and search are in `trainerCatalog.ts`, which only the profile
 * picker and the server load.
 */

/**
 * The first 24 characters, the «Destacados» (the hand-picked start of 0.16.0, before the whole catalogue came in), in picker order. The default character of a
 * player who never chose is drawn from them, so NEVER reorder, remove or insert here (it would change everybody's
 * default); the rest of the catalogue can grow freely.
 */
export const TRAINER_CORE: readonly string[] = [
  'hilbert',
  'hilda',
  'nate',
  'rosa',
  'ethan',
  'lyra',
  'lucas',
  'dawn',
  'red',
  'acetrainer',
  'acetrainerf',
  'backpacker',
  'backpackerf',
  'youngster',
  'lass',
  'bugcatcher',
  'beauty',
  'blackbelt',
  'battlegirl',
  'scientist',
  'hiker',
  'pokemonranger',
  'pokemonrangerf',
  'psychicf',
]

/** FNV-1a (32 bit): a tiny, stable string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The character a player gets without choosing: stable per user id, always one of the core. */
export function defaultTrainerSprite(userId: string): string {
  return TRAINER_CORE[hash(userId) % TRAINER_CORE.length]!
}

export function trainerSpriteUrl(slug: string): string {
  return `/sprites/trainers/${slug}.png`
}
