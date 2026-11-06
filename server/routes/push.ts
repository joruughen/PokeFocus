/**
 * /api/push/* — Web Push subscriptions of the logged-in user (contract: "Web Push"
 * in src/game/protocol.ts). All need the session cookie. Without VAPID keys,
 * /config answers { enabled: false } and the rest 404 push_disabled.
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { PushConfigResponse } from '../../src/game/protocol'
import { playerDocs } from '../db/schema'
import { ApiError, readBody, requireAuth, type AppEnv, type Ctx, type Deps } from '../http'
import { PUSH_ENDPOINT_MAX, localeOf, testPayload, type PushLocale } from '../push'
import { RULES, type RateRule } from '../rate-limit'

const subscribeBody = z.object({
  endpoint: z.string().min(1).max(PUSH_ENDPOINT_MAX),
  keys: z.object({
    p256dh: z.string().min(1).max(128),
    auth: z.string().min(1).max(128),
  }),
})

const unsubscribeBody = z.object({ endpoint: z.string().min(1).max(PUSH_ENDPOINT_MAX) })

export function pushRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  const { push, limiter } = deps
  app.use('*', requireAuth(deps))

  const guard = (c: Ctx, name: string, rule: RateRule) => {
    if (!push.enabled) throw new ApiError(404, 'push_disabled')
    const r = limiter.hit(`${name}:user:${c.get('user').id}`, rule)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
  }

  app.get('/config', (c) => {
    const body: PushConfigResponse = { enabled: push.enabled, publicKey: push.publicKey }
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  app.post('/subscribe', async (c) => {
    guard(c, 'push-write', RULES.pushWriteUser)
    const body = await readBody(c, subscribeBody)
    await push.subscribe(c.get('user').id, body, c.req.header('user-agent') ?? null)
    return c.body(null, 204)
  })

  app.post('/unsubscribe', async (c) => {
    guard(c, 'push-write', RULES.pushWriteUser)
    const body = await readBody(c, unsubscribeBody)
    await push.unsubscribe(c.get('user').id, body.endpoint)
    return c.body(null, 204)
  })

  app.post('/test', async (c) => {
    guard(c, 'push-test', RULES.pushTestUser)
    const userId = c.get('user').id
    const [row] = await deps.db.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, userId))
    // No player yet (starter not chosen): fall back to the browser language.
    const locale: PushLocale = row?.doc.player ? localeOf(row.doc) : /^es\b/i.test(c.req.header('accept-language') ?? '') ? 'es' : 'en'
    const r = await push.sendToUser(userId, testPayload(locale))
    if (r.sent + r.failed + r.removed === 0) throw new ApiError(409, 'no_subscription')
    return c.json({ sent: r.sent })
  })

  return app
}
