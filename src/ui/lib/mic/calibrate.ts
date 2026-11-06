/**
 * Microphone calibration (pure). The wizard records ~5 s of each step —
 * silence (required: the mic's own noise), the player's voice
 * (recommended), and optionally music through the speakers — and
 * `calibrateFrames` turns them into a noise profile plus personal
 * `Thresholds` for `classifyWindow`.
 *
 * - Noise profile: per-cell median of the silent frames (`noise.ts`). Every
 *   step is then re-analysed with it, so the features below are measured
 *   after removing the mic's own noise.
 * - Silence: "silence" = less than `noiseMarginDb` over that noise. The margin
 *   covers how much the silent step itself wandered (+2.5 dB, at least 4 dB)
 *   but stays under 40 % of the gap to the quietest measured signal, so a
 *   quiet voice still counts. `maxSilenceDb` (never silence above) sits
 *   under the quietest signal, or 15 dB over the room when none was measured.
 * - Voice: the voice-band share, modulation and pause-rate thresholds drop to
 *   ~60–70 % of what this voice showed (never raised over the defaults: they
 *   are already permissive), and the spectral-stability cap goes over it.
 * - Music (optional): the tonal-peak and stability thresholds drop to what the
 *   music showed; when music and voice overlap, the boundaries are put
 *   halfway between them.
 * - Noise flatness stays over what voice and music showed.
 *
 * Anything not measured, or measured badly, keeps `DEFAULT_THRESHOLDS`, and
 * everything is clamped to `THRESHOLD_LIMITS`. Storage (per device,
 * localStorage) lives in `calibration-store.ts`.
 */
import { DEFAULT_THRESHOLDS, frameFeatures, windowFeatures, type FrameFeatures, type Thresholds, type WindowFeatures } from './classify'
import { estimateProfile, type NoiseProfile } from './noise'
import type { RawFrame } from './pipeline'

/** Frames per analysis window (2 s at one frame per 100 ms, like the session monitor). */
export const CAL_WINDOW_FRAMES = 20
/** Hop between calibration windows (0.5 s): ~7 overlapping windows from 5 s. */
export const CAL_HOP_FRAMES = 5
/** Duration of each step. */
export const CAL_STEP_MS = 5000
/** A silence step with fewer frames than this (2 s) is not usable. */
export const MIN_SILENCE_FRAMES = 20

export interface CalibrationMeasurements {
  /** Windows recorded while the room was silent (required). */
  silence: readonly WindowFeatures[]
  /** Windows recorded while the player talked (empty = skipped). */
  voice: readonly WindowFeatures[]
  /** Windows recorded with music through the speakers (null/empty = skipped). */
  music?: readonly WindowFeatures[] | null
}

export type CalibrationNote = 'noSilence' | 'voiceTooQuiet' | 'musicTooQuiet' | 'noisyRoom' | 'unsteadySilence'

export interface CalibrationResult {
  thresholds: Thresholds
  /** The mic's own noise (null when the silence step was unusable). */
  noise: NoiseProfile | null
  /** Which steps were usable. */
  measured: { silence: boolean; voice: boolean; music: boolean }
  /** Median levels (dBFS), for the summary. */
  floorDb: number | null
  voiceDb: number | null
  musicDb: number | null
  notes: CalibrationNote[]
}

/** Sliding 2 s windows over the frames of one step (one window if the step is shorter). */
export function stepWindows(frames: readonly FrameFeatures[], size = CAL_WINDOW_FRAMES, hop = CAL_HOP_FRAMES): WindowFeatures[] {
  if (frames.length === 0) return []
  if (frames.length <= size) {
    const w = windowFeatures(frames)
    return w ? [w] : []
  }
  const out: WindowFeatures[] = []
  for (let i = 0; i + size <= frames.length; i += hop) {
    const w = windowFeatures(frames.slice(i, i + size))
    if (w) out.push(w)
  }
  return out
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Quantile (0–1) of finite values, linear interpolation; null when empty. */
export function quantile(values: readonly (number | null)[], q: number): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const pos = clamp(q, 0, 1) * (v.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo)
}

const median = (values: readonly (number | null)[]) => quantile(values, 0.5)
const pick = <K extends keyof WindowFeatures>(ws: readonly WindowFeatures[], k: K) => ws.map((w) => w[k])
const round = (v: number, step: number) => Math.round(v / step) * step

/** Minimum gap (dB) over the mic noise for a voice/music step to count as measured. */
export const MIN_SIGNAL_GAP_DB = 6

/** Limits every personal threshold is kept within (also applied to stored values). */
export const THRESHOLD_LIMITS: Record<keyof Thresholds, readonly [number, number]> = {
  silenceDb: [-90, -50],
  noiseMarginDb: [2.5, 10],
  maxSilenceDb: [-60, -20],
  noiseFlatness: [0.3, 0.6],
  voiceRatio: [0.3, 0.7],
  voiceModulationDb: [2.5, 8],
  voiceLowEnergyRate: [0.06, 0.3],
  voiceMaxStability: [0.7, 0.97],
  musicPeaks: [1, 6],
  musicStability: [0.35, 0.85],
  musicFlatness: [0.05, 0.25],
}

/** Clamp every field into `THRESHOLD_LIMITS`, keep the order constraints, fill missing ones with defaults. */
export function sanitizeThresholds(raw: Partial<Record<keyof Thresholds, unknown>> | null | undefined): Thresholds {
  const out = { ...DEFAULT_THRESHOLDS }
  for (const k of Object.keys(THRESHOLD_LIMITS) as (keyof Thresholds)[]) {
    const v = raw?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = THRESHOLD_LIMITS[k]
      out[k] = clamp(v, lo, hi)
    }
  }
  // The loud-room cap must stay over the absolute silence level.
  if (out.maxSilenceDb < out.silenceDb + 3) out.maxSilenceDb = Math.min(THRESHOLD_LIMITS.maxSilenceDb[1], out.silenceDb + 3)
  // "Very tonal" music must stay clearly under broadband noise.
  if (out.musicFlatness > out.noiseFlatness - 0.1) out.musicFlatness = Math.max(THRESHOLD_LIMITS.musicFlatness[0], out.noiseFlatness - 0.1)
  return out
}

/** Gap of a step over the mic noise: level over the profile when known, else over the silent level. */
function gapOf(ws: readonly WindowFeatures[], floorDb: number): number | null {
  const above = median(pick(ws, 'aboveDb'))
  if (above !== null) return above
  const lvl = median(pick(ws, 'rmsDb'))
  return lvl === null ? null : lvl - floorDb
}

export function calibrate(m: CalibrationMeasurements, noise: NoiseProfile | null = null): CalibrationResult {
  const notes: CalibrationNote[] = []
  const th: Thresholds = { ...DEFAULT_THRESHOLDS }

  const floorDb = median(pick(m.silence, 'rmsDb'))
  if (floorDb === null) {
    // Nothing recorded at all: nothing personal can be derived.
    return { thresholds: { ...DEFAULT_THRESHOLDS }, noise: null, measured: { silence: false, voice: false, music: false }, floorDb: null, voiceDb: null, musicDb: null, notes: ['noSilence'] }
  }
  // A "silent" room this loud (fan, street) is still fine: it becomes the mic noise, but say so.
  if (floorDb > -45) notes.push('noisyRoom')
  const spread = (quantile(pick(m.silence, 'rmsDb'), 0.9) ?? floorDb) - (quantile(pick(m.silence, 'rmsDb'), 0.1) ?? floorDb)
  if (spread > 6) notes.push('unsteadySilence')

  const voiceGap = m.voice.length > 0 ? gapOf(m.voice, floorDb) : null
  const voiceOk = voiceGap !== null && voiceGap >= MIN_SIGNAL_GAP_DB
  if (m.voice.length > 0 && !voiceOk) notes.push('voiceTooQuiet')
  const music = m.music ?? []
  const musicGap = music.length > 0 ? gapOf(music, floorDb) : null
  const musicOk = musicGap !== null && musicGap >= MIN_SIGNAL_GAP_DB
  if (music.length > 0 && !musicOk) notes.push('musicTooQuiet')
  const voiceLevel = voiceOk ? median(pick(m.voice, 'rmsDb')) : null
  const musicLevel = musicOk ? median(pick(music, 'rmsDb')) : null

  // ---- Silence ---------------------------------------------------------------
  // How far over the noise the silent step itself went (≈ 0 when measured against its own profile).
  const silTop = quantile(pick(m.silence, 'aboveDb'), 0.9) ?? 0
  const gaps = [voiceOk ? voiceGap : null, musicOk ? musicGap : null].filter((v): v is number => v !== null)
  const gap = gaps.length > 0 ? Math.min(...gaps) : null
  const margin = Math.max(4, silTop + 2.5)
  th.noiseMarginDb = gap !== null ? Math.max(THRESHOLD_LIMITS.noiseMarginDb[0], Math.min(margin, gap * 0.4)) : margin
  const floorTop = quantile(pick(m.silence, 'rmsDb'), 0.9) ?? floorDb
  const levels = [voiceLevel, musicLevel].filter((v): v is number => v !== null)
  const quietest = levels.length > 0 ? Math.min(...levels) : null
  th.maxSilenceDb = Math.max(floorTop + 3, quietest !== null ? quietest - Math.max(3, (quietest - floorDb) * 0.4) : floorDb + 15)

  // ---- Voice -----------------------------------------------------------------
  const v = voiceOk ? m.voice : []
  const vRatio = quantile(pick(v, 'voiceRatio'), 0.25)
  const vMod = median(pick(v, 'modulationDb'))
  const vLow = median(pick(v, 'lowEnergyRate'))
  const vStab = quantile(pick(v, 'stability'), 0.75)
  if (vRatio !== null) th.voiceRatio = Math.min(DEFAULT_THRESHOLDS.voiceRatio, vRatio - 0.05)
  if (vMod !== null) th.voiceModulationDb = Math.min(DEFAULT_THRESHOLDS.voiceModulationDb, vMod * 0.6)
  if (vLow !== null) th.voiceLowEnergyRate = Math.min(DEFAULT_THRESHOLDS.voiceLowEnergyRate, vLow * 0.6)
  if (vStab !== null) th.voiceMaxStability = Math.max(DEFAULT_THRESHOLDS.voiceMaxStability, vStab + 0.05)

  // ---- Music -----------------------------------------------------------------
  const mu = musicOk ? music : []
  const mPeaks = median(pick(mu, 'tonalPeaks'))
  const mStab = quantile(pick(mu, 'stability'), 0.25)
  const mStabMed = median(pick(mu, 'stability'))
  const mFlat = median(pick(mu, 'flatness'))
  const mRatio = median(pick(mu, 'voiceRatio'))
  const mMod = median(pick(mu, 'modulationDb'))
  if (mPeaks !== null && mPeaks > 0) th.musicPeaks = Math.min(DEFAULT_THRESHOLDS.musicPeaks, Math.max(1, round(mPeaks * 0.7, 0.5)))
  if (mStab !== null) th.musicStability = Math.min(DEFAULT_THRESHOLDS.musicStability, mStab - 0.05)
  if (mFlat !== null) th.musicFlatness = Math.max(DEFAULT_THRESHOLDS.musicFlatness, Math.min(mFlat + 0.03, 0.25))

  // ---- Voice vs music boundaries ---------------------------------------------------
  if (voiceOk && musicOk) {
    const voiceStabMed = median(pick(v, 'stability'))!
    // Music steadier than this voice: the voice stability cap goes halfway between them.
    if (mStabMed !== null && mStabMed > voiceStabMed) th.voiceMaxStability = Math.min(th.voiceMaxStability, (voiceStabMed + mStabMed) / 2)
    // Music with a strong voice band (vocals) and choppy like the voice: raise the bar halfway.
    const voiceRatioMed = median(pick(v, 'voiceRatio'))!
    if (mRatio !== null && mRatio < voiceRatioMed && mRatio >= th.voiceRatio) th.voiceRatio = (mRatio + voiceRatioMed) / 2
    if (mMod !== null && vMod !== null && mMod < vMod && mMod >= th.voiceModulationDb) th.voiceModulationDb = (mMod + vMod) / 2
  }

  // ---- Noise -------------------------------------------------------------------
  const flats = [median(pick(v, 'flatness')), mFlat].filter((x): x is number => x !== null)
  if (flats.length > 0) th.noiseFlatness = Math.max(DEFAULT_THRESHOLDS.noiseFlatness, Math.max(...flats) + 0.1)

  return {
    thresholds: sanitizeThresholds(th),
    noise,
    measured: { silence: true, voice: voiceOk, music: musicOk },
    floorDb,
    voiceDb: voiceLevel,
    musicDb: musicLevel,
    notes,
  }
}

export interface CalibrationRecording {
  silence: readonly RawFrame[]
  voice: readonly RawFrame[]
  music?: readonly RawFrame[] | null
}

/**
 * The whole calibration from the raw frames of each step: the noise profile
 * from the silent frames, then every step analysed with it.
 */
export function calibrateFrames(rec: CalibrationRecording): CalibrationResult {
  const raw = (fs: readonly RawFrame[], noise: NoiseProfile | null) => fs.map((f) => frameFeatures(f.spectrumDb, f.sampleRate, f.rmsDb, noise))
  if (rec.silence.length < MIN_SILENCE_FRAMES) return calibrate({ silence: [], voice: [] })
  const noise = estimateProfile(raw(rec.silence, null).map((f) => f.cells))
  if (!noise) return calibrate({ silence: [], voice: [] })
  return calibrate(
    {
      silence: stepWindows(raw(rec.silence, noise)),
      voice: stepWindows(raw(rec.voice, noise)),
      music: rec.music ? stepWindows(raw(rec.music, noise)) : null,
    },
    noise,
  )
}
