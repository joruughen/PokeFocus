/**
 * App-side audio helpers on top of `src/audio` (see docs/audio.md):
 * - `sfx(name)`: play a named effect (respects the user's audio settings).
 * - The end-of-session chime is scheduled on the audio clock when a session
 *   starts or resumes (background-tab safe) and cancelled on pause/cancel.
 *   SessionWatcher only plays it itself when nothing was scheduled (e.g. after a reload).
 */
import { audio, type SfxHandle, type SfxName, type SfxOptions } from '../../audio'
import { now, usePrefs } from '../store/prefs'

export function sfx(name: SfxName, opts?: SfxOptions): void {
  try {
    audio.sfx(name, opts)
  } catch {
    /* audio is optional */
  }
}

/** Play `name` after `ms` of real time (audio clock; safe in hidden tabs). */
export function sfxLater(name: SfxName, ms: number, opts?: SfxOptions): void {
  try {
    audio.sfxAt(name, ms / 1000, opts)
  } catch {
    /* audio is optional */
  }
}

let endHandle: { sessionKey: string; handle: SfxHandle | null } | null = null

/** Schedule the session-end chime for `endsAt` (game time; converted with the dev clock rate). */
export function scheduleSessionEnd(sessionKey: string, endsAt: number): void {
  cancelSessionEnd()
  const rate = usePrefs.getState().dev.anchor?.rate ?? 1
  const realMs = Math.max(0, (endsAt - now()) / Math.max(1, rate))
  let handle: SfxHandle | null = null
  try {
    handle = audio.sfxAt('sessionEnd', realMs / 1000)
  } catch {
    handle = null
  }
  endHandle = { sessionKey, handle }
}

export function cancelSessionEnd(): void {
  endHandle?.handle?.stop()
  endHandle = null
}

/** True when the chime for this session is already on the audio clock. */
export function sessionEndScheduled(sessionKey: string): boolean {
  return endHandle?.sessionKey === sessionKey && endHandle.handle !== null
}
