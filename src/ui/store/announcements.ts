/**
 * Announcements store: scheduled maintenance windows from GET /api/announcements
 * (public, so it also works on the sign-in screen). Not persisted. Polled every
 * two minutes and when the tab becomes visible again; a failed poll keeps what
 * we had (the banner must not vanish because the server blinked).
 */
import { create } from 'zustand'
import type { ContentNoteNotice, MaintenanceNotice } from '../../game/protocol'
import { announcementsApi } from '../api/endpoints'

export const ANNOUNCEMENTS_POLL_MS = 120_000

const NOTE_SEEN_KEY = 'pokefocus:contentNote:seen'

/** Highest content-note version this device has shown (versions only grow). */
function readSeen(): number {
  try {
    const n = Number(localStorage.getItem(NOTE_SEEN_KEY))
    return Number.isSafeInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export interface AnnouncementsState {
  maintenance: MaintenanceNotice[]
  /** The admin's note for the latest version in force (null = none); shown once per device (`noteSeen`). */
  contentNote: ContentNoteNotice | null
  /** Highest content-note version id already shown on this device (localStorage). */
  noteSeen: number
  markNoteSeen: (versionId: number) => void
  /** `serverNow - Date.now()` at the last fetch, to compare the windows with the server's clock. */
  skew: number
  /** Upcoming notices the player closed (until the page reloads; a running window is never hidden). */
  dismissed: string[]
  load: () => Promise<void>
  dismiss: (id: string) => void
}

export const useAnnouncements = create<AnnouncementsState>()((set) => ({
  maintenance: [],
  contentNote: null,
  noteSeen: readSeen(),
  markNoteSeen: (versionId) =>
    set((s) => {
      if (versionId <= s.noteSeen) return s
      try {
        localStorage.setItem(NOTE_SEEN_KEY, String(versionId))
      } catch {
        // private mode: it comes back after a reload
      }
      return { noteSeen: versionId }
    }),
  skew: 0,
  dismissed: [],
  load: async () => {
    try {
      const res = await announcementsApi.get()
      set((s) => ({
        maintenance: res.maintenance,
        contentNote: res.contentNote ?? null,
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
