/**
 * Persistence adapter for the zustand stores.
 *
 * Only per-device preferences (`usePrefs`) use this: they live in
 * `localStorage` (with an in-memory fallback). The game itself lives on the
 * server (`useGame` is a cache of the server document, see docs/F2-plan.md).
 * A store does not know where its data goes: swap `storageBackend` for any
 * adapter with the same three methods (`getItem`, `setItem`, `removeItem`).
 * Keys are namespaced with `pokefocus:`.
 */
import { createJSONStorage, type StateStorage } from 'zustand/middleware'

export const STORAGE_KEYS = {
  prefs: 'pokefocus:prefs',
} as const

const memory = new Map<string, string>()

/** localStorage with an in-memory fallback (private mode, tests, SSR). */
export const storageBackend: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return memory.get(name) ?? null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      memory.set(name, value)
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      memory.delete(name)
    }
  },
}

export const jsonStorage = createJSONStorage(() => storageBackend)
