/**
 * When to show the event pop-up (pure logic; the UI is `EventPopup.tsx`). Same spirit as `changelog/whatsNew.ts`:
 * it never interrupts a study session, a Profe Pika hint, another dialog or the "What's new?" window; it waits
 * and comes out when the player is calm. One window at a time.
 *
 * A pop-up is owed for an event, per (event, `announceRev`, phase):
 *  - `active`: the event is running and the player has not seen it at this revision. Revision 0 is the
 *    automatic one (the first time a device sees a running event); each "Notify players" press adds one.
 *  - `upcoming`: only after an admin notified (`announceRev >= 1`): the "Coming soon" window.
 * Seeing one is remembered on the device (`useLiveEvents.popupSeen`). A "Coming soon" at revision 1 that is
 * seen does not hide the "now live" window of that same revision when the event starts: it is another phase.
 */
import type { LiveEventPublic } from '../../../game/protocol'

export type PopupPhase = 'active' | 'upcoming'

export interface PopupCandidate {
  event: LiveEventPublic
  phase: PopupPhase
  key: string
}

/** Home phases (store/game.ts `Phase`) where a pop-up may open: not focusing, claiming, catching or resting. */
export const POPUP_CALM_PHASES: readonly string[] = ['idle', 'results']

export const popupKey = (eventId: string, rev: number, phase: PopupPhase): string => `${eventId}#${rev}#${phase === 'active' ? 'a' : 'u'}`

/** Every pop-up the events could owe at `now` (server-corrected), seen or not: running events first, then announced upcoming ones. */
export function popupCandidates(active: readonly LiveEventPublic[], upcoming: readonly LiveEventPublic[], now: number): PopupCandidate[] {
  const out: PopupCandidate[] = []
  const seen = new Set<string>()
  for (const event of [...active, ...upcoming]) {
    if (seen.has(event.id) || event.endsAt <= now) continue
    seen.add(event.id)
    const phase: PopupPhase = event.startsAt <= now ? 'active' : 'upcoming'
    if (phase === 'upcoming' && event.announceRev < 1) continue
    out.push({ event, phase, key: popupKey(event.id, event.announceRev, phase) })
  }
  return out.sort((a, b) => (a.phase === b.phase ? a.event.startsAt - b.event.startsAt || (a.event.id < b.event.id ? -1 : 1) : a.phase === 'active' ? -1 : 1))
}

/** The candidates this device has not shown yet. */
export function pendingPopups(active: readonly LiveEventPublic[], upcoming: readonly LiveEventPublic[], seen: readonly string[], now: number): PopupCandidate[] {
  return popupCandidates(active, upcoming, now).filter((c) => !seen.includes(c.key))
}

export interface EventPopupContext {
  /** Pop-ups owed (`pendingPopups`). */
  pending: readonly PopupCandidate[]
  /** Phase of the home loop (`phaseOf`): only the calm ones let a window open. */
  phase: string
  /** A Profe Pika hint bubble is open. */
  hintOpen: boolean
  /** Another dialog is open. */
  otherDialogOpen: boolean
  /** The "What's new?" window is due (or showing): it goes first. */
  whatsNewPending: boolean
  /** The player is already on `#/events`. */
  onEvents: boolean
}

/**
 * - `none`: nothing owed.
 * - `record`: the player is already looking at the events page: mark them seen, show nothing.
 * - `wait`: something is owed but this is not a good moment; ask again later.
 * - `show`: open this one (the rest follow one at a time).
 */
export type EventPopupDecision = { kind: 'none' } | { kind: 'record'; keys: string[] } | { kind: 'wait' } | { kind: 'show'; candidate: PopupCandidate }

export function decideEventPopup(c: EventPopupContext): EventPopupDecision {
  const first = c.pending[0]
  if (!first) return { kind: 'none' }
  if (c.onEvents) return { kind: 'record', keys: c.pending.map((p) => p.key) }
  if (!POPUP_CALM_PHASES.includes(c.phase) || c.hintOpen || c.otherDialogOpen || c.whatsNewPending) return { kind: 'wait' }
  return { kind: 'show', candidate: first }
}
