/**
 * What the player-support screen offers. The server is the authority (403 otherwise); this only hides what
 * would be refused: support acts on `player` accounts, grants are admin-only, and nobody signs themselves out.
 */
import type { UserRole } from '../../../../game/protocol'

export interface PlayerPermissions {
  /** Clear a 30-day lock, cancel a stuck session, sign out. */
  moderate: boolean
  /** Hand out items or Dust (admin, with the sudo mode). */
  grant: boolean
  logoutAll: boolean
}

export function playerPermissions(me: { id: string; role: UserRole }, target: { id: string; role: UserRole }): PlayerPermissions {
  const moderate = me.role === 'admin' || (me.role === 'support' && target.role === 'player')
  return { moderate, grant: me.role === 'admin', logoutAll: moderate && me.id !== target.id }
}

/** Support and admin see the player tools; players never do. */
export const isStaff = (role: UserRole | undefined): boolean => role === 'support' || role === 'admin'
