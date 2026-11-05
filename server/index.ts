/**
 * Server entry: load env, open the database (migrations run on startup),
 * build the app and listen. See docs/server.md.
 */
import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { openDatabase } from './db/client'
import { loadEnv } from './env'
import { deleteExpiredSessions } from './routes/auth'

if (existsSync('.env')) process.loadEnvFile('.env')

const env = loadEnv()
const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir })
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

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  const db = database.driver === 'pglite' ? `PGlite (${env.pgliteDir})` : 'PostgreSQL'
  console.log(`[server] listening on http://localhost:${info.port} · ${env.nodeEnv} · ${db}${env.devTools ? ' · DEV_TOOLS=1' : ''}`)
  if (env.production && !env.cookieSecure) console.warn('[server] COOKIE_SECURE=0: session cookie without Secure — only serve this over an encrypted network (e.g. Tailscale)')
})

let stopping = false
const shutdown = (signal: string) => {
  if (stopping) return
  stopping = true
  console.log(`[server] ${signal}: shutting down`)
  clearInterval(timer)
  server.close()
  // Open SSE streams keep the HTTP server alive: don't wait for them.
  void database.close().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
