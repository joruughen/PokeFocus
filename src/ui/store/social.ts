/**
 * Friends cache (GET /api/friends): accepted friends plus incoming and
 * outgoing requests. Loaded on sign-in, refreshed on every SSE 'friends'
 * event and after each change; cleared on sign-out (auth.ts).
 * Mutations throw `ApiError` for the screen to explain.
 */
import { create } from 'zustand'
import type { FriendSummary } from '../../game/protocol'
import { friendsApi } from '../api/endpoints'
import { errorCode } from '../api/client'
import { onServerEvent } from '../api/events'

export interface FriendsState {
  /** null until the first load. */
  friends: FriendSummary[] | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  clear: () => void
  /** 'friend' when they had already sent us a request (accepted at once). */
  request: (friendCode: string) => Promise<'outgoing' | 'friend'>
  accept: (userId: string) => Promise<void>
  /** Decline, cancel or remove (same endpoint). */
  remove: (userId: string) => Promise<void>
}

let epoch = 0

export const useFriends = create<FriendsState>()((set, get) => ({
  friends: null,
  loading: false,
  error: null,
  load: async () => {
    const my = epoch
    set({ loading: true })
    try {
      const { friends } = await friendsApi.list()
      if (my === epoch) set({ friends, loading: false, error: null })
    } catch (e) {
      if (my === epoch) set({ loading: false, error: errorCode(e) })
    }
  },
  clear: () => {
    epoch++
    set({ friends: null, loading: false, error: null })
  },
  request: async (friendCode) => {
    const r = await friendsApi.request(friendCode)
    await get().load()
    return r?.status ?? 'outgoing'
  },
  accept: async (userId) => {
    await friendsApi.accept(userId)
    await get().load()
  },
  remove: async (userId) => {
    await friendsApi.remove(userId)
    await get().load()
  },
}))

/** Incoming requests waiting for an answer (nav badge). */
export function useIncomingCount(): number {
  return useFriends((s) => s.friends?.filter((f) => f.status === 'incoming').length ?? 0)
}

onServerEvent((e) => {
  if (e.type === 'friends' && useFriends.getState().friends !== null) void useFriends.getState().load()
})
