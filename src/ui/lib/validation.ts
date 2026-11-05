/**
 * Client-side checks that mirror the server's zod rules (docs/F2-plan.md):
 * they only give earlier, friendlier feedback; the server still decides.
 * Each returns an i18n key under `auth.invalid.*`, or null when valid.
 */
import { isCountryCode } from './countries'

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
export const TRAINER_MIN = 3
export const TRAINER_MAX = 20

export function checkEmail(v: string): string | null {
  const s = v.trim()
  if (!s) return 'auth.invalid.emailEmpty'
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'auth.invalid.email'
  return null
}

export function checkPassword(v: string): string | null {
  if (v.length < PASSWORD_MIN) return 'auth.invalid.passwordShort'
  if (v.length > PASSWORD_MAX) return 'auth.invalid.passwordLong'
  return null
}

export function checkTrainerName(v: string): string | null {
  const s = v.trim()
  if (s.length < TRAINER_MIN || s.length > TRAINER_MAX) return 'auth.invalid.trainerLength'
  if (!/^[\p{L}\p{N} _]+$/u.test(s)) return 'auth.invalid.trainerChars'
  return null
}

export function checkCountry(v: string): string | null {
  return isCountryCode(v) ? null : 'auth.invalid.country'
}
