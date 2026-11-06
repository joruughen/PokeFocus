/**
 * Sound profile classifier (GDD §4.3). Pure: no Web Audio here, so it is unit
 * tested on synthetic spectra and feature vectors. `monitor.ts` feeds it.
 *
 * Pipeline:
 *   1. `frameFeatures` — one analyser frame (~43 ms, every 100 ms): level,
 *      spectral flatness, centroid, share of energy in the voice band, tonal
 *      peaks and a coarse band profile.
 *   2. `windowFeatures` — the frames of one 2 s window: mean level, level
 *      modulation, low-energy-frame rate (speech pauses), spectral stability.
 *   3. `classifyWindow` — simple rules → silence / voice / music / noise.
 *   4. `addWindow` / `profileOf` — seconds per kind → shares sent at claim.
 *
 * It is a heuristic, not a model: it tells "quiet room" from "someone
 * talking" from "music playing" from "café/traffic/fan" well enough to pick a
 * study style, and errs towards `noise` when unsure. Known limits: songs with
 * prominent vocals often read as `voice`; a quiet podcast close to the noise
 * floor reads as `silence`; very compressed music (lo-fi with vinyl hiss)
 * can read as `noise`.
 */
import type { SoundProfile } from '../../../engine'

export type SoundKind = 'silence' | 'voice' | 'music' | 'noise'
export const SOUND_KINDS: readonly SoundKind[] = ['silence', 'music', 'voice', 'noise']

/** Analysed band (Hz): below 80 is mains hum and desk thumps, above 8 kHz little that matters. */
const LO_HZ = 80
const HI_HZ = 8000
const VOICE_LO_HZ = 300
const VOICE_HI_HZ = 3400
/** Log-spaced bands of the coarse profile (for stability between frames). */
const PROFILE_BANDS = 16

export interface FrameFeatures {
  /** RMS level of the time-domain frame, dBFS (−100 for digital silence). */
  rmsDb: number
  /** Spectral flatness 0–1 (1 = white noise, ~0 = pure tone). */
  flatness: number
  /** Spectral centroid, Hz. */
  centroidHz: number
  /** Share of the 80–8000 Hz energy that is in 300–3400 Hz. */
  voiceRatio: number
  /** Narrow peaks ≥ 12 dB over their neighbourhood (harmonics, notes). */
  tonalPeaks: number
  /** Band levels (dB), for frame-to-frame stability. */
  profile: number[]
}

export interface WindowFeatures {
  /** Level of the window (energy mean of the frames), dBFS. */
  rmsDb: number
  /** Standard deviation of frame levels, dB (speech is choppy, music and noise steadier). */
  modulationDb: number
  /** Fraction of frames 10 dB or more below the window level (pauses between words). */
  lowEnergyRate: number
  flatness: number
  centroidHz: number
  voiceRatio: number
  tonalPeaks: number
  /** Mean correlation of consecutive band profiles, −1–1 (sustained notes and steady noise ≈ 1). */
  stability: number
  frames: number
}

export interface Thresholds {
  /** Absolute level under which a window is always silence. */
  silenceDb: number
  /** A window within this many dB of the adaptive noise floor is silence… */
  floorMarginDb: number
  /** …but never above this level (a loud steady room is not "silence"). */
  maxSilenceDb: number
  /** Flatness from which the sound is broadband noise. */
  noiseFlatness: number
  /** Voice: enough energy in the voice band… */
  voiceRatio: number
  /** …and choppy (modulation or pauses)… */
  voiceModulationDb: number
  voiceLowEnergyRate: number
  /** …and the spectrum keeps moving (formants). */
  voiceMaxStability: number
  /** Music: tonal peaks and a steady spectrum, or very tonal. */
  musicPeaks: number
  musicStability: number
  musicFlatness: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  silenceDb: -52,
  floorMarginDb: 6,
  maxSilenceDb: -38,
  noiseFlatness: 0.42,
  voiceRatio: 0.55,
  voiceModulationDb: 5,
  voiceLowEnergyRate: 0.15,
  voiceMaxStability: 0.85,
  musicPeaks: 3,
  musicStability: 0.6,
  musicFlatness: 0.12,
}

const EPS = 1e-12

/** Level of a time-domain frame (samples in −1…1), dBFS. */
export function rmsDbOf(samples: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!
    sum += v * v
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
}

/**
 * Features of one frame. `spectrumDb` is `AnalyserNode.getFloatFrequencyData`
 * (dB per bin, bin i centred at i · sampleRate / (2 · length)).
 */
export function frameFeatures(spectrumDb: ArrayLike<number>, sampleRate: number, rmsDb: number): FrameFeatures {
  const n = spectrumDb.length
  const binHz = sampleRate / (2 * n)
  const lo = Math.max(1, Math.ceil(LO_HZ / binHz))
  const hi = Math.min(n - 1, Math.floor(HI_HZ / binHz))
  let total = 0
  let voice = 0
  let weighted = 0
  let logSum = 0
  let count = 0
  const db: number[] = []
  for (let i = lo; i <= hi; i++) {
    const d = Number.isFinite(spectrumDb[i]!) ? Math.max(-160, spectrumDb[i]!) : -160
    db.push(d)
    const p = Math.pow(10, d / 10) + EPS
    const f = i * binHz
    total += p
    weighted += p * f
    logSum += Math.log(p)
    count++
    if (f >= VOICE_LO_HZ && f <= VOICE_HI_HZ) voice += p
  }
  if (count === 0) return { rmsDb, flatness: 1, centroidHz: 0, voiceRatio: 0, tonalPeaks: 0, profile: [] }
  const flatness = Math.min(1, Math.exp(logSum / count) / (total / count))

  // Tonal peaks: local maxima ≥ 12 dB over the mean of a ±8-bin neighbourhood.
  let tonalPeaks = 0
  const R = 8
  for (let k = 1; k < db.length - 1; k++) {
    const v = db[k]!
    if (v < db[k - 1]! || v < db[k + 1]!) continue
    let s = 0
    let c = 0
    for (let j = Math.max(0, k - R); j <= Math.min(db.length - 1, k + R); j++) {
      if (Math.abs(j - k) <= 1) continue
      s += db[j]!
      c++
    }
    if (c > 0 && v - s / c >= 12) tonalPeaks++
  }

  // Coarse log-spaced band profile (dB).
  const profile: number[] = []
  const ratio = Math.pow(HI_HZ / LO_HZ, 1 / PROFILE_BANDS)
  for (let b = 0; b < PROFILE_BANDS; b++) {
    const f0 = LO_HZ * Math.pow(ratio, b)
    const f1 = f0 * ratio
    let s = 0
    let c = 0
    for (let i = lo; i <= hi; i++) {
      const f = i * binHz
      if (f >= f0 && f < f1) {
        s += Math.pow(10, db[i - lo]! / 10)
        c++
      }
    }
    profile.push(c > 0 ? 10 * Math.log10(s / c + EPS) : -160)
  }

  return { rmsDb, flatness, centroidHz: weighted / total, voiceRatio: voice / total, tonalPeaks, profile }
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let dbb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma
    const y = b[i]! - mb
    num += x * y
    da += x * x
    dbb += y * y
  }
  return da > 0 && dbb > 0 ? num / Math.sqrt(da * dbb) : 1
}

/** Summary of the frames of one window (null if there are none). */
export function windowFeatures(frames: readonly FrameFeatures[]): WindowFeatures | null {
  const n = frames.length
  if (n === 0) return null
  let energy = 0
  for (const f of frames) energy += Math.pow(10, f.rmsDb / 10)
  const rmsDb = 10 * Math.log10(energy / n + EPS)
  const levels = frames.map((f) => f.rmsDb)
  const meanLevel = levels.reduce((s, v) => s + v, 0) / n
  const modulationDb = Math.sqrt(levels.reduce((s, v) => s + (v - meanLevel) ** 2, 0) / n)
  const lowEnergyRate = levels.filter((v) => v <= rmsDb - 10).length / n
  // Spectral shape averaged over the audible frames only (pauses would drag it towards the room noise).
  const loud = frames.filter((f) => f.rmsDb > rmsDb - 10)
  const src = loud.length > 0 ? loud : frames
  const avg = (k: 'flatness' | 'centroidHz' | 'voiceRatio' | 'tonalPeaks') => src.reduce((s, f) => s + f[k], 0) / src.length
  let corr = 0
  let pairs = 0
  for (let i = 1; i < n; i++) {
    corr += correlation(frames[i - 1]!.profile, frames[i]!.profile)
    pairs++
  }
  return {
    rmsDb,
    modulationDb,
    lowEnergyRate,
    flatness: avg('flatness'),
    centroidHz: avg('centroidHz'),
    voiceRatio: avg('voiceRatio'),
    tonalPeaks: avg('tonalPeaks'),
    stability: pairs > 0 ? corr / pairs : 1,
    frames: n,
  }
}

/** Level under which a window counts as silence, given the adaptive floor. */
export function silenceLevel(floorDb: number | null, th: Thresholds = DEFAULT_THRESHOLDS): number {
  if (floorDb === null) return th.silenceDb
  return Math.max(th.silenceDb, Math.min(th.maxSilenceDb, floorDb + th.floorMarginDb))
}

/**
 * Noise floor tracker: follows the quietest windows down at once and creeps
 * up slowly (0.1 dB per window ≈ 3 dB/min), so a steady fan or fridge
 * becomes "the room" while a burst of noise does not.
 */
export function updateFloor(floorDb: number | null, windowDb: number): number {
  if (floorDb === null || windowDb < floorDb) return windowDb
  return Math.min(windowDb, floorDb + 0.1)
}

export function classifyWindow(w: WindowFeatures, floorDb: number | null = null, th: Thresholds = DEFAULT_THRESHOLDS): SoundKind {
  if (w.rmsDb < silenceLevel(floorDb, th)) return 'silence'
  if (w.flatness >= th.noiseFlatness) return 'noise'
  const choppy = w.modulationDb >= th.voiceModulationDb || w.lowEnergyRate >= th.voiceLowEnergyRate
  if (w.voiceRatio >= th.voiceRatio && choppy && w.stability < th.voiceMaxStability) return 'voice'
  if ((w.tonalPeaks >= th.musicPeaks && w.stability >= th.musicStability) || (w.flatness <= th.musicFlatness && !choppy)) return 'music'
  if (w.voiceRatio >= th.voiceRatio && choppy) return 'voice'
  return 'noise'
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

/** Seconds of the session classified as each kind. */
export type SoundTally = Record<SoundKind, number>

export const EMPTY_TALLY: SoundTally = { silence: 0, music: 0, voice: 0, noise: 0 }

export function addWindow(t: SoundTally, kind: SoundKind, seconds: number): SoundTally {
  if (!(seconds > 0)) return t
  return { ...t, [kind]: t[kind] + seconds }
}

export function tallySeconds(t: SoundTally): number {
  return t.silence + t.music + t.voice + t.noise
}

/** Minimum analysed time before a profile is sent. */
export const MIN_PROFILE_SECONDS = 60

/**
 * Shares of the analysed time (sum 1, three decimals, never over 1.003), or
 * null when less than `minSeconds` were analysed.
 */
export function profileOf(t: SoundTally, minSeconds = MIN_PROFILE_SECONDS): SoundProfile | null {
  const total = tallySeconds(t)
  if (!(total >= minSeconds) || total <= 0) return null
  const r = (v: number) => Math.round((v / total) * 1000) / 1000
  return { silence: r(t.silence), music: r(t.music), voice: r(t.voice), noise: r(t.noise) }
}

/** Dominant kind of a tally so far (null if empty). */
export function dominantOf(t: SoundTally): SoundKind | null {
  let best: SoundKind | null = null
  for (const k of SOUND_KINDS) if (t[k] > 0 && (best === null || t[k] > t[best])) best = k
  return best
}

/** Parse a stored tally (sessionStorage), null if malformed. */
export function parseTally(raw: unknown): SoundTally | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out = { ...EMPTY_TALLY }
  for (const k of SOUND_KINDS) {
    const v = o[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
    out[k] = v
  }
  return out
}
