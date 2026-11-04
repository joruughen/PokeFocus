/**
 * Small seeded RNG (mulberry32) used by the generative music and by the sfx
 * pitch variance. Pure; no Web Audio dependency.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform float in [min, max). */
  range(min: number, max: number): number
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T
  /** Weighted pick; weights must be ≥ 0 and not all zero. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T
  /** Derive an independent child stream (stable for the same parent state + salt). */
  fork(salt: string | number): Rng
}

/** 32-bit string hash (FNV-1a) used to turn seeds/salts into integers. */
export function hashSeed(seed: string | number): number {
  const s = String(seed)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function createRng(seed: string | number = Date.now()): Rng {
  let state = hashSeed(seed) || 0x9e3779b9
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() on empty array')
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    weighted: (items, weights) => {
      let total = 0
      for (let i = 0; i < items.length; i++) total += Math.max(0, weights[i] ?? 0)
      if (items.length === 0 || total <= 0) throw new Error('weighted() needs a positive weight')
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i] ?? 0)
        if (r < 0) return items[i] as (typeof items)[number]
      }
      return items[items.length - 1] as (typeof items)[number]
    },
    fork: (salt) => createRng(`${state}:${salt}`),
  }
  return rng
}
