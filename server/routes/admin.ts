/**
 * /api/admin — operator endpoints (docs/admin-plan.md §4).
 *
 *   GET    /admin/me               → AdminMeResponse (role support|admin; sudo state)
 *   POST   /admin/reauth           { password } → AdminMeResponse; sudo for 30 min
 *   GET    /admin/maintenance      → AdminMaintenanceResponse (windows that have not ended)
 *   POST   /admin/maintenance      { startsAt, endsAt, note? } → 201 { item }      (audited)
 *   DELETE /admin/maintenance/:id  → 204                                            (audited)
 *
 * `me` / `reauth`: session cookie → role support or admin (403 forbidden otherwise) →
 * per-user rate limit. Maintenance accepts a signed-in admin (cookie) OR, when an
 * Authorization header is sent, the legacy ADMIN_TOKEN (deprecated; audited as
 * actor_label 'token'). Token checks, in order: ADMIN_TOKEN unset → 404 admin_disabled;
 * per-IP rate limit (every request counts, a valid token clears it) → 429; token →
 * 401. Maintenance windows are informational only (see routes/announcements.ts).
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { count, eq, gt } from 'drizzle-orm'
import type { AdminMaintenanceResponse, AdminMeResponse, UserRole } from '../../src/game/protocol'
import { maintenanceWindows } from '../db/schema'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { audit } from '../admin/audit'
import { PASSWORD_MAX, verifyPassword } from '../auth/password'
import { authSessions } from '../db/schema'
import { ApiError, clientIp, readBody, requireAuth, requireRole, sessionToken, UUID_RE, type AppEnv, type Ctx, type Deps } from '../http'
import { RULES } from '../rate-limit'
import { maintenanceCreateBody } from '../validation'
import { activeMaintenance, toMaintenanceItem } from './announcements'

/** Sudo mode lifetime after POST /admin/reauth. */
export const ELEVATION_MS = 30 * 60_000

const reauthBody = z.object({ password: z.string().min(1).max(PASSWORD_MAX) })

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

  const limit = (c: Ctx, key: string, rule: (typeof RULES)[keyof typeof RULES]) => {
    const r = limiter.hit(key, rule)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
  }

  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.set('ip', clientIp(c, env.trustProxy))
    await next()
  })

  /** Signed-in staff: session cookie, role at least `min`, per-user rate limit. */
  const staff = (min: 'support' | 'admin'): MiddlewareHandler<AppEnv> => {
    const auth = requireAuth(deps)
    const role = requireRole(min)
    return (c, next) =>
      auth(c, async () => {
        await role(c, async () => {
          limit(c, `admin:user:${c.get('user').id}`, RULES.adminUser)
          await next()
        })
      })
  }

  const meBody = (role: UserRole, elevatedUntil: Date | null, now: number): AdminMeResponse => {
    const until = elevatedUntil?.getTime() ?? 0
    return { role, elevated: until > now, elevatedUntil: until > now ? until : null, serverNow: now }
  }

  app.get('/me', staff('support'), (c) => c.json(meBody(c.get('user').role, c.get('session').elevatedUntil, deps.clock())))

  app.post('/reauth', staff('support'), async (c) => {
    const { password } = await readBody(c, reauthBody)
    const me = c.get('user')
    const now = deps.clock()
    limit(c, `admin:reauth:${me.id}`, RULES.adminReauthUser)
    if (!(await verifyPassword(password, me.passwordHash, env.passwordPeppers))) throw new ApiError(403, 'wrong_password')
    limiter.reset(`admin:reauth:${me.id}`)
    const until = new Date(now + ELEVATION_MS)
    await db.transaction(async (tx) => {
      await tx.update(authSessions).set({ elevatedUntil: until }).where(eq(authSessions.id, c.get('session').id))
      await audit(tx, c, { action: 'admin.reauth', targetType: 'session', targetId: c.get('session').id, after: { elevatedUntil: until.getTime() } })
    })
    return c.json(meBody(me.role, until, now))
  })

  /**
   * Maintenance: a signed-in admin (cookie, no Authorization header) or the legacy
   * ADMIN_TOKEN (deprecated). A request carrying Authorization is always a token request.
   */
  const token: MiddlewareHandler<AppEnv> = async (c, next) => {
    const expected = env.adminToken
    if (!expected) throw new ApiError(404, 'admin_disabled')
    const key = `admin:ip:${c.get('ip')}`
    limit(c, key, RULES.adminIp)
    if (!tokenMatches(bearerToken(c), expected)) throw new ApiError(401, 'unauthorized')
    // A legitimate admin is never locked out by earlier typos.
    limiter.reset(key)
    c.set('actorLabel', 'token')
    await next()
  }
  const adminUser = staff('admin')
  const maintenanceAuth: MiddlewareHandler<AppEnv> = (c, next) =>
    !c.req.header('authorization') && sessionToken(c) ? adminUser(c, next) : token(c, next)

  app.get('/maintenance', maintenanceAuth, async (c) => {
    const now = deps.clock()
    const rows = await activeMaintenance(deps, now)
    const body: AdminMaintenanceResponse = { items: rows.map(toMaintenanceItem), serverNow: now }
    return c.json(body)
  })

  app.post('/maintenance', maintenanceAuth, async (c) => {
    const now = deps.clock()
    const body = await readBody(c, maintenanceCreateBody(now))
    const item = await db.transaction(async (tx) => {
      const [open] = await tx.select({ n: count() }).from(maintenanceWindows).where(gt(maintenanceWindows.endsAt, new Date(now)))
      if ((open?.n ?? 0) >= MAX_ACTIVE_WINDOWS) throw new ApiError(409, 'too_many')
      const [row] = await tx
        .insert(maintenanceWindows)
        .values({ startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), note: body.note, createdAt: new Date(now) })
        .returning()
      const item = toMaintenanceItem(row!)
      await audit(tx, c, { action: 'maintenance.create', targetType: 'maintenance', targetId: item.id, after: item })
      return item
    })
    return c.json({ item }, 201)
  })

  app.delete('/maintenance/:id', maintenanceAuth, async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    await db.transaction(async (tx) => {
      const gone = await tx.delete(maintenanceWindows).where(eq(maintenanceWindows.id, id)).returning()
      if (gone.length === 0) throw new ApiError(404, 'not_found')
      await audit(tx, c, { action: 'maintenance.delete', targetType: 'maintenance', targetId: id, before: toMaintenanceItem(gone[0]!) })
    })
    return c.body(null, 204)
  })

  return app
}
