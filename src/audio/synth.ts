/**
 * Tiny sfxr-style voice synth on top of the Web Audio API.
 *
 * A preset is a list of voices; each voice is one oscillator (pulse / triangle /
 * saw / sine) or a noise source, with an ADSR-ish envelope, optional pitch
 * slide, arpeggio, vibrato, filter sweep and pan. Types and duration math are
 * pure (unit-tested); `renderPreset` needs a (Offline)AudioContext.
 */
import { semis } from './theory'

export type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine' | 'noise'

export interface Envelope {
  /** Seconds to reach peak. */
  attack: number
  /** Seconds from peak to sustain level (exponential). */
  decay: number
  /** Sustain level 0–1 relative to peak. 0 = one-shot (ends after decay). */
  sustain: number
  /** Seconds held at sustain. */
  hold: number
  /** Seconds from sustain to silence. */
  release: number
}

export interface FilterSpec {
  type: 'lowpass' | 'highpass' | 'bandpass'
  freq: number
  /** Sweep target (exponential, over the voice duration). */
  freqEnd?: number
  q?: number
}

export interface SfxVoice {
  wave: Wave
  /** Pulse width for `square` (0.125 / 0.25 / 0.5 …). Default 0.5. */
  duty?: number
  /** Start frequency in Hz (ignored for noise). */
  freq: number
  /** Slide target in Hz (exponential). */
  freqEnd?: number
  /** Slide time in seconds (default: whole voice). */
  slide?: number
  /** Noise playback rate (1 = white; lower = darker/crunchier). */
  rate?: number
  rateEnd?: number
  /** Arpeggio: semitone offsets stepped every `step` seconds. */
  arp?: { semis: readonly number[]; step: number; loop?: boolean }
  /** Vibrato in cents. */
  vibrato?: { rate: number; depth: number; delay?: number }
  /** Start offset within the preset (s). */
  start?: number
  env: Envelope
  /** Peak gain 0–1. */
  gain: number
  filter?: FilterSpec
  /** -1 (left) … 1 (right). */
  pan?: number
  panEnd?: number
}

export type SfxKind = 'ui' | 'game' | 'fanfare'

export interface SfxPreset {
  voices: readonly SfxVoice[]
  /** Overall preset gain 0–1. */
  gain?: number
  /** Random pitch variance (± cents) per play, to avoid ear fatigue. */
  variance?: number
  /** Minimum ms between two plays (rate limit). */
  cooldownMs?: number
  /** Max simultaneous instances. */
  maxInstances?: number
  /** Duck the music while this plays. */
  duck?: boolean
  /** Fanfares may last up to 3 s; everything else ≤ 1.5 s. */
  kind: SfxKind
}

export interface RenderOptions {
  /** Pitch offset in cents. */
  cents?: number
  /** Extra gain multiplier (0–1). */
  gain?: number
  /** Stereo offset added to every voice pan. */
  pan?: number
}

export interface SfxHandle {
  /** AudioContext time when the sound ends. */
  readonly end: number
  /** Stop immediately (also cancels a sound scheduled in the future). */
  stop(): void
}

const MIN_ATTACK = 0.002
const FLOOR = 0.0001

export function envDuration(env: Envelope): number {
  const a = Math.max(MIN_ATTACK, env.attack)
  if (env.sustain <= 0) return a + Math.max(0.005, env.decay)
  return a + Math.max(0, env.decay) + Math.max(0, env.hold) + Math.max(0.005, env.release)
}

export function voiceEnd(v: SfxVoice): number {
  return (v.start ?? 0) + envDuration(v.env)
}

/** Total length of a preset in seconds. */
export function presetDuration(p: SfxPreset): number {
  return p.voices.reduce((m, v) => Math.max(m, voiceEnd(v)), 0)
}

/** Default softening filter for bright waves (keeps squares from sounding harsh). */
function defaultFilter(v: SfxVoice): FilterSpec | undefined {
  if (v.filter) return v.filter
  if (v.wave === 'square' || v.wave === 'sawtooth') return { type: 'lowpass', freq: 5200, q: 0.4 }
  return undefined
}

// --- per-context caches --------------------------------------------------------

const pulseCache = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>()
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

/** Fourier series of a pulse wave with the given duty cycle. */
export function pulseCoefficients(duty: number, harmonics = 48): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  for (let n = 1; n <= harmonics; n++) {
    // Gentle rolloff of the top harmonics (anti-harsh + less aliasing).
    const taper = n > harmonics * 0.5 ? Math.cos(((n - harmonics * 0.5) / (harmonics * 0.5)) * (Math.PI / 2)) : 1
    real[n] = ((2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)) * taper
  }
  return { real, imag }
}

export function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  let m = pulseCache.get(ctx)
  if (!m) {
    m = new Map()
    pulseCache.set(ctx, m)
  }
  const key = Math.round(duty * 1000)
  let w = m.get(key)
  if (!w) {
    const { real, imag } = pulseCoefficients(duty)
    w = ctx.createPeriodicWave(real, imag)
    m.set(key, w)
  }
  return w
}

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx)
  if (!b) {
    const len = Math.floor(ctx.sampleRate * 2)
    b = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = b.getChannelData(0)
    let seed = 1234567
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0
      d[i] = ((seed >>> 0) / 4294967296) * 2 - 1
    }
    noiseCache.set(ctx, b)
  }
  return b
}

// --- rendering -----------------------------------------------------------------

function applyEnvelope(param: AudioParam, env: Envelope, peak: number, t0: number): number {
  const a = Math.max(MIN_ATTACK, env.attack)
  const p = Math.max(FLOOR * 2, peak)
  param.setValueAtTime(0, t0)
  param.linearRampToValueAtTime(p, t0 + a)
  if (env.sustain <= 0) {
    const end = t0 + a + Math.max(0.005, env.decay)
    param.exponentialRampToValueAtTime(FLOOR, end)
    param.setValueAtTime(0, end)
    return end
  }
  const sus = Math.max(FLOOR * 2, p * Math.min(1, env.sustain))
  const tD = t0 + a + Math.max(0, env.decay)
  if (env.decay > 0) param.exponentialRampToValueAtTime(sus, tD)
  else param.setValueAtTime(sus, tD)
  const tH = tD + Math.max(0, env.hold)
  param.setValueAtTime(sus, tH)
  const end = tH + Math.max(0.005, env.release)
  param.exponentialRampToValueAtTime(FLOOR, end)
  param.setValueAtTime(0, end)
  return end
}

/**
 * Schedule a preset at context time `at` into `dest`. Returns a handle; nodes
 * disconnect themselves when finished.
 */
export function renderPreset(
  ctx: BaseAudioContext,
  dest: AudioNode,
  preset: SfxPreset,
  at: number,
  opts: RenderOptions = {},
): SfxHandle {
  const cents = opts.cents ?? 0
  const pGain = Math.min(1, Math.max(0, (preset.gain ?? 1) * (opts.gain ?? 1)))
  const sources: AudioScheduledSourceNode[] = []
  const nodes: AudioNode[] = []
  let end = at
  let pending = 0
  const cleanup = (): void => {
    for (const n of nodes) {
      try {
        n.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    nodes.length = 0
  }

  for (const v of preset.voices) {
    const t0 = at + (v.start ?? 0)
    const dur = envDuration(v.env)
    const tEnd = t0 + dur
    end = Math.max(end, tEnd)

    const amp = ctx.createGain()
    nodes.push(amp)
    applyEnvelope(amp.gain, v.env, v.gain * pGain, t0)

    let src: AudioScheduledSourceNode
    if (v.wave === 'noise') {
      const ns = ctx.createBufferSource()
      ns.buffer = noiseBuffer(ctx)
      ns.loop = true
      const r0 = Math.max(0.01, (v.rate ?? 1) * semis(cents / 100))
      ns.playbackRate.setValueAtTime(r0, t0)
      if (v.rateEnd !== undefined) {
        ns.playbackRate.exponentialRampToValueAtTime(Math.max(0.01, v.rateEnd * semis(cents / 100)), tEnd)
      }
      src = ns
    } else {
      const osc = ctx.createOscillator()
      if (v.wave === 'square') osc.setPeriodicWave(pulseWave(ctx, v.duty ?? 0.5))
      else osc.type = v.wave
      osc.detune.setValueAtTime(cents, t0)
      osc.frequency.setValueAtTime(v.freq, t0)
      if (v.arp && v.arp.semis.length > 0) {
        const steps = v.arp.semis
        const stepT = Math.max(0.01, v.arp.step)
        const count = v.arp.loop ? Math.ceil(dur / stepT) : steps.length
        for (let i = 0; i < count; i++) {
          const t = t0 + i * stepT
          if (t >= tEnd) break
          osc.frequency.setValueAtTime(v.freq * semis(steps[i % steps.length] as number), t)
        }
      } else if (v.freqEnd !== undefined) {
        const slideT = Math.min(dur, v.slide ?? dur)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.freqEnd), t0 + Math.max(0.005, slideT))
      }
      if (v.vibrato && v.vibrato.depth > 0) {
        const lfo = ctx.createOscillator()
        const lfoGain = ctx.createGain()
        lfo.frequency.value = v.vibrato.rate
        const vd = t0 + (v.vibrato.delay ?? 0)
        lfoGain.gain.setValueAtTime(0, t0)
        lfoGain.gain.linearRampToValueAtTime(v.vibrato.depth, Math.min(tEnd, vd + 0.08))
        lfo.connect(lfoGain)
        lfoGain.connect(osc.detune)
        lfo.start(t0)
        lfo.stop(tEnd + 0.02)
        sources.push(lfo)
        nodes.push(lfo, lfoGain)
      }
      src = osc
    }
    nodes.push(src)

    let head: AudioNode = src
    const f = defaultFilter(v)
    if (f) {
      const bq = ctx.createBiquadFilter()
      bq.type = f.type
      bq.Q.value = f.q ?? (f.type === 'bandpass' ? 1 : 0.7)
      bq.frequency.setValueAtTime(f.freq, t0)
      if (f.freqEnd !== undefined) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f.freqEnd), tEnd)
      head.connect(bq)
      head = bq
      nodes.push(bq)
    }
    head.connect(amp)
    head = amp

    const pan = (v.pan ?? 0) + (opts.pan ?? 0)
    if ((pan !== 0 || v.panEnd !== undefined) && typeof ctx.createStereoPanner === 'function') {
      const sp = ctx.createStereoPanner()
      const clamp = (x: number): number => Math.max(-1, Math.min(1, x))
      sp.pan.setValueAtTime(clamp(pan), t0)
      if (v.panEnd !== undefined) sp.pan.linearRampToValueAtTime(clamp(v.panEnd + (opts.pan ?? 0)), tEnd)
      head.connect(sp)
      head = sp
      nodes.push(sp)
    }
    head.connect(dest)

    src.start(t0)
    src.stop(tEnd + 0.02)
    sources.push(src)
    pending++
    src.onended = () => {
      pending--
      if (pending <= 0) cleanup()
    }
  }

  return {
    end,
    stop() {
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          /* not started / already stopped */
        }
      }
      cleanup()
    },
  }
}
