import { describe, expect, it } from 'vitest'
import { calibrate, quantile, sanitizeThresholds, stepWindows, THRESHOLD_LIMITS } from './calibrate'
import { classifyWindow, DEFAULT_THRESHOLDS, type FrameFeatures, type Thresholds, type WindowFeatures } from './classify'
import { NOISE_CELLS, type NoiseProfile } from './noise'

const W = (p: Partial<WindowFeatures>): WindowFeatures => ({
  rmsDb: -60,
  aboveDb: null,
  modulationDb: 1,
  lowEnergyRate: 0,
  flatness: 0.3,
  centroidHz: 1200,
  voiceRatio: 0.4,
  tonalPeaks: 0,
  stability: 0.95,
  frames: 20,
  ...p,
})

/** n windows around a base, with a small deterministic spread. */
const many = (n: number, base: Partial<WindowFeatures>, spread: Partial<Record<keyof WindowFeatures, number>> = {}) =>
  Array.from({ length: n }, (_, i) => {
    const k = (i - (n - 1) / 2) / Math.max(1, (n - 1) / 2) // −1…1
    const out = W(base)
    for (const [key, amp] of Object.entries(spread) as [keyof WindowFeatures, number][]) (out[key] as number) += k * amp
    return out
  })

// Windows as measured against the calibrated noise profile (aboveDb ≈ 0 for the silent room).
const quietRoom = many(7, { rmsDb: -68, aboveDb: 0.3, flatness: 0.5, stability: 0.9 }, { rmsDb: 1, aboveDb: 0.6 })
const quietVoice = many(7, { rmsDb: -50, aboveDb: 18, voiceRatio: 0.5, modulationDb: 4, lowEnergyRate: 0.12, stability: 0.6, flatness: 0.15, tonalPeaks: 2 }, { rmsDb: 2, aboveDb: 2, voiceRatio: 0.03 })
const music = many(7, { rmsDb: -44, aboveDb: 24, voiceRatio: 0.4, modulationDb: 1.5, lowEnergyRate: 0, stability: 0.8, flatness: 0.1, tonalPeaks: 2 }, { stability: 0.03 })

function within(th: Thresholds) {
  for (const [k, [lo, hi]] of Object.entries(THRESHOLD_LIMITS) as [keyof Thresholds, readonly [number, number]][]) {
    expect(th[k], k).toBeGreaterThanOrEqual(lo)
    expect(th[k], k).toBeLessThanOrEqual(hi)
  }
}

describe('calibrate', () => {
  it('nothing recorded → defaults', () => {
    const r = calibrate({ silence: [], voice: [] })
    expect(r.thresholds).toEqual(DEFAULT_THRESHOLDS)
    expect(r.measured).toEqual({ silence: false, voice: false, music: false })
    expect(r.notes).toContain('noSilence')
  })

  it('silence only: margin over the mic noise and a loud-room cap over the floor, everything else default', () => {
    const r = calibrate({ silence: quietRoom, voice: [] })
    expect(r.measured).toEqual({ silence: true, voice: false, music: false })
    expect(r.floorDb).toBeCloseTo(-68, 5)
    expect(r.thresholds.noiseMarginDb).toBeGreaterThanOrEqual(4)
    expect(r.thresholds.noiseMarginDb).toBeLessThan(5)
    expect(r.thresholds.maxSilenceDb).toBeCloseTo(-53, 5)
    expect(r.thresholds.voiceRatio).toBe(DEFAULT_THRESHOLDS.voiceRatio)
    expect(r.thresholds.musicPeaks).toBe(DEFAULT_THRESHOLDS.musicPeaks)
  })

  it('a quiet mic: the default thresholds miss this voice; the calibrated ones call it voice', () => {
    expect(quietVoice.map((w) => classifyWindow(w)).filter((k) => k === 'voice').length).toBeLessThan(quietVoice.length)
    const r = calibrate({ silence: quietRoom, voice: quietVoice })
    expect(r.measured.voice).toBe(true)
    within(r.thresholds)
    for (const w of quietVoice) expect(classifyWindow(w, r.thresholds)).toBe('voice')
    for (const w of quietRoom) expect(classifyWindow(w, r.thresholds)).toBe('silence')
    // Silence stays well under the voice.
    expect(r.thresholds.noiseMarginDb).toBeLessThanOrEqual(18 * 0.4)
    expect(r.thresholds.maxSilenceDb).toBeLessThan(-52)
  })

  it('with music measured: music, voice and silence are told apart', () => {
    const r = calibrate({ silence: quietRoom, voice: quietVoice, music })
    expect(r.measured).toEqual({ silence: true, voice: true, music: true })
    within(r.thresholds)
    for (const w of music) expect(classifyWindow(w, r.thresholds)).toBe('music')
    for (const w of quietVoice) expect(classifyWindow(w, r.thresholds)).toBe('voice')
    for (const w of quietRoom) expect(classifyWindow(w, r.thresholds)).toBe('silence')
    expect(r.thresholds.musicPeaks).toBeLessThanOrEqual(2)
  })

  it('a step too close to the mic noise is not used, and says so', () => {
    const r = calibrate({ silence: quietRoom, voice: many(5, { rmsDb: -66, aboveDb: 2 }), music: many(5, { rmsDb: -67, aboveDb: 1 }) })
    expect(r.measured).toEqual({ silence: true, voice: false, music: false })
    expect(r.notes).toEqual(expect.arrayContaining(['voiceTooQuiet', 'musicTooQuiet']))
    expect(r.thresholds.voiceRatio).toBe(DEFAULT_THRESHOLDS.voiceRatio)
  })

  it('without levels over the noise (old data) the gap falls back to the level over the silent step', () => {
    const r = calibrate({ silence: many(5, { rmsDb: -68 }), voice: many(5, { rmsDb: -66 }) })
    expect(r.measured.voice).toBe(false)
  })

  it('a noisy room: thresholds stay clamped and voice is not silence', () => {
    const room = many(7, { rmsDb: -38, aboveDb: 0, flatness: 0.55 }, { rmsDb: 1 })
    const voice = many(7, { rmsDb: -30, aboveDb: 10, voiceRatio: 0.7, modulationDb: 7, lowEnergyRate: 0.25, stability: 0.5, flatness: 0.2 })
    const r = calibrate({ silence: room, voice })
    within(r.thresholds)
    expect(r.notes).toContain('noisyRoom')
    for (const w of voice) expect(classifyWindow(w, r.thresholds)).toBe('voice')
    for (const w of room) expect(classifyWindow(w, r.thresholds)).toBe('silence')
  })

  it('an unsteady silent step is flagged', () => {
    const r = calibrate({ silence: many(7, { rmsDb: -60, aboveDb: 1 }, { rmsDb: 6 }), voice: [] })
    expect(r.notes).toContain('unsteadySilence')
  })

  it('a digitally silent mic keeps every threshold within its limits', () => {
    const r = calibrate({ silence: many(5, { rmsDb: -100, aboveDb: 0 }), voice: [] })
    expect(r.thresholds.maxSilenceDb).toBe(THRESHOLD_LIMITS.maxSilenceDb[0])
    within(r.thresholds)
  })
})

describe('sanitizeThresholds', () => {
  it('fills missing and garbage fields with defaults and clamps the rest', () => {
    const th = sanitizeThresholds({ silenceDb: -200, voiceRatio: 'x', musicPeaks: 99, noiseFlatness: Number.NaN })
    expect(th.silenceDb).toBe(THRESHOLD_LIMITS.silenceDb[0])
    expect(th.voiceRatio).toBe(DEFAULT_THRESHOLDS.voiceRatio)
    expect(th.musicPeaks).toBe(THRESHOLD_LIMITS.musicPeaks[1])
    expect(th.noiseFlatness).toBe(DEFAULT_THRESHOLDS.noiseFlatness)
    expect(sanitizeThresholds(null)).toEqual(DEFAULT_THRESHOLDS)
  })
  it('keeps the loud-room cap over the silence level', () => {
    const th = sanitizeThresholds({ silenceDb: -52, maxSilenceDb: -70 })
    expect(th.maxSilenceDb).toBeGreaterThanOrEqual(th.silenceDb + 3)
  })
  it('old (v1) thresholds: the removed floor margin is ignored, the new margin gets its default', () => {
    const th = sanitizeThresholds({ silenceDb: -62, floorMarginDb: 3, maxSilenceDb: -50 } as Record<string, unknown>)
    expect(th.noiseMarginDb).toBe(DEFAULT_THRESHOLDS.noiseMarginDb)
    expect(th.silenceDb).toBe(-62)
    expect('floorMarginDb' in th).toBe(false)
  })
})

describe('stepWindows / quantile', () => {
  const frame = (rmsDb: number): FrameFeatures => ({ rmsDb, cleanDb: rmsDb, aboveDb: null, flatness: 0.3, centroidHz: 1000, voiceRatio: 0.5, tonalPeaks: 0, profile: [1, 2, 3], cells: [] })
  it('slides 2 s windows every 0.5 s over a 5 s step', () => {
    expect(stepWindows(Array.from({ length: 50 }, () => frame(-60)))).toHaveLength(7)
    expect(stepWindows(Array.from({ length: 8 }, () => frame(-60)))).toHaveLength(1)
    expect(stepWindows([])).toHaveLength(0)
  })
  it('quantile', () => {
    expect(quantile([3, 1, 2], 0.5)).toBe(2)
    expect(quantile([0, 10], 0.25)).toBe(2.5)
    expect(quantile([null, 4], 0.5)).toBe(4)
    expect(quantile([], 0.5)).toBeNull()
  })
})

describe('stored calibration', () => {
  it('parses per-device entries, sanitizes thresholds and profiles and drops garbage', async () => {
    const { __parseCalibration, calibrationFor, isCalibrated, saveCalibration } = await import('./calibration-store')
    const noise: NoiseProfile = { db: Array(NOISE_CELLS).fill(-90) }
    const s = __parseCalibration({
      devices: {
        // A v1 entry: no noise profile.
        abc: { thresholds: { silenceDb: -500 }, at: 5, measured: { silence: true } },
        def: { thresholds: {}, noise, at: 6, measured: { silence: true } },
        broken: { thresholds: {}, noise: { db: [1, 2] }, at: 7 },
        bad: 3,
      },
      last: 'abc',
    })
    expect(Object.keys(s.devices).sort()).toEqual(['abc', 'broken', 'def'])
    expect(s.devices.abc!.thresholds.silenceDb).toBe(THRESHOLD_LIMITS.silenceDb[0])
    expect(s.devices.abc!.noise).toBeNull()
    expect(s.devices.def!.noise).toEqual(noise)
    expect(s.devices.broken!.noise).toBeNull()
    expect(s.devices.abc!.measured).toEqual({ silence: true, voice: false, music: false })
    expect(s.last).toBe('abc')
    expect(__parseCalibration('nope')).toEqual({ devices: {}, last: null })
    // Without localStorage (node), saving still works in memory; unknown devices get the defaults.
    const r = { ...calibrate({ silence: quietRoom, voice: quietVoice }), noise }
    saveCalibration('mic-1', r)
    expect(calibrationFor('mic-1')).toEqual({ thresholds: r.thresholds, noise })
    expect(isCalibrated('mic-1')).toBe(true)
    saveCalibration('mic-2', { ...r, noise: null })
    expect(isCalibrated('mic-2')).toBe(false)
    expect(calibrationFor('other')).toEqual({ thresholds: DEFAULT_THRESHOLDS, noise: null })
    expect(calibrationFor(null)).toEqual({ thresholds: DEFAULT_THRESHOLDS, noise: null })
  })
})
