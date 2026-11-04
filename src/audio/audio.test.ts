import { describe, expect, it } from 'vitest'
import { createRng, hashSeed } from './rng'
import {
  SCALES,
  diatonicChord,
  foldIntoRange,
  inScale,
  midiToFreq,
  nearestPc,
  noteToMidi,
  pitchClass,
  scaleDegree,
  voiceLead,
} from './theory'
import { barDuration, barsInWindow, beatDuration, BarScheduler, swingBeat, type TickSource } from './scheduler'
import { SFX, SFX_NAMES } from './presets'
import { presetDuration, pulseCoefficients, renderPreset, voiceEnd, type SfxPreset } from './synth'
import { TRACKS, TRACK_IDS, TrackGenerator } from './tracks'
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings } from './settings'

describe('rng', () => {
  it('is deterministic per seed and in range', () => {
    const a = createRng('x')
    const b = createRng('x')
    for (let i = 0; i < 1000; i++) {
      const v = a.next()
      expect(v).toBe(b.next())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(createRng('x').next()).not.toBe(createRng('y').next())
    expect(hashSeed('abc')).toBe(hashSeed('abc'))
  })
  it('int / pick / weighted behave', () => {
    const r = createRng(1)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const n = r.int(2, 5)
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(5)
      seen.add(n)
    }
    expect(seen.size).toBe(4)
    for (let i = 0; i < 100; i++) expect(r.weighted(['a', 'b'], [0, 1])).toBe('b')
    expect(() => r.pick([])).toThrow()
  })
})

describe('theory', () => {
  it('converts notes', () => {
    expect(noteToMidi('A4')).toBe(69)
    expect(noteToMidi('C4')).toBe(60)
    expect(noteToMidi('F#3')).toBe(54)
    expect(noteToMidi('Bb5')).toBe(82)
    expect(midiToFreq(69)).toBeCloseTo(440)
    expect(midiToFreq(81)).toBeCloseTo(880)
  })
  it('builds diatonic chords', () => {
    expect(diatonicChord(60, SCALES.major, 0)).toEqual([60, 64, 67]) // C
    expect(diatonicChord(60, SCALES.major, 4, 4)).toEqual([67, 71, 74, 77]) // G7
    expect(diatonicChord(69, SCALES.minor, 0)).toEqual([69, 72, 76]) // Am
    expect(scaleDegree(60, SCALES.major, 7)).toBe(72)
    expect(scaleDegree(60, SCALES.major, -1)).toBe(59)
  })
  it('voice-leads smoothly inside the range', () => {
    const c = voiceLead([0, 4, 7], null, 55, 72)
    expect(c.map(pitchClass).sort()).toEqual([0, 4, 7])
    const f = voiceLead([5, 9, 0], c, 55, 72)
    for (const m of f) {
      expect(m).toBeGreaterThanOrEqual(55)
      expect(m).toBeLessThanOrEqual(72)
    }
    const move = f.reduce((s, m, i) => s + Math.abs(m - (c[i] as number)), 0)
    expect(move).toBeLessThanOrEqual(4) // C→F common-tone voice leading moves ≤ 2 voices by step
  })
  it('folds and finds nearest pitch classes', () => {
    expect(foldIntoRange(30, 36, 48)).toBe(42)
    expect(nearestPc(0, 62)).toBe(60)
    expect(nearestPc(11, 61)).toBe(59)
  })
})

describe('scheduler math', () => {
  it('beat / bar durations', () => {
    expect(beatDuration(120)).toBe(0.5)
    expect(barDuration(60, 4)).toBe(4)
  })
  it('schedules bars entering the window', () => {
    const r = barsInWindow(1, 0.5, 0.6, 2)
    expect(r.bars).toEqual([1])
    expect(r.next).toBe(3)
    expect(barsInWindow(3, 0.5, 0.6, 2).bars).toEqual([])
    expect(barsInWindow(3, 1, 2.5, 1).bars).toEqual([3])
  })
  it('drops a backlog instead of bursting', () => {
    const r = barsInWindow(0, 100, 0.5, 2)
    expect(r.skipped).toBeGreaterThan(0)
    expect(r.bars).toEqual([100.05])
  })
  it('swing only moves off-beat eighths', () => {
    expect(swingBeat(0.5, 0.2)).toBeCloseTo(0.6)
    expect(swingBeat(1, 0.2)).toBe(1)
    expect(swingBeat(0.25, 0.2)).toBe(0.25)
  })
  it('BarScheduler covers a timeline gaplessly with a fake clock', () => {
    let now = 0
    const clock: { tick: (() => void) | null } = { tick: null }
    const src: TickSource = { start: (_ms, cb) => (clock.tick = cb), stop: () => (clock.tick = null) }
    const starts: number[] = []
    const s = new BarScheduler({ getTime: () => now, barDur: 2, onBar: (_i, t) => starts.push(t), tick: src, lookahead: 0.5 })
    s.start(0.1)
    for (let i = 0; i < 200; i++) {
      now += 0.1
      clock.tick?.()
    }
    s.stop()
    for (let i = 1; i < starts.length; i++) expect((starts[i] as number) - (starts[i - 1] as number)).toBeCloseTo(2)
    expect(starts.at(-1)).toBeGreaterThan(now - 2)
    expect(s.barIndex).toBe(starts.length)
  })
})

describe('sfx presets', () => {
  const required = [
    'uiClick', 'uiHover', 'uiOpen', 'uiClose', 'toggle', 'sessionStart', 'sessionEnd', 'claim', 'pointsTick',
    'waveAppear', 'wildAppear', 'shinyAppear', 'ballThrow', 'ballShake', 'catchSuccess', 'catchFail', 'counterHit',
    'counterMiss', 'flee', 'levelUp', 'evolveStart', 'evolveDone', 'newMove', 'hintPop', 'error', 'exhausted', 'heal', 'leagueUp',
  ]
  it('has every required preset', () => {
    for (const n of required) expect(SFX_NAMES).toContain(n)
  })
  it.each(SFX_NAMES)('%s is sane', (name) => {
    const p: SfxPreset = SFX[name]
    const d = presetDuration(p)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThan(0.01)
    expect(d).toBeLessThanOrEqual(p.kind === 'fanfare' ? 3 : 1.5)
    expect(p.gain ?? 1).toBeLessThanOrEqual(1)
    let peak = 0
    for (const v of p.voices) {
      for (const x of [v.freq, v.freqEnd ?? 1, v.gain, v.start ?? 0, v.env.attack, v.env.decay, v.env.hold, v.env.release, v.env.sustain]) {
        expect(Number.isFinite(x)).toBe(true)
        expect(x).toBeGreaterThanOrEqual(0)
      }
      expect(v.gain).toBeLessThanOrEqual(1)
      expect(v.env.sustain).toBeLessThanOrEqual(1)
      if (v.wave !== 'noise') {
        expect(v.freq).toBeGreaterThan(20)
        expect(v.freq).toBeLessThan(12000)
      }
    }
    // Sum of the peak gains of every voice sounding at the same instant (pessimistic:
    // ignores decay, so bell-heavy fanfares get more room) stays modest before the
    // master limiter. Real peaks rendered in Chromium (OfflineAudioContext) are ≤ ~0.55.
    for (const v of p.voices) {
      const t = v.start ?? 0
      const sum = p.voices.filter((w) => (w.start ?? 0) <= t && voiceEnd(w) > t).reduce((a, w) => a + w.gain, 0)
      peak = Math.max(peak, sum)
    }
    expect(peak * (p.gain ?? 1)).toBeLessThanOrEqual(p.kind === 'fanfare' ? 1.5 : 1.1)
    if (p.voices.length > 0 && ['uiHover', 'pointsTick'].includes(name)) expect(p.cooldownMs ?? 0).toBeGreaterThanOrEqual(40)
  })
  it('pulse coefficients are finite', () => {
    const { real } = pulseCoefficients(0.25)
    for (const x of real) expect(Number.isFinite(x)).toBe(true)
  })
})

/** Minimal Web Audio mock that validates automation values. */
function mockContext() {
  const errors: string[] = []
  let sources = 0
  const gains: Array<{ values: number[]; target: unknown[] }> = []
  const param = (name: string, values?: number[]) => ({
    value: 0,
    name,
    values,
    setValueAtTime: (v: number, t: number) => (check(name, v, t), record({ values }, v)),
    linearRampToValueAtTime: (v: number, t: number) => (check(name, v, t), record({ values }, v)),
    exponentialRampToValueAtTime: (v: number, t: number) => {
      check(name, v, t)
      record({ values }, v)
      if (v <= 0) errors.push(`${name}: exp ramp to ${v}`)
    },
    setTargetAtTime: (v: number, t: number) => check(name, v, t),
    cancelScheduledValues: () => undefined,
  })
  const check = (name: string, v: number, t: number) => {
    if (!Number.isFinite(v) || !Number.isFinite(t)) errors.push(`${name}: ${v}@${t}`)
  }
  const record = (p: { values?: number[] }, v: number) => p.values?.push(v)
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined })
  const source = () => ({
    ...node(),
    start: (t: number) => {
      sources++
      check('start', 0, t)
    },
    stop: (t: number = 0) => check('stop', 0, t),
    onended: null,
  })
  const ctx = {
    sampleRate: 8000,
    currentTime: 0,
    createGain: () => {
      const entry = { values: [] as number[], target: [] as unknown[] }
      gains.push(entry)
      return { connect: (n: unknown) => (entry.target.push(n), n), disconnect: () => undefined, gain: param('gain', entry.values) }
    },
    createOscillator: () => ({ ...source(), type: 'sine', frequency: param('frequency'), detune: param('detune'), setPeriodicWave: () => undefined }),
    createBufferSource: () => ({ ...source(), buffer: null, loop: false, playbackRate: param('rate') }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param('filter'), Q: param('q') }),
    createStereoPanner: () => ({ ...node(), pan: param('pan') }),
    createPeriodicWave: () => ({}),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  }
  const finalCheck = () => {
    for (const g of gains) {
      const isDepth = g.target.some((t) => (t as { name?: string }).name === 'detune')
      if (!isDepth) for (const v of g.values) if (v > 1) errors.push(`gain ${v} > 1`)
    }
  }
  return { ctx: ctx as unknown as BaseAudioContext, errors, sources: () => sources, finalCheck }
}

describe('renderPreset (mock context)', () => {
  it.each(SFX_NAMES)('%s schedules finite automation', (name) => {
    const m = mockContext()
    const h = renderPreset(m.ctx, {} as AudioNode, SFX[name], 0, { cents: 30, gain: 1 })
    m.finalCheck()
    expect(m.errors).toEqual([])
    expect(m.sources()).toBeGreaterThan(0)
    expect(h.end).toBeCloseTo(presetDuration(SFX[name]), 5)
  })
})

describe('generative tracks', () => {
  it.each(TRACK_IDS)('%s stays in key, in range and deterministic', (id) => {
    const def = TRACKS[id]
    const g1 = new TrackGenerator(def, 42)
    const g2 = new TrackGenerator(def, 42)
    const bars = Array.from({ length: 64 }, () => g1.next())
    const bars2 = Array.from({ length: 64 }, () => g2.next())
    expect(JSON.stringify(bars)).toBe(JSON.stringify(bars2))
    let prev: number[] | null = null
    for (const b of bars) {
      for (const e of b.events) {
        expect(Number.isFinite(e.beat)).toBe(true)
        expect(e.beat).toBeGreaterThanOrEqual(0)
        expect(e.beat).toBeLessThan(def.beatsPerBar + 0.5)
        expect(e.dur).toBeGreaterThan(0)
        expect(e.vel).toBeGreaterThanOrEqual(0)
        expect(e.vel).toBeLessThanOrEqual(1)
        if (['pad', 'bass', 'lead', 'pluck', 'bell'].includes(e.inst)) {
          expect(inScale(e.midi, def.root, def.scale)).toBe(true)
          expect(e.midi).toBeGreaterThanOrEqual(24)
          expect(e.midi).toBeLessThanOrEqual(96)
        }
        if (e.inst === 'lead') {
          expect(e.midi).toBeGreaterThanOrEqual(def.ranges.lead[0])
          expect(e.midi).toBeLessThanOrEqual(def.ranges.lead[1])
        }
      }
      for (const m of b.voicing) {
        expect(m).toBeGreaterThanOrEqual(def.ranges.pad[0])
        expect(m).toBeLessThanOrEqual(def.ranges.pad[1])
      }
      // Voice leading: average movement per voice stays small between chords.
      if (prev && prev.length === b.voicing.length) {
        const move = b.voicing.reduce((s, m, i) => s + Math.abs(m - (prev as number[])[i]!), 0) / b.voicing.length
        expect(move).toBeLessThanOrEqual(5)
      }
      prev = b.voicing
    }
  })
  it('different seeds give different music', () => {
    const a = new TrackGenerator(TRACKS.home, 1)
    const b = new TrackGenerator(TRACKS.home, 2)
    const sa = JSON.stringify(Array.from({ length: 8 }, () => a.next().events))
    const sb = JSON.stringify(Array.from({ length: 8 }, () => b.next().events))
    expect(sa).not.toBe(sb)
  })
  it('focus track is calm: slow tempo, no drums', () => {
    const def = TRACKS.focus
    expect(def.bpm).toBeGreaterThanOrEqual(70)
    expect(def.bpm).toBeLessThanOrEqual(80)
    const g = new TrackGenerator(def, 7)
    for (let i = 0; i < 32; i++) for (const e of g.next().events) expect(['kick', 'snare', 'hat']).not.toContain(e.inst)
  })
})

describe('settings', () => {
  it('defaults', () => {
    expect(DEFAULT_AUDIO_SETTINGS.enabled).toBe(true)
    expect(DEFAULT_AUDIO_SETTINGS.music).toBeCloseTo(0.35)
    expect(DEFAULT_AUDIO_SETTINGS.sfx).toBeCloseTo(0.6)
  })
  it('sanitizes untrusted input', () => {
    const s = sanitizeAudioSettings({ master: 4, music: -1, sfx: 'loud', muted: 'yes', enabled: false })
    expect(s.master).toBe(1)
    expect(s.music).toBe(0)
    expect(s.sfx).toBe(DEFAULT_AUDIO_SETTINGS.sfx)
    expect(s.muted).toBe(false)
    expect(s.enabled).toBe(false)
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS)
  })
})
