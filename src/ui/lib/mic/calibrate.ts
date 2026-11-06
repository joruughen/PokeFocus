/**
 * Microphone calibration (pure). The wizard records ~5 s of each step —
 * silence (room + mic noise floor), the player's voice, and optionally their
 * music — and `calibrate` turns those measurements into personal
 * `Thresholds` for `classifyWindow`.
 *
 * Rules (each clamped to a sane range; anything not measured, or measured
 * badly, keeps `DEFAULT_THRESHOLDS`):
 * - Silence: the floor is the median level of the silent windows. The
 *   silence threshold sits a few dB over it, and always well under the voice
 *   level (at most 40 % of the floor→voice gap), so a quiet voice still counts.
 * - Voice: the voice-band share, modulation and pause-rate thresholds drop to
 *   ~60–70 % of what this voice showed (never raised over the defaults: they
 *   are already permissive), and the spectral-stability cap goes over it.
 * - Music (optional): the tonal-peak and stability thresholds drop to what the
 *   music showed; when music and voice overlap, the boundaries are put
 *   halfway between them.
 * - Noise flatness stays over what voice and music showed.
 *
 * Storage (per device, localStorage) lives in `calibration-store.ts`.
 */
import { DEFAULT_THRESHOLDS, windowFeatures, type FrameFeatures, type Thresholds, type WindowFeatures } from './classify'

/** Frames per analysis window (2 s at one frame per 100 ms, like the session monitor). */
export const CAL_WINDOW_FRAMES = 20
/** Hop between calibration windows (0.5 s): ~7 overlapping windows from 5 s. */
export const CAL_HOP_FRAMES = 5
/** Duration of each step. */
export const CAL_STEP_MS = 5000

export interface CalibrationMeasurements {
  /** Windows recorded while the room was silent (required). */
  silence: readonly WindowFeatures[]
  /** Windows recorded while the player talked (empty = not measured). */
  voice: readonly WindowFeatures[]
  /** Windows recorded with the player's music (null/empty = skipped, e.g. headphones). */
  music?: readonly WindowFeatures[] | null
}

export type CalibrationNote = 'noSilence' | 'voiceTooQuiet' | 'musicTooQuiet' | 'noisyRoom'

export interface CalibrationResult {
  thresholds: Thresholds
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
export function quantile(values: readonly number[], q: number): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length === 0) return null
  const pos = clamp(q, 0, 1) * (v.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo)
}

const median = (values: readonly number[]) => quantile(values, 0.5)
const pick = (ws: readonly WindowFeatures[], k: keyof WindowFeatures) => ws.map((w) => w[k])
const round = (v: number, step: number) => Math.round(v / step) * step

/** Minimum gap (dB) over the floor for a voice/music step to count as measured. */
export const MIN_SIGNAL_GAP_DB = 6

/** Limits every personal threshold is kept within (also applied to stored values). */
export const THRESHOLD_LIMITS: Record<keyof Thresholds, readonly [number, number]> = {
  silenceDb: [-80, -40],
  floorMarginDb: [2, 8],
  maxSilenceDb: [-80, -30],
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
  // A loud-room cap under the absolute silence level would make no sense.
  if (out.maxSilenceDb < out.silenceDb) out.maxSilenceDb = Math.min(THRESHOLD_LIMITS.maxSilenceDb[1], out.silenceDb + 3)
  // "Very tonal" music must stay clearly under broadband noise.
  if (out.musicFlatness > out.noiseFlatness - 0.1) out.musicFlatness = Math.max(THRESHOLD_LIMITS.musicFlatness[0], out.noiseFlatness - 0.1)
  return out
}

export function calibrate(m: CalibrationMeasurements): CalibrationResult {
  const notes: CalibrationNote[] = []
  const th: Thresholds = { ...DEFAULT_THRESHOLDS }

  const floorDb = median(pick(m.silence, 'rmsDb'))
  if (floorDb === null) {
    // Nothing recorded at all: nothing personal can be derived.
    return { thresholds: { ...DEFAULT_THRESHOLDS }, measured: { silence: false, voice: false, music: false }, floorDb: null, voiceDb: null, musicDb: null, notes: ['noSilence'] }
  }
  // A "silent" room this loud (fan, street) is still fine: it becomes the floor, but say so.
  if (floorDb > -45) notes.push('noisyRoom')

  const voiceLevel = median(pick(m.voice, 'rmsDb'))
  const voiceOk = voiceLevel !== null && voiceLevel - floorDb >= MIN_SIGNAL_GAP_DB
  if (m.voice.length > 0 && !voiceOk) notes.push('voiceTooQuiet')
  const music = m.music ?? []
  const musicLevel = median(pick(music, 'rmsDb'))
  const musicOk = musicLevel !== null && musicLevel - floorDb >= MIN_SIGNAL_GAP_DB
  if (music.length > 0 && !musicOk) notes.push('musicTooQuiet')

  // ---- Silence ---------------------------------------------------------------
  // Loudest silent window + a little: brief creaks in the silent step should still read as silence.
  const floorTop = quantile(pick(m.silence, 'rmsDb'), 0.9) ?? floorDb
  const signals = [voiceOk ? voiceLevel : null, musicOk ? musicLevel : null].filter((v): v is number => v !== null)
  const quietest = signals.length > 0 ? Math.min(...signals) : null
  const gap = quietest !== null ? quietest - floorDb : null
  // Margin over the floor: 3–6 dB, but never more than 40 % of the way to the quietest signal.
  const margin = gap !== null ? Math.min(6, Math.max(3, floorTop - floorDb + 2), gap * 0.4) : Math.min(6, Math.max(3, floorTop - floorDb + 2))
  th.silenceDb = floorDb + margin
  th.floorMarginDb = gap !== null ? Math.min(DEFAULT_THRESHOLDS.floorMarginDb, Math.max(2, gap * 0.4)) : DEFAULT_THRESHOLDS.floorMarginDb
  // Cap for the adaptive floor: stays under the quietest signal (or 14 dB over this floor when none was measured).
  th.maxSilenceDb = quietest !== null ? quietest - Math.max(3, gap! * 0.4) : floorDb + 14

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

  const thresholds = sanitizeThresholds(th)
  return {
    thresholds,
    measured: { silence: true, voice: voiceOk, music: musicOk },
    floorDb,
    voiceDb: voiceOk ? voiceLevel : null,
    musicDb: musicOk ? musicLevel : null,
    notes,
  }
}
