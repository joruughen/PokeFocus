import i18n from 'i18next'
import { isApiError } from '../../../api'
import { errorText } from '../../../lib/errors'

/** Server codes of the player-support routes that have their own copy under `admin.players.errors`. */
const OWN = [
  'invalid_query',
  'invalid_body',
  'forbidden',
  'forbidden_target',
  'elevation_required',
  'wrong_password',
  'not_found',
  'no_session',
  'not_locked',
  'no_player',
  'self_target',
  'empty_grant',
  'unknown_item',
  'invalid_amount',
  'amount_too_large',
  'too_many_items',
]

export function playersErrorText(e: unknown): string {
  if (!isApiError(e)) return errorText('network')
  if (e.status === 429) return i18n.t('admin.players.errors.rate_limited', { count: Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)) })
  if (OWN.includes(e.code)) return i18n.t(`admin.players.errors.${e.code}`)
  return errorText(e.code)
}
