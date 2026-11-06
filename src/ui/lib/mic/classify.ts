/**
 * Sound profile classifier (GDD §4.3). Pure: no Web Audio here, so it is unit
 * tested on synthetic spectra and feature vectors. `pipeline.ts` feeds it.
 *
 * Pipeline:
 *   1. `frameFeatures` — one analyser frame (~43 ms, every 100 ms). The mic's
 *      own noise (`noise.ts` profile) is subtracted from every bin first;
 *      then level over that noise, denoised level, spectral flatness,
 *      centroid, voice-band share, tonal peaks and a coarse band profile.
 *   2. `windowFeatures` — the frames of one 2 s window: level, level over the
 *      noise, modulation, low-energy-frame rate (speech pauses), stability.
 *   3. `classifyWindow` — simple rules → silence / voice / music / noise.
 *      Silence = nothing meaningfully over the mic's own noise.
 *   4. `addWindow` / `profileOf` — seconds per kind → shares sent at claim.
 *
 * It is a heuristic, not a model: it tells "quiet room" from "someone
 * talking" from "music playing" from "café/traffic/fan" well enough to pick a
 * study style, and errs towards `noise` when unsure. Known limits: songs with
 * prominent vocals often read as `voice`; a quiet podcast close to the noise
 * floor reads as `silence`; very compressed music (lo-fi with vinyl hiss)
 * can read as `noise`; music on headphones is not heard at all.
 */
import type { SoundProfile } from '../../../engine'
import { binNoise, cellPowers, NOISE_HI_HZ, NOISE_LO_HZ, SUB_ALPHA, SUB_BETA, type NoiseProfile } from './noise'

export type SoundKind = 'silence' | 'voice' | 'music' | 'noise'
export const SOUND_KINDS: readonly SoundKind[] = ['silence', 'music', 'voice', 'noise']

/** Analysed band (Hz): the high-pass filter removes hum and thumps below 100 Hz; over 8 kHz little matters. */
const LO_HZ = NOISE_LO_HZ
const HI_HZ = NOISE_HI_HZ
const VOICE_LO_HZ = 300
const VOICE_HI_HZ = 3400
/** Log-spaced bands of the coarse profile (for stability between frames). */
const PROFILE_BANDS = 16
/** A tonal peak must stand this far over the mic noise in its bin (power ratio: 10 dB). */
const PEAK_OVER_NOISE = 10
/** Cap of one bin's power ratio over the noise in `aboveDb` (60 dB). */
const MAX_RATIO = 1e6

export interface FrameFeatures {
  /** RMS level of the time-domain frame, dBFS (−100 for digital silence). */
  rmsDb: number
  /** Mean bin power of 100–8000 Hz after removing the mic noise, dB (spectrum scale). Drives modulation and pauses. */
  cleanDb: number
  /** Mean per-bin power over the mic noise profile, dB (≈ 0 = only the mic's own noise); null without a profile. */
  aboveDb: number | null
  /** Spectral flatness 0–1 (1 = white noise, ~0 = pure tone). */
  flatness: number
  /** Spectral centroid, Hz. */
  centroidHz: number
  /** Share of the 100–8000 Hz energy that is in 300–3400 Hz. */
  voiceRatio: number
  /** Narrow peaks ≥ 12 dB over their neighbourhood and 10 dB over the mic noise (harmonics, notes). */
  tonalPeaks: number
  /** Band levels (dB), for frame-to-frame stability. */
  profile: number[]
  /** Raw (not denoised) mean power per noise cell, linear: input of the noise tracker and the calibration. */
  cells: number[]
}

export interface WindowFeatures {
  /** Level of the window (energy mean of the frames), dBFS. */
  rmsDb: number
  /** Level over the mic noise (energy mean of the frames), dB; null without a profile. */
  aboveDb: number | null
  /** Standard deviation of the frames' denoised levels, dB (speech is choppy, music and noise steadier). */
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
  /** Absolute level (dBFS) under which a window is always silence (muted or near-digital silence). */
  silenceDb: number
  /** Silence = less than this many dB over the mic's own noise… */
  noiseMarginDb: number
  /** …and never louder than this (dBFS): a loud steady room is not "silence". */
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
  silenceDb: -70,
  noiseMarginDb: 5,
  maxSilenceDb: -35,
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
 * (dB per bin, bin i centred at i · sampleRate / (2 · length)). With a
 * `noise` profile the mic's noise is subtracted from every bin first
 * (power − 2 × noise, with a floor of 8 % of the bin's power but never over
 * 8 % of the profile's median noise, so leftover hum flattens out instead of
 * keeping its comb shape), and a tonal peak must stand 10 dB over the noise
 * of its bin: steady hiss and hum lines no longer look like tones or sound.
 */
export function frameFeatures(spectrumDb: ArrayLike<number>, sampleRate: number, rmsDb: number, noise: NoiseProfile | null = null): FrameFeatures {
  const n = spectrumDb.length
  const binHz = sampleRate / (2 * n)
  const lo = Math.max(1, Math.ceil(LO_HZ / binHz))
  const hi = Math.min(n - 1, Math.floor(HI_HZ / binHz))
  const nb = noise ? binNoise(noise, n, sampleRate) : null
  let total = 0
  let ratioSum = 0
  let ratioBins = 0
  let voice = 0
  let weighted = 0
  let logSum = 0
  let count = 0
  const db: number[] = []
  const rawDb: number[] = []
  const strong: boolean[] = []
  for (let i = lo; i <= hi; i++) {
    const d = Number.isFinite(spectrumDb[i]!) ? Math.max(-160, spectrumDb[i]!) : -160
    const pr = Math.pow(10, d / 10)
    const nz = nb ? nb.bins[i]! : 0
    const p = (nb ? Math.max(pr - SUB_ALPHA * nz, Math.min(SUB_BETA * pr, nb.floor)) : pr) + EPS
    db.push(10 * Math.log10(p))
    rawDb.push(d)
    strong.push(!nb || pr >= PEAK_OVER_NOISE * nz)
    const f = i * binHz
    if (nz > 0) {
      ratioSum += Math.min(pr / nz, MAX_RATIO)
      ratioBins++
    }
    total += p
    weighted += p * f
    logSum += Math.log(p)
    count++
    if (f >= VOICE_LO_HZ && f <= VOICE_HI_HZ) voice += p
  }
  const cells = cellPowers(spectrumDb, sampleRate)
  if (count === 0) return { rmsDb, cleanDb: -160, aboveDb: null, flatness: 1, centroidHz: 0, voiceRatio: 0, tonalPeaks: 0, profile: [], cells }
  const flatness = Math.min(1, Math.exp(logSum / count) / (total / count))
  // Mean per-bin power ratio over the noise: every bin weighs the same, so loud narrow hum lines cannot hide broadband sound.
  const aboveDb = nb && ratioBins > 0 ? 10 * Math.log10(ratioSum / ratioBins) : null

  // Tonal peaks: local maxima ≥ 12 dB over the mean of a ±8-bin neighbourhood of the raw spectrum (subtraction
  // leaves random spikes in leftover noise; a raw noise bin practically never stands 12 dB over its neighbours),
  // and 10 dB over the mic noise of the bin (steady hum lines are not tones).
  let tonalPeaks = 0
  const R = 8
  for (let k = 1; k < rawDb.length - 1; k++) {
    const v = rawDb[k]!
    if (!strong[k] || v < rawDb[k - 1]! || v < rawDb[k + 1]!) continue
    let s = 0
    let c = 0
    for (let j = Math.max(0, k - R); j <= Math.min(rawDb.length - 1, k + R); j++) {
      if (Math.abs(j - k) <= 1) continue
      s += rawDb[j]!
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

  return {
    rmsDb,
    cleanDb: 10 * Math.log10(total / count),
    aboveDb,
    flatness,
    centroidHz: weighted / total,
    voiceRatio: voice / total,
    tonalPeaks,
    profile,
    cells,
  }
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

const energyDb = (vals: readonly number[]) => 10 * Math.log10(vals.reduce((s, v) => s + Math.pow(10, v / 10), 0) / Math.max(1, vals.length) + EPS)

/** Summary of the frames of one window (null if there are none). */
export function windowFeatures(frames: readonly FrameFeatures[]): WindowFeatures | null {
  const n = frames.length
  if (n === 0) return null
  const rmsDb = energyDb(frames.map((f) => f.rmsDb))
  const aboveDb = frames.every((f) => f.aboveDb !== null) ? energyDb(frames.map((f) => f.aboveDb!)) : null
  // Modulation and pauses on the denoised level: pauses between words fall under the mic noise, not just to it.
  const levels = frames.map((f) => f.cleanDb)
  const level = energyDb(levels)
  const meanLevel = levels.reduce((s, v) => s + v, 0) / n
  const modulationDb = Math.sqrt(levels.reduce((s, v) => s + (v - meanLevel) ** 2, 0) / n)
  const lowEnergyRate = levels.filter((v) => v <= level - 10).length / n
  // Spectral shape averaged over the audible frames only (pauses would drag it towards the room noise).
  const loud = frames.filter((f) => f.cleanDb > level - 10)
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
    aboveDb,
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

/**
 * Silence = nothing meaningfully over the mic's own noise: less than
 * `noiseMarginDb` over the noise profile (and not louder than
 * `maxSilenceDb`), or under the absolute `silenceDb`. Without a profile
 * (only the first window of an uncalibrated mic) just the absolute level.
 */
export function isSilent(w: WindowFeatures, th: Thresholds = DEFAULT_THRESHOLDS): boolean {
  if (w.rmsDb < th.silenceDb) return true
  return w.aboveDb !== null && w.aboveDb < th.noiseMarginDb && w.rmsDb <= th.maxSilenceDb
}

export function classifyWindow(w: WindowFeatures, th: Thresholds = DEFAULT_THRESHOLDS): SoundKind {
  if (isSilent(w, th)) return 'silence'
  if (w.flatness >= th.noiseFlatness) return 'noise'
  const choppy = w.modulationDb >= th.voiceModulationDb || w.lowEnergyRate >= th.voiceLowEnergyRate
  if (w.voiceRatio >= th.voiceRatio && choppy && w.stability < th.voiceMaxStability) return 'voice'
  if ((w.tonalPeaks >= th.musicPeaks && w.stability >= th.musicStability) || (w.flatness <= th.musicFlatness && !choppy)) return 'music'
  if (w.voiceRatio >= th.voiceRatio && choppy) return 'voice'
  return 'noise'
}

/**
 * May this window teach the noise tracker that the room got louder? Only
 * silence, or steady sound without tones a little over the floor (a fan, a
 * higher mic gain) — never speech or music, never a loud room.
 */
export function quietLike(w: WindowFeatures, kind: SoundKind, th: Thresholds = DEFAULT_THRESHOLDS): boolean {
  if (w.rmsDb > th.maxSilenceDb) return false
  if (kind === 'silence') return true
  return (
    w.aboveDb !== null &&
    w.aboveDb < th.noiseMarginDb + 3 &&
    w.tonalPeaks < 1 &&
    w.modulationDb < th.voiceModulationDb &&
    w.lowEnergyRate < th.voiceLowEnergyRate
  )
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

/**
 * Minimum analysed time before a profile is sent: 15 windows of 2 s. Real
 * sessions last ≥ 15 min, so this only rules out nearly empty samples (mic
 * lost at once, dev clock); the shares only tilt encounters slightly.
 */
export const MIN_PROFILE_SECONDS = 30

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
