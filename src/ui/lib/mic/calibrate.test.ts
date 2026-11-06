import { describe, expect, it } from 'vitest'
import { calibrate, quantile, sanitizeThresholds, stepWindows, THRESHOLD_LIMITS } from './calibrate'
import { applyHeadphones, classifyWindow, DEFAULT_THRESHOLDS, type FrameFeatures, type Thresholds, type WindowFeatures } from './classify'

const W = (p: Partial<WindowFeatures>): WindowFeatures => ({
  rmsDb: -60,
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

const quietRoom = many(7, { rmsDb: -68, flatness: 0.5, stability: 0.9 }, { rmsDb: 1 })
const quietVoice = many(7, { rmsDb: -50, voiceRatio: 0.5, modulationDb: 4, lowEnergyRate: 0.12, stability: 0.6, flatness: 0.15, tonalPeaks: 2 }, { rmsDb: 2, voiceRatio: 0.03 })
const music = many(7, { rmsDb: -44, voiceRatio: 0.4, modulationDb: 1.5, lowEnergyRate: 0, stability: 0.8, flatness: 0.1, tonalPeaks: 2 }, { stability: 0.03 })

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

  it('silence only: personal silence level over the floor, everything else default', () => {
    const r = calibrate({ silence: quietRoom, voice: [] })
    expect(r.measured).toEqual({ silence: true, voice: false, music: false })
    expect(r.floorDb).toBeCloseTo(-68, 5)
    expect(r.thresholds.silenceDb).toBeGreaterThan(-68)
    expect(r.thresholds.silenceDb).toBeLessThanOrEqual(-62)
    expect(r.thresholds.voiceRatio).toBe(DEFAULT_THRESHOLDS.voiceRatio)
    expect(r.thresholds.musicPeaks).toBe(DEFAULT_THRESHOLDS.musicPeaks)
  })

  it('a quiet mic: the default thresholds call this voice silence or noise; the calibrated ones call it voice', () => {
    // Defaults: −50 dB voice with a modest voice-band share is not recognised.
    expect(quietVoice.map((w) => classifyWindow(w, null)).filter((k) => k === 'voice').length).toBeLessThan(quietVoice.length)
    const r = calibrate({ silence: quietRoom, voice: quietVoice })
    expect(r.measured.voice).toBe(true)
    within(r.thresholds)
    for (const w of quietVoice) expect(classifyWindow(w, null, r.thresholds)).toBe('voice')
    for (const w of quietRoom) expect(classifyWindow(w, null, r.thresholds)).toBe('silence')
    // The silence level stays well under the voice.
    expect(r.thresholds.silenceDb).toBeLessThan(-50 - 5)
    expect(r.thresholds.maxSilenceDb).toBeLessThan(-52)
  })

  it('with music measured: music, voice and silence are told apart', () => {
    const r = calibrate({ silence: quietRoom, voice: quietVoice, music })
    expect(r.measured).toEqual({ silence: true, voice: true, music: true })
    within(r.thresholds)
    for (const w of music) expect(classifyWindow(w, null, r.thresholds)).toBe('music')
    for (const w of quietVoice) expect(classifyWindow(w, null, r.thresholds)).toBe('voice')
    for (const w of quietRoom) expect(classifyWindow(w, null, r.thresholds)).toBe('silence')
    expect(r.thresholds.musicPeaks).toBeLessThanOrEqual(2)
  })

  it('a step too close to the floor is not used, and says so', () => {
    const r = calibrate({ silence: quietRoom, voice: many(5, { rmsDb: -66 }), music: many(5, { rmsDb: -67 }) })
    expect(r.measured).toEqual({ silence: true, voice: false, music: false })
    expect(r.notes).toEqual(expect.arrayContaining(['voiceTooQuiet', 'musicTooQuiet']))
    expect(r.thresholds.voiceRatio).toBe(DEFAULT_THRESHOLDS.voiceRatio)
  })

  it('a noisy room: thresholds stay clamped and voice stays over the silence level', () => {
    const room = many(7, { rmsDb: -38, flatness: 0.55 }, { rmsDb: 1 })
    const voice = many(7, { rmsDb: -30, voiceRatio: 0.7, modulationDb: 7, lowEnergyRate: 0.25, stability: 0.5, flatness: 0.2 })
    const r = calibrate({ silence: room, voice })
    within(r.thresholds)
    expect(r.notes).toContain('noisyRoom')
    for (const w of voice) expect(classifyWindow(w, -38, r.thresholds)).toBe('voice')
  })

  it('a digitally silent mic clamps the silence level at its limit', () => {
    const r = calibrate({ silence: many(5, { rmsDb: -100 }), voice: [] })
    expect(r.thresholds.silenceDb).toBe(THRESHOLD_LIMITS.silenceDb[0])
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
    const th = sanitizeThresholds({ silenceDb: -42, maxSilenceDb: -70 })
    expect(th.maxSilenceDb).toBeGreaterThanOrEqual(th.silenceDb)
  })
})

describe('stepWindows / quantile', () => {
  const frame = (rmsDb: number): FrameFeatures => ({ rmsDb, flatness: 0.3, centroidHz: 1000, voiceRatio: 0.5, tonalPeaks: 0, profile: [1, 2, 3] })
  it('slides 2 s windows every 0.5 s over a 5 s step', () => {
    expect(stepWindows(Array.from({ length: 50 }, () => frame(-60)))).toHaveLength(7)
    expect(stepWindows(Array.from({ length: 8 }, () => frame(-60)))).toHaveLength(1)
    expect(stepWindows([])).toHaveLength(0)
  })
  it('quantile', () => {
    expect(quantile([3, 1, 2], 0.5)).toBe(2)
    expect(quantile([0, 10], 0.25)).toBe(2.5)
    expect(quantile([], 0.5)).toBeNull()
  })
})

describe('stored calibration', () => {
  it('parses per-device entries, sanitizes thresholds and drops garbage', async () => {
    const { __parseCalibration, thresholdsFor, saveCalibration } = await import('./calibration-store')
    const s = __parseCalibration({ devices: { abc: { thresholds: { silenceDb: -500 }, at: 5, measured: { silence: true } }, bad: 3 }, last: 'abc' })
    expect(Object.keys(s.devices)).toEqual(['abc'])
    expect(s.devices.abc!.thresholds.silenceDb).toBe(THRESHOLD_LIMITS.silenceDb[0])
    expect(s.devices.abc!.measured).toEqual({ silence: true, voice: false, music: false })
    expect(s.last).toBe('abc')
    expect(__parseCalibration('nope')).toEqual({ devices: {}, last: null })
    // Without localStorage (node), saving still works in memory; unknown devices get the defaults.
    const r = calibrate({ silence: quietRoom, voice: quietVoice })
    saveCalibration('mic-1', r)
    expect(thresholdsFor('mic-1')).toEqual(r.thresholds)
    expect(thresholdsFor('other')).toEqual(DEFAULT_THRESHOLDS)
    expect(thresholdsFor(null)).toEqual(DEFAULT_THRESHOLDS)
  })
})

describe('headphones', () => {
  it('counts silent windows as music, keeps the rest', () => {
    expect(applyHeadphones('silence', true)).toBe('music')
    expect(applyHeadphones('voice', true)).toBe('voice')
    expect(applyHeadphones('noise', true)).toBe('noise')
    expect(applyHeadphones('music', true)).toBe('music')
    expect(applyHeadphones('silence', false)).toBe('silence')
  })
})
