/** Role changes outside the HTTP API: start-up promotion (ADMIN_EMAILS) and the `npm run admin:role` CLI. */
import { eq } from 'drizzle-orm'
import type { UserRole } from '../../src/game/protocol'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { audit } from './audit'

export const USER_ROLES: readonly UserRole[] = ['player', 'support', 'admin']

export type SetRoleResult = { ok: true; changed: boolean; before: UserRole } | { ok: false; reason: 'not_found' }

/** Set the role of the account with this email (case-insensitive). Audited in the same transaction; a no-op writes nothing. */
export async function setRoleByEmail(db: Db, email: string, role: UserRole, label: string, note?: string): Promise<SetRoleResult> {
  return db.transaction(async (tx): Promise<SetRoleResult> => {
    const [u] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email.trim().toLowerCase())).for('update')
    if (!u) return { ok: false, reason: 'not_found' }
    if (u.role === role) return { ok: true, changed: false, before: u.role }
    await tx.update(users).set({ role }).where(eq(users.id, u.id))
    await audit(tx, { label }, { action: 'user.role', targetType: 'user', targetId: u.id, before: { role: u.role }, after: { role }, ...(note && { note }) })
    return { ok: true, changed: true, before: u.role }
  })
}

/**
 * Promote every ADMIN_EMAILS account to admin (idempotent: already-admin accounts are
 * untouched and not audited). Returns the emails promoted now and those with no account.
 * Never demotes: removing an email from the list does not change the account.
 */
export async function promoteAdminEmails(db: Db, emails: readonly string[]): Promise<{ promoted: string[]; missing: string[] }> {
  const promoted: string[] = []
  const missing: string[] = []
  for (const email of emails) {
    const r = await setRoleByEmail(db, email, 'admin', 'system', 'ADMIN_EMAILS')
    if (!r.ok) missing.push(email)
    else if (r.changed) promoted.push(email)
  }
  return { promoted, missing }
}
