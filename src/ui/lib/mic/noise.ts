/**
 * The microphone's own noise (pure). Every mic hisses and many hum (mains
 * harmonics at 50/60 Hz multiples); without help the classifier reads that
 * steady, partly tonal sound as music or noise. So:
 *
 * 1. `estimateProfile` measures the noise spectrum during the calibration's
 *    silence step: per 50 Hz cell (100–8000 Hz, 158 cells, independent of the
 *    sample rate), the median over frames of the mean bin power, corrected
 *    for the median's bias. Fine enough to keep hum lines, small enough to
 *    store (~1 KB per device).
 * 2. `frameFeatures` (classify.ts) subtracts it from every frame (spectral
 *    subtraction with over-subtraction and a floor) before computing any
 *    feature, and measures the level relative to it (`aboveDb`).
 * 3. `trackNoise` keeps the profile current during use: it follows quieter
 *    cells down quickly, and creeps up slowly only from windows that look
 *    like steady room noise a little over the floor (never speech or music),
 *    within a cap over the calibrated profile.
 */

/** Profile grid: cells of `CELL_HZ` from `LO_HZ` to `HI_HZ`. */
export const NOISE_LO_HZ = 100
export const NOISE_HI_HZ = 8000
export const CELL_HZ = 50
export const NOISE_CELLS = Math.ceil((NOISE_HI_HZ - NOISE_LO_HZ) / CELL_HZ) // 158

/**
 * Median → mean of a cell's power for noise-like bins (mean of ~2 exponential
 * bins ≈ Gamma(2): median ≈ 0.84 × mean). Steady hum is overestimated by
 * < 1 dB, the safe side.
 */
export const MEDIAN_BIAS = 1.19

/** Spectral subtraction: remove `ALPHA` × noise, keep at least `BETA` of the original power. */
export const SUB_ALPHA = 2
export const SUB_BETA = 0.08

/** Tracker: per window, down-rate, up-rate, and the most the profile may rise over its base (dB). */
const DOWN_RATE = 0.5
const UP_RATE = 0.03
export const TRACK_CAP_DB = 12
const TRACK_MIN_DB = -20
/** Stored values are clamped to this range (dB). */
const DB_MIN = -200
const DB_MAX = 0

/** Noise power per cell, dB (same scale as `getFloatFrequencyData`, mean bin power). */
export interface NoiseProfile {
  db: number[]
}

export const cellOf = (hz: number): number => Math.floor((hz - NOISE_LO_HZ) / CELL_HZ)

const toLin = (db: number) => Math.pow(10, db / 10)
const toDb = (p: number) => (p > 0 ? 10 * Math.log10(p) : DB_MIN)

/** Mean linear power per cell of one spectrum (dB per bin); empty cells = 0. */
export function cellPowers(spectrumDb: ArrayLike<number>, sampleRate: number): number[] {
  const n = spectrumDb.length
  const binHz = sampleRate / (2 * n)
  const sum = new Array<number>(NOISE_CELLS).fill(0)
  const cnt = new Array<number>(NOISE_CELLS).fill(0)
  const lo = Math.max(1, Math.ceil(NOISE_LO_HZ / binHz))
  const hi = Math.min(n - 1, Math.floor(NOISE_HI_HZ / binHz))
  for (let i = lo; i <= hi; i++) {
    const c = cellOf(i * binHz)
    if (c < 0 || c >= NOISE_CELLS) continue
    const d = spectrumDb[i]!
    sum[c]! += Number.isFinite(d) ? toLin(Math.max(-160, d)) : 0
    cnt[c]!++
  }
  return sum.map((s, c) => (cnt[c]! > 0 ? s / cnt[c]! : 0))
}

function median(values: number[]): number {
  const v = values.slice().sort((a, b) => a - b)
  const m = v.length >> 1
  return v.length === 0 ? 0 : v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2
}

/** Per-cell bias-corrected median power over frames (`cells` from `cellPowers`), linear. */
export function medianCells(frames: readonly (readonly number[])[]): number[] | null {
  if (frames.length === 0) return null
  const out: number[] = []
  for (let c = 0; c < NOISE_CELLS; c++) out.push(median(frames.map((f) => f[c] ?? 0)) * MEDIAN_BIAS)
  return out
}

/** The noise profile of a silent recording (null without frames). */
export function estimateProfile(frames: readonly (readonly number[])[]): NoiseProfile | null {
  const m = medianCells(frames)
  return m ? { db: m.map((p) => round(toDb(p))) } : null
}

const round = (db: number) => Math.round(Math.min(DB_MAX, Math.max(DB_MIN, db)) * 2) / 2

/** Validate a stored profile; null if malformed. */
export function sanitizeProfile(raw: unknown): NoiseProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const db = (raw as { db?: unknown }).db
  if (!Array.isArray(db) || db.length !== NOISE_CELLS) return null
  if (!db.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return { db: db.map((v: number) => round(v)) }
}

/** Total noise level of a profile (dB, sum of cell powers), for summaries. */
export function profileLevelDb(p: NoiseProfile): number {
  return toDb(p.db.reduce((s, d) => s + toLin(d), 0))
}

export interface BinNoise {
  /** Noise power per FFT bin (linear); bins outside the grid = 0. */
  bins: Float64Array
  /**
   * Subtraction floor cap: `SUB_BETA` × the median noise of the profile. A bin
   * keeps min(8 % of its power, this), so bins that are only hum fall to a
   * flat floor instead of keeping the comb shape of the hum lines.
   */
  floor: number
}

const binCache = new WeakMap<NoiseProfile, { n: number; sr: number; out: BinNoise }>()

/** Per-bin noise for a spectrum of `n` bins (cached per profile). */
export function binNoise(p: NoiseProfile, n: number, sampleRate: number): BinNoise {
  const hit = binCache.get(p)
  if (hit && hit.n === n && hit.sr === sampleRate) return hit.out
  const binHz = sampleRate / (2 * n)
  const bins = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const c = cellOf(i * binHz)
    if (c >= 0 && c < NOISE_CELLS && i * binHz <= NOISE_HI_HZ) bins[i] = toLin(p.db[c]!)
  }
  const out = { bins, floor: SUB_BETA * median(p.db.map(toLin)) }
  binCache.set(p, { n, sr: sampleRate, out })
  return out
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export interface NoiseTracker {
  /** Current estimate (null until the first window when nothing was calibrated). */
  profile: NoiseProfile | null
  /** Calibrated profile (or the first estimate), the reference for the cap. */
  base: NoiseProfile | null
}

export function trackerInit(calibrated: NoiseProfile | null): NoiseTracker {
  return { profile: calibrated, base: calibrated }
}

/**
 * Update with one window. `estimate` = `medianCells` of its frames;
 * `quietLike` = the window is silence, or steady noise only a little over the
 * floor (decided by the caller from the window features); `loud` = too loud to
 * ever be "the room" (never learnt).
 */
export function trackNoise(t: NoiseTracker, estimate: readonly number[] | null, opts: { quietLike: boolean; loud: boolean }): NoiseTracker {
  if (!estimate || estimate.length !== NOISE_CELLS) return t
  if (!t.profile) {
    // Nothing calibrated: start from the first window that is not loud (fast-down fixes a bad start).
    if (opts.loud) return t
    const p = { db: estimate.map((v) => round(toDb(v))) }
    return { profile: p, base: p }
  }
  const base = t.base ?? t.profile
  const db = t.profile.db.map((cur, c) => {
    const n = toLin(cur)
    const e = estimate[c]!
    let next = n
    if (e < n) next = n + DOWN_RATE * (e - n)
    else if (opts.quietLike && !opts.loud) next = n + UP_RATE * (e - n)
    const b = base.db[c]!
    return round(Math.min(b + TRACK_CAP_DB, Math.max(b + TRACK_MIN_DB, toDb(next))))
  })
  return { profile: { db }, base }
}
