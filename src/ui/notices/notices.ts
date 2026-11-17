/**
 * When the two small admin-to-player windows may open (pure logic; the UI is `NoticeHosts.tsx`):
 *  - the support gift window (`PlayerState.pendingGifts`, server-side, closed with `ackGifts`);
 *  - the content note («what changed in the rules», `GET /api/announcements` → `contentNote`, once per device).
 * Same spirit as `levelUp/levelUp.ts`: never in a study session, wave, break, over a hint, another dialog,
 * "What's new?" or the level-up window; the gift goes before the note. One window at a time.
 */
import type { ContentNoteNotice, LocalizedNote } from '../../game/protocol'

export const NOTICE_CALM_PHASES: readonly string[] = ['idle', 'results']

/** The note's text in the player's language (the other one when missing); empty when there is none. */
export const noteText = (note: LocalizedNote | undefined, lng: 'es' | 'en'): string => (note ? (note[lng] ?? note.en ?? note.es ?? '') : '')

/** The content note this device still owes the player, or null. */
export const contentNoteOwed = (notice: ContentNoteNotice | null, seen: number): ContentNoteNotice | null => (notice && notice.versionId > seen ? notice : null)

export interface NoticeContext {
  /** Something is owed. */
  owed: boolean
  phase: string
  hintOpen: boolean
  otherDialogOpen: boolean
  whatsNewPending: boolean
  levelUpPending: boolean
  /** For the content note: a gift window is owed (it goes first). */
  giftPending?: boolean
}

export function decideNotice(c: NoticeContext): 'none' | 'wait' | 'show' {
  if (!c.owed) return 'none'
  if (!NOTICE_CALM_PHASES.includes(c.phase) || c.hintOpen || c.otherDialogOpen || c.whatsNewPending || c.levelUpPending || c.giftPending) return 'wait'
  return 'show'
}
