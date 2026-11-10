/**
 * Server entry: load env, open the database (migrations run on startup),
 * build the app and listen; hourly session cleanup and the Web Push scheduler
 * (every 15 s, only with VAPID keys). See docs/server.md.
 */
import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { openDatabase } from './db/client'
import { loadEnv } from './env'
import { promoteAdminEmails } from './admin/roles'
import { deleteExpiredSessions } from './routes/auth'

if (existsSync('.env')) process.loadEnvFile('.env')

const env = loadEnv()
const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir })
if (env.adminEmails.length > 0) {
  const { promoted, missing } = await promoteAdminEmails(database.db, env.adminEmails)
  if (promoted.length > 0) console.log(`[server] ADMIN_EMAILS: promoted ${promoted.length} account(s) to admin`)
  if (missing.length > 0) console.warn(`[server] ADMIN_EMAILS: ${missing.length} email(s) have no account yet (register first, then restart)`)
}
const { app, deps } = createApp({ env, db: database.db })

const HOUR = 3_600_000
const cleanup = async () => {
  try {
    const n = await deleteExpiredSessions(database.db, Date.now())
    if (n > 0) console.log(`[server] removed ${n} expired session(s)`)
  } catch (e) {
    console.error('[server] session cleanup failed', e)
  }
  deps.limiter.sweep()
}
void cleanup()
const timer = setInterval(cleanup, HOUR)
timer.unref()

// Web Push fallback for the end-of-session notice (server/push.ts). Single instance:
// two servers on one database would still send at most once (push_sent), but the
// in-memory parts (event bus, rate limiter) already assume one process.
const PUSH_TICK_MS = 15_000
let pushRunning = false
const pushTick = async () => {
  if (pushRunning) return // a slow run (push service timeouts) must not overlap the next tick
  pushRunning = true
  try {
    const n = await deps.push.runDue()
    if (n > 0) console.log(`[push] sent ${n} session-end notification(s)`)
  } catch (e) {
    console.error('[push] scheduler run failed:', e instanceof Error ? e.message : 'unknown error')
  } finally {
    pushRunning = false
  }
}
const pushTimer = deps.push.enabled ? setInterval(pushTick, PUSH_TICK_MS) : null
pushTimer?.unref()

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  const db = database.driver === 'pglite' ? `PGlite (${env.pgliteDir})` : 'PostgreSQL'
  console.log(`[server] listening on http://localhost:${info.port} · ${env.nodeEnv} · ${db}${env.devTools ? ' · DEV_TOOLS=1' : ''}`)
  console.log(`[server] web push ${deps.push.enabled ? 'enabled' : 'disabled (no VAPID keys; npm run vapid)'}`)
  if (env.production && !env.cookieSecure) console.warn('[server] COOKIE_SECURE=0: session cookie without Secure — only serve this over an encrypted network (e.g. Tailscale)')
})

let stopping = false
const shutdown = (signal: string) => {
  if (stopping) return
  stopping = true
  console.log(`[server] ${signal}: shutting down`)
  clearInterval(timer)
  if (pushTimer) clearInterval(pushTimer)
  server.close()
  // Open SSE streams keep the HTTP server alive: don't wait for them.
  void database.close().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
