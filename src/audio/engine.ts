/**
 * The audio engine: AudioContext lifecycle (autoplay-safe), volume buses,
 * master limiter, sfx playback with rate limiting + ducking, generative music
 * with crossfades, and page-visibility handling. No React in here.
 *
 *   track players ─┬─────────────► musicBus ─► duck ─┐
 *                  └─► reverb ────►                  ├─► master ─► limiter ─► out
 *   sfx presets ─────────────────► sfxBus ───────────┘
 */
import { createRng } from './rng'
import { TrackPlayer } from './music'
import { getPreset, type SfxName } from './presets'
import { workerTickSource } from './scheduler'
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings, type AudioSettings } from './settings'
import { presetDuration, renderPreset, type SfxHandle } from './synth'
import { TRACKS, type TrackId } from './tracks'

export interface SfxOptions {
  /** Pitch offset in cents (e.g. rising `pointsTick`: 0, 50, 100…). */
  pitch?: number
  /** Extra volume multiplier 0–1. */
  volume?: number
  /** Stereo position -1…1 added to the preset's own panning. */
  pan?: number
  /** Ignore the preset's cooldown / instance limit. */
  force?: boolean
}

export interface AudioSnapshot {
  /** This browser has Web Audio at all. */
  supported: boolean
  /** AudioContext created. */
  ready: boolean
  /** AudioContext state ('none' before init). */
  state: AudioContextState | 'none'
  settings: AudioSettings
  /** Track requested by the app (may be silent: hidden tab, disabled, focus music off…). */
  track: TrackId | null
  /** Track actually sounding right now. */
  playing: TrackId | null
  ducked: boolean
}

export interface MusicControls {
  /** Request a track; crossfades (~1.5 s) from whatever is playing. Works before `init` (starts once unlocked). */
  play(track: TrackId): void
  /** Fade out and stop (default 1500 ms). */
  stop(fadeMs?: number): void
  /** Requested track (null when stopped). */
  readonly current: TrackId | null
}

interface Buses {
  master: GainNode
  limiter: DynamicsCompressorNode
  music: GainNode
  duck: GainNode
  sfx: GainNode
  reverbIn: GainNode
}

const CROSSFADE_S = 1.5
const DUCK_LEVEL = 0.3

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** Synthetic stereo room impulse (decaying, darkening noise). */
function makeImpulse(ctx: BaseAudioContext, seconds = 2.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  const rng = createRng('reverb-ir')
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const x = i / len
      const k = 0.5 - 0.42 * x // one-pole low-pass that closes over time
      lp += k * (rng.range(-1, 1) - lp)
      d[i] = lp * Math.pow(1 - x, 3)
    }
  }
  return buf
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private buses: Buses | null = null
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS }
  private wanted: TrackId | null = null
  private player: TrackPlayer | null = null
  private hidden = false
  private manualDuck = false
  private duckUntil = 0
  private readonly lastPlay = new Map<SfxName, number>()
  private readonly active = new Map<SfxName, number>()
  private readonly listeners = new Set<() => void>()
  private readonly rng = createRng()
  private visibilityBound = false
  private snap: AudioSnapshot = this.makeSnapshot()

  /** Generative music controls. */
  readonly music: MusicControls

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const engine = this
    this.music = {
      play(track) {
        engine.wanted = track
        engine.reconcile()
        engine.emit()
      },
      stop(fadeMs = CROSSFADE_S * 1000) {
        engine.wanted = null
        engine.reconcile(Math.max(0, fadeMs) / 1000)
        engine.emit()
      },
      get current() {
        return engine.wanted
      },
    }
  }

  // --- lifecycle --------------------------------------------------------------

  /**
   * Create (first call) and resume the AudioContext. Call from a user gesture;
   * safe to call repeatedly. Resolves once running (or immediately if audio
   * is unavailable).
   */
  init(): Promise<void> {
    if (!this.ctx) {
      const Ctor = audioContextCtor()
      if (!Ctor) return Promise.resolve()
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' })
      } catch {
        return Promise.resolve()
      }
      this.buildGraph(this.ctx)
      this.ctx.onstatechange = () => {
        this.reconcile()
        this.emit()
      }
      this.bindVisibility()
      this.applyVolumes(0)
      this.emit()
    }
    const ctx = this.ctx
    // 'suspended' (autoplay rules, settings off) or Safari's 'interrupted': try to resume.
    if (this.settings.enabled && ctx.state !== 'running' && ctx.state !== 'closed') {
      return ctx.resume().then(
        () => this.reconcile(),
        () => undefined,
      )
    }
    this.reconcile()
    return Promise.resolve()
  }

  /** The AudioContext (null until `init`). Exposed for advanced use / tests. */
  get context(): AudioContext | null {
    return this.ctx
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain()
    const limiter = ctx.createDynamicsCompressor()
    // Gentle bus compressor acting as a safety limiter (≈ -6 dBFS ceiling).
    limiter.threshold.value = -8
    limiter.knee.value = 6
    limiter.ratio.value = 16
    limiter.attack.value = 0.003
    limiter.release.value = 0.2
    const headroom = ctx.createGain()
    headroom.gain.value = 0.85
    master.connect(limiter).connect(headroom).connect(ctx.destination)

    const music = ctx.createGain()
    const duck = ctx.createGain()
    music.connect(duck).connect(master)
    const reverbIn = ctx.createGain()
    const conv = ctx.createConvolver()
    conv.buffer = makeImpulse(ctx)
    const wet = ctx.createGain()
    wet.gain.value = 0.55
    reverbIn.connect(conv).connect(wet).connect(music)

    const sfx = ctx.createGain()
    sfx.connect(master)
    this.buses = { master, limiter, music, duck, sfx, reverbIn }
  }

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return
    this.visibilityBound = true
    this.hidden = document.visibilityState === 'hidden'
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.visibilityState === 'hidden'
      this.player?.setHidden(this.hidden)
      if (!this.hidden && this.ctx?.state === 'suspended' && this.settings.enabled) void this.ctx.resume().catch(() => undefined)
      this.reconcile()
      this.emit()
    })
  }

  // --- settings -----------------------------------------------------------------

  get enabled(): boolean {
    return this.settings.enabled
  }

  set enabled(on: boolean) {
    this.applySettings({ enabled: on })
  }

  getSettings(): AudioSettings {
    return this.settings
  }

  /** Merge (and clamp) settings. Unknown / invalid fields are ignored. */
  applySettings(patch: Partial<AudioSettings>): void {
    const next = sanitizeAudioSettings({ ...this.settings, ...patch }, this.settings)
    const prev = this.settings
    this.settings = next
    if (this.ctx) {
      if (!next.enabled && prev.enabled && this.ctx.state === 'running') {
        // Fade, then suspend to free CPU.
        this.applyVolumes(0.05)
        const ctx = this.ctx
        setTimeout(() => {
          if (!this.settings.enabled && ctx.state === 'running') void ctx.suspend().catch(() => undefined)
        }, 120)
      } else {
        if (next.enabled && !prev.enabled && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined)
        this.applyVolumes(0.05)
      }
      this.player?.setHiss(next.vinylHiss)
    }
    this.reconcile()
    this.emit()
  }

  private audible(): boolean {
    return this.settings.enabled && !this.settings.muted && this.settings.master > 0
  }

  private applyVolumes(rampSec: number): void {
    const b = this.buses
    const ctx = this.ctx
    if (!b || !ctx) return
    const t = ctx.currentTime
    const set = (p: AudioParam, v: number): void => {
      p.cancelScheduledValues(t)
      p.setValueAtTime(p.value, t)
      if (rampSec > 0) p.linearRampToValueAtTime(v, t + rampSec)
      else p.setValueAtTime(v, t)
    }
    set(b.master.gain, this.audible() ? this.settings.master : 0)
    set(b.music.gain, this.settings.music)
    set(b.sfx.gain, this.settings.sfx)
  }

  // --- sfx ------------------------------------------------------------------------

  /** Play a named sound effect now. Returns null when muted / rate-limited / unavailable. */
  sfx(name: SfxName, opts: SfxOptions = {}): SfxHandle | null {
    return this.playSfx(name, 0, opts)
  }

  /**
   * Schedule a sound effect `delaySec` seconds from now on the audio clock.
   * Sample-accurate and immune to background-tab timer throttling — e.g.
   * schedule `sessionEnd` when a session starts and `stop()` it if cancelled.
   */
  sfxAt(name: SfxName, delaySec: number, opts: SfxOptions = {}): SfxHandle | null {
    return this.playSfx(name, Math.max(0, delaySec), { ...opts, force: true })
  }

  /** True once the page has had a user gesture (or when the browser can't tell, e.g. tests). */
  private userHasInteracted(): boolean {
    if (this.ctx?.state === 'running') return true
    const ua = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined
    return !ua || ua.hasBeenActive
  }

  private playSfx(name: SfxName, delay: number, opts: SfxOptions): SfxHandle | null {
    const s = this.settings
    if (!s.enabled || s.muted || s.sfx <= 0 || s.master <= 0) return null
    // Before the first user gesture the browser refuses to start audio and logs a console warning on
    // every attempt (a reload straight onto the waves screen produced ~50). Skip until the user has interacted.
    if (!this.userHasInteracted()) return null
    if (!this.ctx) void this.init() // inside a gesture handler this also unlocks audio
    const ctx = this.ctx
    const b = this.buses
    if (!ctx || !b) return null
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const preset = getPreset(name)
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (!opts.force) {
      const last = this.lastPlay.get(name) ?? -Infinity
      if (nowMs - last < (preset.cooldownMs ?? 0)) return null
      if ((this.active.get(name) ?? 0) >= (preset.maxInstances ?? 4)) return null
    }
    this.lastPlay.set(name, nowMs)
    const v = preset.variance ?? 0
    const cents = (opts.pitch ?? 0) + (v > 0 ? this.rng.range(-v, v) : 0)
    const at = ctx.currentTime + 0.005 + delay
    const handle = renderPreset(ctx, b.sfx, preset, at, { cents, gain: opts.volume ?? 1, pan: opts.pan })
    const dur = presetDuration(preset)
    this.active.set(name, (this.active.get(name) ?? 0) + 1)
    setTimeout(() => this.active.set(name, Math.max(0, (this.active.get(name) ?? 1) - 1)), (delay + dur) * 1000 + 30)
    if (preset.duck && s.ducking) this.autoDuck(at, at + dur)
    return handle
  }

  // --- ducking --------------------------------------------------------------------

  /** Manually lower (true) or restore (false) the music, e.g. around a cutscene. */
  setDucking(on: boolean): void {
    this.manualDuck = on
    const ctx = this.ctx
    const b = this.buses
    if (ctx && b) {
      const t = ctx.currentTime
      if (t >= this.duckUntil) {
        b.duck.gain.cancelScheduledValues(t)
        b.duck.gain.setTargetAtTime(on ? DUCK_LEVEL : 1, t, on ? 0.05 : 0.25)
      }
    }
    this.emit()
  }

  private autoDuck(start: number, end: number): void {
    const b = this.buses
    if (!b) return
    const g = b.duck.gain
    const until = Math.max(this.duckUntil, end)
    g.cancelScheduledValues(start)
    g.setTargetAtTime(DUCK_LEVEL, start, 0.04)
    g.setTargetAtTime(this.manualDuck ? DUCK_LEVEL : 1, until, 0.3)
    this.duckUntil = until
  }

  // --- music ----------------------------------------------------------------------

  /** Which track should be sounding given settings, visibility and context state. */
  private desiredTrack(): TrackId | null {
    const w = this.wanted
    if (!w || !this.ctx || this.ctx.state !== 'running') return null
    if (!this.audible() || this.settings.music <= 0) return null
    if (w === 'focus' && !this.settings.musicDuringFocus) return null
    if (this.hidden && !(w === 'focus' && this.settings.backgroundMusic)) return null
    return w
  }

  private trackLevel(id: TrackId): number {
    return id === 'focus' ? this.settings.focusMusicLevel : 1
  }

  private reconcile(fadeSec = CROSSFADE_S): void {
    const ctx = this.ctx
    const b = this.buses
    if (!ctx || !b) return
    const want = this.desiredTrack()
    const cur = this.player
    if (cur && cur.def.id === want) {
      cur.setLevel(this.trackLevel(want))
      return
    }
    if (cur) {
      cur.stop(want ? CROSSFADE_S : fadeSec)
      this.player = null
    }
    if (want) {
      const p = new TrackPlayer({
        ctx,
        out: b.music,
        reverbIn: b.reverbIn,
        def: TRACKS[want],
        hiss: this.settings.vinylHiss,
        level: this.trackLevel(want),
        tick: workerTickSource(),
      })
      p.setHidden(this.hidden)
      p.start(cur ? CROSSFADE_S : 1.0)
      this.player = p
    }
  }

  // --- store (for React) ------------------------------------------------------------

  private makeSnapshot(): AudioSnapshot {
    return {
      supported: audioContextCtor() !== null,
      ready: this.ctx !== null,
      state: this.ctx?.state ?? 'none',
      settings: this.settings,
      track: this.wanted,
      playing: this.player?.def.id ?? null,
      ducked: this.manualDuck,
    }
  }

  private emit(): void {
    this.snap = this.makeSnapshot()
    for (const l of this.listeners) l()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): AudioSnapshot => this.snap

  /** Stop everything and close the context (tests / HMR). */
  async dispose(): Promise<void> {
    this.player?.stop(0.05)
    this.player = null
    const ctx = this.ctx
    this.ctx = null
    this.buses = null
    if (ctx) await ctx.close().catch(() => undefined)
    this.emit()
  }
}

/**
 * True when sound effects are switched on (enabled, not muted, audible
 * volumes) but the AudioContext is not running, so an effect scheduled now
 * (the end-of-session bell) would stay silent. Typical after a page reload:
 * browsers keep a new context suspended until the next tap/click/key. The UI
 * offers a "tap to turn sound on" button while this holds.
 */
export function soundLocked(snap: AudioSnapshot): boolean {
  const s = snap.settings
  if (!snap.supported || !s.enabled || s.muted || s.master <= 0 || s.sfx <= 0) return false
  return snap.state !== 'running'
}

/**
 * Attach one-shot listeners that call `engine.init()` on the first user
 * gesture (autoplay policy). Returns a cleanup function.
 */
export function installAudioUnlock(engine: AudioEngine): () => void {
  if (typeof window === 'undefined') return () => undefined
  const events = ['pointerdown', 'keydown', 'touchend'] as const
  const handler = (): void => {
    void engine.init().then(() => {
      if (engine.context?.state === 'running') cleanup()
    })
  }
  const cleanup = (): void => {
    for (const e of events) window.removeEventListener(e, handler, true)
  }
  for (const e of events) window.addEventListener(e, handler, true)
  return cleanup
}
