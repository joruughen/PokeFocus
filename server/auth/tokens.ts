/** Opaque session tokens (32 random bytes, base64url, only sha256 stored) and friend codes. */
import { createHash, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'pf_session'
export const SESSION_TTL_MS = 30 * 24 * 3_600_000
/** Sliding expiry: renew when the session was last seen more than this ago. */
export const SESSION_RENEW_AFTER_MS = 24 * 3_600_000

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 43 base64url chars = 32 bytes. Anything else is not one of our tokens. */
export function looksLikeToken(v: string | undefined): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)
}

/** Friend codes: 8 chars from an alphabet without 0/O/1/I/L. */
export const FRIEND_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function newFriendCode(): string {
  const n = FRIEND_CODE_ALPHABET.length
  const limit = 256 - (256 % n) // rejection sampling keeps it uniform
  const out: string[] = []
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < limit) out.push(FRIEND_CODE_ALPHABET[b % n]!)
      if (out.length === 8) break
    }
  }
  return out.join('')
}

export function normalizeFriendCode(v: string): string {
  return v.trim().toUpperCase().replace(/[\s-]/g, '')
}
