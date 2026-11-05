/**
 * Password hashing with scrypt (node:crypto).
 * Format: `scrypt$N$r$p$salt_b64$hash_b64` (N=2^15, r=8, p=1, 64-byte key, 16-byte salt).
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const N = 2 ** 15
const R = 8
const P = 1
const KEY_LEN = 64
const SALT_LEN = 16
/** scrypt needs 128·N·r bytes (32 MiB here) and the default maxmem is exactly 32 MiB: raise it. */
const maxmemFor = (n: number, r: number) => 128 * n * r * 2

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

function derive(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const key = await derive(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: maxmemFor(N, R) })
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 2 ** 20 || r > 32 || p > 16) return false
  const salt = Buffer.from(parts[4]!, 'base64')
  const expected = Buffer.from(parts[5]!, 'base64')
  if (expected.length === 0) return false
  const key = await derive(password, salt, expected.length, { N: n, r, p, maxmem: maxmemFor(n, r) })
  return timingSafeEqual(key, expected)
}

let dummy: Promise<string> | null = null

/**
 * Verify against a random, never-matching hash: used when the email is unknown,
 * so login costs the same whether the account exists or not.
 */
export async function verifyDummy(password: string): Promise<false> {
  dummy ??= hashPassword(randomBytes(32).toString('base64'))
  await verifyPassword(password, await dummy)
  return false
}
