/**
 * Microphone monitor (GDD §4.3): Web Audio analysis in the browser. The audio
 * never leaves the device — only the shares computed by `classify.ts` are
 * sent with `claim`.
 *
 * - One monitor for the whole tab (module state), so screen re-renders and
 *   route changes do not restart it. `MicBridge` runs it only while the
 *   session is counting down: a pause releases the device (nothing counted)
 *   and resuming opens it again without a new prompt.
 * - The tally is mirrored in sessionStorage per session id, so a reload in
 *   the middle of a session keeps the partial shares.
 * - Needs a secure context (localhost or HTTPS); otherwise, or without
 *   permission, the session simply has no sound profile.
 */
import { create } from 'zustand'
import type { SoundProfile } from '../../../engine'
import {
  addWindow,
  classifyWindow,
  EMPTY_TALLY,
  frameFeatures,
  parseTally,
  profileOf,
  rmsDbOf,
  updateFloor,
  windowFeatures,
  type FrameFeatures,
  type SoundKind,
  type SoundTally,
} from './classify'

export type MicStatus = 'off' | 'starting' | 'listening' | 'insecure' | 'unsupported' | 'denied' | 'error'

export interface MicState {
  status: MicStatus
  sessionId: string | null
  tally: SoundTally
  /** Kind of the last analysed window (null before the first). */
  current: SoundKind | null
}

export const useMic = create<MicState>()(() => ({ status: 'off', sessionId: null, tally: EMPTY_TALLY, current: null }))

const FRAME_MS = 100
const WINDOW_MS = 2000
/** Credit at most this much time to one window (a throttled background tab may tick rarely). */
const MAX_WINDOW_CREDIT_S = 60
const STORAGE_PREFIX = 'pokefocus.mic.'

interface Runtime {
  stream: MediaStream
  ctx: AudioContext
  analyser: AnalyserNode
  timer: ReturnType<typeof setInterval>
  frames: FrameFeatures[]
  windowStart: number
  floor: number | null
  time: Float32Array<ArrayBuffer>
  freq: Float32Array<ArrayBuffer>
  resumeOnGesture: (() => void) | null
}

let rt: Runtime | null = null
/** Bumped by stop(): a getUserMedia that resolves after a stop is discarded. */
let generation = 0

/** Why the microphone cannot be used here, or null if it can be tried. */
export function micUnavailable(): 'insecure' | 'unsupported' | null {
  if (typeof window === 'undefined') return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return 'unsupported'
  return null
}

function storageKey(sessionId: string): string {
  return STORAGE_PREFIX + sessionId
}

function loadTally(sessionId: string): SoundTally | null {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId))
    return raw ? parseTally(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function saveTally(sessionId: string, t: SoundTally): void {
  try {
    sessionStorage.setItem(storageKey(sessionId), JSON.stringify(t))
  } catch {
    // Storage full or blocked: the in-memory tally still works for this tab.
  }
}

/** Forget stored tallies of every session but `keep`. */
export function clearMicTallies(keep: string | null = null): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(STORAGE_PREFIX) && k !== (keep ? storageKey(keep) : null)) sessionStorage.removeItem(k)
    }
  } catch {
    // ignore
  }
  if (useMic.getState().sessionId !== keep) useMic.setState({ sessionId: keep, tally: keep ? (loadTally(keep) ?? EMPTY_TALLY) : EMPTY_TALLY, current: null })
}

function errorStatus(e: unknown): MicStatus {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unsupported'
  return 'error'
}

const CONSTRAINTS: MediaStreamConstraints = {
  // Raw levels: the classifier relies on real loudness and noise.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
}

/**
 * Ask for permission now (from the PreSession toggle, inside a user gesture)
 * and release the device at once. Returns the resulting status.
 */
export async function probeMic(): Promise<MicStatus> {
  const why = micUnavailable()
  if (why) {
    useMic.setState({ status: why })
    return why
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
    s.getTracks().forEach((t) => t.stop())
    if (!rt) useMic.setState({ status: 'off' })
    return 'off'
  } catch (e) {
    const st = errorStatus(e)
    useMic.setState({ status: st })
    return st
  }
}

/** Start (or keep) listening for `sessionId`. Idempotent. */
export async function startMic(sessionId: string): Promise<void> {
  const s = useMic.getState()
  if (rt && s.sessionId === sessionId) return
  stopMic()
  const tally = s.sessionId === sessionId ? s.tally : (loadTally(sessionId) ?? EMPTY_TALLY)
  useMic.setState({ sessionId, tally, current: null })
  const why = micUnavailable()
  if (why) {
    useMic.setState({ status: why })
    return
  }
  const gen = ++generation
  useMic.setState({ status: 'starting' })
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
  } catch (e) {
    if (gen === generation) useMic.setState({ status: errorStatus(e) })
    return
  }
  if (gen !== generation) {
    stream.getTracks().forEach((t) => t.stop())
    return
  }
  try {
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0
    source.connect(analyser) // never connected to the speakers
    const runtime: Runtime = {
      stream,
      ctx,
      analyser,
      timer: setInterval(tick, FRAME_MS),
      frames: [],
      windowStart: Date.now(),
      floor: null,
      time: new Float32Array(analyser.fftSize),
      freq: new Float32Array(analyser.frequencyBinCount),
      resumeOnGesture: null,
    }
    rt = runtime
    // Autoplay rules: after a reload the context may start suspended until the next tap/click.
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
      const resume = () => void ctx.resume().catch(() => {})
      runtime.resumeOnGesture = resume
      window.addEventListener('pointerdown', resume, { once: true })
      window.addEventListener('keydown', resume, { once: true })
    }
    // The track can end on its own (device unplugged, permission revoked).
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (rt === runtime) {
        stopMic()
        useMic.setState({ status: 'error' })
      }
    })
    useMic.setState({ status: 'listening' })
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    useMic.setState({ status: 'error' })
  }
}

function tick(): void {
  const r = rt
  if (!r) return
  const now = Date.now()
  if (r.ctx.state === 'running') {
    r.analyser.getFloatTimeDomainData(r.time)
    r.analyser.getFloatFrequencyData(r.freq)
    r.frames.push(frameFeatures(r.freq, r.ctx.sampleRate, rmsDbOf(r.time)))
  }
  const elapsed = now - r.windowStart
  if (elapsed < WINDOW_MS) return
  const frames = r.frames
  r.frames = []
  r.windowStart = now
  const w = windowFeatures(frames)
  if (!w) return
  const kind = classifyWindow(w, r.floor)
  r.floor = updateFloor(r.floor, w.rmsDb)
  const s = useMic.getState()
  if (!s.sessionId) return
  const tally = addWindow(s.tally, kind, Math.min(elapsed / 1000, MAX_WINDOW_CREDIT_S))
  useMic.setState({ tally, current: kind })
  saveTally(s.sessionId, tally)
}

/** Release the microphone. The tally is kept until the session is claimed or cancelled. */
export function stopMic(): void {
  generation++
  const r = rt
  rt = null
  if (r) {
    clearInterval(r.timer)
    r.stream.getTracks().forEach((t) => t.stop())
    void r.ctx.close().catch(() => {})
    if (r.resumeOnGesture) {
      window.removeEventListener('pointerdown', r.resumeOnGesture)
      window.removeEventListener('keydown', r.resumeOnGesture)
    }
  }
  const st = useMic.getState().status
  if (st === 'listening' || st === 'starting') useMic.setState({ status: 'off', current: null })
}

/** Shares to send with `claim` for this session (null if none or too little analysed). */
export function micProfileFor(sessionId: string): SoundProfile | null {
  const s = useMic.getState()
  const tally = s.sessionId === sessionId ? s.tally : loadTally(sessionId)
  return tally ? profileOf(tally) : null
}
