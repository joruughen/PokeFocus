/**
 * In-memory stand-in for the game API, for store tests: a `fetch` replacement
 * that runs the real reducer (`src/game/actions.ts`) on one user's doc, the way
 * server/ does, honoring the dev headers (`x-dev-now`, `x-dev-seed`). It also
 * answers GET/PATCH /api/auth/me for one account with the name / country locks
 * of src/game/protocol.ts ("Account changes").
 */
import { vi } from 'vitest'
import { createRng } from '../../engine'
import { applyAction } from '../../game/actions'
import { COUNTRY_LOCK_DAYS, DEV_NOW_HEADER, DEV_SEED_HEADER, EMPTY_DOC, NAME_LOCK_DAYS, type GameAction, type GameDoc, type PublicUser } from '../../game/protocol'

export interface FakeServer {
  doc: GameDoc
  version: number
  /** The signed-in account (GET/PATCH /api/auth/me). Edit it to set up a locked name or country. */
  user: PublicUser
  /** Every request seen: method, path, headers, body. */
  calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[]
  /** The server's DEV_TOOLS (GET /api/config). False: x-dev-now / x-dev-seed are ignored and dev actions answer 403, like a production server. Default true. */
  devTools: boolean
  /** Force the next response (e.g. a 401 or a network error). */
  failNext: ((path: string) => Response | 'network' | null) | null
  reset: () => void
  restore: () => void
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const DAY_MS = 86_400_000

function freshUser(trainerName: string): PublicUser {
  return {
    id: 'u1',
    email: 'ash@example.com',
    trainerName,
    country: 'PE',
    friendCode: 'ABCD2345',
    createdAt: 0,
    nameChangedAt: null,
    countryChangedAt: null,
    anonymousRankings: false,
    trainerSprite: null,
    role: 'player',
  }
}

export function installFakeServer(opts: { trainerName?: string; skewMs?: number } = {}): FakeServer {
  const server: FakeServer = {
    doc: EMPTY_DOC,
    version: 0,
    user: freshUser(opts.trainerName ?? 'Test'),
    devTools: true,
    calls: [],
    failNext: null,
    reset() {
      server.doc = EMPTY_DOC
      server.version = 0
      server.user = freshUser(opts.trainerName ?? 'Test')
      server.devTools = true
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

    if (method === 'GET' && path === '/api/config') return json(200, { devTools: server.devTools })
    if (method === 'GET' && path === '/api/game') return json(200, { doc: server.doc, version: server.version, serverNow: serverNow() })
    if (method === 'POST' && path === '/api/game/action') {
      const now = server.devTools && headers[DEV_NOW_HEADER] ? Number(headers[DEV_NOW_HEADER]) : serverNow()
      const rng = createRng((server.devTools && headers[DEV_SEED_HEADER]) || `${now}-${Math.random()}`)
      const r = applyAction(server.doc, body as GameAction, { now, rng, dev: server.devTools, trainerName: opts.trainerName ?? 'Test' })
      if (!r.ok) return json(r.error === 'dev_disabled' ? 403 : 409, { error: r.error })
      server.doc = r.doc
      server.version++
      return json(200, { doc: server.doc, version: server.version, serverNow: serverNow(), result: r.result })
    }
    if (path === '/api/auth/me' && method === 'GET') return json(200, { user: server.user })
    if (path === '/api/auth/me' && method === 'PATCH') {
      const patch = (body ?? {}) as { trainerName?: string; country?: string; anonymousRankings?: boolean; trainerSprite?: string | null }
      const at = serverNow()
      const u = server.user
      // A change is a different value; the same value is a no-op. Any locked change fails the whole request.
      const nameChange = patch.trainerName !== undefined && patch.trainerName !== u.trainerName
      const countryChange = patch.country !== undefined && patch.country !== u.country
      if (nameChange && u.nameChangedAt !== null && u.nameChangedAt + NAME_LOCK_DAYS * DAY_MS > at) return json(409, { error: 'name_locked', unlockAt: u.nameChangedAt + NAME_LOCK_DAYS * DAY_MS })
      if (countryChange && u.countryChangedAt !== null && u.countryChangedAt + COUNTRY_LOCK_DAYS * DAY_MS > at) return json(409, { error: 'country_locked', unlockAt: u.countryChangedAt + COUNTRY_LOCK_DAYS * DAY_MS })
      server.user = {
        ...u,
        ...(nameChange && { trainerName: patch.trainerName!, nameChangedAt: at }),
        ...(countryChange && { country: patch.country!, countryChangedAt: at }),
        ...(patch.anonymousRankings !== undefined && { anonymousRankings: patch.anonymousRankings }),
        ...(patch.trainerSprite !== undefined && { trainerSprite: patch.trainerSprite }),
      }
      return json(200, { user: server.user })
    }
    return json(404, { error: 'not_found' })
  }

  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(handler as typeof fetch)
  return server
}
