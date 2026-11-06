/** public/sw.js run in a sandbox with a fake `self` (no browser). */
import { describe, expect, it, vi } from 'vitest'
import source from '../../../public/sw.js?raw'

const ORIGIN = 'https://pokefocus.example'

interface FakeClient {
  url: string
  visibilityState: 'visible' | 'hidden'
  focus: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
}

function client(url: string, visibilityState: 'visible' | 'hidden' = 'hidden'): FakeClient {
  const c: FakeClient = { url, visibilityState, focus: vi.fn(async () => c), navigate: vi.fn(async () => c) }
  return c
}

function load(windows: FakeClient[] = [], language = 'es-PE') {
  const handlers: Record<string, (e: unknown) => void> = {}
  const self = {
    addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => (handlers[type] = fn)),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => undefined), pushManager: { subscribe: vi.fn() } },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => null), claim: vi.fn(async () => undefined) },
    location: { origin: ORIGIN },
    navigator: { language },
    fetch: vi.fn(),
    atob: (s: string) => atob(s),
  }
  new Function('self', source)(self)
  /** Dispatch an event and wait for what it passed to waitUntil. */
  async function fire(type: string, e: Record<string, unknown>) {
    let done: Promise<unknown> = Promise.resolve()
    handlers[type]!({ ...e, waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  return { self, fire, handlers }
}

const data = (v: unknown) => ({ json: () => (typeof v === 'string' ? JSON.parse(v) : v) })
const payload = { type: 'session-end', title: '¡Sesión completa!', body: 'Reclama ya', tag: 'pokefocus-session', url: '/#/' }

describe('sw.js', () => {
  it('registers the lifecycle and push handlers', () => {
    const { handlers } = load()
    expect(Object.keys(handlers).sort()).toEqual(['activate', 'install', 'notificationclick', 'push', 'pushsubscriptionchange'])
  })

  it('shows the notice when no window is visible', async () => {
    const { self, fire } = load([client(`${ORIGIN}/`, 'hidden')])
    await fire('push', { data: data(payload) })
    expect(self.registration.showNotification).toHaveBeenCalledWith('¡Sesión completa!', { body: 'Reclama ya', tag: 'pokefocus-session', icon: '/art/logo.svg', data: { url: '/#/' } })
  })

  it('shows nothing while a window is visible (the page notifies), except a test', async () => {
    const { self, fire } = load([client(`${ORIGIN}/`, 'visible')])
    await fire('push', { data: data(payload) })
    expect(self.registration.showNotification).not.toHaveBeenCalled()
    await fire('push', { data: data({ ...payload, type: 'test' }) })
    expect(self.registration.showNotification).toHaveBeenCalledOnce()
  })

  it('the tag defaults to pokefocus-session', async () => {
    const { self, fire } = load()
    await fire('push', { data: data({ type: 'session-end', title: 'T', body: 'B', url: '/' }) })
    expect(self.registration.showNotification.mock.calls[0]).toMatchObject(['T', { tag: 'pokefocus-session' }])
  })

  it('an empty or malformed payload still shows a generic notice', async () => {
    const { self, fire } = load([], 'en-US')
    await fire('push', { data: { json: () => JSON.parse('{nope') } })
    await fire('push', { data: null })
    await fire('push', { data: data(42) })
    expect(self.registration.showNotification).toHaveBeenCalledTimes(3)
    for (const call of self.registration.showNotification.mock.calls as unknown as [string, { tag: string; data: { url: string } }][]) {
      expect(call[0]).toBe('Session complete!')
      expect(call[1]).toMatchObject({ tag: 'pokefocus-session', data: { url: '/' } })
    }
    const es = load([], 'es-ES')
    await es.fire('push', {})
    expect((es.self.registration.showNotification.mock.calls as unknown as string[][])[0]![0]).toBe('¡Sesión completa!')
  })

  it('cross-origin or absolute urls in the payload are dropped', async () => {
    const { self, fire } = load()
    for (const url of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', '/\\evil.example']) {
      await fire('push', { data: data({ ...payload, url }) })
    }
    for (const call of self.registration.showNotification.mock.calls as unknown as [string, { data: { url: string } }][]) expect(call[1].data.url).toBe('/')
  })

  it('click focuses an open window of the app without reloading it', async () => {
    const win = client(`${ORIGIN}/#/box`)
    const { self, fire } = load([client('https://other.example/'), win])
    const close = vi.fn()
    await fire('notificationclick', { notification: { close, data: { url: '/#/' } } })
    expect(close).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.navigate).not.toHaveBeenCalled()
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('click opens a window when none is open, ignoring foreign urls', async () => {
    const { self, fire } = load()
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/#/' } } })
    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: 'https://evil.example/' } } })
    await fire('notificationclick', { notification: { close: vi.fn(), data: null } })
    expect(self.clients.openWindow.mock.calls).toEqual([['/#/'], ['/'], ['/']])
  })

  it('pushsubscriptionchange re-subscribes and tells the server, swallowing errors', async () => {
    const { self, fire } = load()
    self.fetch.mockImplementation(async (path: string) => (path === '/api/push/config' ? { ok: true, json: async () => ({ enabled: true, publicKey: 'AQID' }) } : { ok: true }))
    self.registration.pushManager.subscribe.mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push/new', keys: { p256dh: 'P', auth: 'A' } }) })
    await fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://push/old' } })
    const posts = self.fetch.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')
    expect(posts.map((c) => [c[0], JSON.parse((c[1] as { body: string }).body)])).toEqual([
      ['/api/push/subscribe', { endpoint: 'https://push/new', keys: { p256dh: 'P', auth: 'A' } }],
      ['/api/push/unsubscribe', { endpoint: 'https://push/old' }],
    ])

    const broken = load()
    broken.self.fetch.mockRejectedValue(new TypeError('offline'))
    await expect(broken.fire('pushsubscriptionchange', {})).resolves.toBeUndefined()
  })
})
