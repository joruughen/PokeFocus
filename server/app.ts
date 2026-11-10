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
import { createPushService, type PushSender, type PushService } from './push'
import { loadLiveEvents } from './content/events'
import { createContentService, type ContentService } from './content/service'
import { createSimRunner, type SimRunner } from './content/simRunner'
import { RateLimiter } from './rate-limit'
import { adminRoutes } from './routes/admin'
import { announcementRoutes } from './routes/announcements'
import { authRoutes } from './routes/auth'
import { configRoutes } from './routes/config'
import { contentRoutes } from './routes/content'
import { eventRoutes } from './routes/events'
import { gameRoutes } from './routes/game'
import { liveEventRoutes } from './routes/liveEvents'
import { groupRoutes } from './routes/groups'
import { pushRoutes } from './routes/push'
import { friendRoutes, leaderboardRoutes } from './routes/social'
import { weatherRoutes } from './routes/weather'
import { MEDIA_FILE_RE, readMedia, UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES } from './uploads'
import { createWeatherService, type FetchLike, type WeatherService } from './weather'

export const BODY_LIMIT = 64 * 1024
/** Admin live-content and live-event bodies (a whole patch: techniques, missions…). */
export const CONTENT_BODY_LIMIT = 512 * 1024
/** The one route that takes a raw image body (docs/admin-plan.md §3). */
export const UPLOAD_PATH = '/api/admin/uploads'

export interface AppOptions {
  env: Env
  db: Db
  bus?: EventBus
  limiter?: RateLimiter
  clock?: () => number
  /** Outbound HTTP for Open-Meteo (default: global fetch). */
  fetch?: FetchLike
  weather?: WeatherService
  /** Web Push service (default: built from env.vapid + `pushSender`). */
  push?: PushService
  /** Outbound push delivery (default: web-push); a fake in tests. */
  pushSender?: PushSender
  /** Live content service (default: built from `db` + `bus` + `clock`, with the published live events). */
  content?: ContentService
  /** Admin balance simulations (default: worker threads, 5 min timeout). */
  sim?: SimRunner
}

export function createApp(opts: AppOptions) {
  const clock = opts.clock ?? Date.now
  const fetchFn: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init))
  const bus = opts.bus ?? new EventBus()
  const deps: Deps = {
    env: opts.env,
    db: opts.db,
    bus,
    limiter: opts.limiter ?? new RateLimiter(),
    clock,
    fetch: fetchFn,
    weather: opts.weather ?? createWeatherService({ fetch: fetchFn, clock }),
    push: opts.push ?? createPushService({ env: opts.env, db: opts.db, clock, sender: opts.pushSender }),
    content: opts.content ?? createContentService({ db: opts.db, bus, clock, events: loadLiveEvents }),
    sim: opts.sim ?? createSimRunner({ db: opts.db, clock }),
  }
  const { env } = deps
  const app = new Hono<AppEnv>()

  app.use('*', secureHeaders())

  const api = new Hono<AppEnv>()
  const tooLarge = () => {
    throw new ApiError(413, 'body_too_large')
  }
  const defaultLimit = bodyLimit({ maxSize: BODY_LIMIT, onError: tooLarge })
  const contentLimit = bodyLimit({ maxSize: CONTENT_BODY_LIMIT, onError: tooLarge })
  const uploadLimit = bodyLimit({ maxSize: UPLOAD_MAX_BYTES, onError: tooLarge })
  api.use('*', (c, next) => {
    const p = c.req.path
    if (p === UPLOAD_PATH) return uploadLimit(c, next)
    return p.startsWith('/api/admin/content') || p.startsWith('/api/admin/events') ? contentLimit(c, next) : defaultLimit(c, next)
  })
  api.use('*', async (c, next) => {
    const m = c.req.method
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next()
    // CSRF: the Origin of every state-changing request must be ours…
    const origin = c.req.header('origin')?.replace(/\/+$/, '')
    if (!origin || !env.appOrigins.includes(origin)) throw new ApiError(403, 'bad_origin')
    // …and the body JSON (a cross-site <form> cannot send application/json). The only exception is the
    // image upload: a raw png/jpeg/webp body, which a form cannot send either (Origin is still checked).
    const ct = c.req.header('content-type') ?? ''
    const rawImage = m === 'POST' && c.req.path === UPLOAD_PATH && (UPLOAD_MIME_TYPES as readonly string[]).includes(ct.split(';')[0]!.trim().toLowerCase())
    if (!rawImage && !/^application\/json\s*(;|$)/i.test(ct)) throw new ApiError(415, 'json_required')
    return next()
  })
  api.route('/auth', authRoutes(deps))
  api.route('/game', gameRoutes(deps))
  api.route('/friends', friendRoutes(deps))
  api.route('/leaderboard', leaderboardRoutes(deps))
  api.route('/groups', groupRoutes(deps))
  api.route('/events', eventRoutes(deps))
  api.route('/weather', weatherRoutes(deps))
  api.route('/announcements', announcementRoutes(deps))
  api.route('/config', configRoutes(deps))
  api.route('/content', contentRoutes(deps))
  api.route('/live-events', liveEventRoutes(deps))
  api.route('/admin', adminRoutes(deps))
  api.route('/push', pushRoutes(deps))
  api.get('/health', (c) => c.json({ ok: true }))
  api.all('*', () => {
    throw new ApiError(404, 'not_found')
  })
  app.route('/api', api)

  // Sanitized event images (server/uploads.ts): the name is the hash of the content, so they are immutable.
  // Served in development too (not tied to env.production). Never HTML: fixed image/webp, nosniff, empty CSP.
  app.on(['GET', 'HEAD'], '/media/events/:file', async (c) => {
    const file = c.req.param('file')
    const bytes = MEDIA_FILE_RE.test(file) ? await readMedia(env.uploadsDir, file) : null
    if (!bytes) return c.json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' })
    const etag = `"${file.replace(/\.webp$/, '')}"`
    const headers: Record<string, string> = {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      ETag: etag,
    }
    if (c.req.header('if-none-match')?.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return c.body(null, 304, headers)
    const out = { ...headers, 'Content-Length': String(bytes.length) }
    return c.req.method === 'HEAD' ? c.body(null, 200, out) : c.body(new Uint8Array(bytes), 200, out)
  })

  if (env.production) {
    // Built client from the same origin (SPA fallback to index.html).
    const root = resolve(env.staticDir)
    const indexPath = resolve(root, 'index.html')
    const swPath = resolve(root, 'sw.js')
    // Service worker (Web Push): always revalidated, real JS MIME type, and never the
    // SPA index.html when missing (a registration must fail cleanly with 404).
    app.on(['GET', 'HEAD'], '/sw.js', (c) => {
      if (!existsSync(swPath)) return c.text('Not found', 404)
      c.header('Content-Type', 'text/javascript; charset=utf-8')
      c.header('Cache-Control', 'no-cache')
      return c.body(readFileSync(swPath))
    })
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
