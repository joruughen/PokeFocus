/** Trades between friends: /api/trades (GDD §12.8, docs/server.md § Trades). */
import { DEV_NOW_HEADER, type TradeOfferView, type TradesResponse } from '../../game/protocol'
import { now, usePrefs } from '../store/prefs'
import { api } from './client'

const id = (t: string) => encodeURIComponent(t)

/** Trades run on game time (daily limit, expiry): they carry the dev clock like game actions (honored only with DEV_TOOLS=1). */
function opts() {
  const headers: Record<string, string> = {}
  if (usePrefs.getState().dev.anchor) headers[DEV_NOW_HEADER] = String(Math.round(now()))
  return { headers }
}

export const tradesApi = {
  list: () => api.get<TradesResponse>('/trades', opts()),
  offer: (toUserId: string, uid: string, message: string | null) => api.post<TradeOfferView>('/trades', { toUserId, uid, message }, opts()),
  counter: (offerId: string, uid: string) => api.post<TradeOfferView>(`/trades/${id(offerId)}/counter`, { uid }, opts()),
  accept: (offerId: string) => api.post<TradeOfferView>(`/trades/${id(offerId)}/accept`, {}, opts()),
  reject: (offerId: string) => api.post<TradeOfferView>(`/trades/${id(offerId)}/reject`, {}, opts()),
  cancel: (offerId: string) => api.post<TradeOfferView>(`/trades/${id(offerId)}/cancel`, {}, opts()),
}
