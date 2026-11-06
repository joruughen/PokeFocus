/**
 * Frames → 2 s windows → kinds, with the mic noise tracked (no Web Audio, so
 * tests can drive it). Shared by the session monitor and the live meter, so
 * both classify the same way.
 */
import { classifyWindow, frameFeatures, quietLike, windowFeatures, type FrameFeatures, type SoundKind, type Thresholds, type WindowFeatures } from './classify'
import { medianCells, trackerInit, trackNoise, type NoiseProfile, type NoiseTracker } from './noise'

/** One analyser read: dB spectrum, time-domain level and the context's rate. */
export interface RawFrame {
  spectrumDb: Float32Array
  rmsDb: number
  sampleRate: number
}

export interface SoundPipeline {
  /** Analyse one frame (with the current noise estimate) and keep it for the window. */
  push(raw: RawFrame): FrameFeatures
  /** Frames since the last window. */
  readonly pending: number
  /** Close the window: classify it and update the noise estimate. Null without frames. */
  endWindow(): { kind: SoundKind; w: WindowFeatures } | null
  /** Drop the frames of this window unclassified (too few to judge); the noise estimate is untouched. */
  discardWindow(): void
  /** Current noise estimate (null before the first window of an uncalibrated mic). */
  readonly noise: NoiseProfile | null
}

export function createPipeline(opts: { thresholds: Thresholds; noise: NoiseProfile | null }): SoundPipeline {
  let tracker: NoiseTracker = trackerInit(opts.noise)
  let frames: FrameFeatures[] = []
  return {
    push(raw) {
      const f = frameFeatures(raw.spectrumDb, raw.sampleRate, raw.rmsDb, tracker.profile)
      frames.push(f)
      return f
    },
    get pending() {
      return frames.length
    },
    endWindow() {
      const fs = frames
      frames = []
      const w = windowFeatures(fs)
      if (!w) return null
      const kind = classifyWindow(w, opts.thresholds)
      tracker = trackNoise(tracker, medianCells(fs.map((f) => f.cells)), {
        quietLike: quietLike(w, kind, opts.thresholds),
        loud: w.rmsDb > opts.thresholds.maxSilenceDb,
      })
      return { kind, w }
    },
    discardWindow() {
      frames = []
    },
    get noise() {
      return tracker.profile
    },
  }
}
