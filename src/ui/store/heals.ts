/**
 * Study-group heals cache (GET /api/heals): the heals waiting for me and what I
 * can send in my latest group. Loaded on sign-in, refreshed on every SSE `heal`
 * event (which also raises the notices), cleared on sign-out.
 * Mutations return an error code or null.
 */
import i18n from 'i18next'
import { create } from 'zustand'
import type { HealsResponse } from '../../game/protocol'
import { toast } from '../components/Toast'
import { errorCode } from '../api/client'
import { onServerEvent } from '../api/events'
import { healsApi } from '../api/heals'
import { errorText } from '../lib/errors'
import { speciesName } from '../lib/names'
import { useAuth } from './auth'
import { useGame } from './game'

/** Error code → text: `heal.errors.*` first, then the shared families. */
export function healErrorText(code: string): string {
  const k = `heal.errors.${code}`
  return i18n.exists(k) ? i18n.t(k) : errorText(code)
}

export interface HealsState {
  data: HealsResponse | null
  /** A heal request is in flight. */
  busy: boolean
  load: () => Promise<void>
  clear: () => void
  send: (groupId: string, toUserId: string, uid: string) => Promise<string | null>
  accept: (healId: string) => Promise<string | null>
  decline: (healId: string) => Promise<string | null>
  cancel: (healId: string) => Promise<string | null>
}

let epoch = 0

export const useHeals = create<HealsState>()((set, get) => {
  const run = async (fn: () => Promise<unknown>, opts: { reloadGame?: boolean } = {}): Promise<string | null> => {
    const my = epoch
    set({ busy: true })
    try {
      await fn()
      return null
    } catch (e) {
      return errorCode(e)
    } finally {
      if (my === epoch) {
        set({ busy: false })
        await get().load()
        if (opts.reloadGame) await useGame.getState().load()
      }
    }
  }
  return {
    data: null,
    busy: false,
    load: async () => {
      const my = epoch
      try {
        const r = await healsApi.status()
        if (my === epoch) set({ data: r })
      } catch {
        // keep what we have; the next event or action retries
      }
    },
    clear: () => {
      epoch++
      set({ data: null, busy: false })
    },
    send: (groupId, toUserId, uid) => run(() => healsApi.send(groupId, toUserId, uid)),
    accept: (healId) => run(() => healsApi.accept(healId), { reloadGame: true }),
    decline: (healId) => run(() => healsApi.decline(healId)),
    cancel: (healId) => run(() => healsApi.cancel(healId)),
  }
})

// Load on sign-in, forget on sign-out.
useAuth.subscribe((s, prev) => {
  if (s.user?.id === prev.user?.id) return
  useHeals.getState().clear()
  if (s.status === 'authed' && s.user) void useHeals.getState().load()
})

onServerEvent((e) => {
  if (e.type !== 'heal') return
  const meId = useAuth.getState().user?.id
  void useHeals.getState().load().then(() => {
    if (e.userId === meId) return
    const t = i18n.t.bind(i18n)
    const lng = i18n.language
    const d = useHeals.getState().data
    const heal = d?.incoming.find((h) => h.id === e.healId) ?? d?.group?.sent.find((h) => h.id === e.healId)
    const mon = heal ? speciesName(heal.speciesSlug, lng === 'en' ? 'en' : 'es') : ''
    if (e.status === 'pending') toast.add({ title: t('heal.notice.incoming', { name: e.trainerName, amount: d?.amount ?? 0 }), type: 'info', description: t('heal.notice.incomingBody', { mon }) })
    else if (e.status === 'accepted') toast.add({ title: t('heal.notice.accepted', { name: e.trainerName, mon }), type: 'success' })
    else if (e.status === 'declined') toast.add({ title: t('heal.notice.declined', { name: e.trainerName }), type: 'info', description: t('heal.notice.declinedBody') })
    else if (e.status === 'cancelled') toast.add({ title: t('heal.notice.cancelled', { name: e.trainerName }), type: 'info' })
  })
})
