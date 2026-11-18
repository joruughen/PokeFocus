/** Study-group heals: /api/heals (GDD §9.2). */
import { DEV_NOW_HEADER, type GroupHealView, type HealsResponse } from '../../game/protocol'
import { now, usePrefs } from '../store/prefs'
import { api } from './client'

const id = (h: string) => encodeURIComponent(h)

/** Heals depend on the clock (windows, expiry): they carry the dev clock like game actions (honored only with DEV_TOOLS=1). */
function opts() {
  const headers: Record<string, string> = {}
  if (usePrefs.getState().dev.anchor) headers[DEV_NOW_HEADER] = String(Math.round(now()))
  return { headers }
}

export const healsApi = {
  status: () => api.get<HealsResponse>('/heals', opts()),
  send: (groupId: string, toUserId: string, uid: string) => api.post<GroupHealView>('/heals', { groupId, toUserId, uid }, opts()),
  accept: (healId: string) => api.post<GroupHealView>(`/heals/${id(healId)}/accept`, {}, opts()),
  decline: (healId: string) => api.post<GroupHealView>(`/heals/${id(healId)}/decline`, {}, opts()),
  cancel: (healId: string) => api.post<GroupHealView>(`/heals/${id(healId)}/cancel`, {}, opts()),
}
