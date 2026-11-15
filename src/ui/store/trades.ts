/**
 * Trades cache (GET /api/trades): open offers (received / sent) and the
 * history. Loaded on sign-in, refreshed on every SSE 'trade' event and after
 * each change; cleared on sign-out (auth.ts). Completing a trade also changes
 * the game doc: the server sends `game` over SSE, and `accept` reloads it too.
 * Mutations throw `ApiError` for the screen to explain.
 */
import { create } from 'zustand'
import type { TradeOfferView, TradesResponse } from '../../game/protocol'
import { errorCode } from '../api/client'
import { onServerEvent } from '../api/events'
import { tradesApi } from '../api/trades'
import { pendingCount } from '../screens/trades/eligibility'
import { useGame } from './game'

export interface TradesState {
  /** null until the first load. */
  data: TradesResponse | null
  error: string | null
  load: () => Promise<void>
  clear: () => void
  offer: (toUserId: string, uid: string, message: string | null) => Promise<TradeOfferView>
  counter: (offerId: string, uid: string) => Promise<TradeOfferView>
  accept: (offerId: string) => Promise<TradeOfferView>
  reject: (offerId: string) => Promise<TradeOfferView>
  cancel: (offerId: string) => Promise<TradeOfferView>
}

let epoch = 0

export const useTrades = create<TradesState>()((set, get) => {
  const after = async <T,>(p: Promise<T>): Promise<T> => {
    const r = await p
    await get().load()
    return r
  }
  return {
    data: null,
    error: null,
    load: async () => {
      const my = epoch
      try {
        const data = await tradesApi.list()
        if (my === epoch) set({ data, error: null })
      } catch (e) {
        if (my === epoch) set({ error: errorCode(e) })
      }
    },
    clear: () => {
      epoch++
      set({ data: null, error: null })
    },
    offer: (toUserId, uid, message) => after(tradesApi.offer(toUserId, uid, message)),
    counter: (offerId, uid) => after(tradesApi.counter(offerId, uid)),
    accept: async (offerId) => {
      const r = await after(tradesApi.accept(offerId))
      // The new Pokémon (and the Dust paid) are in the game doc.
      await useGame.getState().load()
      return r
    },
    reject: (offerId) => after(tradesApi.reject(offerId)),
    cancel: (offerId) => after(tradesApi.cancel(offerId)),
  }
})

/** Offers waiting for me (nav badge). */
export function useTradeTurnCount(): number {
  return useTrades((s) => pendingCount(s.data))
}

onServerEvent((e) => {
  if (e.type === 'trade' && useTrades.getState().data !== null) void useTrades.getState().load()
})
