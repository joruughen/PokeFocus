/**
 * Study groups cache (GET /api/groups): the group I am in (lobby or the group
 * of my running session) and the invites waiting for an answer. Loaded on
 * sign-in, refreshed on every SSE `group` event (which also raises the
 * notices: invites, someone left, start…), cleared on sign-out.
 * Mutations return an error code or null.
 */
import i18n from 'i18next'
import { create } from 'zustand'
import type { ServerEvent, StudyGroupView } from '../../game/protocol'
import { toast } from '../components/Toast'
import { errorCode } from '../api/client'
import { errorText } from '../lib/errors'
import { onServerEvent } from '../api/events'
import { groupsApi } from '../api/groups'
import { useAuth } from './auth'
import { useGame } from './game'

/** Error code → text: `group.errors.*` first, then the shared families. */
export function groupErrorText(code: string): string {
  const k = `group.errors.${code}`
  return i18n.exists(k) ? i18n.t(k) : errorText(code)
}

export interface GroupsState {
  current: StudyGroupView | null
  invites: StudyGroupView[]
  loaded: boolean
  /** A group request is in flight. */
  busy: boolean
  load: () => Promise<void>
  clear: () => void
  create: (minutes: number, friendIds: string[]) => Promise<string | null>
  invite: (friendIds: string[]) => Promise<string | null>
  accept: (groupId: string) => Promise<string | null>
  decline: (groupId: string) => Promise<string | null>
  start: () => Promise<string | null>
  leave: () => Promise<string | null>
}

let epoch = 0

export const useGroups = create<GroupsState>()((set, get) => {
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
    current: null,
    invites: [],
    loaded: false,
    busy: false,
    load: async () => {
      const my = epoch
      try {
        const r = await groupsApi.status()
        if (my === epoch) set({ current: r.current, invites: r.invites, loaded: true })
      } catch {
        // keep what we have; the next event or action retries
      }
    },
    clear: () => {
      epoch++
      set({ current: null, invites: [], loaded: false, busy: false })
    },
    create: (minutes, friendIds) => run(() => groupsApi.create(minutes, friendIds)),
    invite: (friendIds) => {
      const g = get().current
      return g ? run(() => groupsApi.invite(g.id, friendIds)) : Promise.resolve('not_found')
    },
    accept: (groupId) => run(() => groupsApi.accept(groupId), { reloadGame: true }),
    decline: (groupId) => run(() => groupsApi.decline(groupId)),
    start: () => {
      const g = get().current
      return g ? run(() => groupsApi.start(g.id), { reloadGame: true }) : Promise.resolve('not_found')
    },
    leave: () => {
      const g = get().current
      return g ? run(() => groupsApi.leave(g.id)) : Promise.resolve('not_found')
    },
  }
})

// Load on sign-in, forget on sign-out.
useAuth.subscribe((s, prev) => {
  if (s.user?.id === prev.user?.id) return
  useGroups.getState().clear()
  if (s.status === 'authed' && s.user) void useGroups.getState().load()
})

/** Notice for a group event (null = nothing worth saying). */
export function groupNotice(e: Extract<ServerEvent, { type: 'group' }>, meId: string | undefined, current: StudyGroupView | null): { title: string; type: 'info' | 'success' | 'danger'; description?: string } | null {
  const t = i18n.t.bind(i18n)
  const mine = e.userId === meId
  const name = e.trainerName
  switch (e.kind) {
    case 'invite':
      return mine ? null : { title: t('group.notice.invite', { name }), type: 'info', description: t('group.notice.inviteBody') }
    case 'accept':
      return mine ? null : { title: t('group.notice.accept', { name }), type: 'success' }
    case 'decline':
      return mine || !current?.me.host ? null : { title: t('group.notice.decline', { name }), type: 'info' }
    case 'start':
      return mine ? null : { title: t('group.notice.start', { name }), type: 'success', description: t('group.notice.startBody') }
    case 'join':
      return mine ? null : { title: t('group.notice.join', { name }), type: 'success' }
    case 'disband':
      return mine ? null : { title: t('group.notice.disband', { name }), type: 'info' }
    case 'failed':
      return mine ? { title: t('group.notice.failedMe'), type: 'danger', description: t('group.notice.failedMeBody') } : { title: t('group.notice.failed', { name }), type: 'info' }
    case 'leave': {
      if (e.reason === 'finished') return null
      const reason = t(`group.reason.${e.reason ?? 'leave'}`)
      if (mine) return { title: t('group.notice.youLeft', { reason }), type: 'info', description: t('group.notice.youLeftBody') }
      return { title: t('group.notice.left', { name, reason }), type: 'info', description: t('group.notice.leftBody') }
    }
  }
}

onServerEvent((e) => {
  if (e.type !== 'group') return
  const before = useGroups.getState().current
  const n = groupNotice(e, useAuth.getState().user?.id, before)
  if (n) toast.add(n)
  void useGroups.getState().load()
})
