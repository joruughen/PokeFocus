/** Study groups: /api/groups (docs/server.md § Study groups). */
import { DEV_NOW_HEADER, type GroupsResponse, type StudyGroupView } from '../../game/protocol'
import { now, usePrefs } from '../store/prefs'
import { api } from './client'

const id = (g: string) => encodeURIComponent(g)

/** Group writes may start sessions: they carry the dev clock like game actions (honored only with DEV_TOOLS=1). */
function opts() {
  const headers: Record<string, string> = {}
  if (usePrefs.getState().dev.anchor) headers[DEV_NOW_HEADER] = String(Math.round(now()))
  return { headers }
}

export const groupsApi = {
  status: () => api.get<GroupsResponse>('/groups', opts()),
  create: (minutes: number, friendIds: string[]) => api.post<StudyGroupView>('/groups', { minutes, friendIds }, opts()),
  invite: (groupId: string, friendIds: string[]) => api.post<StudyGroupView>(`/groups/${id(groupId)}/invite`, { friendIds }, opts()),
  accept: (groupId: string) => api.post<StudyGroupView>(`/groups/${id(groupId)}/accept`, {}, opts()),
  decline: (groupId: string) => api.post<void>(`/groups/${id(groupId)}/decline`, {}, opts()),
  start: (groupId: string) => api.post<StudyGroupView>(`/groups/${id(groupId)}/start`, {}, opts()),
  leave: (groupId: string) => api.post<void>(`/groups/${id(groupId)}/leave`, {}, opts()),
}
