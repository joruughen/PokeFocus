/**
 * Persistence adapter for the zustand stores.
 *
 * Today everything lives in `localStorage`. To move to Supabase (F2), replace
 * `storageBackend` with an adapter that implements the same three methods
 * (`getItem`, `setItem`, `removeItem`, sync or async): the stores do not know
 * where their data goes. Keys are namespaced with `pokefocus:`.
 */
import { createJSONStorage, type StateStorage } from 'zustand/middleware'

export const STORAGE_KEYS = {
  game: 'pokefocus:game',
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
