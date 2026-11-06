/**
 * Microphone monitor (GDD §4.3): Web Audio analysis in the browser. The audio
 * never leaves the device — only the shares computed by `classify.ts` are
 * sent with `claim`.
 *
 * - One monitor for the whole tab (module state), so screen re-renders and
 *   route changes do not restart it. `MicBridge` runs it only while the
 *   session is counting down: a pause releases the device (nothing counted)
 *   and resuming opens it again without a new prompt.
 * - A small record per session id is mirrored in sessionStorage (tally plus
 *   the last problem: permission denied, device lost…), so a reload keeps the
 *   partial shares and Results can say why the mic did not apply.
 * - Needs a secure context (localhost or HTTPS); otherwise, or without
 *   permission, the session simply has no sound profile, and says so.
 * - Uses the device's calibration (thresholds + noise profile). An
 *   uncalibrated device learns its noise from the first quiet windows.
 * - Only what the mic hears counts: music through the speakers (the app's own
 *   focus music included) is music; music on headphones is not heard.
 */
import { create } from 'zustand'
import type { SoundProfile } from '../../../engine'
import { CONSTRAINTS, deviceIdOf, errorStatus, micUnavailable, openMicAnalyser, type MicAnalyser, type MicStatus } from './analyser'
import { calibrationFor, isCalibrated } from './calibration-store'
import { addWindow, EMPTY_TALLY, MIN_PROFILE_SECONDS, parseTally, profileOf, tallySeconds, type SoundKind, type SoundTally } from './classify'
import { createPipeline, type SoundPipeline } from './pipeline'

export { micUnavailable, type MicStatus }

/** Why the mic stopped or never started in a session. */
export type MicIssue = 'insecure' | 'unsupported' | 'denied' | 'error' | 'lost'
const ISSUES: readonly MicIssue[] = ['insecure', 'unsupported', 'denied', 'error', 'lost']

export interface MicState {
  status: MicStatus
  sessionId: string | null
  tally: SoundTally
  /** Kind of the last analysed window (null before the first). */
  current: SoundKind | null
  /** Last problem in this session (cleared when the mic works again). */
  issue: MicIssue | null
  /** The device in use has a calibration with a noise profile. */
  calibrated: boolean
}

export const useMic = create<MicState>()(() => ({ status: 'off', sessionId: null, tally: EMPTY_TALLY, current: null, issue: null, calibrated: false }))

const FRAME_MS = 100
const WINDOW_MS = 2000
/** Credit at most this much time to one window (a throttled background tab may tick rarely). */
const MAX_WINDOW_CREDIT_S = 60
const STORAGE_PREFIX = 'pokefocus.mic.'
const RESULT_KEY = 'pokefocus.micResult'

interface SessionRecord {
  tally: SoundTally
  issue: MicIssue | null
}

interface Runtime {
  mic: MicAnalyser
  timer: ReturnType<typeof setInterval>
  pipe: SoundPipeline
  windowStart: number
}

let rt: Runtime | null = null
/** Bumped by stop(): a getUserMedia that resolves after a stop is discarded. */
let generation = 0

const storageKey = (sessionId: string) => STORAGE_PREFIX + sessionId

/** Parse a stored record; accepts the older plain-tally format. */
export function parseRecord(raw: unknown): SessionRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { tally?: unknown; issue?: unknown }
  if (o.tally === undefined) {
    const t = parseTally(raw)
    return t ? { tally: t, issue: null } : null
  }
  const tally = parseTally(o.tally)
  if (!tally) return null
  return { tally, issue: ISSUES.includes(o.issue as MicIssue) ? (o.issue as MicIssue) : null }
}

function loadRecord(sessionId: string): SessionRecord | null {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId))
    return raw ? parseRecord(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function saveRecord(): void {
  const s = useMic.getState()
  if (!s.sessionId) return
  try {
    sessionStorage.setItem(storageKey(s.sessionId), JSON.stringify({ tally: s.tally, issue: s.issue } satisfies SessionRecord))
  } catch {
    // Storage full or blocked: the in-memory record still works for this tab.
  }
}

function setIssue(issue: MicIssue | null, status: MicStatus): void {
  useMic.setState({ status, issue, current: null })
  saveRecord()
}

/** Forget stored records of every session but `keep`. */
export function clearMicTallies(keep: string | null = null): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(STORAGE_PREFIX) && k !== (keep ? storageKey(keep) : null)) sessionStorage.removeItem(k)
    }
  } catch {
    // ignore
  }
  if (useMic.getState().sessionId !== keep) {
    const r = keep ? loadRecord(keep) : null
    useMic.setState({ sessionId: keep, tally: r?.tally ?? EMPTY_TALLY, issue: r?.issue ?? null, current: null })
  }
}

/**
 * Ask for permission now (from the PreSession toggle, inside a user gesture)
 * and release the device at once. Returns the status and the device id (the
 * calibration key).
 */
export async function probeMic(): Promise<{ status: MicStatus; deviceId: string | null }> {
  const why = micUnavailable()
  if (why) {
    useMic.setState({ status: why })
    return { status: why, deviceId: null }
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
    const deviceId = deviceIdOf(s)
    s.getTracks().forEach((t) => t.stop())
    if (!rt) useMic.setState({ status: 'off' })
    return { status: 'off', deviceId }
  } catch (e) {
    const st = errorStatus(e)
    useMic.setState({ status: st })
    return { status: st, deviceId: null }
  }
}

/** Start (or keep) listening for `sessionId`. Idempotent. */
export async function startMic(sessionId: string): Promise<void> {
  const s = useMic.getState()
  if (rt && s.sessionId === sessionId) return
  stopMic()
  const rec = s.sessionId === sessionId ? { tally: s.tally, issue: s.issue } : (loadRecord(sessionId) ?? { tally: EMPTY_TALLY, issue: null })
  useMic.setState({ sessionId, tally: rec.tally, issue: rec.issue, current: null })
  saveRecord() // the session had the mic switched on, even if it never starts
  const why = micUnavailable()
  if (why) return setIssue(why, why)
  const gen = ++generation
  useMic.setState({ status: 'starting' })
  const r = await openMicAnalyser()
  if (gen !== generation) {
    if (r.ok) r.mic.close()
    return
  }
  if (!r.ok) return setIssue(r.status === 'off' || r.status === 'starting' || r.status === 'listening' ? 'error' : r.status, r.status)
  const runtime: Runtime = {
    mic: r.mic,
    timer: setInterval(tick, FRAME_MS),
    pipe: createPipeline(calibrationFor(r.mic.deviceId)),
    windowStart: Date.now(),
  }
  rt = runtime
  r.mic.onEnded(() => {
    if (rt === runtime) {
      stopMic()
      setIssue('lost', 'error')
    }
  })
  useMic.setState({ status: 'listening', issue: null, calibrated: isCalibrated(r.mic.deviceId) })
  saveRecord()
}

function tick(): void {
  const r = rt
  if (!r) return
  const now = Date.now()
  const f = r.mic.frame()
  if (f) r.pipe.push(f)
  const elapsed = now - r.windowStart
  if (elapsed < WINDOW_MS) return
  r.windowStart = now
  const out = r.pipe.endWindow()
  if (!out) return
  const s = useMic.getState()
  if (!s.sessionId) return
  const tally = addWindow(s.tally, out.kind, Math.min(elapsed / 1000, MAX_WINDOW_CREDIT_S))
  useMic.setState({ tally, current: out.kind })
  saveRecord()
}

/** Release the microphone. The record is kept until the session is claimed or cancelled. */
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

// ---------------------------------------------------------------------------
// Outcome (what Results explains)
// ---------------------------------------------------------------------------

export interface MicOutcome {
  sessionId: string
  /** Seconds classified. */
  analysedS: number
  /** Shares sent with the claim (null = not applied). */
  profile: SoundProfile | null
  /** Why it stopped, if it did. */
  issue: MicIssue | null
}

/** What the mic did in this session, or null if it was not switched on for it. */
export function micOutcomeFor(sessionId: string): MicOutcome | null {
  const s = useMic.getState()
  const rec = s.sessionId === sessionId ? { tally: s.tally, issue: s.issue } : loadRecord(sessionId)
  if (!rec) return null
  return { sessionId, analysedS: tallySeconds(rec.tally), profile: profileOf(rec.tally), issue: rec.issue }
}

/** Shares to send with `claim` for this session (null if none or too little analysed). */
export function micProfileFor(sessionId: string): SoundProfile | null {
  return micOutcomeFor(sessionId)?.profile ?? null
}

/** Why the mic did not apply to an outcome (null = it applied, or it was not on). */
export function micSkipReason(o: MicOutcome | null): { kind: 'issue'; issue: MicIssue } | { kind: 'short'; seconds: number; min: number } | null {
  if (!o || o.profile) return null
  if (o.issue) return { kind: 'issue', issue: o.issue }
  return { kind: 'short', seconds: Math.floor(o.analysedS), min: MIN_PROFILE_SECONDS }
}

function parseOutcome(raw: unknown): MicOutcome | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<Record<keyof MicOutcome, unknown>>
  if (typeof o.sessionId !== 'string' || typeof o.analysedS !== 'number' || !Number.isFinite(o.analysedS)) return null
  return {
    sessionId: o.sessionId,
    analysedS: Math.max(0, o.analysedS),
    profile: null, // the server's result carries the applied shares
    issue: ISSUES.includes(o.issue as MicIssue) ? (o.issue as MicIssue) : null,
  }
}

function loadOutcome(): MicOutcome | null {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY)
    return raw ? parseOutcome(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** The mic outcome of the last claimed session in this tab (for Results). */
export const useMicResult = create<{ last: MicOutcome | null }>()(() => ({ last: loadOutcome() }))

export function rememberMicOutcome(o: MicOutcome | null): void {
  useMicResult.setState({ last: o })
  try {
    if (o) sessionStorage.setItem(RESULT_KEY, JSON.stringify(o))
    else sessionStorage.removeItem(RESULT_KEY)
  } catch {
    // ignore
  }
}
