/**
 * Live content store (docs/admin-plan.md §1 "Cliente").
 *
 * The server may overlay an admin patch and the active events on the shipped
 * data (GET /api/content). This store downloads it, resolves it into an
 * `EngineContext` and installs it as the engine's default context, so every
 * view that calls `defaultContext()` (or `useContent()`) reads the live rules.
 *
 * - Without a content server (404 / network error) nothing changes: the base
 *   context stays and `hash` stays 'base'.
 * - A session is pinned to the hash it started with (`activeSession.contentHash`,
 *   `encounter.contentHash`): while one runs, its screens keep that content
 *   (fetched from the immutable GET /api/content/:hash) even if the server's
 *   current content moves on. A session without a pin (saved before pinning)
 *   freezes whatever is installed.
 * - When the installed context changes, `hash` changes and the app remounts
 *   (`key={hash}` in App.tsx), so nothing keeps stale values.
 * - `stale`: the server was built from other shipped data than this bundle
 *   (a redeploy happened): the UI asks for a reload.
 */
import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import metaJson from '../../data/game/meta.json'
import { baseContext, createEngineContext, defaultContext, resolveContent, setDefaultContext, type EngineContext } from '../../engine'
import { CONTENT_PATH, type ContentResponse } from '../../game/contentProtocol'
import type { GameDoc } from '../../game/protocol'
import { api, isApiError } from '../api/client'
import { onServerEvent } from '../api/events'
import { useGame } from './game'

/** `baseHash` of the data bundled in this build. */
export const BUNDLE_BASE_HASH: string = metaJson.baseHash

export type ContentStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface ContentState {
  /** Hash of the installed context (`ctx.contentHash`; 'base' = shipped data). The app is keyed by it. */
  hash: string
  /** The server's current hash, when known. */
  latestHash: string | null
  /** `baseHash` the server reported; null while unknown or without a content server. */
  baseHash: string | null
  /** The server's base differs from this bundle's: reload for the new version. */
  stale: boolean
  status: ContentStatus
  /** GET /api/content (boot, SSE `content`, tab visible again). Never throws. */
  load: () => Promise<void>
}

/** Contexts built so far, by the server's hash. */
const contexts = new Map<string, EngineContext>()
/** Hashes the server could not give us (404): a session pinned to one falls back to the current content. */
const unavailable = new Set<string>()
/** The server's current content, built. */
let latestCtx: EngineContext | null = null

export const useContentStore = create<ContentState>()((set, get) => ({
  hash: defaultContext().contentHash,
  latestHash: null,
  baseHash: null,
  stale: false,
  status: 'idle',
  load: async () => {
    if (get().status === 'idle') set({ status: 'loading' })
    try {
      const res = await api.get<ContentResponse>(CONTENT_PATH, { allow401: true })
      latestCtx = remember(res)
      set({ latestHash: res.hash, baseHash: res.baseHash, stale: res.baseHash !== BUNDLE_BASE_HASH, status: 'ready' })
    } catch (e) {
      // 404 = no content server: stay on the shipped content. Anything else: keep what we had.
      if (isApiError(e) && e.status === 404) {
        latestCtx = null
        set({ status: 'unavailable', latestHash: null, baseHash: null, stale: false })
      } else if (get().status === 'loading') set({ status: 'unavailable' })
    }
    await sync()
  },
}))

/** Build (once per hash) the context of a content response. Empty content is exactly the base context. */
function remember(res: ContentResponse): EngineContext {
  const known = contexts.get(res.hash)
  if (known) return known
  const patch = res.patch ?? {}
  const events = res.events ?? []
  const items = res.eventItems ?? {}
  const empty = Object.keys(patch).length === 0 && events.length === 0 && Object.keys(items).length === 0
  const ctx = empty ? baseContext() : createEngineContext(resolveContent(patch, events, items, { hash: res.hash }))
  contexts.set(res.hash, ctx)
  return ctx
}

/** The hash the player's session is pinned to: `undefined` = no session, `null` = a session without a pin. */
export function pinnedHashOf(doc: Pick<GameDoc, 'player'>): string | null | undefined {
  const p = doc.player
  if (!p || (!p.activeSession && !p.encounter)) return undefined
  // `contentHash` lives on ActiveSession / EncounterState (written by the server when the session starts).
  const enc = p.encounter as { contentHash?: string } | null
  const act = p.activeSession as { contentHash?: string } | null
  return enc?.contentHash ?? act?.contentHash ?? null
}

let syncing = false
let again = false

/** Install the effective context: the pinned one while a session runs, else the server's current one. */
async function sync(): Promise<void> {
  // One run at a time; a change that arrives meanwhile triggers another pass.
  if (syncing) {
    again = true
    return
  }
  syncing = true
  try {
    do {
      again = false
      await pass()
    } while (again)
  } finally {
    syncing = false
  }
}

async function pass(): Promise<void> {
  const pinned = pinnedHashOf(useGame.getState())
  if (pinned === null) return // a session from before pinning: freeze what is installed
  let ctx: EngineContext | null = null
  if (pinned !== undefined) {
    ctx = contexts.get(pinned) ?? (unavailable.has(pinned) ? null : await fetchPinned(pinned))
    // The session or the pin changed while downloading: start over.
    if (pinnedHashOf(useGame.getState()) !== pinned) {
      again = true
      return
    }
  }
  // No session, or its content cannot be had: the server's current content (or the shipped one).
  ctx ??= latestCtx ?? baseContext()
  if (defaultContext() !== ctx) setDefaultContext(ctx === baseContext() ? null : ctx)
  if (useContentStore.getState().hash !== ctx.contentHash) useContentStore.setState({ hash: ctx.contentHash })
}

async function fetchPinned(hash: string): Promise<EngineContext | null> {
  try {
    const res = await api.get<ContentResponse>(`${CONTENT_PATH}/${encodeURIComponent(hash)}`, { allow401: true })
    return remember({ ...res, hash })
  } catch (e) {
    if (isApiError(e) && e.status === 404) unavailable.add(hash)
    return null
  }
}

/** The context the game screens read (live content, or the one a running session is pinned to). Re-renders when it changes. */
export function useContent(): EngineContext {
  useContentStore((s) => s.hash)
  return defaultContext()
}

/**
 * The context of the active session (its pinned hash) when there is one and it
 * is already downloaded, else `useContent()`. Once the store has synced it is
 * the same as `useContent()`; session screens use it so they never read
 * anything but their own content.
 */
export function useSessionContext(): EngineContext {
  const fallback = useContent()
  const pinned = useSyncExternalStore(
    useGame.subscribe,
    () => pinnedHashOf(useGame.getState()),
    () => undefined,
  )
  return (pinned ? contexts.get(pinned) : undefined) ?? fallback
}

/** Whether the server's base differs from this bundle's (reload for the new version). */
export function useContentStale(): boolean {
  return useContentStore((s) => s.stale)
}

let started = false

/** Boot: fetch the content, follow SSE `content` events and tab visibility, and re-sync when the session pin changes (idempotent). */
export function startContent(): void {
  if (started || typeof document === 'undefined') return
  started = true
  const load = () => void useContentStore.getState().load()
  load()
  onServerEvent((e) => {
    const ev = e as { type: string; hash?: string }
    if (ev.type === 'content' && ev.hash !== useContentStore.getState().latestHash) load()
  })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load()
  })
  let lastPin = pinnedHashOf(useGame.getState())
  useGame.subscribe((s) => {
    const pin = pinnedHashOf(s)
    if (pin === lastPin) return
    lastPin = pin
    void sync()
  })
}

/** Tests: forget everything downloaded and go back to the base context. */
export function resetContentForTests(): void {
  contexts.clear()
  unavailable.clear()
  latestCtx = null
  syncing = false
  again = false
  setDefaultContext(null)
  useContentStore.setState({ hash: baseContext().contentHash, latestHash: null, baseHash: null, stale: false, status: 'idle' })
}
