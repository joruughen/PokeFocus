/**
 * Cross-tab navigation of the admin screen: a link in one tab (the event editor's «Contenido atado») asks for a
 * place in another one. `Admin` switches the tab; the panel that owns the thing consumes the request when it shows.
 */
import { create } from 'zustand'

interface AdminNav {
  /** A content version the content tab should open (read-only view). */
  contentVersionId: number | null
  /** Open that version in the content tab. */
  openContentVersion: (id: number) => void
  /** The content tab took the request. */
  consumeContentVersion: () => void
}

export const useAdminNav = create<AdminNav>((set) => ({
  contentVersionId: null,
  openContentVersion: (id) => set({ contentVersionId: id }),
  consumeContentVersion: () => set({ contentVersionId: null }),
}))
