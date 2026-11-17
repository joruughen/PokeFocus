import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnouncementsResponse } from '../../game/protocol'
import { useAnnouncements } from './announcements'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('announcements store', () => {
  beforeEach(() => {
    useAnnouncements.setState({ maintenance: [], skew: 0, dismissed: [] })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads the windows and measures the clock skew', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const body: AnnouncementsResponse = { maintenance: [{ id: 'a', startsAt: 2_000_000, endsAt: 3_000_000, note: 'x' }], contentNote: null, serverNow: 1_030_000 }
    const fetchMock = vi.fn(async () => json(200, body))
    vi.stubGlobal('fetch', fetchMock)
    await useAnnouncements.getState().load()
    const s = useAnnouncements.getState()
    expect(s.maintenance).toEqual(body.maintenance)
    expect(s.skew).toBe(30_000)
    expect(fetchMock).toHaveBeenCalledWith('/api/announcements', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
  })

  it('keeps the previous notices when the poll fails', async () => {
    const notice = { id: 'a', startsAt: 1, endsAt: 2, note: null }
    useAnnouncements.setState({ maintenance: [notice], skew: 5 })
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'internal' })))
    await useAnnouncements.getState().load()
    expect(useAnnouncements.getState().maintenance).toEqual([notice])
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await useAnnouncements.getState().load()
    expect(useAnnouncements.getState().maintenance).toEqual([notice])
    expect(useAnnouncements.getState().skew).toBe(5)
  })

  it('dismissals are remembered, deduplicated, and forgotten when the notice disappears', async () => {
    const { dismiss } = useAnnouncements.getState()
    dismiss('a')
    dismiss('a')
    dismiss('gone')
    expect(useAnnouncements.getState().dismissed).toEqual(['a', 'gone'])
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { maintenance: [{ id: 'a', startsAt: 1, endsAt: 2, note: null }], serverNow: Date.now() })))
    await useAnnouncements.getState().load()
    expect(useAnnouncements.getState().dismissed).toEqual(['a'])
  })
})
