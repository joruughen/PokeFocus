/**
 * End-of-session signals: browser Notification, the `sessionEnd` sfx and the tab title.
 *
 * - Permission is requested from the Start click (a user gesture), never re-prompted after "denied".
 * - The audio engine is unlocked inside that same click (autoplay policy).
 * - Only the "leader" tab notifies (Web Locks); `timer.notified` makes it once per session.
 */
import { audio } from '../../audio'
import { sfx } from './sound'

/** Call from the Start button handler: unlocks audio and asks for notification permission once. */
export function primeSignals(): void {
  void audio.init().catch(() => undefined)
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => undefined)
  }
}

/** End-of-session sound (the audio module's `sessionEnd` bells). */
export function chime(): void {
  sfx('sessionEnd')
}

export function notify(title: string, body: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, tag: 'pokefocus-session', icon: '/art/logo.svg' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

let leader = false
let leaderRequested = false

/**
 * Leader election between tabs: the first tab takes a Web Lock and keeps it
 * until it closes; the next waiting tab then becomes leader. Without Web Locks
 * every tab is leader (the persisted `notified` flag still dedupes).
 */
export function electLeader(): void {
  if (leaderRequested) return
  leaderRequested = true
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks) {
    leader = true
    return
  }
  void locks.request('pokefocus-leader', () => {
    leader = true
    return new Promise<void>(() => undefined)
  })
}

export function isLeaderTab(): boolean {
  return leader
}
