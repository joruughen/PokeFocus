/**
 * Builds the Hono app (no listening, no timers): used by server/index.ts and by
 * the integration tests through `app.request()`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Env } from './env'
import type { Db } from './db/client'
import { EventBus } from './events'
import { ApiError, type AppEnv, type Deps } from './http'
import { RateLimiter } from './rate-limit'
import { authRoutes } from './routes/auth'
import { eventRoutes } from './routes/events'
import { gameRoutes } from './routes/game'
import { groupRoutes } from './routes/groups'
import { friendRoutes, leaderboardRoutes } from './routes/social'

export const BODY_LIMIT = 64 * 1024

export interface AppOptions {
  env: Env
  db: Db
  bus?: EventBus
  limiter?: RateLimiter
  clock?: () => number
}

export function createApp(opts: AppOptions) {
  const deps: Deps = {
    env: opts.env,
    db: opts.db,
    bus: opts.bus ?? new EventBus(),
    limiter: opts.limiter ?? new RateLimiter(),
    clock: opts.clock ?? Date.now,
  }
  const { env } = deps
  const app = new Hono<AppEnv>()

  app.use('*', secureHeaders())

  const api = new Hono<AppEnv>()
  api.use('*', bodyLimit({ maxSize: BODY_LIMIT, onError: () => { throw new ApiError(413, 'body_too_large') } }))
  api.use('*', async (c, next) => {
    const m = c.req.method
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next()
    // CSRF: the Origin of every state-changing request must be ours…
    const origin = c.req.header('origin')?.replace(/\/+$/, '')
    if (!origin || !env.appOrigins.includes(origin)) throw new ApiError(403, 'bad_origin')
    // …and the body JSON (a cross-site <form> cannot send application/json).
    const ct = c.req.header('content-type') ?? ''
    if (!/^application\/json\s*(;|$)/i.test(ct)) throw new ApiError(415, 'json_required')
    return next()
  })
  api.route('/auth', authRoutes(deps))
  api.route('/game', gameRoutes(deps))
  api.route('/friends', friendRoutes(deps))
  api.route('/leaderboard', leaderboardRoutes(deps))
  api.route('/groups', groupRoutes(deps))
  api.route('/events', eventRoutes(deps))
  api.get('/health', (c) => c.json({ ok: true }))
  api.all('*', () => {
    throw new ApiError(404, 'not_found')
  })
  app.route('/api', api)

  if (env.production) {
    // Built client from the same origin (SPA fallback to index.html).
    const root = resolve(env.staticDir)
    const indexPath = resolve(root, 'index.html')
    app.use('/*', serveStatic({ root: env.staticDir }))
    app.get('*', (c) => {
      if (!existsSync(indexPath)) return c.text('Client not built (run npm run build)', 404)
      c.header('Cache-Control', 'no-cache')
      return c.html(readFileSync(indexPath, 'utf8'))
    })
  }

  app.onError((e, c) => {
    if (e instanceof ApiError) {
      return c.json({ error: e.code, ...e.extra }, e.status)
    }
    console.error('[server] unhandled error', e)
    return c.json({ error: 'internal' }, 500)
  })
  app.notFound((c) => c.json({ error: 'not_found' }, 404))

  return { app, deps }
}
