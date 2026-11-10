/**
 * Password hashing with scrypt (node:crypto), optionally keyed with a server-side pepper.
 *
 * Formats:
 * - peppered (current): `scryptp$<pepperId>$N$r$p$salt_b64$hash_b64`
 *   key = scrypt(HMAC-SHA256(pepper, NFKC(password)), salt)
 * - legacy (no pepper): `scrypt$N$r$p$salt_b64$hash_b64`
 *   key = scrypt(NFKC(password), salt)
 *
 * N=2^15, r=8, p=1, 64-byte key, 16-byte random salt per user. The pepper lives only in the
 * server environment (PASSWORD_PEPPER), never in the database: a stolen database alone is not
 * enough to brute-force the hashes. Legacy and previous-pepper hashes still verify and are
 * upgraded on the next successful login (`needsRehash`).
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const N = 2 ** 15
const R = 8
const P = 1
const KEY_LEN = 64
const SALT_LEN = 16
/** scrypt needs 128·N·r bytes (32 MiB here) and the default maxmem is exactly 32 MiB: raise it. */
const maxmemFor = (n: number, r: number) => 128 * n * r * 2

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

/** Minimum pepper length (characters); `npm run pepper` prints 43 (32 random bytes, base64url). */
export const PEPPER_MIN = 32

export interface Pepper {
  /** Public, short fingerprint stored in the hash to pick the right pepper (8 hex chars). */
  id: string
  key: Buffer
}

export interface PepperSet {
  /** Pepper for new hashes; null = no pepper (legacy format, development only). */
  current: Pepper | null
  /** Older peppers still accepted while rotating (hashes are upgraded on login). */
  previous: Pepper[]
}

export const NO_PEPPER: PepperSet = { current: null, previous: [] }

export function pepperFrom(secret: string): Pepper {
  const key = Buffer.from(secret, 'utf8')
  const id = createHash('sha256').update('pokefocus-password-pepper-id\0').update(key).digest('hex').slice(0, 8)
  return { id, key }
}

export function pepperSet(current: string | undefined, previous: readonly string[] = []): PepperSet {
  return { current: current ? pepperFrom(current) : null, previous: previous.map(pepperFrom) }
}

function derive(input: string | Buffer, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(input, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

const normalize = (password: string) => password.normalize('NFKC')
const peppered = (password: string, pepper: Pepper) => createHmac('sha256', pepper.key).update(normalize(password), 'utf8').digest()

export async function hashPassword(password: string, peppers: PepperSet = NO_PEPPER): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const opts = { N, r: R, p: P, maxmem: maxmemFor(N, R) }
  const pepper = peppers.current
  if (!pepper) {
    const key = await derive(normalize(password), salt, KEY_LEN, opts)
    return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
  }
  const key = await derive(peppered(password, pepper), salt, KEY_LEN, opts)
  return ['scryptp', pepper.id, N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

interface Parsed {
  pepperId: string | null
  n: number
  r: number
  p: number
  salt: Buffer
  expected: Buffer
}

function parse(stored: string): Parsed | null {
  const parts = stored.split('$')
  let pepperId: string | null
  let rest: string[]
  if (parts[0] === 'scrypt' && parts.length === 6) {
    pepperId = null
    rest = parts.slice(1)
  } else if (parts[0] === 'scryptp' && parts.length === 7 && /^[0-9a-f]{8}$/.test(parts[1]!)) {
    pepperId = parts[1]!
    rest = parts.slice(2)
  } else return null
  const [n, r, p] = rest.slice(0, 3).map(Number) as [number, number, number]
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 2 ** 20 || r > 32 || p > 16) return null
  const salt = Buffer.from(rest[3]!, 'base64')
  const expected = Buffer.from(rest[4]!, 'base64')
  if (expected.length === 0) return null
  return { pepperId, n, r, p, salt, expected }
}

let warnedUnknownPepper = false

export async function verifyPassword(password: string, stored: string, peppers: PepperSet = NO_PEPPER): Promise<boolean> {
  const h = parse(stored)
  if (!h) return false
  let input: string | Buffer
  if (h.pepperId === null) input = normalize(password)
  else {
    const pepper = [peppers.current, ...peppers.previous].find((pp) => pp?.id === h.pepperId)
    if (!pepper) {
      // The hash was made with a pepper this server does not have: nobody can log in to it.
      // Almost always a misconfiguration (PASSWORD_PEPPER changed or lost), so say it once.
      if (!warnedUnknownPepper) {
        warnedUnknownPepper = true
        console.warn('[auth] a password hash uses a pepper this server does not know: check PASSWORD_PEPPER / PASSWORD_PEPPER_PREVIOUS')
      }
      return false
    }
    input = peppered(password, pepper)
  }
  const key = await derive(input, h.salt, h.expected.length, { N: h.n, r: h.r, p: h.p, maxmem: maxmemFor(h.n, h.r) })
  return timingSafeEqual(key, h.expected)
}

/**
 * True when a hash that just verified should be replaced: it has no pepper (or an old one)
 * while a current pepper is configured, or it uses weaker scrypt parameters than today's.
 */
export function needsRehash(stored: string, peppers: PepperSet = NO_PEPPER): boolean {
  const h = parse(stored)
  if (!h) return false
  if ((peppers.current?.id ?? null) !== h.pepperId) return peppers.current !== null
  return h.n < N || h.r < R || h.p < P || h.expected.length < KEY_LEN
}

const dummies = new Map<string, Promise<string>>()

/**
 * Verify against a random, never-matching hash: used when the email is unknown,
 * so login costs the same whether the account exists or not.
 */
export async function verifyDummy(password: string, peppers: PepperSet = NO_PEPPER): Promise<false> {
  const k = peppers.current?.id ?? ''
  let dummy = dummies.get(k)
  if (!dummy) {
    dummy = hashPassword(randomBytes(32).toString('base64'), peppers)
    dummies.set(k, dummy)
  }
  await verifyPassword(password, await dummy, peppers)
  return false
}
