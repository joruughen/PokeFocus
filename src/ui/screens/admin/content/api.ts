/** Live-content admin calls (server/routes/admin/content.ts). Every call uses the signed-in staff session. */
import type {
  AdminContentLiveResponse,
  AdminContentStatus,
  AdminContentValidateResponse,
  AdminContentVersionResponse,
  AdminContentVersionsResponse,
  AdminMeResponse,
  AdminSimParams,
  AdminSimRunResponse,
  AdminSimRunsResponse,
  AdminSpawnPreview,
  AdminSpawnWeather,
} from '../../../../game/protocol'
import type { ContentPatch } from '../../../../engine/content'
import { api } from '../../../api'

const BASE = '/admin/content'
const draft = (id: number) => `${BASE}/drafts/${id}`
const version = (id: number) => `${BASE}/versions/${id}`

export interface CreateDraftInput {
  from?: 'active' | 'empty'
  fromVersionId?: number
  title?: string
  note?: string
}

export interface SaveDraftInput {
  patch?: ContentPatch
  title?: string | null
  note?: string | null
}

export interface PublishInput {
  /** Epoch ms in the future (at most 60 days ahead) = schedule; absent = now. */
  effectiveAt?: number
  confirm?: boolean
  note?: string
}

export interface SpawnPreviewQuery {
  versionId?: number
  eventId?: string
  hour: number
  weather: AdminSpawnWeather
  trainerLevel: number
}

export const contentApi = {
  live: () => api.get<AdminContentLiveResponse>(`${BASE}/live`),
  versions: (status?: AdminContentStatus) => api.get<AdminContentVersionsResponse>(`${BASE}/versions${status ? `?status=${status}` : ''}`),
  version: (id: number) => api.get<AdminContentVersionResponse>(version(id)),
  createDraft: (body: CreateDraftInput = {}) => api.post<AdminContentVersionResponse>(`${BASE}/drafts`, body),
  saveDraft: (id: number, body: SaveDraftInput) => api.put<AdminContentVersionResponse>(draft(id), body),
  deleteDraft: (id: number) => api.delete(draft(id)),
  /** Full validation, with the engine smoke test. */
  validate: (id: number) => api.post<AdminContentValidateResponse>(`${draft(id)}/validate`, {}),
  /** Admin + sudo (403 `elevation_required`); 409 `confirm_required`; 422 `validation_failed`. */
  publish: (id: number, body: PublishInput) => api.post<AdminContentVersionResponse>(`${draft(id)}/publish`, body),
  /** Admin + sudo: a NEW published version with the old patch. */
  rollback: (id: number, body: { confirm?: boolean; note?: string } = {}) => api.post<AdminContentVersionResponse>(`${version(id)}/rollback`, body),
  spawnPreview: (q: SpawnPreviewQuery) => {
    const p = new URLSearchParams({ hour: String(q.hour), weather: q.weather, trainerLevel: String(q.trainerLevel) })
    if (q.versionId !== undefined) p.set('versionId', String(q.versionId))
    if (q.eventId) p.set('eventId', q.eventId)
    return api.get<AdminSpawnPreview>(`${BASE}/spawn-preview?${p.toString()}`)
  },
  /** Balance simulation of a draft vs the active content (one at a time on the server: 409 `busy`). */
  simulate: (id: number, body: Partial<AdminSimParams> = {}) => api.post<AdminSimRunResponse>(`${draft(id)}/simulate`, body),
  simRuns: (versionId?: number) => api.get<AdminSimRunsResponse>(`${BASE}/sim-runs${versionId !== undefined ? `?versionId=${versionId}` : ''}`),
  simRun: (id: number) => api.get<AdminSimRunResponse>(`${BASE}/sim-runs/${id}`),
  me: () => api.get<AdminMeResponse>('/admin/me'),
  reauth: (password: string) => api.post<AdminMeResponse>('/admin/reauth', { password }),
}
