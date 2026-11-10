/**
 * What the server says it can do (GET /api/config, public so it also works on
 * the sign-in screen). Today: `devTools`, the server's DEV_TOOLS. Without it the
 * server ignores `x-dev-now` / `x-dev-seed` and refuses the `dev*` actions, so
 * the developer panel (`?dev`) must lock those controls instead of pretending.
 *
 * `devTools: null` = not known yet (loading, or the request failed): the panel
 * then behaves as before and the server stays the authority. Not persisted. A
 * leaf module (no store imports) so prefs.ts can read it.
 */
import { create } from 'zustand'
import type { ConfigResponse } from '../../game/protocol'
import { api } from '../api/client'

export interface ServerConfigState {
  devTools: boolean | null
  load: () => Promise<void>
}

export const useServerConfig = create<ServerConfigState>()((set) => ({
  devTools: null,
  load: async () => {
    try {
      const res = await api.get<ConfigResponse>('/config', { allow401: true })
      set({ devTools: res.devTools === true })
    } catch {
      // keep what we had (null = unknown): the server still refuses what it must
    }
  },
}))

let started = false

/** Fetch at boot (idempotent); while it is still unknown, try again whenever the tab becomes visible. */
export function startServerConfig(): void {
  if (started || typeof document === 'undefined') return
  started = true
  const load = () => void useServerConfig.getState().load()
  load()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && useServerConfig.getState().devTools === null) load()
  })
}
