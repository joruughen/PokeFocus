/**
 * One helper per route of docs/F2-plan.md §API. Types come from the shared
 * contract (src/game/protocol.ts).
 */
import {
  DEV_NOW_HEADER,
  DEV_SEED_HEADER,
  type ActionResponse,
  type AdminMaintenanceItem,
  type AdminMaintenanceResponse,
  type AnnouncementsResponse,
  type AuthSessionInfo,
  type FriendSummary,
  type GameAction,
  type GameSnapshot,
  type LeaderboardPeriod,
  type LeaderboardResponse,
  type LeaderboardScope,
  type MaintenanceCreateRequest,
  type PublicUser,
  type PushConfigResponse,
  type PushSubscribeRequest,
} from '../../game/protocol'
import type { WeatherResponse } from '../../game/weather'
import { now, usePrefs } from '../store/prefs'
import { api } from './client'

export interface RegisterInput {
  email: string
  password: string
  trainerName: string
  country: string
}

export const authApi = {
  register: (input: RegisterInput) => api.post<{ user: PublicUser }>('/auth/register', input, { allow401: true }),
  login: (email: string, password: string) => api.post<{ user: PublicUser }>('/auth/login', { email, password }, { allow401: true }),
  logout: () => api.post<void>('/auth/logout', {}, { allow401: true }),
  logoutAll: () => api.post<void>('/auth/logout-all'),
  me: () => api.get<{ user: PublicUser }>('/auth/me', { allow401: true }),
  updateMe: (patch: { trainerName?: string; country?: string; anonymousRankings?: boolean }) => api.patch<{ user: PublicUser }>('/auth/me', patch),
  changePassword: (current: string, next: string) => api.post<void>('/auth/password', { current, next }),
  sessions: () => api.get<{ sessions: AuthSessionInfo[] }>('/auth/sessions'),
  revokeSession: (id: string) => api.delete(`/auth/sessions/${encodeURIComponent(id)}`),
}

/**
 * Dev-panel headers for game writes: the virtual clock (only while the dev
 * clock is active) and the next fixed seed (only with a seed set). The server
 * honors them only when it runs with DEV_TOOLS=1.
 */
export function devHeaders(): Record<string, string> {
  const h: Record<string, string> = {}
  const prefs = usePrefs.getState()
  if (prefs.dev.anchor) h[DEV_NOW_HEADER] = String(Math.round(now()))
  const seed = prefs.nextSeed()
  if (seed !== null) h[DEV_SEED_HEADER] = seed
  return h
}

export const gameApi = {
  get: () => api.get<GameSnapshot>('/game'),
  action: <A extends GameAction>(action: A) => api.post<ActionResponse<A['type']>>('/game/action', action, { headers: devHeaders() }),
}

export const friendsApi = {
  list: () => api.get<{ friends: FriendSummary[] }>('/friends'),
  request: (friendCode: string) => api.post<{ userId: string; status: 'outgoing' | 'friend' }>('/friends/request', { friendCode }),
  accept: (userId: string) => api.post<void>(`/friends/${encodeURIComponent(userId)}/accept`),
  remove: (userId: string) => api.delete(`/friends/${encodeURIComponent(userId)}`),
}

export const leaderboardApi = {
  get: (scope: LeaderboardScope, period: LeaderboardPeriod) =>
    api.get<LeaderboardResponse>(`/leaderboard?scope=${scope}&period=${period}`),
}

export const weatherApi = {
  /** Weather a session started now would use (real city weather or the manual fallback). */
  get: () => api.get<WeatherResponse>('/weather'),
}

/** Public: scheduled maintenance windows that have not ended (works signed out). */
export const announcementsApi = {
  get: () => api.get<AnnouncementsResponse>('/announcements', { allow401: true }),
}

/** Web Push for this browser (src/game/protocol.ts "Web Push"; flows in lib/push.ts). */
export const pushApi = {
  config: () => api.get<PushConfigResponse>('/push/config'),
  subscribe: (body: PushSubscribeRequest) => api.post<void>('/push/subscribe', body),
  // Also runs right before logout: a 401 there must not trigger the "session expired" path.
  unsubscribe: (endpoint: string) => api.post<void>('/push/unsubscribe', { endpoint }, { allow401: true }),
  test: () => api.post<{ sent: number }>('/push/test'),
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

/**
 * Admin API (server env ADMIN_TOKEN). A wrong token answers 401, which must NOT
 * sign the player out, hence `allow401` on every call.
 */
export const adminApi = {
  list: (token: string) => api.get<AdminMaintenanceResponse>('/admin/maintenance', { headers: bearer(token), allow401: true }),
  create: (token: string, body: MaintenanceCreateRequest) =>
    api.post<{ item: AdminMaintenanceItem }>('/admin/maintenance', body, { headers: bearer(token), allow401: true }),
  remove: (token: string, id: string) => api.delete(`/admin/maintenance/${encodeURIComponent(id)}`, { headers: bearer(token), allow401: true }),
}
