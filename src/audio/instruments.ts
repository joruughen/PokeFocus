/**
 * Music instruments: render one NoteEvent into a destination node. Levels are
 * deliberately low (pads ≈ 0.05 per voice) — the music bus volume and the
 * master limiter sit on top.
 */
import { noiseBuffer, pulseWave } from './synth'
import type { InstrumentId } from './tracks'
import { midiToFreq } from './theory'

export interface InstrumentContext {
  ctx: BaseAudioContext
  dest: AudioNode
  /** Pad low-pass cutoff for the current track. */
  padCutoff: number
}

const FLOOR = 0.0001

function env(g: AudioParam, t: number, attack: number, peak: number, sustainLevel: number, decay: number, noteOff: number, release: number): number {
  const offAt = Math.max(noteOff, t + attack + 0.002)
  g.setValueAtTime(0, t)
  g.linearRampToValueAtTime(Math.max(FLOOR * 2, peak), t + attack)
  const sus = Math.max(FLOOR * 2, peak * sustainLevel)
  const tD = Math.min(offAt, t + attack + decay)
  g.exponentialRampToValueAtTime(sus, tD)
  g.setValueAtTime(sus, offAt)
  const end = offAt + release
  g.exponentialRampToValueAtTime(FLOOR, end)
  g.setValueAtTime(0, end + 0.001)
  return end
}

function finish(src: AudioScheduledSourceNode, nodes: AudioNode[], t: number, end: number): void {
  // Noise hits start at a random point of the buffer so repeats don't sound identical.
  if (src instanceof AudioBufferSourceNode) src.start(t, Math.random() * 1.5)
  else src.start(t)
  src.stop(end + 0.02)
  src.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect()
      } catch {
        /* noop */
      }
    }
  }
}

function osc(ic: InstrumentContext, type: OscillatorType | { duty: number }, freq: number, t: number, detune = 0): OscillatorNode {
  const o = ic.ctx.createOscillator()
  if (typeof type === 'string') o.type = type
  else o.setPeriodicWave(pulseWave(ic.ctx, type.duty))
  o.frequency.setValueAtTime(freq, t)
  if (detune) o.detune.setValueAtTime(detune, t)
  return o
}

function lowpass(ic: InstrumentContext, freq: number, q = 0.6): BiquadFilterNode {
  const f = ic.ctx.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = freq
  f.Q.value = q
  return f
}

function noise(ic: InstrumentContext, rate = 1): AudioBufferSourceNode {
  const n = ic.ctx.createBufferSource()
  n.buffer = noiseBuffer(ic.ctx)
  n.loop = true
  n.playbackRate.value = rate
  return n
}

/** Schedule one note. `t` and `dur` in seconds. */
export function playInstrument(ic: InstrumentContext, inst: InstrumentId, midi: number, t: number, dur: number, vel: number): void {
  const { ctx, dest } = ic
  const v = Math.max(0, Math.min(1, vel))
  const freq = midiToFreq(midi)
  switch (inst) {
    case 'pad': {
      // Two slightly detuned triangles + a quiet sine, low-passed, slow swell.
      const g = ctx.createGain()
      const lp = lowpass(ic, ic.padCutoff, 0.3)
      const a = osc(ic, 'triangle', freq, t, -6)
      const b = osc(ic, 'triangle', freq, t, 6)
      const c = osc(ic, 'sine', freq / 2, t)
      const cg = ctx.createGain()
      cg.gain.value = 0.35
      a.connect(lp)
      b.connect(lp)
      c.connect(cg).connect(lp)
      lp.connect(g).connect(dest)
      const release = Math.min(1.2, 0.4 + dur * 0.15)
      const end = env(g.gain, t, Math.min(0.6, dur * 0.3), 0.045 * v, 0.8, 0.5, t + dur, release)
      const nodes = [a, b, c, cg, lp, g]
      a.start(t)
      b.start(t)
      a.stop(end + 0.02)
      b.stop(end + 0.02)
      finish(c, nodes, t, end)
      return
    }
    case 'bass': {
      const g = ctx.createGain()
      const lp = lowpass(ic, 700, 0.5)
      const a = osc(ic, 'triangle', freq, t)
      const s = osc(ic, 'sine', freq, t)
      a.connect(lp)
      s.connect(lp)
      lp.connect(g).connect(dest)
      const end = env(g.gain, t, 0.01, 0.2 * v, 0.6, 0.15, t + dur * 0.95, 0.12)
      a.start(t)
      a.stop(end + 0.02)
      finish(s, [a, s, lp, g], t, end)
      return
    }
    case 'lead': {
      // 25% pulse through a gentle low-pass, delayed vibrato.
      const g = ctx.createGain()
      const lp = lowpass(ic, 2400, 0.4)
      const o = osc(ic, { duty: 0.25 }, freq, t)
      const lfo = ctx.createOscillator()
      const lg = ctx.createGain()
      lfo.frequency.value = 5.2
      lg.gain.setValueAtTime(0, t)
      lg.gain.linearRampToValueAtTime(dur > 0.4 ? 9 : 0, t + Math.max(0.05, dur * 0.6))
      lfo.connect(lg).connect(o.detune)
      o.connect(lp).connect(g).connect(dest)
      const end = env(g.gain, t, 0.01, 0.06 * v, 0.55, 0.15, t + dur * 0.9, 0.12)
      lfo.start(t)
      lfo.stop(end + 0.02)
      finish(o, [o, lfo, lg, lp, g], t, end)
      return
    }
    case 'pluck': {
      const g = ctx.createGain()
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.Q.value = 0.8
      lp.frequency.setValueAtTime(2600, t)
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.25)
      const o = osc(ic, { duty: 0.5 }, freq, t)
      o.connect(lp).connect(g).connect(dest)
      const end = env(g.gain, t, 0.003, 0.05 * v, 0.15, 0.18, t + Math.min(dur, 0.3), 0.08)
      finish(o, [o, lp, g], t, end)
      return
    }
    case 'bell': {
      const g = ctx.createGain()
      const a = osc(ic, 'sine', freq, t)
      const b = osc(ic, 'sine', freq * 2, t)
      const bg = ctx.createGain()
      bg.gain.setValueAtTime(0.3, t)
      bg.gain.exponentialRampToValueAtTime(0.02, t + 0.6)
      a.connect(g)
      b.connect(bg).connect(g)
      g.connect(dest)
      const ring = Math.max(0.6, Math.min(2.2, dur * 1.5))
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.06 * v, t + 0.004)
      g.gain.exponentialRampToValueAtTime(FLOOR, t + ring)
      g.gain.setValueAtTime(0, t + ring + 0.001)
      b.start(t)
      b.stop(t + ring + 0.02)
      finish(a, [a, b, bg, g], t, t + ring)
      return
    }
    case 'kick': {
      const g = ctx.createGain()
      const o = osc(ic, 'sine', 120, t)
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
      o.connect(g).connect(dest)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.32 * v, t + 0.004)
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.22)
      finish(o, [o, g], t, t + 0.22)
      return
    }
    case 'snare': {
      const g = ctx.createGain()
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1800
      bp.Q.value = 0.8
      const n = noise(ic, 0.9)
      n.connect(bp).connect(g).connect(dest)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.11 * v, t + 0.003)
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.14)
      finish(n, [n, bp, g], t, t + 0.14)
      return
    }
    case 'hat': {
      const g = ctx.createGain()
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 7000
      const n = noise(ic)
      n.connect(hp).connect(g).connect(dest)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.045 * v, t + 0.002)
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.045)
      finish(n, [n, hp, g], t, t + 0.05)
      return
    }
    case 'crackle': {
      const g = ctx.createGain()
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 2500
      const n = noise(ic, 1.5)
      n.connect(hp).connect(g).connect(dest)
      g.gain.setValueAtTime(0.035 * v, t)
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.008)
      finish(n, [n, hp, g], t, t + 0.01)
      return
    }
  }
}

/** Continuous vinyl-ish hiss bed (looped, band-limited noise). Returns a stop fn. */
export function startHiss(ctx: BaseAudioContext, dest: AudioNode, level = 0.012): () => void {
  const n = ctx.createBufferSource()
  n.buffer = noiseBuffer(ctx)
  n.loop = true
  n.playbackRate.value = 0.75
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 900
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 5500
  const g = ctx.createGain()
  g.gain.value = level
  n.connect(hp).connect(lp).connect(g).connect(dest)
  n.start()
  return () => {
    try {
      n.stop()
    } catch {
      /* noop */
    }
    for (const x of [n, hp, lp, g]) x.disconnect()
  }
}
