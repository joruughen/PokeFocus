/**
 * The draft being edited, as a small framework-free store (usable with `useSyncExternalStore`): the working
 * copy of patch / title / note, the last copy the server confirmed, and an autosave loop that debounces edits,
 * never runs two saves at once and never loses an edit made while a save is in flight.
 */
import type { ContentPatch } from '../../../../engine/content'
import type { AdminContentDiffEntry, AdminContentVersion, AdminContentVersionResponse } from '../../../../game/protocol'
import { errorCode } from '../../../api'
import type { SaveDraftInput } from './api'
import { pruneEmpty, sameJson } from './patch'

export type SavePhase = 'clean' | 'dirty' | 'saving' | 'error'

export interface DraftState {
  id: number
  patch: ContentPatch
  title: string
  note: string
  phase: SavePhase
  /** Error code of the last failed save. */
  error: string | null
  /** Bumped on every local edit (the live validation re-runs on it). */
  revision: number
  /** The last answer of the server (validation of the saved copy included). */
  server: AdminContentVersion
  /** Diff of the SAVED copy against the active patch (as the server computed it). */
  diff: AdminContentDiffEntry[]
}

export interface DraftDeps {
  save: (id: number, body: SaveDraftInput) => Promise<AdminContentVersionResponse>
  debounceMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface DraftStore {
  getState: () => DraftState
  subscribe: (listener: () => void) => () => void
  /** Edit the patch (the function gets the current one and returns the next). */
  edit: (fn: (patch: ContentPatch) => ContentPatch) => void
  setTitle: (title: string) => void
  setNote: (note: string) => void
  /** Save right now (waits for a save in flight). Resolves true when the server holds the current copy. */
  flush: () => Promise<boolean>
  /** Stop the pending autosave timer (call `flush` first to keep the edits). Safe to call more than once. */
  dispose: () => void
}

export function createDraftStore(first: AdminContentVersionResponse, deps: DraftDeps): DraftStore {
  const initial = first.version
  const debounceMs = deps.debounceMs ?? 800
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const listeners = new Set<() => void>()
  let timer: unknown = null
  let inflight: Promise<void> | null = null

  let state: DraftState = {
    id: initial.id,
    patch: initial.patch,
    title: initial.title ?? '',
    note: initial.note ?? '',
    phase: 'clean',
    error: null,
    revision: 0,
    server: initial,
    diff: first.diff,
  }
  /** What the server holds, as normalised strings (title/note: the server stores '' as null). */
  let saved = { patch: initial.patch, title: (initial.title ?? '').trim(), note: (initial.note ?? '').trim() }

  const emit = () => listeners.forEach((l) => l())
  const set = (patch: Partial<DraftState>) => {
    state = { ...state, ...patch }
    emit()
  }
  const isDirty = () => !sameJson(state.patch, saved.patch) || state.title.trim() !== saved.title || state.note.trim() !== saved.note

  const schedule = () => {
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      void run()
    }, debounceMs)
  }

  const touch = (patch: Partial<DraftState>) => {
    state = { ...state, ...patch, revision: state.revision + 1, error: null }
    const dirty = isDirty()
    // While a save is in flight the phase stays 'saving'; its completion re-checks and reschedules.
    if (state.phase !== 'saving') state = { ...state, phase: dirty ? 'dirty' : 'clean' }
    emit()
    if (dirty && state.phase !== 'saving') schedule()
  }

  async function run(): Promise<void> {
    if (inflight || !isDirty()) return
    const sent = { patch: state.patch, title: state.title.trim(), note: state.note.trim() }
    const body: SaveDraftInput = {}
    if (!sameJson(sent.patch, saved.patch)) body.patch = sent.patch
    if (sent.title !== saved.title) body.title = sent.title || null
    if (sent.note !== saved.note) body.note = sent.note || null
    set({ phase: 'saving', error: null })
    inflight = (async () => {
      try {
        const res = await deps.save(state.id, body)
        saved = { patch: sent.patch, title: sent.title, note: sent.note }
        state = { ...state, server: res.version, diff: res.diff }
        // Edits made while saving: keep them dirty and save again.
        if (isDirty()) {
          set({ phase: 'dirty' })
          schedule()
        } else set({ phase: 'clean' })
      } catch (e) {
        set({ phase: 'error', error: errorCode(e) })
      } finally {
        inflight = null
      }
    })()
    await inflight
  }

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    edit: (fn) => {
      const next = pruneEmpty(fn(state.patch))
      if (sameJson(next, state.patch)) return
      touch({ patch: next })
    },
    setTitle: (title) => touch({ title }),
    setNote: (note) => touch({ note }),
    async flush() {
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      // A save may be running; after it, anything edited meanwhile still needs one more.
      for (let i = 0; i < 5; i++) {
        if (inflight) await inflight
        if (!isDirty()) return state.phase !== 'error'
        await run()
        if (state.phase === 'error') return false
      }
      return !isDirty()
    },
    dispose() {
      if (timer !== null) clearTimer(timer)
      timer = null
    },
  }
}
