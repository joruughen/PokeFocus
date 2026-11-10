/**
 * When to show the "What's new?" dialog (pure logic; the UI is `WhatsNewDialog.tsx`).
 *
 * The player has "seen" a version once they close the dialog or open the news
 * page (`prefs.lastSeenVersion`). The dialog never interrupts: not for a brand
 * new device, not during a study session, not over another dialog or a Profe
 * Pika hint.
 */
import type { ChangelogEntry } from './entries'

/** Numeric compare of MAJOR.MINOR.PATCH (missing or non-numeric parts count as 0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

/** Entries newer than `lastSeen` (newest first, as in the changelog). `null` = nothing recorded yet, so none are "unseen". */
export function unseenEntries(changelog: readonly ChangelogEntry[], lastSeen: string | null): ChangelogEntry[] {
  if (lastSeen === null) return []
  return changelog.filter((e) => compareVersions(e.version, lastSeen) > 0)
}

export interface WhatsNewContext {
  /** `prefs.lastSeenVersion` (null: this device never recorded one). */
  lastSeen: string | null
  /** Newest version (`APP_VERSION`). */
  current: string
  /** A study session is active (running, paused or waiting to be claimed). */
  studying: boolean
  /** A Profe Pika hint bubble is open. */
  hintOpen: boolean
  /** Another dialog is open. */
  otherDialogOpen: boolean
  /** The player is already on the news page. */
  onChangelog: boolean
}

/**
 * - `record`: nothing to show; just mark the current version as seen (new player, or already reading the news page).
 * - `none`: up to date.
 * - `wait`: there is news but this is not a good moment; ask again later.
 * - `show`: open the dialog.
 */
export type WhatsNewDecision = 'record' | 'none' | 'wait' | 'show'

export function decideWhatsNew(c: WhatsNewContext): WhatsNewDecision {
  if (c.lastSeen === null) return 'record'
  if (compareVersions(c.current, c.lastSeen) <= 0) return 'none'
  if (c.onChangelog) return 'record'
  if (c.studying || c.hintOpen || c.otherDialogOpen) return 'wait'
  return 'show'
}
