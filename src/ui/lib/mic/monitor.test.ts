import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TickSource } from '../../../audio/scheduler'
import type { MicAnalyser } from './analyser'
import { tallySeconds } from './classify'
import { __setMicDeps, FRAME_MS, micSkipReason, MIN_WINDOW_FRAMES, parseRecord, startMic, stopMic, useMic, WINDOW_MS } from './monitor'
import { sceneFrames } from './test-spectra'

describe('session mic record', () => {
  it('parses the current and the older (plain tally) format, drops garbage', () => {
    const tally = { silence: 10, music: 0, voice: 2, noise: 0 }
    expect(parseRecord(tally)).toEqual({ tally, issue: null })
    expect(parseRecord({ tally, issue: 'denied' })).toEqual({ tally, issue: 'denied' })
    expect(parseRecord({ tally, issue: 'weird' })).toEqual({ tally, issue: null })
    expect(parseRecord({ tally: { silence: -1 } })).toBeNull()
    expect(parseRecord('x')).toBeNull()
  })
})

describe('why the mic did not apply', () => {
  const base = { sessionId: 's1', analysedS: 7.4, profile: null, issue: null }
  it('too little analysed', () => {
    expect(micSkipReason(base)).toEqual({ kind: 'short', seconds: 7, min: 30 })
  })
  it('a problem wins over the duration', () => {
    expect(micSkipReason({ ...base, issue: 'denied' })).toEqual({ kind: 'issue', issue: 'denied' })
    expect(micSkipReason({ ...base, analysedS: 12, issue: 'lost' })).toEqual({ kind: 'issue', issue: 'lost' })
  })
  it('applied, or mic not on → nothing to explain', () => {
    expect(micSkipReason({ ...base, analysedS: 900, profile: { silence: 1, music: 0, voice: 0, noise: 0 } })).toBeNull()
    expect(micSkipReason(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Sampling cadence (hidden tabs): driven by an injectable ticker + clock.
// ---------------------------------------------------------------------------

describe('mic sampling cadence', () => {
  let clock = 0
  let onTick: (() => void) | null = null
  let tickerStarts = 0
  let tickerStops = 0
  let closed = 0
  const frames = sceneFrames('voice', 400, 7)
  let next = 0
  const ticker = (): TickSource => ({
    start(ms, cb) {
      expect(ms).toBe(FRAME_MS)
      tickerStarts++
      onTick = cb
    },
    stop() {
      tickerStops++
      onTick = null
    },
  })
  const mic: MicAnalyser = {
    deviceId: 'test-mic',
    frame: () => frames[next++ % frames.length]!,
    onEnded: () => undefined,
    close: () => void closed++,
  }
  /** Advance the clock by `ms`, ticking every `every` ms (100 = normal, 1000+ = throttled tab). */
  const run = (ms: number, every: number) => {
    for (let t = 0; t < ms; t += every) {
      clock += every
      onTick?.()
    }
  }

  beforeEach(async () => {
    clock = 0
    next = 0
    tickerStarts = tickerStops = closed = 0
    __setMicDeps({ unavailable: () => null, open: async () => ({ ok: true, mic }), ticker, now: () => clock })
    useMic.setState({ sessionId: null, tally: { silence: 0, music: 0, voice: 0, noise: 0 }, issue: null, current: null, status: 'off' })
    await startMic('s1')
  })
  afterEach(() => {
    stopMic()
    __setMicDeps(null)
  })

  it('normal cadence: 20 frames per window, voice credited', () => {
    expect(useMic.getState().status).toBe('listening')
    run(10 * WINDOW_MS, FRAME_MS)
    const s = useMic.getState()
    expect(tallySeconds(s.tally)).toBeCloseTo(20, 0)
    expect(s.tally.voice).toBeGreaterThan(s.tally.music + s.tally.noise)
    expect(s.current).toBe('voice')
  })

  it('a throttled window (1 frame in 2 s+) is neither classified nor credited, and nothing credited is lost', () => {
    run(4 * WINDOW_MS, FRAME_MS)
    const before = useMic.getState().tally
    run(10 * WINDOW_MS, WINDOW_MS + 100) // one frame per window
    run(60_000, 60_000) // ~1 frame per minute after 5 min hidden
    const after = useMic.getState().tally
    expect(after).toEqual(before)
    expect(MIN_WINDOW_FRAMES).toBeGreaterThan(1)
  })

  it('start is idempotent; stop releases the device and the timer', async () => {
    await startMic('s1')
    expect(tickerStarts).toBe(1)
    stopMic()
    expect(tickerStops).toBe(1)
    expect(closed).toBe(1)
    expect(onTick).toBeNull()
    expect(useMic.getState().status).toBe('off')
    expect(useMic.getState().sessionId).toBe('s1') // the record stays until claim/cancel
  })

  it('a stop while the device is opening discards it', async () => {
    stopMic()
    let release: (v: { ok: true; mic: MicAnalyser }) => void = () => undefined
    __setMicDeps({ unavailable: () => null, open: () => new Promise((r) => (release = r)), ticker, now: () => clock })
    const p = startMic('s2')
    stopMic()
    release({ ok: true, mic })
    await p
    expect(closed).toBe(2)
    expect(tickerStarts).toBe(1) // no new timer for the discarded device
  })
})
