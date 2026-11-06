import { describe, expect, it } from 'vitest'
import {
  addWindow,
  classifyWindow,
  dominantOf,
  EMPTY_TALLY,
  frameFeatures,
  parseTally,
  profileOf,
  rmsDbOf,
  isSilent,
  quietLike,
  windowFeatures,
  type FrameFeatures,
  type WindowFeatures,
} from './classify'

const SR = 48_000
const BINS = 1024 // fftSize 2048
const binHz = SR / (2 * BINS)

/** A spectrum (dB per bin) from a function of frequency. */
function spectrum(fn: (hz: number) => number): Float32Array {
  const s = new Float32Array(BINS)
  for (let i = 0; i < BINS; i++) s[i] = fn(i * binHz)
  return s
}

/** Deterministic pseudo-random jitter in ±amp dB. */
function jitter(seed: number, amp: number): (i: number) => number {
  return (i) => {
    const x = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453
    return (x - Math.floor(x) - 0.5) * 2 * amp
  }
}

const white = (level: number, seed = 1) => {
  const j = jitter(seed, 2)
  return spectrum((hz) => level + j(Math.round(hz / binHz)))
}

/** Harmonic series at f0 (every harmonic 30 dB over the floor). */
const harmonic = (f0: number, floor = -100, peak = -40) =>
  spectrum((hz) => {
    const h = hz / f0
    const near = Math.abs(h - Math.round(h)) * f0 < binHz * 0.6 && Math.round(h) >= 1
    return near ? peak - Math.round(h) * 0.5 : floor
  })

/** Voice-like: energy concentrated in 300–3400 Hz with formant bumps. */
const voiced = (formant: number, level = -45) =>
  spectrum((hz) => {
    if (hz < 300 || hz > 3400) return level - 35
    return level - Math.abs(hz - formant) / 120
  })

const W = (p: Partial<WindowFeatures>): WindowFeatures => ({
  rmsDb: -30,
  aboveDb: null,
  modulationDb: 2,
  lowEnergyRate: 0,
  flatness: 0.2,
  centroidHz: 1500,
  voiceRatio: 0.4,
  tonalPeaks: 0,
  stability: 0.7,
  frames: 20,
  ...p,
})

describe('frame features', () => {
  it('rmsDbOf: full-scale sine ≈ −3 dBFS, zeros = −100', () => {
    const s = Float32Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / SR))
    expect(rmsDbOf(s)).toBeCloseTo(-3.01, 1)
    expect(rmsDbOf(new Float32Array(2048))).toBe(-100)
  })

  it('white noise is flat; a harmonic tone is not and has peaks', () => {
    const n = frameFeatures(white(-60), SR, -30)
    expect(n.flatness).toBeGreaterThan(0.8)
    expect(n.tonalPeaks).toBeLessThan(3)
    const tone = frameFeatures(harmonic(220), SR, -30)
    expect(tone.flatness).toBeLessThan(0.05)
    expect(tone.tonalPeaks).toBeGreaterThanOrEqual(10)
  })

  it('voice-band energy share and centroid', () => {
    const v = frameFeatures(voiced(1000), SR, -30)
    expect(v.voiceRatio).toBeGreaterThan(0.9)
    expect(v.centroidHz).toBeGreaterThan(600)
    expect(v.centroidHz).toBeLessThan(1600)
    const hiss = frameFeatures(spectrum((hz) => (hz > 5000 ? -40 : -110)), SR, -30)
    expect(hiss.voiceRatio).toBeLessThan(0.05)
    expect(hiss.centroidHz).toBeGreaterThan(5000)
  })

  it('band profile has 16 bands; non-finite bins are tolerated', () => {
    const s = white(-60)
    s[10] = -Infinity
    s[11] = NaN
    const f = frameFeatures(s, SR, -40)
    expect(f.profile).toHaveLength(16)
    expect(Number.isFinite(f.flatness)).toBe(true)
  })
})

describe('window features', () => {
  const frame = (rmsDb: number, spec: Float32Array) => frameFeatures(spec, SR, rmsDb)

  it('steady frames: low modulation, no pauses, high stability', () => {
    const frames = Array.from({ length: 20 }, () => frame(-30, harmonic(220)))
    const w = windowFeatures(frames)!
    expect(w.modulationDb).toBeCloseTo(0, 5)
    expect(w.lowEnergyRate).toBe(0)
    expect(w.stability).toBeGreaterThan(0.99)
    expect(w.rmsDb).toBeCloseTo(-30, 5)
  })

  it('speech-like frames: choppy level, pauses and a moving spectrum', () => {
    const frames: FrameFeatures[] = []
    for (let i = 0; i < 20; i++) {
      const pause = i % 4 === 3
      frames.push(pause ? frame(-60, white(-110, i)) : frame(-28 - (i % 3) * 4, voiced(500 + ((i * 700) % 2400))))
    }
    const w = windowFeatures(frames)!
    expect(w.lowEnergyRate).toBeGreaterThanOrEqual(0.2)
    expect(w.modulationDb).toBeGreaterThan(5)
    expect(w.voiceRatio).toBeGreaterThan(0.8) // averaged over the audible frames only
    expect(classifyWindow(w)).toBe('voice')
  })

  it('no frames → null', () => {
    expect(windowFeatures([])).toBeNull()
  })

  it('end to end: synthetic music, noise and silence windows', () => {
    const music = windowFeatures(Array.from({ length: 20 }, (_, i) => frame(-26 - (i % 2), harmonic(i < 10 ? 220 : 330))))!
    expect(classifyWindow(music)).toBe('music')
    const noise = windowFeatures(Array.from({ length: 20 }, (_, i) => frame(-32, white(-55, i))))!
    expect(classifyWindow(noise)).toBe('noise')
    const quiet = windowFeatures(Array.from({ length: 20 }, (_, i) => frame(-80, white(-120, i))))!
    expect(classifyWindow(quiet)).toBe('silence')
  })
})

describe('classifyWindow (feature vectors)', () => {
  it('silence: under the absolute level, or close to the mic noise (and not loud)', () => {
    expect(classifyWindow(W({ rmsDb: -80 }))).toBe('silence')
    // A steady −44 dBFS hiss that is the mic's own noise (≈ 0 dB over its profile) is silence…
    expect(classifyWindow(W({ rmsDb: -44, aboveDb: 1, flatness: 0.6 }))).toBe('silence')
    // …but not without a profile, not well over the noise, and a loud room is never silence.
    expect(classifyWindow(W({ rmsDb: -44, aboveDb: null, flatness: 0.6 }))).toBe('noise')
    expect(classifyWindow(W({ rmsDb: -44, aboveDb: 9, flatness: 0.6 }))).toBe('noise')
    expect(classifyWindow(W({ rmsDb: -30, aboveDb: 1, flatness: 0.6 }))).toBe('noise')
    expect(isSilent(W({ rmsDb: -50, aboveDb: 4.9 }))).toBe(true)
    expect(isSilent(W({ rmsDb: -50, aboveDb: 5 }))).toBe(false)
  })

  it('noise: broadband (high flatness) even if choppy', () => {
    expect(classifyWindow(W({ flatness: 0.55, modulationDb: 8, voiceRatio: 0.7 }))).toBe('noise')
  })

  it('voice: voice band + choppy + moving spectrum', () => {
    expect(classifyWindow(W({ voiceRatio: 0.7, modulationDb: 7, stability: 0.5, tonalPeaks: 4 }))).toBe('voice')
    expect(classifyWindow(W({ voiceRatio: 0.7, lowEnergyRate: 0.3, stability: 0.6 }))).toBe('voice')
  })

  it('music: tonal and steady, or very tonal and continuous', () => {
    expect(classifyWindow(W({ tonalPeaks: 6, stability: 0.8, voiceRatio: 0.6, modulationDb: 2 }))).toBe('music')
    expect(classifyWindow(W({ flatness: 0.08, tonalPeaks: 1, stability: 0.4 }))).toBe('music')
    // Sung vocals over steady accompaniment: voice band, choppy but a very stable spectrum → music.
    expect(classifyWindow(W({ voiceRatio: 0.7, modulationDb: 6, stability: 0.9, tonalPeaks: 5 }))).toBe('music')
  })

  it('unsure → noise', () => {
    expect(classifyWindow(W({ flatness: 0.3, tonalPeaks: 1, stability: 0.3, voiceRatio: 0.3 }))).toBe('noise')
  })

  it('quietLike: what may teach the noise tracker that the room got louder', () => {
    expect(quietLike(W({ rmsDb: -60, aboveDb: 1 }), 'silence')).toBe(true)
    // Steady, toneless, a little over the floor (a fan): yes.
    expect(quietLike(W({ rmsDb: -55, aboveDb: 6, tonalPeaks: 0, modulationDb: 1 }), 'noise')).toBe(true)
    // Speech, tones, too far over the floor, or a loud room: no.
    expect(quietLike(W({ rmsDb: -55, aboveDb: 6, modulationDb: 7 }), 'voice')).toBe(false)
    expect(quietLike(W({ rmsDb: -55, aboveDb: 6, tonalPeaks: 2 }), 'noise')).toBe(false)
    expect(quietLike(W({ rmsDb: -55, aboveDb: 12 }), 'noise')).toBe(false)
    expect(quietLike(W({ rmsDb: -30, aboveDb: 1 }), 'silence')).toBe(false)
  })
})

describe('tally → profile', () => {
  it('shares sum to 1 and pass the server check (each 0–1, sum ≤ 1.05)', () => {
    let t = EMPTY_TALLY
    t = addWindow(t, 'silence', 1000)
    t = addWindow(t, 'music', 333)
    t = addWindow(t, 'voice', 333)
    t = addWindow(t, 'noise', 334)
    const p = profileOf(t)!
    const sum = p.silence + p.music + p.voice + p.noise
    expect(sum).toBeGreaterThan(0.99)
    expect(sum).toBeLessThanOrEqual(1.003)
    expect(p.silence).toBe(0.5)
    expect(dominantOf(t)).toBe('silence')
  })

  it('too little analysed time → no profile; ignores bad durations', () => {
    expect(profileOf(addWindow(EMPTY_TALLY, 'music', 29))).toBeNull()
    expect(profileOf(addWindow(EMPTY_TALLY, 'music', 30))).not.toBeNull()
    expect(addWindow(EMPTY_TALLY, 'music', -5)).toBe(EMPTY_TALLY)
    expect(addWindow(EMPTY_TALLY, 'music', NaN)).toBe(EMPTY_TALLY)
    expect(dominantOf(EMPTY_TALLY)).toBeNull()
  })

  it('parseTally validates stored data', () => {
    expect(parseTally({ silence: 1, music: 2, voice: 0, noise: 0 })).toEqual({ silence: 1, music: 2, voice: 0, noise: 0 })
    expect(parseTally({ silence: 1 })).toBeNull()
    expect(parseTally({ silence: -1, music: 0, voice: 0, noise: 0 })).toBeNull()
    expect(parseTally('x')).toBeNull()
  })
})
