/**
 * Lookahead scheduler ("A Tale of Two Clocks"): a coarse JS timer wakes up
 * periodically and schedules every bar whose start falls inside the lookahead
 * window, using sample-accurate AudioContext time. The timing math is pure and
 * unit-tested; the timer source is injectable (Worker clock in the browser,
 * fake clock in tests).
 */

/** Seconds per beat at `bpm`. */
export function beatDuration(bpm: number): number {
  return 60 / bpm
}

/** Seconds per bar. */
export function barDuration(bpm: number, beatsPerBar: number): number {
  return beatDuration(bpm) * beatsPerBar
}

/**
 * Swing: offsets every odd eighth (in beats) later by `swing` (0 = straight,
 * 1/3 ≈ triplet feel). Returns the swung position in beats.
 */
export function swingBeat(beat: number, swing: number): number {
  if (swing <= 0) return beat
  const eighth = beat * 2
  const whole = Math.floor(eighth + 1e-9)
  const frac = eighth - whole
  // Only exact off-beat eighths move; an eighth is half a beat.
  if (whole % 2 === 1 && frac < 1e-6) return beat + swing * 0.5
  return beat
}

export interface WindowResult {
  /** Bar start times (AudioContext seconds) to schedule now, ascending. */
  bars: number[]
  /** Next unscheduled bar start. */
  next: number
  /** Number of bars skipped because the clock fell too far behind. */
  skipped: number
}

/**
 * Which bars must be scheduled now.
 * - `next`: start of the next unscheduled bar
 * - `now`: current AudioContext time
 * - `lookahead`: seconds ahead to fill
 * - `barDur`: bar length in seconds
 * If the clock fell behind by more than one bar (tab frozen, laptop asleep),
 * the backlog is dropped and playback resumes `restartDelay` from now instead
 * of bursting all the missed notes at once.
 */
export function barsInWindow(next: number, now: number, lookahead: number, barDur: number, restartDelay = 0.05): WindowResult {
  if (!(barDur > 0) || !Number.isFinite(next) || !Number.isFinite(now)) return { bars: [], next, skipped: 0 }
  let cursor = next
  let skipped = 0
  if (cursor < now - barDur * 0.5) {
    skipped = Math.max(1, Math.round((now - cursor) / barDur))
    cursor = now + restartDelay
  }
  const bars: number[] = []
  const limit = now + Math.max(0, lookahead)
  // A bar is scheduled as soon as its start enters the window.
  while (cursor < limit && bars.length < 64) {
    bars.push(cursor)
    cursor += barDur
  }
  return { bars, next: cursor, skipped }
}

/** Interface of a periodic tick source. */
export interface TickSource {
  start(intervalMs: number, onTick: () => void): void
  stop(): void
}

/** Plain setInterval tick source (throttled to ~1 Hz in background tabs). */
export function intervalTickSource(): TickSource {
  let id: ReturnType<typeof setInterval> | null = null
  return {
    start(ms, onTick) {
      if (id !== null) clearInterval(id)
      id = setInterval(onTick, ms)
    },
    stop() {
      if (id !== null) clearInterval(id)
      id = null
    },
  }
}

/**
 * Tick source backed by a tiny inline Web Worker. Worker timers are not
 * subject to the aggressive main-thread throttling of hidden tabs, so music
 * keeps flowing during a focus session in a background tab. Falls back to
 * setInterval when Workers / Blob URLs are unavailable.
 */
export function workerTickSource(): TickSource {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return intervalTickSource()
  }
  let worker: Worker | null = null
  let url: string | null = null
  let fallback: TickSource | null = null
  return {
    start(ms, onTick) {
      this.stop()
      try {
        const src = 'let id=null;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}'
        url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
        const w = new Worker(url)
        worker = w
        w.onmessage = onTick
        // A worker that fails to load (blocked Blob URLs, CSP) errors asynchronously: fall back then.
        w.onerror = () => {
          if (worker !== w) return
          this.stop()
          fallback = intervalTickSource()
          fallback.start(ms, onTick)
        }
        w.postMessage(ms)
      } catch {
        fallback = intervalTickSource()
        fallback.start(ms, onTick)
      }
    },
    stop() {
      if (worker) {
        worker.postMessage(0)
        worker.terminate()
        worker = null
      }
      if (url) {
        URL.revokeObjectURL(url)
        url = null
      }
      fallback?.stop()
      fallback = null
    },
  }
}

export interface BarSchedulerOptions {
  getTime: () => number
  barDur: number
  onBar: (barIndex: number, startTime: number) => void
  tick?: TickSource
  /** Timer interval while visible (ms). */
  intervalMs?: number
  /** Lookahead while visible (s). */
  lookahead?: number
  /** Lookahead while the page is hidden (s), to survive ~1 s timer throttling. */
  hiddenLookahead?: number
}

/** Bar-granular lookahead scheduler. */
export class BarScheduler {
  private next = 0
  private bar = 0
  private running = false
  private hidden = false
  private readonly tick: TickSource
  private readonly opts: Required<Omit<BarSchedulerOptions, 'tick'>>

  constructor(opts: BarSchedulerOptions) {
    this.tick = opts.tick ?? intervalTickSource()
    this.opts = {
      getTime: opts.getTime,
      barDur: opts.barDur,
      onBar: opts.onBar,
      intervalMs: opts.intervalMs ?? 100,
      lookahead: opts.lookahead ?? 0.6,
      hiddenLookahead: opts.hiddenLookahead ?? 2.5,
    }
  }

  get isRunning(): boolean {
    return this.running
  }

  get barIndex(): number {
    return this.bar
  }

  /** Start with the first bar at `startTime` (defaults to now + 50 ms). */
  start(startTime?: number): void {
    if (this.running) return
    this.running = true
    this.next = startTime ?? this.opts.getTime() + 0.05
    this.bar = 0
    this.pump()
    this.tick.start(this.opts.intervalMs, () => this.pump())
  }

  stop(): void {
    this.running = false
    this.tick.stop()
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden
    if (this.running) this.pump()
  }

  /** Schedule everything due. Public for tests / manual pumping. */
  pump(): void {
    if (!this.running) return
    const la = this.hidden ? this.opts.hiddenLookahead : this.opts.lookahead
    const res = barsInWindow(this.next, this.opts.getTime(), la, this.opts.barDur)
    this.bar += res.skipped
    for (const t of res.bars) {
      this.opts.onBar(this.bar, t)
      this.bar++
    }
    this.next = res.next
  }
}
