import type { PendingLevelUp } from '../../engine'
import { useGame } from '../store/game'
import { levelUpKey } from './levelUp'

/**
 * Notices this device already closed. The server empties `pendingLevelUps` on `ackLevelUp`, but until the
 * answer arrives (or if it fails) the window must not reopen, nor hold back the other windows forever.
 */
const dismissed = new Set<string>()

export function markLevelUpsDismissed(list: readonly PendingLevelUp[]): void {
  for (const p of list) dismissed.add(levelUpKey(p))
}

export function resetLevelUpDismissedForTests(): void {
  dismissed.clear()
}

/** The level-ups owed right now (live store, not dismissed here). Not a hook: timers use it too. */
export function owedLevelUps(): PendingLevelUp[] {
  return (useGame.getState().player?.pendingLevelUps ?? []).filter((p) => !dismissed.has(levelUpKey(p)))
}
