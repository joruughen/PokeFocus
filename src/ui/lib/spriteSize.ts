import sizes from '../../data/sprite-sizes.json'

/**
 * Showdown draws every GIF at its natural size with the same zoom, so relative sizes come from the
 * files themselves. Here a scene has a box per Pokémon; the biggest species fills it and the rest
 * follow `(longest side / biggest longest side) ^ SIZE_GAMMA`: the order is always the real one, but
 * the small ones are not tiny next to a Moltres. 1 = true proportions, 0 = everyone the same size.
 * (npm run sprites:sizes regenerates the table after downloading sprites.)
 */
export const SIZE_GAMMA = 0.7
/**
 * Flatter rule for a screen that shows ONE Pokémon (sheet, Pokédex entry, evolution, trade…): nothing next to it
 * to compare with, so medium and big ones stay big instead of shrinking relative to a Moltres.
 */
export const SHOWCASE_GAMMA = 0.35

const TABLE = sizes as unknown as Record<string, [number, number]>
const LONGEST = Math.max(...Object.values(TABLE).map(([w, h]) => Math.max(w, h)))

export interface SpriteBox {
  /** Height the biggest species reaches (and no sprite exceeds). */
  height: number
  /** Width no sprite exceeds (default: only the height limits). */
  width?: number
  /** Size exponent (default `SIZE_GAMMA`; `SHOWCASE_GAMMA` for a screen with a single Pokémon). */
  gamma?: number
}

/** Natural size of the animated sprite of a species id, or null when it is not in the table. */
export function naturalSize(id: number): { w: number; h: number } | null {
  const s = TABLE[String(id)]
  return s ? { w: s[0], h: s[1] } : null
}

/** Rendered size of a species in a box (fractional zoom, the same rule everywhere). Null when its size is unknown. */
export function fitSpriteSize(id: number, box: SpriteBox): { w: number; h: number } | null {
  const n = naturalSize(id)
  if (!n) return null
  const longest = Math.max(n.w, n.h)
  let f = (box.height * Math.pow(longest / LONGEST, box.gamma ?? SIZE_GAMMA)) / longest
  f = Math.min(f, box.height / n.h, box.width !== undefined ? box.width / n.w : Infinity)
  return { w: Math.max(1, Math.round(n.w * f)), h: Math.max(1, Math.round(n.h * f)) }
}
