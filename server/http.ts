/** Shared HTTP plumbing: app context type, errors, body parsing, client IP, auth middleware. */
import type { Context, MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { and, eq, gt } from 'drizzle-orm'
import type { z } from 'zod'
import type { Env } from './env'
import type { Db } from './db/client'
import { authSessions, users, type AuthSessionRow, type UserRow } from './db/schema'
import type { EventBus } from './events'
import type { RateLimiter } from './rate-limit'
import type { FetchLike, WeatherService } from './weather'
import { hashToken, looksLikeToken, SESSION_COOKIE, SESSION_RENEW_AFTER_MS, SESSION_TTL_MS } from './auth/tokens'
import { DEV_NOW_HEADER, type PublicUser } from '../src/game/protocol'

export interface Deps {
  env: Env
  db: Db
  bus: EventBus
  limiter: RateLimiter
  /** Real time (ms). Game time may differ in dev (x-dev-now). */
  clock: () => number
  /** Outbound HTTP (Open-Meteo); a fake in tests. */
  fetch: FetchLike
  /** Real weather per city, cached (built from `fetch` + `clock`). */
  weather: WeatherService
}

export type AppEnv = {
  Variables: {
    user: UserRow
    session: AuthSessionRow
  }
}

export type Ctx = Context<AppEnv>

/** Thrown anywhere in a handler → `{ error: code }` with `status` (see app.onError). */
export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500

export class ApiError extends Error {
  readonly status: ApiStatus
  readonly code: string
  readonly extra: Record<string, unknown> | undefined

  constructor(status: ApiStatus, code: string, extra?: Record<string, unknown>) {
    super(code)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/** Parse and validate the JSON body. Errors: 400 invalid_json / invalid_body. */
export async function readBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json')
  }
  const r = schema.safeParse(raw)
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(root)'))]
    throw new ApiError(400, 'invalid_body', { fields })
  }
  return r.data
}

/** Client IP: the socket address, or the last X-Forwarded-For hop when TRUST_PROXY=1. */
export function clientIp(c: Ctx, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header('x-forwarded-for')
    const last = xff?.split(',').map((s) => s.trim()).filter(Boolean).pop()
    if (last) return last
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // app.request() in tests has no socket
  }
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    trainerName: u.trainerName,
    country: u.country,
    friendCode: u.friendCode,
    createdAt: u.createdAt.getTime(),
  }
}

export function setSessionCookie(c: Ctx, env: Env, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: env.cookieSecure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function clearSessionCookie(c: Ctx, env: Env): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'Lax', secure: env.cookieSecure })
}

export function sessionToken(c: Ctx): string | null {
  const v = getCookie(c, SESSION_COOKIE)
  return looksLikeToken(v) ? v : null
}

/** Resolve the session cookie → `user` + `session`, or 401 unauthorized. Renews sliding expiry. */
export function requireAuth(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = sessionToken(c)
    if (!token) throw new ApiError(401, 'unauthorized')
    const now = deps.clock()
    const [row] = await deps.db
      .select({ session: authSessions, user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.tokenHash, hashToken(token)), gt(authSessions.expiresAt, new Date(now))))
      .limit(1)
    if (!row) {
      clearSessionCookie(c, deps.env)
      throw new ApiError(401, 'unauthorized')
    }
    let session = row.session
    if (now - session.lastSeenAt.getTime() > SESSION_RENEW_AFTER_MS) {
      const patch = { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) }
      await deps.db.update(authSessions).set(patch).where(eq(authSessions.id, session.id))
      session = { ...session, ...patch }
      setSessionCookie(c, deps.env, token)
    }
    c.set('user', row.user)
    c.set('session', session)
    await next()
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Game time: server clock, or x-dev-now only with DEV_TOOLS=1. */
export function gameTime(deps: Deps, c: Ctx): number {
  if (deps.env.devTools) {
    const v = Number(c.req.header(DEV_NOW_HEADER))
    if (Number.isFinite(v) && v > 0) return Math.floor(v)
  }
  return deps.clock()
}
