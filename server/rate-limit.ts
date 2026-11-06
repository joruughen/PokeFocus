/**
 * Fixed-window in-memory rate limiter (single process). Keys are free-form,
 * e.g. `login:ip:1.2.3.4`. `hit` counts an attempt and says whether it is allowed.
 */
export interface RateRule {
  limit: number
  windowMs: number
}

export const RULES = {
  loginIp: { limit: 10, windowMs: 15 * 60_000 },
  loginEmail: { limit: 5, windowMs: 15 * 60_000 },
  registerIp: { limit: 5, windowMs: 60 * 60_000 },
  /** Wrong-current-password guesses from a (possibly stolen) session. */
  passwordUser: { limit: 5, windowMs: 15 * 60_000 },
  /** Study-group invitations (create + invite more) per user: no invite spam. */
  groupInviteUser: { limit: 20, windowMs: 15 * 60_000 },
  /** Any other study-group write (accept, decline, start, leave) per user. */
  groupWriteUser: { limit: 120, windowMs: 15 * 60_000 },
} satisfies Record<string, RateRule>

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>()
  private clock: () => number

  constructor(clock: () => number = Date.now) {
    this.clock = clock
  }

  /** Count one attempt. `retryAfter` is in seconds when blocked. */
  hit(key: string, rule: RateRule): { ok: true } | { ok: false; retryAfter: number } {
    const now = this.clock()
    let b = this.buckets.get(key)
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + rule.windowMs }
      this.buckets.set(key, b)
    }
    if (b.count >= rule.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
    b.count++
    return { ok: true }
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  /** Drop expired windows (called periodically). */
  sweep(): void {
    const now = this.clock()
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k)
  }
}
