/** Event admin calls (server/routes/admin/events.ts, uploads.ts, content.ts spawn-preview). They all use the staff session. */
import type {
  AdminEventAnnounceResponse,
  AdminEventAudienceResponse,
  AdminEventResponse,
  AdminEventsResponse,
  AdminEventStatus,
  AdminMeResponse,
  AdminSpawnPreview,
  AdminSpawnWeather,
  AdminUploadResponse,
  AdminUploadsResponse,
} from '../../../../game/protocol'
import { api } from '../../../api'
import type { EventRequestBody } from './draft'

const base = (id: string) => `/admin/events/${encodeURIComponent(id)}`

export interface SpawnQuery {
  eventId?: string
  hour: number
  weather: AdminSpawnWeather
  trainerLevel: number
}

export const eventsAdminApi = {
  list: (status?: AdminEventStatus) => api.get<AdminEventsResponse>(`/admin/events${status ? `?status=${status}` : ''}`),
  get: (id: string) => api.get<AdminEventResponse>(base(id)),
  create: (body: EventRequestBody) => api.post<AdminEventResponse>('/admin/events', body),
  update: (id: string, body: Partial<EventRequestBody> & { confirm?: boolean }) => api.put<AdminEventResponse>(base(id), body),
  remove: (id: string) => api.delete(base(id)),
  publish: (id: string, body: { confirm?: boolean; note?: string }) => api.post<AdminEventResponse>(`${base(id)}/publish`, body),
  archive: (id: string, body: { note?: string }) => api.post<AdminEventResponse>(`${base(id)}/archive`, body),
  announce: (id: string, body: { note?: string }) => api.post<AdminEventAnnounceResponse>(`${base(id)}/announce`, body),
  audience: (id: string) => api.get<AdminEventAudienceResponse>(`${base(id)}/audience`),

  uploads: () => api.get<AdminUploadsResponse>('/admin/uploads'),
  upload: (file: File) => api.upload<AdminUploadResponse>('/admin/uploads', file),

  spawnPreview: (q: SpawnQuery) => {
    const p = new URLSearchParams({ hour: String(q.hour), weather: q.weather, trainerLevel: String(q.trainerLevel) })
    if (q.eventId) p.set('eventId', q.eventId)
    return api.get<AdminSpawnPreview>(`/admin/content/spawn-preview?${p.toString()}`)
  },

  me: () => api.get<AdminMeResponse>('/admin/me'),
  reauth: (password: string) => api.post<AdminMeResponse>('/admin/reauth', { password }),
}
