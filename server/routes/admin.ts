/**
 * /api/admin — operator endpoints, guarded by `Authorization: Bearer <ADMIN_TOKEN>`.
 *
 *   GET    /admin/maintenance      → AdminMaintenanceResponse (windows that have not ended)
 *   POST   /admin/maintenance      { startsAt, endsAt, note? } → 201 { item }
 *   DELETE /admin/maintenance/:id  → 204
 *
 * Checks, in order: ADMIN_TOKEN unset → 404 admin_disabled; per-IP rate limit
 * (every request counts, a valid token clears it) → 429 rate_limited; token →
 * 401 unauthorized. Maintenance windows are informational only (see
 * routes/announcements.ts): nothing here blocks requests.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { count, eq, gt } from 'drizzle-orm'
import type { AdminMaintenanceResponse } from '../../src/game/protocol'
import { maintenanceWindows } from '../db/schema'
import { ApiError, clientIp, readBody, UUID_RE, type AppEnv, type Ctx, type Deps } from '../http'
import { RULES } from '../rate-limit'
import { maintenanceCreateBody } from '../validation'
import { activeMaintenance, toMaintenanceItem } from './announcements'

/** Windows that have not ended yet, at most. */
export const MAX_ACTIVE_WINDOWS = 20

const sha256 = (s: string) => createHash('sha256').update(s).digest()

/** Constant-time comparison: equal-length digests, so neither length nor content leaks. */
function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected))
}

function bearerToken(c: Ctx): string {
  const m = /^Bearer\s+(.+?)\s*$/i.exec(c.req.header('authorization') ?? '')
  return m?.[1] ?? ''
}

export function adminRoutes(deps: Deps) {
  const { db, env, limiter } = deps
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const expected = env.adminToken
    if (!expected) throw new ApiError(404, 'admin_disabled')
    const key = `admin:ip:${clientIp(c, env.trustProxy)}`
    const r = limiter.hit(key, RULES.adminIp)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
    if (!tokenMatches(bearerToken(c), expected)) throw new ApiError(401, 'unauthorized')
    // A legitimate admin is never locked out by earlier typos.
    limiter.reset(key)
    await next()
  })

  app.get('/maintenance', async (c) => {
    const now = deps.clock()
    const rows = await activeMaintenance(deps, now)
    const body: AdminMaintenanceResponse = { items: rows.map(toMaintenanceItem), serverNow: now }
    return c.json(body)
  })

  app.post('/maintenance', async (c) => {
    const now = deps.clock()
    const body = await readBody(c, maintenanceCreateBody(now))
    const [open] = await db.select({ n: count() }).from(maintenanceWindows).where(gt(maintenanceWindows.endsAt, new Date(now)))
    if ((open?.n ?? 0) >= MAX_ACTIVE_WINDOWS) throw new ApiError(409, 'too_many')
    const [row] = await db
      .insert(maintenanceWindows)
      .values({ startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), note: body.note, createdAt: new Date(now) })
      .returning()
    return c.json({ item: toMaintenanceItem(row!) }, 201)
  })

  app.delete('/maintenance/:id', async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    const gone = await db.delete(maintenanceWindows).where(eq(maintenanceWindows.id, id)).returning({ id: maintenanceWindows.id })
    if (gone.length === 0) throw new ApiError(404, 'not_found')
    return c.body(null, 204)
  })

  return app
}
