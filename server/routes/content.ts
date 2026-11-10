/**
 * GET /api/content — public (the splash needs it before login): the live
 * content active now, `ETag: "<hash>"` + `Cache-Control: no-cache` (304 when
 * `If-None-Match` matches).
 * GET /api/content/:hash — the content a session pinned. Immutable by hash
 * (`public, max-age=31536000, immutable`), except `base`, whose meaning moves
 * with each deploy (no-cache). 404 `unknown_content`. Drafts never show here:
 * only published versions and published events are ever resolved.
 */
import { Hono } from 'hono'
import { ApiError, gameTime, type AppEnv, type Ctx, type Deps } from '../http'
import { contentBody, HASH_RE, type ResolvedContent } from '../content/service'

function etagMatches(c: Ctx, etag: string): boolean {
  const inm = c.req.header('if-none-match')
  if (!inm) return false
  return inm.split(',').some((t) => {
    const v = t.trim().replace(/^W\//, '')
    return v === etag || v === '*'
  })
}

function reply(c: Ctx, r: ResolvedContent, cacheControl: string) {
  const etag = `"${r.hash}"`
  c.header('ETag', etag)
  c.header('Cache-Control', cacheControl)
  if (etagMatches(c, etag)) return c.body(null, 304)
  return c.json(contentBody(r))
}

export function contentRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => reply(c, await deps.content.current(gameTime(deps, c)), 'no-cache'))

  app.get('/:hash', async (c) => {
    const hash = c.req.param('hash')
    if (!HASH_RE.test(hash)) throw new ApiError(404, 'unknown_content')
    const r = await deps.content.byHash(hash)
    if (!r) throw new ApiError(404, 'unknown_content')
    return reply(c, r, hash === 'base' ? 'no-cache' : 'public, max-age=31536000, immutable')
  })

  return app
}
