/** Histograma logarítmico mergeable para latencias (ms): error relativo ≤ 4 %. */
const BASE = 1.04
const MIN_MS = 0.1
const LN = Math.log(BASE)

export type SparseHist = Record<number, number>

export function bucketOf(ms: number): number {
  return Math.max(0, Math.ceil(Math.log(Math.max(ms, MIN_MS) / MIN_MS) / LN))
}

export function bucketValue(idx: number): number {
  return MIN_MS * Math.pow(BASE, idx)
}

export function addTo(h: SparseHist, ms: number): void {
  const b = bucketOf(ms)
  h[b] = (h[b] ?? 0) + 1
}

export function mergeInto(dst: SparseHist, src: SparseHist): void {
  for (const k of Object.keys(src)) dst[+k] = (dst[+k] ?? 0) + src[+k]!
}

export function count(h: SparseHist): number {
  let n = 0
  for (const v of Object.values(h)) n += v
  return n
}

/** Percentil p (0-100) en ms; NaN si el histograma está vacío. */
export function percentile(h: SparseHist, p: number): number {
  const total = count(h)
  if (total === 0) return NaN
  const target = Math.max(1, Math.ceil((p / 100) * total))
  let acc = 0
  for (const k of Object.keys(h).map(Number).sort((a, b) => a - b)) {
    acc += h[k]!
    if (acc >= target) return bucketValue(k)
  }
  return NaN
}
