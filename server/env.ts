/**
 * Server configuration from environment variables (validated with zod).
 * See docs/server.md for the full list.
 */
import { z } from 'zod'

const flag = z.enum(['0', '1']).default('0').transform((v) => v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** postgres://… — when set, PostgreSQL via postgres-js; otherwise embedded PGlite. */
  DATABASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  /** PGlite data directory (dev). `memory://` keeps it in memory. */
  PGLITE_DIR: z.string().min(1).default('.data/pglite'),
  /** Comma-separated list of allowed origins for non-GET requests (CSRF check). */
  APP_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  /** Dev tools: x-dev-now / x-dev-seed headers and dev* actions. Always off in production. */
  DEV_TOOLS: flag,
  /** Behind a reverse proxy: take the client IP from the last X-Forwarded-For entry. */
  TRUST_PROXY: flag,
  /** Built client served in production (SPA fallback). */
  STATIC_DIR: z.string().min(1).default('dist'),
})

export interface Env {
  nodeEnv: 'development' | 'production' | 'test'
  production: boolean
  port: number
  databaseUrl: string | undefined
  pgliteDir: string
  appOrigins: string[]
  devTools: boolean
  trustProxy: boolean
  staticDir: string
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${msg}`)
  }
  const e = parsed.data
  const production = e.NODE_ENV === 'production'
  return {
    nodeEnv: e.NODE_ENV,
    production,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    appOrigins: e.APP_ORIGIN.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    // Never in production, whatever the variable says.
    devTools: production ? false : e.DEV_TOOLS,
    trustProxy: e.TRUST_PROXY,
    staticDir: e.STATIC_DIR,
  }
}
