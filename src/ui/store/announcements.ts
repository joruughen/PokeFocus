/**
 * Announcements store: scheduled maintenance windows from GET /api/announcements
 * (public, so it also works on the sign-in screen). Not persisted. Polled every
 * two minutes and when the tab becomes visible again; a failed poll keeps what
 * we had (the banner must not vanish because the server blinked).
 */
import { create } from 'zustand'
import type { MaintenanceNotice } from '../../game/protocol'
import { announcementsApi } from '../api/endpoints'

export const ANNOUNCEMENTS_POLL_MS = 120_000

export interface AnnouncementsState {
  maintenance: MaintenanceNotice[]
  /** `serverNow - Date.now()` at the last fetch, to compare the windows with the server's clock. */
  skew: number
  /** Upcoming notices the player closed (until the page reloads; a running window is never hidden). */
  dismissed: string[]
  load: () => Promise<void>
  dismiss: (id: string) => void
}

export const useAnnouncements = create<AnnouncementsState>()((set) => ({
  maintenance: [],
  skew: 0,
  dismissed: [],
  load: async () => {
    try {
      const res = await announcementsApi.get()
      set((s) => ({
        maintenance: res.maintenance,
        skew: Number.isFinite(res.serverNow) ? res.serverNow - Date.now() : s.skew,
        // Forget dismissals of notices that no longer exist.
        dismissed: s.dismissed.filter((id) => res.maintenance.some((n) => n.id === id)),
      }))
    } catch {
      // keep the previous list
    }
  },
  dismiss: (id) => set((s) => (s.dismissed.includes(id) ? s : { dismissed: [...s.dismissed, id] })),
}))

let started = false

/** Fetch now and keep polling (idempotent; called once at boot). */
export function startAnnouncements(): void {
  if (started || typeof document === 'undefined') return
  started = true
  const load = () => void useAnnouncements.getState().load()
  load()
  setInterval(load, ANNOUNCEMENTS_POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load()
  })
}
