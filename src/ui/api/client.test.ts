/** `ApiError` keeps the whole error answer (`body`), e.g. `unlockAt` of 409 name_locked. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, isApiError } from './client'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const fail = async (res: Response | Error) => {
  vi.stubGlobal('fetch', vi.fn(async () => (res instanceof Error ? Promise.reject(res) : res)))
  return api.get('/x').catch((e: unknown) => e)
}

afterEach(() => vi.unstubAllGlobals())

describe('ApiError.body', () => {
  it('carries the extra fields of the error answer', async () => {
    const err = await fail(json(409, { error: 'name_locked', unlockAt: 1_800_000_000_000 }))
    expect(isApiError(err)).toBe(true)
    const e = err as ApiError
    expect(e.status).toBe(409)
    expect(e.code).toBe('name_locked')
    expect(e.body).toEqual({ error: 'name_locked', unlockAt: 1_800_000_000_000 })
    expect(e.body!.unlockAt).toBe(1_800_000_000_000)
  })

  it('keeps retryAfter working next to the body', async () => {
    const e = (await fail(json(429, { error: 'rate_limited', retryAfter: 42 }, { 'Retry-After': '42' }))) as ApiError
    expect(e.retryAfter).toBe(42)
    expect(e.body).toEqual({ error: 'rate_limited', retryAfter: 42 })
  })

  it('is null when the answer is not a JSON object, or the request never got one', async () => {
    expect(((await fail(new Response('<html>bad gateway</html>', { status: 502 }))) as ApiError).body).toBeNull()
    expect(((await fail(json(500, '[1,2]'))) as ApiError).body).toBeNull()
    expect(((await fail(json(500, 'null'))) as ApiError).body).toBeNull()
    const net = (await fail(new TypeError('offline'))) as ApiError
    expect(net.code).toBe('network')
    expect(net.body).toBeNull()
  })

  it('an error built without a body keeps working as before', () => {
    const e = new ApiError(409, 'too_many')
    expect(e.body).toBeNull()
    expect(e.retryAfter).toBeNull()
  })
})
