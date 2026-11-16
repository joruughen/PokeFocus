/**
 * Server configuration from environment variables (validated with zod).
 * See docs/server.md for the full list.
 */
import { z } from 'zod'
import { PEPPER_MIN, pepperSet, type PepperSet } from './auth/password'

const flag = z.enum(['0', '1']).default('0').transform((v) => v === '1')

const emptyAsUnset = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

/** Decoded byte length of a strict base64url string (no padding), or null when malformed. */
export function base64urlLength(s: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return null
  return Buffer.from(s, 'base64url').length
}

/** An uncompressed P-256 point is 65 bytes starting with 0x04. */
const isUncompressedPoint = (v: string) => base64urlLength(v) === 65 && Buffer.from(v, 'base64url')[0] === 0x04

/** VAPID keys (Web Push). Issues never echo the value (the private key is a secret). */
const vapidKey = (bytes: number, hint: string) =>
  z.preprocess(
    emptyAsUnset,
    z
      .string()
      .refine((v) => (bytes === 65 ? isUncompressedPoint(v.trim()) : base64urlLength(v.trim()) === bytes), {
        message: `must be a base64url ${hint} (${bytes} bytes); generate a pair with npm run vapid`,
      })
      .transform((v) => v.trim())
      .optional(),
  )

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
  /**
   * Where uploaded event images live (re-encoded by sharp, served at /media/events/…).
   * Back this directory up together with PostgreSQL: the database only holds their metadata.
   */
  UPLOADS_DIR: z.string().min(1).default('.data/uploads'),
  /**
   * `Secure` flag on the session cookie. auto = on in production. Set 0 only when
   * the site is served over plain HTTP inside an already-encrypted network
   * (e.g. http://<tailscale-ip>:8787); browsers drop Secure cookies over http.
   */
  COOKIE_SECURE: z.enum(['auto', '0', '1']).default('auto'),
  /**
   * Seconds-scale cache (ms) of the global and country leaderboard tops, shared by all players.
   * Unset = 10000 in production, 0 (off) elsewhere so tests and dev see every change at once.
   */
  /** Max simultaneous SSE connections per player (the oldest is closed when exceeded; several tabs are fine). */
  MAX_SSE_PER_USER: z.coerce.number().int().min(1).max(50).default(6),
  /** Max SSE connections in this process (each costs ~200 KB). Over it: 503 server_busy. */
  MAX_SSE_TOTAL: z.coerce.number().int().min(1).default(10_000),
  /** Max API requests being served at once (not SSE or /health). Over it: 503 server_busy + Retry-After. 0 = off. */
  MAX_INFLIGHT: z.coerce.number().int().min(0).default(400),
  LEADERBOARD_CACHE_MS: z.coerce.number().int().min(0).max(600_000).optional(),
  /**
   * Bearer token of the admin API (/api/admin/*, scheduled maintenance notices).
   * Unset or empty = admin API off. When set it must be at least 24 characters
   * (e.g. `openssl rand -hex 24`). Never logged.
   */
  ADMIN_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(24, 'must be at least 24 characters (e.g. openssl rand -hex 24)').optional(),
  ),
  /**
   * Comma-separated emails promoted to role `admin` at start-up (idempotent, audited as
   * actor 'system'). The accounts must already exist. Unknown emails are ignored.
   */
  ADMIN_EMAILS: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .transform((v) => v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
      .pipe(z.array(z.string().max(254).refine((e) => /^[^\s@]+@[^\s@]+$/.test(e), { message: 'must be a comma-separated list of emails' })))
      .optional(),
  ),
  /**
   * Server-side secret mixed into every password hash (HMAC before scrypt). Required in
   * production; generate it with `npm run pepper`. Never logged. Losing or changing it
   * without PASSWORD_PEPPER_PREVIOUS locks every peppered account out.
   */
  PASSWORD_PEPPER: z.preprocess(
    emptyAsUnset,
    z.string().trim().min(PEPPER_MIN, `must be at least ${PEPPER_MIN} characters (generate one with npm run pepper)`).optional(),
  ),
  /** Comma-separated older peppers still accepted while rotating (hashes upgrade on login). */
  PASSWORD_PEPPER_PREVIOUS: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.string().min(PEPPER_MIN, `each previous pepper must be at least ${PEPPER_MIN} characters`)))
      .optional(),
  ),
  /** Web Push (VAPID). All three or none; none = push disabled (404 push_disabled). */
  VAPID_PUBLIC_KEY: vapidKey(65, 'uncompressed P-256 public key'),
  VAPID_PRIVATE_KEY: vapidKey(32, 'P-256 private key'),
  VAPID_SUBJECT: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .trim()
      .max(256)
      .refine((v) => /^mailto:[^\s@]+@[^\s@]+$/.test(v) || /^https:\/\/[^\s/]+/.test(v), { message: 'must start with mailto: or https://' })
      .optional(),
  ),
}).superRefine((e, ctx) => {
  if (e.NODE_ENV === 'production' && !e.PASSWORD_PEPPER) {
    ctx.addIssue({ code: 'custom', path: ['PASSWORD_PEPPER'], message: 'required in production (generate one with npm run pepper)' })
  }
  if (e.PASSWORD_PEPPER && e.PASSWORD_PEPPER_PREVIOUS?.includes(e.PASSWORD_PEPPER)) {
    ctx.addIssue({ code: 'custom', path: ['PASSWORD_PEPPER_PREVIOUS'], message: 'must not contain the current PASSWORD_PEPPER' })
  }
  const set = [e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT].filter((v) => v !== undefined).length
  if (set !== 0 && set !== 3) {
    ctx.addIssue({ code: 'custom', path: ['VAPID_*'], message: 'set all three of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none' })
  }
})

export interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export interface Env {
  nodeEnv: 'development' | 'production' | 'test'
  /** Shared cache of the global/country leaderboard top and total (ms; 0 = off). */
  leaderboardCacheMs: number
  maxSsePerUser: number
  maxSseTotal: number
  maxInflight: number
  production: boolean
  port: number
  databaseUrl: string | undefined
  pgliteDir: string
  appOrigins: string[]
  devTools: boolean
  trustProxy: boolean
  staticDir: string
  /** Directory of the uploaded event images (UPLOADS_DIR). */
  uploadsDir: string
  cookieSecure: boolean
  /** Admin API token; undefined = admin API disabled (404 admin_disabled). */
  adminToken: string | undefined
  /** Emails promoted to admin at start-up (lower-case). */
  adminEmails: string[]
  /** Web Push keys; null = push disabled. Never logged. */
  vapid: VapidConfig | null
  /** Password peppers (current + rotation); never logged. */
  passwordPeppers: PepperSet
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
    maxSsePerUser: e.MAX_SSE_PER_USER,
    maxSseTotal: e.MAX_SSE_TOTAL,
    maxInflight: e.MAX_INFLIGHT,
    leaderboardCacheMs: e.LEADERBOARD_CACHE_MS ?? (production ? 10_000 : 0),
    production,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    appOrigins: e.APP_ORIGIN.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    // Never in production, whatever the variable says.
    devTools: production ? false : e.DEV_TOOLS,
    trustProxy: e.TRUST_PROXY,
    staticDir: e.STATIC_DIR,
    uploadsDir: e.UPLOADS_DIR,
    cookieSecure: e.COOKIE_SECURE === 'auto' ? production : e.COOKIE_SECURE === '1',
    adminToken: e.ADMIN_TOKEN,
    adminEmails: [...new Set(e.ADMIN_EMAILS ?? [])],
    vapid:
      e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && e.VAPID_SUBJECT
        ? { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT }
        : null,
    passwordPeppers: pepperSet(e.PASSWORD_PEPPER, e.PASSWORD_PEPPER_PREVIOUS),
  }
}
