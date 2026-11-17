/** Player-support calls (server/routes/admin/players.ts). Every call uses the signed-in staff session. */
import type { LocalizedNote, AdminMeResponse, AdminPlayerDetail, AdminPlayersResponse, AdminUnlockField } from '../../../../game/protocol'
import { api } from '../../../api'

export interface GrantInput {
  items?: Record<string, number>
  dust?: number
  /** A short message the player sees in a window with the gift. */
  message?: LocalizedNote
  reason: string
}

const base = (id: string) => `/admin/players/${encodeURIComponent(id)}`

export const playersApi = {
  search: (q: string) => api.get<AdminPlayersResponse>(`/admin/players?q=${encodeURIComponent(q)}`),
  get: (id: string) => api.get<AdminPlayerDetail>(base(id)),
  grant: (id: string, body: GrantInput) => api.post<AdminPlayerDetail>(`${base(id)}/grant`, body),
  unlock: (id: string, field: AdminUnlockField, reason?: string) => api.post<AdminPlayerDetail>(`${base(id)}/unlock`, { field, ...(reason && { reason }) }),
  cancelSession: (id: string, reason?: string) => api.post<AdminPlayerDetail>(`${base(id)}/cancel-session`, { ...(reason && { reason }) }),
  logoutAll: (id: string, reason?: string) => api.post<AdminPlayerDetail>(`${base(id)}/logout-all`, { ...(reason && { reason }) }),
  me: () => api.get<AdminMeResponse>('/admin/me'),
  reauth: (password: string) => api.post<AdminMeResponse>('/admin/reauth', { password }),
}
