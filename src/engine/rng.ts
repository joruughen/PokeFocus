/**
 * Seedable PRNG (mulberry32) and helpers. Every random function in the engine
 * takes an `Rng`, so results are reproducible with a fixed seed.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
}

/** Hash a string seed into a 32-bit integer (xmur3). */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

/** Create a deterministic RNG from a number or string seed. */
export function createRng(seed: number | string): Rng {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/** Integer in [min, max] (inclusive). */
export function randInt(rng: Rng, min: number, max: number): number {
  if (max < min) return min
  return min + Math.floor(rng.next() * (max - min + 1))
}

/** True with probability `p`. */
export function chance(rng: Rng, p: number): boolean {
  if (p <= 0) return false
  if (p >= 1) return true
  return rng.next() < p
}

/** Uniformly pick one element. Throws on an empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: empty array')
  return items[Math.floor(rng.next() * items.length)] as T
}

/** Pick one element with the given non-negative weights. Returns null if all weights are 0. */
export function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T | null {
  let total = 0
  const ws = items.map((i) => {
    const w = Math.max(0, weight(i))
    total += w
    return w
  })
  if (total <= 0) return null
  let r = rng.next() * total
  for (let i = 0; i < items.length; i++) {
    r -= ws[i] as number
    if (r < 0) return items[i] as T
  }
  return items[items.length - 1] as T
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}

/** Pick `n` distinct elements (or all if fewer). */
export function sample<T>(rng: Rng, items: readonly T[], n: number): T[] {
  return shuffle(rng, items).slice(0, Math.max(0, n))
}
