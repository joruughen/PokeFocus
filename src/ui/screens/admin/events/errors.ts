import i18n from 'i18next'
import { isApiError } from '../../../api'
import { errorText } from '../../../lib/errors'

/** Server codes of the event / upload routes that have their own copy under `eventsAdmin.errors`. */
const OWN = [
  'invalid_body',
  'invalid_query',
  'invalid_dates',
  'forbidden',
  'elevation_required',
  'wrong_password',
  'not_found',
  'not_draft',
  'not_published',
  'not_editable',
  'slug_taken',
  'slug_locked',
  'too_many_drafts',
  'confirm_required',
  'in_use',
  'uploads_full',
  'body_too_large',
  'unsupported_type',
  'validation_failed',
  'invalid_image',
  'image_too_small',
  'image_too_large',
  'animated_image',
  'unknown_image',
]

export function eventsErrorText(e: unknown): string {
  if (!isApiError(e)) return errorText('network')
  if (e.status === 429) return i18n.t('eventsAdmin.errors.rate_limited', { count: Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)) })
  if (OWN.includes(e.code)) return i18n.t(`eventsAdmin.errors.${e.code}`)
  return errorText(e.code)
}

/** Validation issues the server attached to a 422 / 409 answer (`errors`, `warnings`). */
export interface IssueLike {
  code: string
  path: string
  message: string
  params?: Record<string, unknown>
  requiresConfirm?: boolean
}

export function issuesOf(e: unknown, key: 'errors' | 'warnings'): IssueLike[] {
  if (!isApiError(e) || !e.body) return []
  const v = e.body[key]
  return Array.isArray(v) ? (v as IssueLike[]) : []
}

/** One issue as a sentence: the translated copy of its code when there is one, else the server's English message. */
export function issueText(i: IssueLike): string {
  const key = `eventsAdmin.issues.${i.code}`
  return i18n.exists(key) ? i18n.t(key, { ...i.params, path: i.path }) : i.message
}
