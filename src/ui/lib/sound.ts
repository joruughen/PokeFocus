/**
 * App-side audio helpers on top of `src/audio` (see docs/audio.md):
 * - `sfx(name)`: play a named effect (respects the user's audio settings).
 * - The end-of-session chime is scheduled on the audio clock when a session
 *   starts or resumes (background-tab safe) and cancelled on pause/cancel.
 *   SessionWatcher only plays it itself when nothing was scheduled (e.g. after a reload).
 * - When the audio context starts running (first gesture after a reload, the
 *   "tap to turn sound on" chip, sound switched back on), SessionWatcher calls
 *   `syncSessionEndToAudio`: a bell scheduled while the context was suspended
 *   is re-timed (a suspended clock does not advance), and the leader tab puts
 *   the bell on the audio clock if nothing was scheduled, so it rings on time
 *   even if the tab is hidden by then.
 * - One sound across tabs (QA R-03): the tab that has the bell on a *running* audio clock holds a
 *   Web Lock named after the session ("bell claim"). The leader tab, which is the one that notifies,
 *   checks it at the end and stays silent when another live tab rings; otherwise it chimes itself.
 *   The lock dies with the tab, so a closed or frozen-silent owner never leaves the end mute.
 */
import { audio, type SfxHandle, type SfxName, type SfxOptions } from '../../audio'
import { timerOf, useGame } from '../store/game'
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

let endHandle: { sessionKey: string; handle: SfxHandle | null; releaseClaim: () => void } | null = null

type Locks = Pick<LockManager, 'request'>
const locksOf = (): Locks | null => (globalThis.navigator as { locks?: Locks } | undefined)?.locks ?? null
const claimName = (sessionKey: string) => `pokefocus-end-bell:${sessionKey}`

/**
 * Hold the bell-claim lock for `sessionKey` until the returned function is called (or the tab closes).
 * No Web Locks: a no-op (every tab is then leader and the persisted `notified` flag is the only guard).
 */
function holdBellClaim(sessionKey: string): () => void {
  const locks = locksOf()
  if (!locks) return () => undefined
  let released = false
  let release: () => void = () => undefined
  void locks
    .request(claimName(sessionKey), () => (released ? undefined : new Promise<void>((res) => (release = res))))
    .catch(() => undefined)
  return () => {
    released = true
    release()
  }
}

/** Only a context that is really running keeps time, so only then does this tab claim the bell. */
function audioRunning(): boolean {
  try {
    return audio.getSnapshot().state === 'running'
  } catch {
    return false
  }
}

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
  // A bell on a suspended (frozen) clock may never ring; do not claim it, another tab can still chime.
  const releaseClaim = handle && audioRunning() ? holdBellClaim(sessionKey) : () => undefined
  endHandle = { sessionKey, handle, releaseClaim }
}

/**
 * The dev clock changed (rate switch or time jump): re-time the bell this tab had scheduled, because
 * its delay was computed with the old rate. If the end is now in the past, or the session is
 * paused/gone, the bell is dropped and SessionWatcher rings it instead. Does nothing when this tab
 * never scheduled a bell (another tab owns it).
 */
export function resyncSessionEnd(): void {
  if (!endHandle) return
  const key = endHandle.sessionKey
  const s = useGame.getState()
  const timer = timerOf(s)
  if (!timer || timer.sessionId !== key || timer.pausedAt !== null || now() >= timer.endsAt) {
    cancelSessionEnd()
    return
  }
  scheduleSessionEnd(key, timer.endsAt)
}

/**
 * The audio context just started running. Re-time the bell this tab scheduled (its delay was
 * counted on a clock that may have been frozen), or, when this tab scheduled none and `owner`
 * (the leader tab) is true, schedule it now for the running session. No-op when no session is
 * counting down.
 */
export function syncSessionEndToAudio(owner: boolean): void {
  if (endHandle) {
    resyncSessionEnd() // drops a stale/ended bell, re-times a live one
    if (endHandle) return
  }
  if (!owner) return
  const timer = timerOf(useGame.getState())
  if (!timer || timer.pausedAt !== null || now() >= timer.endsAt) return
  scheduleSessionEnd(timer.sessionId, timer.endsAt)
}

export function cancelSessionEnd(): void {
  endHandle?.handle?.stop()
  endHandle?.releaseClaim()
  endHandle = null
}

/**
 * The audio context stopped running (Safari `interrupted`, sound switched off): this tab's bell may
 * not ring, so give the claim back and let the leader chime. Running again re-claims via
 * `syncSessionEndToAudio`.
 */
export function dropBellClaim(): void {
  if (!endHandle) return
  endHandle.releaseClaim()
  endHandle.releaseClaim = () => undefined
}

/**
 * The leader tab at the end of a session: play the `sessionEnd` chime unless this tab already has the
 * bell on the audio clock or another live tab holds the bell claim (that tab rings, so the sound is
 * heard once, like the Notification). The check is async (`ifAvailable` lock probe) and falls back to
 * chiming when anything goes wrong, so a failure never costs the end sound.
 */
export async function chimeUnlessOtherTabRings(sessionKey: string): Promise<void> {
  if (sessionEndScheduled(sessionKey)) return
  const locks = locksOf()
  let otherRings = false
  if (locks) {
    try {
      otherRings = await locks.request(claimName(sessionKey), { ifAvailable: true }, (lock) => lock === null)
    } catch {
      otherRings = false
    }
  }
  if (!otherRings) sfx('sessionEnd')
}

/** True when the chime for this session is already on the audio clock. */
export function sessionEndScheduled(sessionKey: string): boolean {
  return endHandle?.sessionKey === sessionKey && endHandle.handle !== null
}
