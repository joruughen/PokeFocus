/**
 * GET /api/events — Server-Sent Events. Each message is an unnamed SSE event
 * (`onmessage`) whose `data` is a JSON `ServerEvent`. A `: ping` comment every
 * 25 s keeps proxies from closing the connection.
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { ApiError, requireAuth, type AppEnv, type Deps } from '../http'
import { RULES } from '../rate-limit'

export const PING_MS = 25_000

export function eventRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.get('/', requireAuth(deps), (c) => {
    const user = c.get('user')
    const session = c.get('session')
    // Protection: a bounded number of connections per player and per process (each one costs memory).
    const r = deps.limiter.hit(`sse:${user.id}`, RULES.sseConnectUser)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
    if (deps.bus.count() >= deps.env.maxSseTotal) {
      c.header('Retry-After', '10')
      throw new ApiError(503, 'server_busy')
    }
    if (deps.bus.count(user.id) >= deps.env.maxSsePerUser) deps.bus.evictOldest(user.id)
    c.header('X-Accel-Buffering', 'no') // nginx-style proxies: do not buffer
    c.header('Cache-Control', 'no-cache, no-transform')
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        let open = true
        const finish = () => {
          if (!open) return
          open = false
          clearInterval(ping)
          unsubscribe()
          resolve()
        }
        const unsubscribe = deps.bus.subscribe({
          userId: user.id,
          sessionId: session.id,
          send: (ev) => {
            if (open) stream.writeSSE({ data: JSON.stringify(ev) }).catch(finish)
          },
          close: () => {
            // let the pending `logout` write flush before ending the stream
            setTimeout(finish, 50)
          },
        })
        const ping = setInterval(() => {
          stream.write(': ping\n\n').catch(finish)
        }, PING_MS)
        stream.onAbort(finish)
        // Reconnect delay + an initial comment so proxies flush the headers now.
        stream.write('retry: 5000\n: connected\n\n').catch(finish)
      })
    })
  })
  return app
}
