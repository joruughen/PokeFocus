/**
 * Live events store (docs/admin-plan.md §6): the published events from
 * GET /api/live-events (active, upcoming, past with a cursor). Not persisted,
 * except two per-device lists: "I closed the banner" and "I saw the pop-up". It
 * reloads on the SSE `content` event (an event starting, ending, being
 * published or archived moves the content hash), on `event_announce` (an admin
 * notified the players: `announceRev` moved) and when the tab is visible
 * again; a failed reload keeps what we had.
 */
import { create } from 'zustand'
import type { LiveEventPublic, LiveEventsResponse } from '../../game/protocol'
import { api } from '../api/client'
import { onServerEvent } from '../api/events'

export const LIVE_EVENTS_PATH = '/live-events'
const DISMISSED_KEY = 'pokefocus:eventBanner:dismissed'
const DISMISSED_MAX = 50
const POPUP_SEEN_KEY = 'pokefocus:eventPopup:seen'
const POPUP_SEEN_MAX = 100

export type LiveEventsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LiveEventsState {
  active: LiveEventPublic[]
  upcoming: LiveEventPublic[]
  past: LiveEventPublic[]
  /** `before` for the next page of past events; null on the last page. */
  nextCursor: number | null
  /** `serverNow - Date.now()` at the last fetch. */
  skew: number
  status: LiveEventsStatus
  loadingMore: boolean
  /** Ids of events whose home banner the player closed (kept in this browser). */
  dismissed: string[]
  /** Pop-up keys (`popupKey`: event, announce revision, phase) this device already showed. */
  popupSeen: string[]
  load: () => Promise<void>
  loadMore: () => Promise<void>
  dismissBanner: (id: string) => void
  markPopupSeen: (keys: readonly string[]) => void
}

function readList(key: string, max: number): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-max) : []
  } catch {
    return []
  }
}

function writeList(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // private mode: it just comes back after a reload
  }
}

let seq = 0

export const useLiveEvents = create<LiveEventsState>()((set, get) => ({
  active: [],
  upcoming: [],
  past: [],
  nextCursor: null,
  skew: 0,
  status: 'idle',
  loadingMore: false,
  dismissed: readList(DISMISSED_KEY, DISMISSED_MAX),
  popupSeen: readList(POPUP_SEEN_KEY, POPUP_SEEN_MAX),
  load: async () => {
    const mine = ++seq
    if (get().status === 'idle') set({ status: 'loading' })
    try {
      const res = await api.get<LiveEventsResponse>(LIVE_EVENTS_PATH, { allow401: true })
      if (mine !== seq) return
      set((s) => ({
        active: res.active,
        upcoming: res.upcoming,
        past: res.past,
        nextCursor: res.nextCursor,
        skew: Number.isFinite(res.serverNow) ? res.serverNow - Date.now() : s.skew,
        status: 'ready',
        loadingMore: false,
      }))
    } catch {
      if (mine === seq && get().status !== 'ready') set({ status: 'error' })
    }
  },
  loadMore: async () => {
    const { nextCursor, loadingMore } = get()
    if (nextCursor === null || loadingMore) return
    const mine = seq
    set({ loadingMore: true })
    try {
      const res = await api.get<LiveEventsResponse>(`${LIVE_EVENTS_PATH}?before=${nextCursor}`, { allow401: true })
      // A reload happened meanwhile: its first page already replaced the list.
      if (mine !== seq) return
      set((s) => ({
        past: [...s.past, ...res.past.filter((e) => !s.past.some((p) => p.id === e.id))],
        nextCursor: res.nextCursor,
      }))
    } catch {
      // keep the cursor: the button can be pressed again
    } finally {
      if (mine === seq) set({ loadingMore: false })
    }
  },
  dismissBanner: (id) =>
    set((s) => {
      if (s.dismissed.includes(id)) return s
      const dismissed = [...s.dismissed, id].slice(-DISMISSED_MAX)
      writeList(DISMISSED_KEY, dismissed)
      return { dismissed }
    }),
  markPopupSeen: (keys) =>
    set((s) => {
      const fresh = keys.filter((k) => !s.popupSeen.includes(k))
      if (fresh.length === 0) return s
      const popupSeen = [...s.popupSeen, ...fresh].slice(-POPUP_SEEN_MAX)
      writeList(POPUP_SEEN_KEY, popupSeen)
      return { popupSeen }
    }),
}))

let started = false

/** Fetch now and follow the SSE `content` / `event_announce` events and tab visibility (idempotent; called once at boot). */
export function startLiveEvents(): void {
  if (started || typeof document === 'undefined') return
  started = true
  const load = () => void useLiveEvents.getState().load()
  load()
  onServerEvent((e) => {
    if (e.type === 'content' || e.type === 'event_announce') load()
  })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load()
  })
}

/** Tests: back to an empty store. */
export function resetLiveEventsForTests(): void {
  seq++
  useLiveEvents.setState({ active: [], upcoming: [], past: [], nextCursor: null, skew: 0, status: 'idle', loadingMore: false, dismissed: [], popupSeen: [] })
}
