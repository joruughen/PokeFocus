/**
 * Web Push: the server-side fallback for the end-of-session notification
 * (contract: "Web Push" in src/game/protocol.ts, docs/server.md § Web Push).
 *
 * The page notifies by itself when it is alive and then sets `timer.notified`.
 * A frozen hidden tab cannot, so `runDue()` (every 15 s from server/index.ts)
 * pushes through the browser's push service when the page did not notify within
 * PUSH_GRACE_MS. `push_sent` makes it at most once per (user, session), also
 * across restarts. Single instance assumed (like the in-memory event bus).
 *
 * Never log endpoints or keys: an endpoint is a bearer capability to notify a browser.
 */
import { and, eq, ne, sql } from 'drizzle-orm'
import webpush from 'web-push'
import { defaultContext } from '../src/engine'
import {
  MAX_PUSH_SUBSCRIPTIONS,
  PUSH_GRACE_MS,
  PUSH_MAX_AGE_MS,
  PUSH_TAG,
  type GameDoc,
  type PushPayload,
  type PushSubscribeRequest,
  type SessionTimer,
} from '../src/game/protocol'
import type { Db } from './db/client'
import { playerDocs, pushSent, pushSubscriptions } from './db/schema'
import { base64urlLength, type Env, type VapidConfig } from './env'
import { ApiError } from './http'

export const PUSH_ENDPOINT_MAX = 2048
/** Per-subscription deadline of one delivery (our race; web-push also gets a socket timeout). */
export const PUSH_SEND_TIMEOUT_MS = 10_000
/** Deliveries of one session-end push before giving up on all-transient failures. */
export const PUSH_MAX_ATTEMPTS = 3
/** Due sessions handled per runDue() call (the next tick picks up the rest). */
const DUE_BATCH = 200

/**
 * Real push services, matched by exact host or dot-suffix (SSRF guard: the server
 * only ever POSTs to these). FCM (Chrome/Edge/Opera…), Mozilla autopush, Apple, WNS.
 */
export const PUSH_HOST_SUFFIXES = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'] as const

export function isAllowedPushHost(host: string): boolean {
  const h = host.toLowerCase()
  return PUSH_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))
}

/** Null when the endpoint is acceptable, otherwise a short reason (for tests; the API answers invalid_body). */
export function endpointProblem(endpoint: string): string | null {
  if (endpoint.length > PUSH_ENDPOINT_MAX) return 'too_long'
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    return 'not_url'
  }
  if (u.protocol !== 'https:') return 'not_https'
  if (u.username || u.password) return 'credentials'
  if (u.port !== '' && u.port !== '443') return 'port'
  if (!isAllowedPushHost(u.hostname)) return 'host'
  return null
}

const keyOk = (v: string, bytes: number) => v.length <= 128 && base64urlLength(v.replace(/=+$/, '')) === bytes

export function subscriptionProblem(req: PushSubscribeRequest): string | null {
  const e = endpointProblem(req.endpoint)
  if (e) return e
  if (!keyOk(req.keys.p256dh, 65) || Buffer.from(req.keys.p256dh, 'base64url')[0] !== 0x04) return 'p256dh'
  if (!keyOk(req.keys.auth, 16)) return 'auth'
  return null
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface PushTarget {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * Delivers one encrypted payload. Resolves on 2xx; rejects otherwise, with
 * `statusCode` when the push service answered (web-push's WebPushError has it).
 */
export type PushSender = (target: PushTarget, payload: string, opts: { ttlSeconds: number }) => Promise<unknown>

export function webPushSender(vapid: VapidConfig): PushSender {
  return (target, payload, opts) =>
    webpush.sendNotification(target, payload, {
      vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: opts.ttlSeconds,
      urgency: 'high',
      timeout: PUSH_SEND_TIMEOUT_MS,
    })
}

type Outcome = 'sent' | 'gone' | 'transient' | 'permanent'

function classify(e: unknown): Outcome {
  const code = typeof e === 'object' && e !== null ? (e as { statusCode?: unknown }).statusCode : undefined
  if (typeof code !== 'number') return 'transient' // network error, timeout, throw before the request
  if (code === 404 || code === 410) return 'gone'
  if (code === 429 || code >= 500) return 'transient'
  return 'permanent' // 400 / 401 / 403 / 413: our request or keys are wrong; retrying will not help
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('push timeout')), ms)
    timer.unref?.()
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

export interface SendResult {
  sent: number
  failed: number
  removed: number
  /** Failures that may succeed later (network, timeout, 429, 5xx). Included in `failed`. */
  transient: number
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type PushLocale = 'es' | 'en'

export const localeOf = (doc: GameDoc | null | undefined): PushLocale => (doc?.player?.profile.locale === 'es' ? 'es' : 'en')

export function sessionEndPayload(locale: PushLocale, claimWindowMinutes = defaultContext().config.session.claimWindowMinutes): PushPayload {
  const n = claimWindowMinutes
  const [title, body] =
    locale === 'es'
      ? ['¡Sesión completa!', `Reclama tus recompensas en ${n === 1 ? 'el próximo minuto' : `los próximos ${n} minutos`}.`]
      : ['Session complete!', `Claim your rewards within the next ${n === 1 ? 'minute' : `${n} minutes`}.`]
  return { type: 'session-end', title, body, tag: PUSH_TAG, url: '/' }
}

export function testPayload(locale: PushLocale): PushPayload {
  const [title, body] =
    locale === 'es'
      ? ['Avisos activados', 'Así te avisaremos cuando termine tu sesión.']
      : ['Notifications are on', 'This is how we will tell you when your session ends.']
  return { type: 'test', title, body, tag: PUSH_TAG, url: '/' }
}

/** The contract rule for one timer (the SQL in runDue is the same condition; this re-checks it). */
export function isDue(timer: SessionTimer | null | undefined, now: number): timer is SessionTimer {
  return (
    !!timer &&
    typeof timer.sessionId === 'string' &&
    typeof timer.endsAt === 'number' &&
    timer.pausedAt === null &&
    timer.notified !== true &&
    now >= timer.endsAt + PUSH_GRACE_MS &&
    timer.endsAt > now - PUSH_MAX_AGE_MS
  )
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PushService {
  enabled: boolean
  publicKey: string | null
  /** Upsert by endpoint (moves it to `userId` if another user had it). 400 invalid_body, 409 too_many. */
  subscribe(userId: string, req: PushSubscribeRequest, userAgent?: string | null): Promise<void>
  /** Removes the caller's own subscription for `endpoint` (no-op otherwise). */
  unsubscribe(userId: string, endpoint: string): Promise<void>
  sendToUser(userId: string, payload: PushPayload): Promise<SendResult>
  /** Scheduler body: pushes every due session-end once. Returns how many sessions got a push. */
  runDue(): Promise<number>
}

export interface PushServiceOptions {
  env: Env
  db: Db
  clock: () => number
  /** Default: web-push with env.vapid. Tests inject a fake (no network). */
  sender?: PushSender
}

export function createPushService(opts: PushServiceOptions): PushService {
  const { db, clock } = opts
  const vapid = opts.env.vapid
  const sender: PushSender | null = opts.sender ?? (vapid ? webPushSender(vapid) : null)
  const enabled = !!vapid && !!sender
  const claimWindowMinutes = defaultContext().config.session.claimWindowMinutes
  // A push that arrives after the claim window is useless.
  const ttlSeconds = Math.max(60, Math.round(claimWindowMinutes * 60))

  const disabled = () => new ApiError(404, 'push_disabled')

  async function subscribe(userId: string, req: PushSubscribeRequest, userAgent?: string | null) {
    if (!enabled) throw disabled()
    if (subscriptionProblem(req)) throw new ApiError(400, 'invalid_body', { fields: ['endpoint'] })
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), ne(pushSubscriptions.endpoint, req.endpoint)))
    if ((row?.n ?? 0) >= MAX_PUSH_SUBSCRIPTIONS) throw new ApiError(409, 'too_many')
    const values = {
      userId,
      endpoint: req.endpoint,
      p256dh: req.keys.p256dh,
      auth: req.keys.auth,
      userAgent: userAgent ? userAgent.slice(0, 256) : null,
    }
    await db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: values.userId, p256dh: values.p256dh, auth: values.auth, userAgent: values.userAgent },
      })
  }

  async function unsubscribe(userId: string, endpoint: string) {
    if (!enabled) throw disabled()
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
  }

  async function sendToUser(userId: string, payload: PushPayload): Promise<SendResult> {
    const result: SendResult = { sent: 0, failed: 0, removed: 0, transient: 0 }
    if (!enabled || !sender) return result
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
    const body = JSON.stringify(payload)
    await Promise.all(
      subs.map(async (s) => {
        let outcome: Outcome
        try {
          await withTimeout(Promise.resolve().then(() => sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { ttlSeconds })), PUSH_SEND_TIMEOUT_MS)
          outcome = 'sent'
        } catch (e) {
          outcome = classify(e)
        }
        try {
          if (outcome === 'sent') {
            result.sent++
            await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(clock()) }).where(eq(pushSubscriptions.id, s.id))
          } else if (outcome === 'gone') {
            result.removed++
            // Only this exact row: the endpoint may have moved to another user meanwhile.
            await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, s.id), eq(pushSubscriptions.endpoint, s.endpoint)))
          } else {
            result.failed++
            if (outcome === 'transient') result.transient++
          }
        } catch (e) {
          console.error('[push] bookkeeping failed:', e instanceof Error ? e.message : 'unknown error')
        }
      }),
    )
    return result
  }

  /** Claim (user, session): only the winner sends. Retries only rows released after an all-transient failure. */
  async function claim(userId: string, sessionId: string, now: number): Promise<boolean> {
    const rows = await db
      .insert(pushSent)
      .values({ userId, sessionId, kind: 'session-end', sentAt: new Date(now), attempts: 1 })
      .onConflictDoUpdate({
        target: [pushSent.userId, pushSent.sessionId, pushSent.kind],
        set: { attempts: sql`${pushSent.attempts} + 1`, sentAt: new Date(now) },
        setWhere: sql`${pushSent.sentAt} is null and ${pushSent.attempts} < ${PUSH_MAX_ATTEMPTS}`,
      })
      .returning({ attempts: pushSent.attempts })
    return rows.length > 0
  }

  async function release(userId: string, sessionId: string) {
    await db
      .update(pushSent)
      .set({ sentAt: null })
      .where(and(eq(pushSent.userId, userId), eq(pushSent.sessionId, sessionId), eq(pushSent.kind, 'session-end')))
  }

  async function runDue(): Promise<number> {
    if (!enabled) return 0
    const now = Math.floor(clock())
    const dueBefore = now - PUSH_GRACE_MS
    const staleBefore = now - PUSH_MAX_AGE_MS
    // Same condition as isDue(), in SQL: users without subscriptions never get here.
    const candidates = await db
      .select({ userId: playerDocs.userId })
      .from(playerDocs)
      .where(
        sql`jsonb_typeof(${playerDocs.doc} -> 'timer') = 'object'
          and jsonb_typeof(${playerDocs.doc} #> '{timer,endsAt}') = 'number'
          and (${playerDocs.doc} #>> '{timer,pausedAt}') is null
          and coalesce(${playerDocs.doc} #>> '{timer,notified}', 'false') <> 'true'
          and (${playerDocs.doc} #>> '{timer,endsAt}')::numeric::bigint <= ${dueBefore}
          and (${playerDocs.doc} #>> '{timer,endsAt}')::numeric::bigint > ${staleBefore}
          and exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${playerDocs.userId})
          and not exists (
            select 1 from ${pushSent}
            where ${pushSent.userId} = ${playerDocs.userId}
              and ${pushSent.sessionId} = ${playerDocs.doc} #>> '{timer,sessionId}'
              and ${pushSent.kind} = 'session-end'
              and (${pushSent.sentAt} is not null or ${pushSent.attempts} >= ${PUSH_MAX_ATTEMPTS})
          )`,
      )
      .limit(DUE_BATCH)

    let pushed = 0
    for (const { userId } of candidates) {
      try {
        // Re-check on the current doc: it may have been claimed, paused or notified meanwhile.
        const [row] = await db.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, userId))
        const timer = row?.doc.timer
        const t = clock()
        if (!row || !isDue(timer, t)) continue
        if (!(await claim(userId, timer.sessionId, t))) continue
        const r = await sendToUser(userId, sessionEndPayload(localeOf(row.doc), claimWindowMinutes))
        if (r.sent > 0) pushed++
        else if (r.removed === 0 && r.failed > 0 && r.failed === r.transient) await release(userId, timer.sessionId)
      } catch (e) {
        console.error('[push] session-end push failed:', e instanceof Error ? e.message : 'unknown error')
      }
    }
    return pushed
  }

  return { enabled, publicKey: enabled ? vapid!.publicKey : null, subscribe, unsubscribe, sendToUser, runDue }
}
