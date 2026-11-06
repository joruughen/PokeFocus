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
 * - Uses the personal thresholds of the device if it was calibrated
 *   (`calibration-store.ts`), else `DEFAULT_THRESHOLDS`.
 * - Headphones option (`setMicHeadphones`): silent windows count as music.
 *   Music through speakers, the app's own focus music included, is heard by
 *   the mic and counts as music anyway (accepted).
 */
import { create } from 'zustand'
import type { SoundProfile } from '../../../engine'
import { CONSTRAINTS, errorStatus, micUnavailable, openMicAnalyser, type MicAnalyser, type MicStatus } from './analyser'
import { thresholdsFor } from './calibration-store'
import {
  addWindow,
  applyHeadphones,
  classifyWindow,
  EMPTY_TALLY,
  parseTally,
  profileOf,
  updateFloor,
  windowFeatures,
  type FrameFeatures,
  type SoundKind,
  type SoundTally,
  type Thresholds,
} from './classify'

export { micUnavailable, type MicStatus }

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
  mic: MicAnalyser
  timer: ReturnType<typeof setInterval>
  frames: FrameFeatures[]
  windowStart: number
  floor: number | null
  /** Personal thresholds of this device (calibration), else the defaults. */
  thresholds: Thresholds
}

/** "I listen to music on headphones" (prefs): silent windows count as music. */
let headphones = false
export function setMicHeadphones(on: boolean): void {
  headphones = on
}

let rt: Runtime | null = null
/** Bumped by stop(): a getUserMedia that resolves after a stop is discarded. */
let generation = 0

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
  const r = await openMicAnalyser()
  if (!r.ok) {
    if (gen === generation) useMic.setState({ status: r.status })
    return
  }
  if (gen !== generation) {
    r.mic.close()
    return
  }
  const runtime: Runtime = {
    mic: r.mic,
    timer: setInterval(tick, FRAME_MS),
    frames: [],
    windowStart: Date.now(),
    floor: null,
    thresholds: thresholdsFor(r.mic.deviceId),
  }
  rt = runtime
  r.mic.onEnded(() => {
    if (rt === runtime) {
      stopMic()
      useMic.setState({ status: 'error' })
    }
  })
  useMic.setState({ status: 'listening' })
}

function tick(): void {
  const r = rt
  if (!r) return
  const now = Date.now()
  const f = r.mic.frame()
  if (f) r.frames.push(f)
  const elapsed = now - r.windowStart
  if (elapsed < WINDOW_MS) return
  const frames = r.frames
  r.frames = []
  r.windowStart = now
  const w = windowFeatures(frames)
  if (!w) return
  const kind = applyHeadphones(classifyWindow(w, r.floor, r.thresholds), headphones)
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
    r.mic.close()
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
