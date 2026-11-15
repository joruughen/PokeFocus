import { isApiError } from '../../../api'
import { errorText } from '../../../lib/errors'

const OWN = ['forbidden', 'not_found', 'not_draft', 'not_published', 'not_scheduled', 'too_many_drafts', 'invalid_body', 'event_not_linkable', 'unknown_event']

/** Text of an error of the content API (own copy for its codes, else the generic one). */
export function contentErrorText(e: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!isApiError(e)) return errorText('network')
  if (e.status === 429) return t('admin.content.action.rateLimited', { count: Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)) })
  if (OWN.includes(e.code)) return t(`admin.content.errors.${e.code}`)
  return errorText(e.code)
}
