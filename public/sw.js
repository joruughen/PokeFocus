/*
 * PokeFocus service worker: Web Push only (no caching, no offline).
 * Contract: src/game/protocol.ts "Web Push". Client side: src/ui/lib/push.ts.
 *
 * The server pushes the end-of-session notice only when the page did not show
 * it (a frozen or closed tab). If a window of the app is visible anyway, the
 * page handles it, so the worker shows nothing. The tag is the same as the
 * page's (src/ui/lib/notify.ts), so a second notice replaces the first.
 *
 * Plain JavaScript, no build step: Vite copies public/ as is. Everything is
 * reached through `self` so tests can run this file with a fake one.
 */
const TAG = 'pokefocus-session'
const ICON = '/art/logo.svg'

function generic() {
  const es = String((self.navigator && self.navigator.language) || '').toLowerCase().startsWith('es')
  return es
    ? { type: 'session-end', title: '¡Sesión completa!', body: 'Abre PokeFocus para reclamar tus recompensas.', tag: TAG, url: '/' }
    : { type: 'session-end', title: 'Session complete!', body: 'Open PokeFocus to claim your rewards.', tag: TAG, url: '/' }
}

/** PushPayload from the event, or the generic notice for an empty / malformed one. */
function readPayload(data) {
  const fallback = generic()
  let p = null
  try {
    p = data ? data.json() : null
  } catch {
    p = null
  }
  if (!p || typeof p !== 'object') return fallback
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v : d)
  return {
    type: p.type === 'test' ? 'test' : 'session-end',
    title: str(p.title, fallback.title),
    body: str(p.body, fallback.body),
    tag: str(p.tag, TAG),
    url: safeUrl(p.url),
  }
}

/** Only same-origin relative paths ("/", "/#/home"); anything else opens the app's root. */
function safeUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return '/'
  try {
    const u = new URL(url, self.location.origin)
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/'
  } catch {
    return '/'
  }
}

function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
}

async function onPush(event) {
  const p = readPayload(event.data)
  // A visible window shows the notice itself. A test is always shown: it is sent from a visible Settings page.
  if (p.type !== 'test') {
    const list = await windowClients().catch(() => [])
    if (list.some((c) => c.visibilityState === 'visible')) return
  }
  await self.registration.showNotification(p.title, { body: p.body, tag: p.tag, icon: ICON, data: { url: p.url } })
}

async function onNotificationClick(event) {
  event.notification.close()
  const url = safeUrl(event.notification.data && event.notification.data.url)
  const list = await windowClients()
  const client = list.find((c) => typeof c.url === 'string' && c.url.startsWith(self.location.origin))
  if (!client) {
    await self.clients.openWindow(url)
    return
  }
  const focused = await client.focus()
  // Same page (the app routes by hash): just focus, so the open game is not reloaded.
  const path = new URL(client.url).pathname
  if (path !== new URL(url, self.location.origin).pathname && focused && typeof focused.navigate === 'function') {
    await focused.navigate(url).catch(() => undefined)
  }
}

function urlBase64ToUint8Array(b64) {
  const s = self.atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0))
}

function postJson(path, body) {
  return self.fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The push service rotated the subscription: subscribe again and tell the server (best effort). */
async function onSubscriptionChange(event) {
  try {
    let sub = event.newSubscription
    if (!sub) {
      const res = await self.fetch('/api/push/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      const cfg = res.ok ? await res.json() : null
      if (!cfg || !cfg.enabled || !cfg.publicKey) return
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) })
    }
    const j = sub.toJSON()
    await postJson('/api/push/subscribe', { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } })
    if (event.oldSubscription && event.oldSubscription.endpoint !== j.endpoint) {
      await postJson('/api/push/unsubscribe', { endpoint: event.oldSubscription.endpoint })
    }
  } catch {
    /* best effort: the next sign-in or the Settings switch fixes it */
  }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('push', (event) => event.waitUntil(onPush(event)))
self.addEventListener('notificationclick', (event) => event.waitUntil(onNotificationClick(event)))
self.addEventListener('pushsubscriptionchange', (event) => event.waitUntil(onSubscriptionChange(event)))
