/**
 * Web Push, client side (src/game/protocol.ts "Web Push", public/sw.js).
 *
 * The page still shows the end-of-session notification itself (lib/notify.ts).
 * This is the fallback: the server pushes through the browser's push service
 * when the page did not notify (a frozen or closed tab), and the service worker
 * shows it. A subscription belongs to THIS browser; the server stores it under
 * the signed-in user.
 *
 * Every browser API goes through `PushDeps`, so the flows run in tests against
 * fakes (`browserDeps()` is the real one).
 */
import type { PushConfigResponse, PushSubscribeRequest } from '../../game/protocol'
import { errorCode } from '../api/client'
import { pushApi } from '../api/endpoints'

export type PushState = 'unsupported' | 'server-off' | 'denied' | 'off' | 'on'
export type Permission = NotificationPermission

/** The parts of a PushSubscription we use. */
export interface SubLike {
  endpoint: string
  toJSON(): { endpoint?: string; keys?: Record<string, string> }
  unsubscribe(): Promise<boolean>
}

export interface PushManagerLike {
  getSubscription(): Promise<SubLike | null>
  subscribe(opts: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<SubLike>
}

export interface PushApiLike {
  config(): Promise<PushConfigResponse>
  subscribe(body: PushSubscribeRequest): Promise<void>
  unsubscribe(endpoint: string): Promise<void>
  test(): Promise<{ sent: number }>
}

export interface PushDeps {
  /** Service worker + PushManager + Notification in a secure context. */
  supported(): boolean
  permission(): Permission
  requestPermission(): Promise<Permission>
  /** The push manager of the already registered worker, without registering one. */
  existing(): Promise<PushManagerLike | null>
  /** Registers /sw.js (scope '/'), waits until it is ready, returns its push manager. */
  register(): Promise<PushManagerLike>
  api: PushApiLike
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    window.isSecureContext === true &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** The real browser. */
export function browserDeps(): PushDeps {
  return {
    supported: isPushSupported,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    existing: async () => {
      const reg = await navigator.serviceWorker.getRegistration('/')
      return reg ? (reg.pushManager as unknown as PushManagerLike) : null
    },
    register: async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      const reg = await navigator.serviceWorker.ready
      return reg.pushManager as unknown as PushManagerLike
    },
    api: pushApi,
  }
}

/** base64url (the VAPID public key) → bytes for `applicationServerKey`. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Body of POST /push/subscribe, or null if the subscription lacks its keys. */
export function subscribeBody(sub: SubLike): PushSubscribeRequest | null {
  const j = sub.toJSON()
  const endpoint = j.endpoint ?? sub.endpoint
  const p256dh = j.keys?.p256dh
  const auth = j.keys?.auth
  return endpoint && p256dh && auth ? { endpoint, keys: { p256dh, auth } } : null
}

async function currentSub(deps: PushDeps): Promise<SubLike | null> {
  const pm = await deps.existing().catch(() => null)
  return pm ? pm.getSubscription().catch(() => null) : null
}

/** Where this browser stands: support → server config → permission → an active subscription. */
export async function pushState(deps: PushDeps = browserDeps()): Promise<PushState> {
  if (!deps.supported()) return 'unsupported'
  const cfg = await deps.api.config().catch(() => null)
  if (!cfg?.enabled || !cfg.publicKey) return 'server-off'
  const perm = deps.permission()
  if (perm === 'denied') return 'denied'
  if (perm !== 'granted') return 'off'
  return (await currentSub(deps)) ? 'on' : 'off'
}

export type EnableResult =
  | { ok: true }
  /** dismissed: the permission prompt was closed without an answer. error: `code` is an API error code or 'browser'. */
  | { ok: false; reason: 'unsupported' | 'server-off' | 'denied' | 'dismissed' | 'error'; code?: string }

/**
 * Turn push on for this browser. Call it straight from the click handler: the
 * permission prompt needs the user gesture, so it is asked before anything else.
 * If the server refuses the subscription, the browser one is dropped too.
 */
export async function enablePush(deps: PushDeps = browserDeps()): Promise<EnableResult> {
  if (!deps.supported()) return { ok: false, reason: 'unsupported' }
  let perm = deps.permission()
  if (perm === 'default') perm = await deps.requestPermission().catch(() => 'default' as const)
  if (perm === 'denied') return { ok: false, reason: 'denied' }
  if (perm !== 'granted') return { ok: false, reason: 'dismissed' }

  let cfg: PushConfigResponse
  try {
    cfg = await deps.api.config()
  } catch (e) {
    return { ok: false, reason: 'error', code: errorCode(e) }
  }
  if (!cfg.enabled || !cfg.publicKey) return { ok: false, reason: 'server-off' }

  let sub: SubLike
  try {
    const pm = await deps.register()
    sub = (await pm.getSubscription()) ?? (await pm.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) }))
  } catch {
    return { ok: false, reason: 'error', code: 'browser' }
  }

  const body = subscribeBody(sub)
  try {
    if (!body) throw new Error('no keys')
    await deps.api.subscribe(body)
    return { ok: true }
  } catch (e) {
    await sub.unsubscribe().catch(() => false)
    return { ok: false, reason: 'error', code: body ? errorCode(e) : 'browser' }
  }
}

/** Turn push off for this browser: the server forgets it, then the browser drops it (even if the server call failed). */
export async function disablePush(deps: PushDeps = browserDeps()): Promise<void> {
  if (!deps.supported()) return
  const sub = await currentSub(deps)
  if (!sub) return
  await deps.api.unsubscribe(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe().catch(() => false)
}

/** POST /push/test. Throws the ApiError (no_subscription, push_disabled, rate_limited, network…). */
export function sendTestPush(deps: PushDeps = browserDeps()): Promise<{ sent: number }> {
  return deps.api.test()
}

/**
 * After signing in: if this browser already has a subscription, hand it to the
 * user who just signed in (same browser, maybe another account). Silent.
 */
export async function syncPushOnSignIn(deps: PushDeps = browserDeps()): Promise<void> {
  try {
    if (!deps.supported() || deps.permission() !== 'granted') return
    const sub = await currentSub(deps)
    const body = sub && subscribeBody(sub)
    if (body) await deps.api.subscribe(body)
  } catch {
    /* best effort */
  }
}

/**
 * Before signing out: the server forgets this browser's subscription, so the
 * previous player's pushes never pop up for the next one. The browser keeps it
 * (the next sign-in hands it over with `syncPushOnSignIn`). Never throws and
 * gives up after `timeoutMs`, so logout is never blocked.
 */
export async function forgetPushOnSignOut(deps: PushDeps = browserDeps(), timeoutMs = 3000): Promise<void> {
  const work = (async () => {
    if (!deps.supported()) return
    const sub = await currentSub(deps)
    if (sub) await deps.api.unsubscribe(sub.endpoint)
  })().catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))
  await Promise.race([work, timeout])
  clearTimeout(timer)
}
