import { describe, expect, it } from 'vitest'
import { hashPassword, verifyDummy, verifyPassword } from './auth/password'
import { FRIEND_CODE_ALPHABET, hashToken, looksLikeToken, newFriendCode, newToken } from './auth/tokens'
import { loadEnv } from './env'
import { RateLimiter } from './rate-limit'

describe('password hashing', () => {
  it('uses scrypt$N$r$p$salt$hash and verifies', async () => {
    const h = await hashPassword('pikachu123')
    const [alg, n, r, p, salt, key] = h.split('$')
    expect([alg, n, r, p]).toEqual(['scrypt', '32768', '8', '1'])
    expect(Buffer.from(salt!, 'base64')).toHaveLength(16)
    expect(Buffer.from(key!, 'base64')).toHaveLength(64)
    expect(await verifyPassword('pikachu123', h)).toBe(true)
    expect(await verifyPassword('pikachu124', h)).toBe(false)
    expect(await verifyPassword('pikachu123', 'garbage')).toBe(false)
    expect(await hashPassword('pikachu123')).not.toBe(h) // random salt
    expect(await verifyDummy('anything')).toBe(false)
  })
})

describe('tokens', () => {
  it('32-byte base64url tokens, sha256 hashes, friend codes', () => {
    const t = newToken()
    expect(looksLikeToken(t)).toBe(true)
    expect(looksLikeToken('short')).toBe(false)
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
    for (let i = 0; i < 50; i++) {
      const code = newFriendCode()
      expect(code).toHaveLength(8)
      for (const ch of code) expect(FRIEND_CODE_ALPHABET).toContain(ch)
    }
    expect(FRIEND_CODE_ALPHABET).not.toMatch(/[0O1I]/)
  })
})

describe('env', () => {
  it('defaults, origin list, DEV_TOOLS forced off in production', () => {
    const d = loadEnv({})
    expect(d).toMatchObject({ port: 8787, pgliteDir: '.data/pglite', appOrigins: ['http://localhost:5173'], devTools: false, databaseUrl: undefined })
    expect(loadEnv({ DEV_TOOLS: '1' }).devTools).toBe(true)
    expect(loadEnv({ DEV_TOOLS: '1', NODE_ENV: 'production' }).devTools).toBe(false)
    expect(loadEnv({ APP_ORIGIN: 'https://a.example/, https://b.example' }).appOrigins).toEqual(['https://a.example', 'https://b.example'])
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/)
  })
  it('COOKIE_SECURE: auto follows production, explicit values override', () => {
    expect(loadEnv({}).cookieSecure).toBe(false)
    expect(loadEnv({ NODE_ENV: 'production' }).cookieSecure).toBe(true)
    expect(loadEnv({ NODE_ENV: 'production', COOKIE_SECURE: '0' }).cookieSecure).toBe(false)
    expect(loadEnv({ COOKIE_SECURE: '1' }).cookieSecure).toBe(true)
  })
})

describe('rate limiter', () => {
  it('fixed window with Retry-After', () => {
    let t = 0
    const rl = new RateLimiter(() => t)
    const rule = { limit: 2, windowMs: 10_000 }
    expect(rl.hit('k', rule).ok).toBe(true)
    expect(rl.hit('k', rule).ok).toBe(true)
    expect(rl.hit('k', rule)).toEqual({ ok: false, retryAfter: 10 })
    t = 10_000
    expect(rl.hit('k', rule).ok).toBe(true)
  })
})
