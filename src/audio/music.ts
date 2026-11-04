/**
 * One playing instance of a generative track: its own fade gain, reverb send,
 * lookahead scheduler and (optional) vinyl hiss bed. The engine crossfades by
 * running two of these at once.
 */
import { playInstrument, startHiss } from './instruments'
import { BarScheduler, barDuration, beatDuration, type TickSource } from './scheduler'
import { TrackGenerator, type TrackDef } from './tracks'

export interface TrackPlayerOptions {
  ctx: BaseAudioContext & { currentTime: number }
  out: AudioNode
  reverbIn: AudioNode
  def: TrackDef
  seed?: string | number
  hiss: boolean
  /** 0–1 extra level (e.g. lower during focus). */
  level: number
  tick: TickSource
}

export class TrackPlayer {
  readonly def: TrackDef
  private readonly opts: TrackPlayerOptions
  private readonly fade: GainNode
  private readonly send: GainNode
  private readonly scheduler: BarScheduler
  private readonly gen: TrackGenerator
  private stopHiss: (() => void) | null = null
  private stopped = false
  private hiss: boolean

  constructor(opts: TrackPlayerOptions) {
    this.opts = opts
    this.def = opts.def
    this.hiss = opts.hiss
    const { ctx } = opts
    this.fade = ctx.createGain()
    this.fade.gain.value = 0
    this.send = ctx.createGain()
    this.send.gain.value = opts.def.reverb
    this.fade.connect(opts.out)
    this.fade.connect(this.send)
    this.send.connect(opts.reverbIn)
    this.gen = new TrackGenerator(opts.def, opts.seed ?? Math.floor(Math.random() * 1e9))
    const beat = beatDuration(opts.def.bpm)
    this.scheduler = new BarScheduler({
      getTime: () => ctx.currentTime,
      barDur: barDuration(opts.def.bpm, opts.def.beatsPerBar),
      tick: opts.tick,
      onBar: (_i, t0) => {
        const bar = this.gen.next()
        const ic = { ctx, dest: this.fade, padCutoff: this.def.padCutoff }
        for (const e of bar.events) {
          if (e.inst === 'crackle' && !this.hiss) continue
          playInstrument(ic, e.inst, e.midi, t0 + e.beat * beat, e.dur * beat, e.vel)
        }
      },
    })
  }

  private target(): number {
    return Math.max(0, Math.min(1, this.def.gain * this.opts.level))
  }

  start(fadeSec: number): void {
    const { ctx } = this.opts
    const now = ctx.currentTime
    this.fade.gain.cancelScheduledValues(now)
    this.fade.gain.setValueAtTime(0, now)
    this.fade.gain.linearRampToValueAtTime(this.target(), now + Math.max(0.02, fadeSec))
    if (this.hiss && this.def.hiss) this.stopHiss = startHiss(ctx, this.fade)
    this.scheduler.start(now + 0.08)
  }

  setLevel(level: number, rampSec = 0.4): void {
    this.opts.level = level
    if (this.stopped) return
    const now = this.opts.ctx.currentTime
    this.fade.gain.cancelScheduledValues(now)
    this.fade.gain.setValueAtTime(this.fade.gain.value, now)
    this.fade.gain.linearRampToValueAtTime(this.target(), now + rampSec)
  }

  setHiss(on: boolean): void {
    this.hiss = on
    if (this.stopped) return
    if (on && this.def.hiss && !this.stopHiss) this.stopHiss = startHiss(this.opts.ctx, this.fade)
    if (!on && this.stopHiss) {
      this.stopHiss()
      this.stopHiss = null
    }
  }

  setHidden(hidden: boolean): void {
    this.scheduler.setHidden(hidden)
  }

  /** Fade out and release everything. Returns ms until fully silent. */
  stop(fadeSec: number): number {
    if (this.stopped) return 0
    this.stopped = true
    this.scheduler.stop()
    const now = this.opts.ctx.currentTime
    const f = Math.max(0.02, fadeSec)
    this.fade.gain.cancelScheduledValues(now)
    this.fade.gain.setValueAtTime(this.fade.gain.value, now)
    this.fade.gain.linearRampToValueAtTime(0, now + f)
    // Notes already scheduled ring out under the fade; disconnect after the longest tail.
    const ms = (f + barDuration(this.def.bpm, this.def.beatsPerBar) + 2.5) * 1000
    setTimeout(() => {
      this.stopHiss?.()
      this.stopHiss = null
      try {
        this.fade.disconnect()
        this.send.disconnect()
      } catch {
        /* noop */
      }
    }, ms)
    return f * 1000
  }
}
