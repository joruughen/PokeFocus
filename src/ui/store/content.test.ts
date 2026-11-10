/**
 * Live content store: downloads GET /api/content (faked here, the endpoint is
 * the server's job), installs it as the engine's default context, pins a
 * running session to its own hash, and flags a base that differs from the build.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseContext, defaultContext } from '../../engine'
import type { ContentResponse } from '../../game/contentProtocol'
import { EMPTY_DOC } from '../../game/protocol'
import { BUNDLE_BASE_HASH, pinnedHashOf, resetContentForTests, useContentStore } from './content'
import { useGame } from './game'

const claimWindow = (h: string) => ({ hash: h, baseHash: BUNDLE_BASE_HASH, patch: { config: { session: { claimWindowMinutes: Number(h.slice(1)) } } }, events: [], eventItems: {} }) satisfies ContentResponse

/** Fake content server: `current` is GET /api/content, `byHash` are the immutable ones. */
const server = {
  current: null as ContentResponse | null,
  byHash: new Map<string, ContentResponse>(),
  calls: [] as string[],
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input)
  server.calls.push(path)
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (path === '/api/content') return server.current ? json(200, server.current) : json(404, { error: 'not_found' })
  const m = /^\/api\/content\/(.+)$/.exec(path)
  const hit = m ? server.byHash.get(decodeURIComponent(m[1]!)) : undefined
  return hit ? json(200, hit) : json(404, { error: 'not_found' })
})

const origFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  server.current = null
  server.byHash.clear()
  server.calls = []
  resetContentForTests()
  useGame.setState({ ...EMPTY_DOC })
})
afterEach(() => resetContentForTests())
afterAll(() => {
  globalThis.fetch = origFetch
})

/** A player doc with a session pinned to `hash` (`undefined` = a session saved before pinning). */
function sessionPinnedTo(hash: string | undefined) {
  const player = { activeSession: { plannedMinutes: 25, ...(hash !== undefined && { contentHash: hash }) }, encounter: null }
  useGame.setState({ player: player as never })
}

describe('content store', () => {
  it('without a content server (404) the base content stays: same context, hash "base", no notice', async () => {
    await useContentStore.getState().load()
    expect(useContentStore.getState()).toMatchObject({ status: 'unavailable', hash: 'base', stale: false })
    expect(defaultContext()).toBe(baseContext())
  })

  it('a network failure also leaves the base content', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await useContentStore.getState().load()
    expect(defaultContext()).toBe(baseContext())
    expect(useContentStore.getState().hash).toBe('base')
  })

  it('empty content is exactly the base context', async () => {
    server.current = { hash: 'h-empty', baseHash: BUNDLE_BASE_HASH, patch: {}, events: [], eventItems: {} }
    await useContentStore.getState().load()
    expect(defaultContext()).toBe(baseContext())
    expect(useContentStore.getState()).toMatchObject({ status: 'ready', hash: 'base', latestHash: 'h-empty', stale: false })
  })

  it('a patch becomes the default context and changes the hash (the app remounts on it)', async () => {
    server.current = claimWindow('h77')
    await useContentStore.getState().load()
    expect(defaultContext().config.session.claimWindowMinutes).toBe(77)
    expect(defaultContext().contentHash).toBe('h77')
    expect(useContentStore.getState().hash).toBe('h77')
    // The server drops the patch again: back to the base.
    server.current = { hash: 'h-empty', baseHash: BUNDLE_BASE_HASH, patch: {}, events: [], eventItems: {} }
    await useContentStore.getState().load()
    expect(defaultContext()).toBe(baseContext())
    expect(useContentStore.getState().hash).toBe('base')
  })

  it('flags a server base that differs from the bundle (redeploy) and not one that matches', async () => {
    server.current = { ...claimWindow('h77'), baseHash: 'someone-elses-base' }
    await useContentStore.getState().load()
    expect(useContentStore.getState().stale).toBe(true)
    server.current = claimWindow('h77')
    await useContentStore.getState().load()
    expect(useContentStore.getState().stale).toBe(false)
  })
})

describe('session pinning', () => {
  it('reads the pin from the encounter first, then the active session', () => {
    expect(pinnedHashOf(EMPTY_DOC)).toBeUndefined()
    expect(pinnedHashOf({ player: { activeSession: { contentHash: 'a' }, encounter: null } as never })).toBe('a')
    expect(pinnedHashOf({ player: { activeSession: null, encounter: { contentHash: 'b' } } as never })).toBe('b')
    expect(pinnedHashOf({ player: { activeSession: { plannedMinutes: 25 }, encounter: null } as never })).toBeNull()
  })

  it('a running session keeps its own content (downloaded by hash) while the current one moves on, then follows it', async () => {
    server.byHash.set('h30', claimWindow('h30'))
    server.current = claimWindow('h77')
    sessionPinnedTo('h30')
    await useContentStore.getState().load()
    expect(server.calls).toContain('/api/content/h30')
    expect(defaultContext().config.session.claimWindowMinutes).toBe(30)
    expect(useContentStore.getState()).toMatchObject({ hash: 'h30', latestHash: 'h77' })
    // The session ends: the screens move to the current content.
    useGame.setState({ player: { activeSession: null, encounter: null } as never })
    await useContentStore.getState().load()
    expect(defaultContext().config.session.claimWindowMinutes).toBe(77)
    expect(useContentStore.getState().hash).toBe('h77')
  })

  it('a pin the server no longer has falls back to the current content', async () => {
    server.current = claimWindow('h77')
    sessionPinnedTo('gone')
    await useContentStore.getState().load()
    expect(defaultContext().config.session.claimWindowMinutes).toBe(77)
  })

  it('a session from before pinning freezes what is installed', async () => {
    server.current = claimWindow('h30')
    await useContentStore.getState().load()
    sessionPinnedTo(undefined)
    server.current = claimWindow('h77')
    await useContentStore.getState().load()
    expect(defaultContext().config.session.claimWindowMinutes).toBe(30)
    expect(useContentStore.getState()).toMatchObject({ hash: 'h30', latestHash: 'h77' })
  })
})
