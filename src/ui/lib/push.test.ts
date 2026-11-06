/** Web Push flows against fake browser objects (lib/push.ts). */
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { disablePush, enablePush, forgetPushOnSignOut, pushState, syncPushOnSignIn, urlBase64ToUint8Array, type PushDeps, type SubLike } from './push'

const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

function fakeSub(endpoint = 'https://fcm.googleapis.com/fcm/send/abc', keys: Record<string, string> | undefined = { p256dh: 'P', auth: 'A' }): SubLike & { unsubscribe: ReturnType<typeof vi.fn> } {
  return { endpoint, toJSON: () => ({ endpoint, keys }), unsubscribe: vi.fn(async () => true) }
}

function fake(opts: { supported?: boolean; permission?: NotificationPermission; answer?: NotificationPermission; sub?: SubLike | null; registered?: boolean; enabled?: boolean; subscribeFails?: unknown } = {}) {
  let permission = opts.permission ?? 'granted'
  let sub: SubLike | null = opts.sub ?? null
  const pm = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => (sub = fakeSub())),
  }
  const enabled = opts.enabled ?? true
  const api = {
    config: vi.fn(async () => ({ enabled, publicKey: enabled ? KEY : null })),
    subscribe: vi.fn(async () => {
      if (opts.subscribeFails) throw opts.subscribeFails
    }),
    unsubscribe: vi.fn(async () => undefined),
    test: vi.fn(async () => ({ sent: 1 })),
  }
  let registered = opts.registered ?? sub !== null
  const deps: PushDeps = {
    supported: () => opts.supported ?? true,
    permission: () => permission,
    requestPermission: vi.fn(async () => (permission = opts.answer ?? 'granted')),
    existing: async () => (registered ? pm : null),
    register: vi.fn(async () => {
      registered = true
      return pm
    }),
    api,
  }
  return { deps, pm, api, current: () => sub }
}

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url without padding', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff])
    expect([...urlBase64ToUint8Array('AQ')]).toEqual([1])
  })
  it('a VAPID public key is 65 bytes starting with 0x04', () => {
    const b = urlBase64ToUint8Array(KEY)
    expect(b.length).toBe(65)
    expect(b[0]).toBe(4)
  })
})

describe('pushState', () => {
  it('unsupported browser', async () => {
    const { deps, api } = fake({ supported: false })
    expect(await pushState(deps)).toBe('unsupported')
    expect(api.config).not.toHaveBeenCalled()
  })
  it('server without VAPID keys, or unreachable', async () => {
    expect(await pushState(fake({ enabled: false }).deps)).toBe('server-off')
    const f = fake()
    f.api.config.mockRejectedValueOnce(new ApiError(0, 'network'))
    expect(await pushState(f.deps)).toBe('server-off')
  })
  it('denied, default, granted without and with a subscription', async () => {
    expect(await pushState(fake({ permission: 'denied' }).deps)).toBe('denied')
    expect(await pushState(fake({ permission: 'default' }).deps)).toBe('off')
    expect(await pushState(fake({ permission: 'granted' }).deps)).toBe('off')
    expect(await pushState(fake({ permission: 'granted', sub: fakeSub() }).deps)).toBe('on')
  })
})

describe('enablePush', () => {
  it('asks permission, registers the worker, subscribes and tells the server', async () => {
    const f = fake({ permission: 'default', answer: 'granted' })
    expect(await enablePush(f.deps)).toEqual({ ok: true })
    expect(f.deps.requestPermission).toHaveBeenCalledOnce()
    expect(f.deps.register).toHaveBeenCalledOnce()
    const arg = f.pm.subscribe.mock.calls[0] as unknown as [{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }]
    expect(arg[0].userVisibleOnly).toBe(true)
    expect(arg[0].applicationServerKey.length).toBe(65)
    expect(f.api.subscribe).toHaveBeenCalledWith({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'P', auth: 'A' } })
    expect(await pushState(f.deps)).toBe('on')
  })
  it('permission denied or the prompt dismissed: nothing is registered', async () => {
    const denied = fake({ permission: 'default', answer: 'denied' })
    expect(await enablePush(denied.deps)).toEqual({ ok: false, reason: 'denied' })
    const dismissed = fake({ permission: 'default', answer: 'default' })
    expect(await enablePush(dismissed.deps)).toEqual({ ok: false, reason: 'dismissed' })
    const blocked = fake({ permission: 'denied' })
    expect(await enablePush(blocked.deps)).toEqual({ ok: false, reason: 'denied' })
    expect(blocked.deps.requestPermission).not.toHaveBeenCalled()
    for (const f of [denied, dismissed, blocked]) expect(f.deps.register).not.toHaveBeenCalled()
  })
  it('unsupported and server-off', async () => {
    expect(await enablePush(fake({ supported: false }).deps)).toEqual({ ok: false, reason: 'unsupported' })
    const off = fake({ enabled: false })
    expect(await enablePush(off.deps)).toEqual({ ok: false, reason: 'server-off' })
    expect(off.pm.subscribe).not.toHaveBeenCalled()
  })
  it('a server failure rolls back the browser subscription', async () => {
    const f = fake({ subscribeFails: new ApiError(409, 'too_many') })
    expect(await enablePush(f.deps)).toEqual({ ok: false, reason: 'error', code: 'too_many' })
    const sub = f.current() as ReturnType<typeof fakeSub>
    expect(sub.unsubscribe).toHaveBeenCalledOnce()
  })
  it('reuses an existing browser subscription', async () => {
    const sub = fakeSub()
    const f = fake({ sub })
    expect(await enablePush(f.deps)).toEqual({ ok: true })
    expect(f.pm.subscribe).not.toHaveBeenCalled()
  })
})

describe('disablePush, sign-in and sign-out', () => {
  it('disable: server first, then the browser (even if the server fails)', async () => {
    const sub = fakeSub()
    const f = fake({ sub })
    f.api.unsubscribe.mockRejectedValueOnce(new ApiError(0, 'network'))
    await disablePush(f.deps)
    expect(f.api.unsubscribe).toHaveBeenCalledWith(sub.endpoint)
    expect(sub.unsubscribe).toHaveBeenCalledOnce()
  })
  it('disable with no subscription does nothing', async () => {
    const f = fake()
    await disablePush(f.deps)
    expect(f.api.unsubscribe).not.toHaveBeenCalled()
  })
  it('sign-in re-posts an existing subscription only with permission granted', async () => {
    const f = fake({ sub: fakeSub() })
    await syncPushOnSignIn(f.deps)
    expect(f.api.subscribe).toHaveBeenCalledOnce()
    const g = fake({ sub: fakeSub(), permission: 'denied' })
    await syncPushOnSignIn(g.deps)
    expect(g.api.subscribe).not.toHaveBeenCalled()
    const h = fake({ sub: fakeSub(), subscribeFails: new ApiError(404, 'push_disabled') })
    await expect(syncPushOnSignIn(h.deps)).resolves.toBeUndefined()
  })
  it('sign-out forgets it on the server, keeps the browser one, never throws or hangs', async () => {
    const sub = fakeSub()
    const f = fake({ sub })
    await forgetPushOnSignOut(f.deps)
    expect(f.api.unsubscribe).toHaveBeenCalledWith(sub.endpoint)
    expect(sub.unsubscribe).not.toHaveBeenCalled()

    const g = fake({ sub: fakeSub() })
    g.api.unsubscribe.mockRejectedValueOnce(new ApiError(0, 'network'))
    await expect(forgetPushOnSignOut(g.deps)).resolves.toBeUndefined()

    const h = fake({ sub: fakeSub() })
    h.api.unsubscribe.mockImplementationOnce(() => new Promise(() => undefined))
    await expect(forgetPushOnSignOut(h.deps, 10)).resolves.toBeUndefined()
  })
})
