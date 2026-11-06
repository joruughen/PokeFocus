import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, soundLocked, type AudioSnapshot } from './engine'
import { DEFAULT_AUDIO_SETTINGS } from './settings'

const snap = (p: Partial<AudioSnapshot> = {}, s: Partial<AudioSnapshot['settings']> = {}): AudioSnapshot => ({
  supported: true,
  ready: true,
  state: 'suspended',
  settings: { ...DEFAULT_AUDIO_SETTINGS, enabled: true, ...s },
  track: null,
  playing: null,
  ducked: false,
  ...p,
})

describe('soundLocked', () => {
  it('is true while sound is on but the context is not running', () => {
    expect(soundLocked(snap({ state: 'suspended' }))).toBe(true)
    expect(soundLocked(snap({ state: 'none', ready: false }))).toBe(true) // reload: no context until a gesture
    expect(soundLocked(snap({ state: 'running' }))).toBe(false)
  })
  it('is false when nothing would sound anyway, or without Web Audio', () => {
    expect(soundLocked(snap({}, { enabled: false }))).toBe(false)
    expect(soundLocked(snap({}, { muted: true }))).toBe(false)
    expect(soundLocked(snap({}, { master: 0 }))).toBe(false)
    expect(soundLocked(snap({}, { sfx: 0 }))).toBe(false)
    expect(soundLocked(snap({ supported: false }))).toBe(false)
  })
})

/** Just enough of an AudioContext for the engine graph; `resume()` fires statechange like a browser. */
class FakeContext {
  state: AudioContextState = 'suspended'
  onstatechange: (() => void) | null = null
  sampleRate = 100
  currentTime = 0
  destination = {}
  private param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} })
  private node = () => ({ connect: (n: unknown) => n, disconnect() {} })
  createGain = () => ({ ...this.node(), gain: this.param() })
  createDynamicsCompressor = () => ({ ...this.node(), threshold: this.param(), knee: this.param(), ratio: this.param(), attack: this.param(), release: this.param() })
  createConvolver = () => ({ ...this.node(), buffer: null })
  createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) })
  resume = () => {
    this.setState('running')
    return Promise.resolve()
  }
  suspend = () => {
    this.setState('suspended')
    return Promise.resolve()
  }
  close = () => Promise.resolve()
  setState(s: AudioContextState) {
    this.state = s
    this.onstatechange?.()
  }
}

describe('audio state for the UI', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports locked until a gesture resumes the context, and again if it gets suspended', async () => {
    let ctx: FakeContext | null = null
    vi.stubGlobal('window', {
      AudioContext: function () {
        ctx = new FakeContext()
        return ctx
      },
    })
    const engine = new AudioEngine()
    engine.applySettings({ enabled: true })
    const seen: boolean[] = []
    engine.subscribe(() => seen.push(soundLocked(engine.getSnapshot())))
    expect(engine.getSnapshot().supported).toBe(true)
    expect(soundLocked(engine.getSnapshot())).toBe(true) // fresh page: no context yet

    await engine.init() // the gesture (chip click or any click)
    expect(engine.getSnapshot().state).toBe('running')
    expect(soundLocked(engine.getSnapshot())).toBe(false)
    expect(seen.at(-1)).toBe(false)

    ctx!.setState('suspended') // e.g. the OS took the audio device
    expect(soundLocked(engine.getSnapshot())).toBe(true)
    expect(seen.at(-1)).toBe(true)
  })

  it('init() also resumes an "interrupted" context (Safari)', async () => {
    let ctx: FakeContext | null = null
    vi.stubGlobal('window', {
      AudioContext: function () {
        ctx = new FakeContext()
        return ctx
      },
    })
    const engine = new AudioEngine()
    engine.applySettings({ enabled: true })
    await engine.init()
    ctx!.setState('interrupted' as AudioContextState)
    expect(soundLocked(engine.getSnapshot())).toBe(true)
    await engine.init()
    expect(soundLocked(engine.getSnapshot())).toBe(false)
  })
})
