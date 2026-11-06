/**
 * Lock of the trainer name and the country (PATCH /api/auth/me): after a
 * change the field is frozen for `NAME_LOCK_DAYS` / `COUNTRY_LOCK_DAYS`. The
 * server enforces it; the client only shows it (disabled control + the date it
 * opens again). Pure, so the boundary is easy to test.
 */

const DAY_MS = 86_400_000

export interface LockState {
  /** True while the field cannot be changed (never in dev mode). */
  locked: boolean
  /** Epoch ms when it can be changed again; null when it was never changed. Reported even if the dev bypass is on. */
  unlockAt: number | null
}

/**
 * - `changedAt` null = never changed since sign-up: free.
 * - Locked while `changedAt + days > now`; at exactly `days` days it is free again
 *   (same comparison as the time-zone lock and the server).
 * - `dev` (the dev panel / `?dev`) ignores the lock, like the server with DEV_TOOLS=1.
 */
export function lockState(changedAt: number | null, days: number, now: number, dev: boolean): LockState {
  if (changedAt === null) return { locked: false, unlockAt: null }
  const unlockAt = changedAt + days * DAY_MS
  return { locked: unlockAt > now && !dev, unlockAt }
}

/** The fields of PATCH /auth/me that really change (and so start a lock). */
export interface ProfileChange {
  trainerName?: string
  country?: string
}

/**
 * What saving the profile form would change, or null when nothing does. Saving
 * the same value is a no-op (no lock, so no confirm); a locked field cannot be
 * edited, so it never counts. The name is compared trimmed, as it is sent.
 */
export function profileChange(
  current: { trainerName: string; country: string },
  form: { name: string; country: string },
  locked: { name: boolean; country: boolean },
): ProfileChange | null {
  const name = form.name.trim()
  const change: ProfileChange = {}
  if (!locked.name && name !== current.trainerName) change.trainerName = name
  if (!locked.country && form.country !== current.country) change.country = form.country
  return Object.keys(change).length > 0 ? change : null
}
