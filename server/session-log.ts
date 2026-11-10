/**
 * session_log writer (docs/admin-plan.md §2; read by routes/admin-metrics.ts).
 * `logSession` is called by runGameAction inside the action's transaction, so the
 * log row and the player document commit (or roll back) together.
 */
import { and, eq } from 'drizzle-orm'
import type { GameAction, GameDoc } from '../src/game/protocol'
import type { Tx } from './db/client'
import { sessionLog } from './db/schema'

/** Content version of the data the session ran with; 'base' = the bundled data (no live content yet). */
export const BASE_CONTENT_HASH = 'base'

/**
 * - `claim`: inserts one row for the claimed session (valid ones only; idempotent per user + session).
 * - any other action: if a session's `caught` counter moved (ball throws after the claim),
 *   the matching row's `catches` follows it.
 */
export async function logSession(
  tx: Tx,
  userId: string,
  actionType: GameAction['type'],
  before: GameDoc,
  after: GameDoc,
  opts: { contentHash?: string | null } = {},
): Promise<void> {
  // A claim, or a cancelled long session that kept its minutes (GDD §3.4): both leave an outcome
  // for the session that was active before the action (a stale outcome of an older one is ignored).
  if (actionType === 'claim' || actionType === 'cancel') {
    const res = after.outcome?.result
    if (!res || res.sessionId !== before.player?.activeSession?.id) return
    const entry = after.player?.history.find((h) => h.id === res.sessionId)
    if (!res.valid || !entry) return
    let shinies = 0
    let legendaries = 0
    for (const w of res.waves) {
      for (const wild of w.wilds) {
        if (wild.isShiny) shinies++
        if (wild.isLegendary) legendaries++
      }
    }
    await tx
      .insert(sessionLog)
      .values({
        userId,
        sessionId: res.sessionId,
        startedAt: new Date(res.startedAt),
        endedAt: new Date(res.endedAt),
        claimedAt: new Date(res.claimedAt),
        minutes: res.minutes,
        focus: res.focus,
        lateClaim: res.lateClaim,
        points: Math.round(res.totalPoints),
        wilds: entry.wilds,
        catches: entry.caught,
        shinies,
        legendaries,
        contentHash: opts.contentHash ?? BASE_CONTENT_HASH,
      })
      .onConflictDoNothing()
    return
  }
  const a = after.player?.history
  const b = before.player?.history
  if (!a || a === b) return
  const prev = new Map((b ?? []).map((h) => [h.id, h.caught]))
  for (const h of a) {
    if (prev.has(h.id) && prev.get(h.id) !== h.caught) {
      await tx.update(sessionLog).set({ catches: h.caught }).where(and(eq(sessionLog.userId, userId), eq(sessionLog.sessionId, h.id)))
    }
  }
}
