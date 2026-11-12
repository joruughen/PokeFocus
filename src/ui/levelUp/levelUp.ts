/**
 * When to show the trainer "Congratulations" window (pure logic; the UI is `LevelUpDialog.tsx`). Same spirit as
 * `changelog/whatsNew.ts` and `screens/events/popup.ts`: it never interrupts a study session, a wave, a break, a
 * Profe Pika hint or another dialog, and "What's new?" goes first. The window comes before the event pop-up
 * (`decideEventPopup` waits for it), so they come out one at a time.
 *
 * The rewards are already in the inventory when the window opens (`PlayerState.pendingLevelUps`); closing it
 * sends `ackLevelUp`. Several level-ups owed at once are shown in ONE window (`mergeLevelUps`).
 */
import type { PendingLevelUp } from '../../engine'

/** Home phases (store/game.ts `Phase`) where the window may open: not focusing, claiming, catching or resting. */
export const LEVEL_UP_CALM_PHASES: readonly string[] = ['idle', 'results']

/** The pending notices as one: first `from`, last `to`, items and Dust summed. `null` when none. */
export function mergeLevelUps(pending: readonly PendingLevelUp[] | undefined): { from: number; to: number; items: Record<string, number>; dust: number } | null {
  if (!pending || pending.length === 0) return null
  const items: Record<string, number> = {}
  let dust = 0
  for (const p of pending) {
    dust += p.dust
    for (const [k, n] of Object.entries(p.items)) items[k] = (items[k] ?? 0) + n
  }
  const first = pending[0]!
  return { from: first.from, to: pending[pending.length - 1]!.to, items, dust }
}

/** Stable identity of a notice, so the window can be remembered as dismissed while the `ackLevelUp` is in flight. */
export const levelUpKey = (p: PendingLevelUp): string => `${p.at}:${p.from}:${p.to}`

export interface LevelUpContext {
  /** Level-ups owed and not yet dismissed on this device. */
  pending: readonly PendingLevelUp[]
  /** Phase of the home loop (`phaseOf`). */
  phase: string
  /** A Profe Pika hint bubble is open. */
  hintOpen: boolean
  /** Another dialog is open. */
  otherDialogOpen: boolean
  /** The "What's new?" window is due (or showing): it goes first. */
  whatsNewPending: boolean
}

/** `none`: nothing owed. `wait`: owed but not a good moment (ask again later). `show`: open the window. */
export type LevelUpDecision = 'none' | 'wait' | 'show'

export function decideLevelUp(c: LevelUpContext): LevelUpDecision {
  if (c.pending.length === 0) return 'none'
  if (!LEVEL_UP_CALM_PHASES.includes(c.phase) || c.hintOpen || c.otherDialogOpen || c.whatsNewPending) return 'wait'
  return 'show'
}
