/**
 * In-memory stand-in for the game API, for store tests: a `fetch` replacement
 * that runs the real reducer (`src/game/actions.ts`) on one user's doc, the way
 * server/ does, honoring the dev headers (`x-dev-now`, `x-dev-seed`).
 */
import { vi } from 'vitest'
import { createRng } from '../../engine'
import { applyAction } from '../../game/actions'
import { DEV_NOW_HEADER, DEV_SEED_HEADER, EMPTY_DOC, type GameAction, type GameDoc } from '../../game/protocol'

export interface FakeServer {
  doc: GameDoc
  version: number
  /** Every request seen: method, path, headers, body. */
  calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[]
  /** Force the next response (e.g. a 401 or a network error). */
  failNext: ((path: string) => Response | 'network' | null) | null
  reset: () => void
  restore: () => void
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export function installFakeServer(opts: { trainerName?: string; skewMs?: number } = {}): FakeServer {
  const server: FakeServer = {
    doc: EMPTY_DOC,
    version: 0,
    calls: [],
    failNext: null,
    reset() {
      server.doc = EMPTY_DOC
      server.version = 0
      server.calls = []
      server.failNext = null
    },
    restore() {
      spy.mockRestore()
    },
  }
  const serverNow = () => Date.now() + (opts.skewMs ?? 0)

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    server.calls.push({ method, path, headers, body })

    const forced = server.failNext?.(path) ?? null
    if (forced) {
      server.failNext = null
      if (forced === 'network') throw new TypeError('Failed to fetch')
      return forced
    }

    if (method === 'GET' && path === '/api/game') return json(200, { doc: server.doc, version: server.version, serverNow: serverNow() })
    if (method === 'POST' && path === '/api/game/action') {
      const now = headers[DEV_NOW_HEADER] ? Number(headers[DEV_NOW_HEADER]) : serverNow()
      const rng = createRng(headers[DEV_SEED_HEADER] ?? `${now}-${Math.random()}`)
      const r = applyAction(server.doc, body as GameAction, { now, rng, dev: true, trainerName: opts.trainerName ?? 'Test' })
      if (!r.ok) return json(r.error === 'dev_disabled' ? 403 : 409, { error: r.error })
      server.doc = r.doc
      server.version++
      return json(200, { doc: server.doc, version: server.version, serverNow: serverNow(), result: r.result })
    }
    return json(404, { error: 'not_found' })
  }

  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(handler as typeof fetch)
  return server
}
