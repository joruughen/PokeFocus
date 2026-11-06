import { describe, expect, it } from 'vitest'
import { calibrateFrames, THRESHOLD_LIMITS } from './calibrate'
import { classifyWindow, DEFAULT_THRESHOLDS, frameFeatures, windowFeatures, type SoundKind, type Thresholds } from './classify'
import { estimateProfile, NOISE_CELLS, profileLevelDb, sanitizeProfile, TRACK_CAP_DB, trackerInit, trackNoise, type NoiseProfile } from './noise'
import { createPipeline, type RawFrame } from './pipeline'
import { sceneFrames, type MicNoise, type Scene } from './test-spectra'

const features = (fs: RawFrame[], noise: NoiseProfile | null) => fs.map((f) => frameFeatures(f.spectrumDb, f.sampleRate, f.rmsDb, noise))
const profileOf = (seed: number, mic: MicNoise = {}) => estimateProfile(features(sceneFrames('silence', 50, seed, mic), null).map((f) => f.cells))!

/** Kinds of `windows` consecutive 2 s windows of a scene. */
function kinds(scene: Scene, noise: NoiseProfile | null, opts: { windows?: number; seed?: number; mic?: MicNoise; th?: Thresholds } = {}): SoundKind[] {
  const { windows = 4, seed = 100, mic = {}, th = DEFAULT_THRESHOLDS } = opts
  const out: SoundKind[] = []
  for (let k = 0; k < windows; k++) out.push(classifyWindow(windowFeatures(features(sceneFrames(scene, 20, seed + k * 31, mic), noise))!, th))
  return out
}

describe('noise profile', () => {
  it('estimates the hiss level and keeps the hum lines', () => {
    const p = profileOf(1)
    expect(p.db).toHaveLength(NOISE_CELLS)
    // Hiss cells near −95 dB (bias-corrected median), hum cells clearly higher.
    const hissCell = p.db[Math.floor((5025 - 100) / 50)]!
    expect(hissCell).toBeGreaterThan(-97.5)
    expect(hissCell).toBeLessThan(-92.5)
    const humCell = p.db[Math.floor((200 - 100) / 50)]!
    expect(humCell).toBeGreaterThan(hissCell + 15)
  })

  it('sanitizeProfile validates stored profiles', () => {
    const p = profileOf(2)
    expect(sanitizeProfile(JSON.parse(JSON.stringify(p)))).toEqual(p)
    expect(sanitizeProfile({ db: [1, 2, 3] })).toBeNull()
    expect(sanitizeProfile({ db: Array(NOISE_CELLS).fill('x') })).toBeNull()
    expect(sanitizeProfile(null)).toBeNull()
    expect(sanitizeProfile({ db: Array(NOISE_CELLS).fill(50) })!.db[0]).toBe(0)
  })
})

describe('noisy mic: hiss + mains hum harmonics', () => {
  it('the reported bug: a strong hum in a silent room reads as music without the profile; with it, silence', () => {
    const mic: MicNoise = { humDb: -60 }
    expect(kinds('silence', null, { mic })).toEqual(Array(4).fill('music'))
    const noise = profileOf(6, mic)
    const after = features(sceneFrames('silence', 20, 50, mic), noise)
    expect(Math.max(...after.map((f) => f.tonalPeaks))).toBeLessThanOrEqual(1)
    expect(Math.abs(windowFeatures(after)!.aboveDb!)).toBeLessThan(2)
    expect(kinds('silence', noise, { mic, windows: 8 })).toEqual(Array(8).fill('silence'))
  })

  it('without the profile even mild mic noise is not silence (−52 dBFS hiss + hum)', () => {
    expect(kinds('silence', null)).not.toContain('silence')
  })

  for (const [label, mic] of [
    ['mild hum, 50 Hz', { humDb: -72 }],
    ['strong hum, 50 Hz', { humDb: -60 }],
    ['strong hum, 60 Hz', { humDb: -60, mains: 60 }],
  ] as [string, MicNoise][]) {
    describe(label, () => {
      const noise = profileOf(7, mic)
      it('silence', () => expect(kinds('silence', noise, { mic, windows: 8 })).toEqual(Array(8).fill('silence')))
      it('same noise + voice-like modulated band energy → voice', () => expect(kinds('voice', noise, { mic, windows: 6 })).toEqual(Array(6).fill('voice')))
      it('same noise + a stable tonal chord → music', () => expect(kinds('music', noise, { mic, windows: 6 })).toEqual(Array(6).fill('music')))
      it('broadband noise well over the floor → noise', () => expect(kinds('loudNoise', noise, { mic, windows: 6 })).toEqual(Array(6).fill('noise')))
    })
  }

  it('a slightly noisier room (+2 dB) is still silence', () => {
    const noise = profileOf(9)
    expect(kinds('silence', noise, { mic: { hissDb: -93, humDb: -70 }, windows: 6 })).toEqual(Array(6).fill('silence'))
  })
})

describe('noise tracker', () => {
  const base = profileOf(11)
  const est = (db: number) => Array(NOISE_CELLS).fill(Math.pow(10, db / 10))

  it('bootstraps from the first window that is not loud', () => {
    expect(trackNoise(trackerInit(null), est(-90), { quietLike: false, loud: true }).profile).toBeNull()
    const t = trackNoise(trackerInit(null), est(-90), { quietLike: false, loud: false })
    expect(t.profile!.db[0]).toBeCloseTo(-90, 0)
    expect(t.base).toBe(t.profile)
  })

  it('follows quieter cells down quickly, louder ones up slowly and only from quiet-like windows, within the cap', () => {
    const flat: NoiseProfile = { db: Array(NOISE_CELLS).fill(-90) }
    let t = trackerInit(flat)
    t = trackNoise(t, est(-100), { quietLike: false, loud: false })
    expect(t.profile!.db[0]).toBeLessThan(-92) // half-way in power: about −92.6 dB
    t = trackerInit(flat)
    expect(trackNoise(t, est(-80), { quietLike: false, loud: false }).profile!.db[0]).toBe(-90)
    expect(trackNoise(t, est(-80), { quietLike: true, loud: true }).profile!.db[0]).toBe(-90)
    const up = trackNoise(t, est(-80), { quietLike: true, loud: false }).profile!.db[0]!
    expect(up).toBeGreaterThan(-90)
    expect(up).toBeLessThan(-86)
    for (let i = 0; i < 400; i++) t = trackNoise(t, est(-40), { quietLike: true, loud: false })
    expect(t.profile!.db[0]).toBe(-90 + TRACK_CAP_DB)
  })

  it('ignores malformed estimates', () => {
    const t = trackerInit(base)
    expect(trackNoise(t, null, { quietLike: true, loud: false })).toBe(t)
    expect(trackNoise(t, [1, 2], { quietLike: true, loud: false })).toBe(t)
  })

  it('profile level summary', () => {
    expect(profileLevelDb({ db: Array(NOISE_CELLS).fill(-100) })).toBeCloseTo(-100 + 10 * Math.log10(NOISE_CELLS), 3)
  })
})

describe('pipeline', () => {
  const run = (pipe: ReturnType<typeof createPipeline>, frames: RawFrame[]) => {
    const out: SoundKind[] = []
    for (let i = 0; i < frames.length; i++) {
      pipe.push(frames[i]!)
      if (pipe.pending === 20) out.push(pipe.endWindow()!.kind)
    }
    return out
  }

  it('uncalibrated mic: learns its noise from the first quiet window, then tells silence from voice', () => {
    const pipe = createPipeline({ thresholds: DEFAULT_THRESHOLDS, noise: null })
    expect(pipe.noise).toBeNull()
    run(pipe, sceneFrames('silence', 20, 300))
    expect(pipe.noise).not.toBeNull()
    expect(run(pipe, sceneFrames('silence', 80, 301))).toEqual(Array(4).fill('silence'))
    expect(run(pipe, sceneFrames('voice', 80, 302))).toEqual(Array(4).fill('voice'))
    expect(run(pipe, sceneFrames('silence', 40, 303))).toEqual(Array(2).fill('silence'))
  })

  it('a quieter room after calibrating: the profile follows it down', () => {
    const noisy = profileOf(12, { hissDb: -88, humDb: -65 })
    const pipe = createPipeline({ thresholds: DEFAULT_THRESHOLDS, noise: noisy })
    run(pipe, sceneFrames('silence', 100, 304))
    // Voice that would sit near the old (louder) floor is still heard as voice.
    expect(run(pipe, sceneFrames('voice', 60, 305))).toEqual(Array(3).fill('voice'))
    expect(pipe.noise!.db[100]!).toBeLessThan(noisy.db[100]! - 4)
  })

  it('a steady fan a few dB over the calibrated noise becomes "the room" within about a minute; speech never does', () => {
    const pipe = createPipeline({ thresholds: DEFAULT_THRESHOLDS, noise: profileOf(13) })
    const fan: MicNoise = { hissDb: -88.5 } // +6.5 dB of steady hiss
    const first = run(pipe, sceneFrames('silence', 20, 306, fan))
    expect(first).toEqual(['noise'])
    run(pipe, sceneFrames('silence', 20 * 40, 307, fan))
    expect(run(pipe, sceneFrames('silence', 60, 308, fan))).toEqual(Array(3).fill('silence'))
    expect(run(pipe, sceneFrames('voice', 60, 309, fan))).toEqual(Array(3).fill('voice'))
  })

  it('a loud steady room (+20 dB) is never learnt as silence', () => {
    const pipe = createPipeline({ thresholds: DEFAULT_THRESHOLDS, noise: profileOf(14) })
    const out = run(pipe, sceneFrames('loudNoise', 20 * 60, 310))
    expect(out.slice(-5)).toEqual(Array(5).fill('noise'))
  })

  it('no frames → no window', () => {
    expect(createPipeline({ thresholds: DEFAULT_THRESHOLDS, noise: null }).endWindow()).toBeNull()
  })
})

describe('calibrateFrames', () => {
  it('silence + voice + speaker music: profile and thresholds that tell them apart', () => {
    const r = calibrateFrames({ silence: sceneFrames('silence', 50, 400), voice: sceneFrames('voice', 50, 401), music: sceneFrames('music', 50, 402) })
    expect(r.measured).toEqual({ silence: true, voice: true, music: true })
    expect(r.noise).not.toBeNull()
    for (const [k, [lo, hi]] of Object.entries(THRESHOLD_LIMITS) as [keyof Thresholds, readonly [number, number]][]) {
      expect(r.thresholds[k], k).toBeGreaterThanOrEqual(lo)
      expect(r.thresholds[k], k).toBeLessThanOrEqual(hi)
    }
    const th = r.thresholds
    expect(kinds('silence', r.noise, { th, seed: 500, windows: 6 })).toEqual(Array(6).fill('silence'))
    expect(kinds('voice', r.noise, { th, seed: 600, windows: 6 })).toEqual(Array(6).fill('voice'))
    expect(kinds('music', r.noise, { th, seed: 700, windows: 6 })).toEqual(Array(6).fill('music'))
    expect(kinds('loudNoise', r.noise, { th, seed: 800, windows: 6 })).toEqual(Array(6).fill('noise'))
  })

  it('silence only (voice and music skipped) is enough', () => {
    const r = calibrateFrames({ silence: sceneFrames('silence', 50, 410), voice: [], music: null })
    expect(r.measured).toEqual({ silence: true, voice: false, music: false })
    expect(r.notes).toEqual([])
    expect(kinds('silence', r.noise, { th: r.thresholds, seed: 510 })).toEqual(Array(4).fill('silence'))
    expect(kinds('voice', r.noise, { th: r.thresholds, seed: 610 })).toEqual(Array(4).fill('voice'))
  })

  it('a silence step that is too short fails', () => {
    const r = calibrateFrames({ silence: sceneFrames('silence', 5, 420), voice: [] })
    expect(r.measured.silence).toBe(false)
    expect(r.noise).toBeNull()
    expect(r.notes).toContain('noSilence')
  })
})
