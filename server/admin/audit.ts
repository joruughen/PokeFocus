/**
 * Admin audit log (docs/admin-plan.md §4). `audit()` must be called with the SAME
 * transaction handle as the mutation it records, so either both persist or neither.
 */
import { adminAudit } from '../db/schema'
import type { Db } from '../db/client'
import type { Ctx } from '../http'

export interface AuditEntry {
  /** Dotted verb, e.g. `maintenance.create`, `user.role`. */
  action: string
  targetType?: string
  targetId?: string
  /** JSON-serializable snapshots (omit for creations / deletions). */
  before?: unknown
  after?: unknown
  note?: string
}

/** A request (actor = the signed-in user, or 'token' for the legacy ADMIN_TOKEN) or a non-HTTP actor such as `system` / `cli`. */
export type AuditActor = Ctx | { label: string }

/** Anything with Drizzle's `insert` (a `Tx` or the `Db`). */
type Writer = Pick<Db, 'insert'>

export async function audit(tx: Writer, c: AuditActor, e: AuditEntry): Promise<void> {
  let actorId: string | null = null
  let actorLabel: string | null = null
  let ip: string | null = null
  if ('req' in c) {
    const user = c.get('user')
    if (user) actorId = user.id
    else actorLabel = c.get('actorLabel') ?? 'unknown'
    ip = c.get('ip') ?? null
  } else {
    actorLabel = c.label
  }
  await tx.insert(adminAudit).values({
    actorId,
    actorLabel,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    note: e.note ?? null,
    ip,
  })
}
