import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminContentVersion, AdminContentVersionResponse } from '../../../../game/protocol'
import { ApiError } from '../../../api'
import type { SaveDraftInput } from './api'
import { createDraftStore } from './draftStore'
import { setConfigValue } from './patch'

function response(over: Partial<AdminContentVersion> = {}): AdminContentVersionResponse {
  const version: AdminContentVersion = {
    id: 7,
    status: 'draft',
    title: null,
    note: null,
    parentId: null,
    hash: 'h',
    effectiveAt: null,
    createdBy: null,
    createdAt: 0,
    publishedBy: null,
    publishedAt: null,
    active: false,
    scheduled: false,
    validation: null,
    linkedEvent: null,
    linkedRole: null,
    revertOfVersionId: null,
    revertStale: false,
    patch: {},
    baseHash: 'base',
    validationDetail: null,
    ...over,
  }
  return { version, diff: [], serverNow: 0 }
}

/** A save that stays pending until the test releases it. */
function deferredSave() {
  const calls: SaveDraftInput[] = []
  const pending: ((r: AdminContentVersionResponse) => void)[] = []
  const save = vi.fn((_id: number, body: SaveDraftInput) => {
    calls.push(body)
    return new Promise<AdminContentVersionResponse>((resolve) => pending.push(resolve))
  })
  return { save, calls, release: (i = 0) => pending[i]!(response()) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('draft store', () => {
  it('debounces edits into one save with only what changed', async () => {
    const save = vi.fn(async () => response({ patch: { config: { encounters: { roamingSessions: 6 } } } }))
    const store = createDraftStore(response(), { save, debounceMs: 500 })
    store.edit((p) => setConfigValue(p, 'encounters.roamingSessions', 5))
    store.edit((p) => setConfigValue(p, 'encounters.roamingSessions', 6))
    expect(store.getState().phase).toBe('dirty')
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(7, { patch: { config: { encounters: { roamingSessions: 6 } } } })
    expect(store.getState().phase).toBe('clean')
  })

  it('an edit back to the saved value is not dirty', () => {
    const store = createDraftStore(response(), { save: vi.fn(), debounceMs: 500 })
    store.edit((p) => setConfigValue(p, 'encounters.roamingSessions', 6))
    expect(store.getState().phase).toBe('dirty')
    store.edit((p) => setConfigValue(p, 'encounters.roamingSessions', undefined))
    expect(store.getState().phase).toBe('clean')
  })

  it('saves title and note apart from the patch, empty text as null', async () => {
    const save = vi.fn(async () => response())
    const store = createDraftStore(response({ title: 'Old' }), { save, debounceMs: 100 })
    store.setTitle('')
    store.setNote('  why  ')
    await vi.advanceTimersByTimeAsync(150)
    expect(save).toHaveBeenCalledWith(7, { title: null, note: 'why' })
  })

  it('never runs two saves at once and does not lose an edit made while saving', async () => {
    const d = deferredSave()
    const store = createDraftStore(response(), { save: d.save, debounceMs: 100 })
    store.edit((p) => setConfigValue(p, 'encounters.roamingSessions', 5))
    await vi.advanceTimersByTimeAsync(150)
    expect(d.calls).toHaveLength(1)
    // Edit while the first save is in flight.
    store.edit((p) => setConfigValue(p, 'encounters.roamingSessions', 7))
    await vi.advanceTimersByTimeAsync(500)
    expect(d.calls).toHaveLength(1)
    d.release(0)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(150)
    expect(d.calls).toHaveLength(2)
    expect(d.calls[1]).toEqual({ patch: { config: { encounters: { roamingSessions: 7 } } } })
    d.release(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().phase).toBe('clean')
  })

  it('flush saves right now and resolves true only when the server has the current copy', async () => {
    const save = vi.fn(async () => response())
    const store = createDraftStore(response(), { save, debounceMs: 10_000 })
    store.edit((p) => setConfigValue(p, 'energy.costBase', 1.5))
    const ok = store.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(await ok).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(await store.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a failed save reports the code, keeps the edit and retries on the next flush', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(500, 'internal')).mockResolvedValue(response())
    const store = createDraftStore(response(), { save, debounceMs: 100 })
    store.edit((p) => setConfigValue(p, 'energy.costBase', 1.5))
    const first = store.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(await first).toBe(false)
    expect(store.getState()).toMatchObject({ phase: 'error', error: 'internal' })
    expect(store.getState().patch.config?.energy?.costBase).toBe(1.5)
    const second = store.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(await second).toBe(true)
    expect(store.getState().phase).toBe('clean')
  })

  it('notifies subscribers and stops at unsubscribe', () => {
    const store = createDraftStore(response(), { save: vi.fn(), debounceMs: 100 })
    const seen = vi.fn()
    const off = store.subscribe(seen)
    store.setTitle('x')
    expect(seen).toHaveBeenCalled()
    seen.mockClear()
    off()
    store.setTitle('y')
    expect(seen).not.toHaveBeenCalled()
  })
})
