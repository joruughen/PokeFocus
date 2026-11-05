/**
 * Error code → friendly text. Game rule errors keep their families
 * (`errors.throw.*`, `errors.box.*`…); transport errors (network, 5xx, 403
 * dev-only, rate limits) map to `errors.api.*`. Anything unknown falls back to
 * `errors.api.generic`, so a new server code never shows a raw key.
 */
import i18n from 'i18next'
import { isApiError } from '../api/client'

export type ErrorFamily = 'throw' | 'charge' | 'box' | 'heal' | 'mission' | 'auth' | 'friends'

export function errorText(code: string, family?: ErrorFamily, vars?: Record<string, unknown>): string {
  const t = i18n.t.bind(i18n)
  const keys = [
    family ? `errors.${family}.${code}` : null,
    `errors.${code}`,
    `errors.api.${code}`,
    code.startsWith('http_5') ? 'errors.api.server' : null,
  ].filter((k): k is string => k !== null)
  for (const k of keys) if (i18n.exists(k) && typeof i18n.t(k, { returnObjects: true }) === 'string') return t(k, vars ?? {})
  return t('errors.api.generic')
}

/**
 * Text for a failed auth/social request: rate limits say when to retry,
 * validation errors (400) fall back to a generic "check the fields" line.
 */
export function requestErrorText(e: unknown, family: ErrorFamily = 'auth'): string {
  if (!isApiError(e)) return errorText('network')
  if (e.status === 429) {
    const minutes = Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60))
    return i18n.t('errors.auth.rate_limited', { count: minutes })
  }
  const known = `errors.${family}.${e.code}`
  if (i18n.exists(known)) return i18n.t(known)
  if (e.status === 400) return i18n.t('errors.auth.bad_request')
  return errorText(e.code, family)
}
