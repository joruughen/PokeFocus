/** /api/auth/* — register, login, logout, me, password, sessions. */
import { Hono } from 'hono'
import { and, eq, lt, ne } from 'drizzle-orm'
import { COUNTRY_LOCK_DAYS, EMPTY_DOC, NAME_LOCK_DAYS } from '../../src/game/protocol'
import type { AuthSessionInfo } from '../../src/game/protocol'
import { hashPassword, needsRehash, verifyDummy, verifyPassword } from '../auth/password'
import { hashToken, newFriendCode, newToken, SESSION_TTL_MS } from '../auth/tokens'
import { isUniqueViolation, type Db } from '../db/client'
import { authSessions, playerDocs, users } from '../db/schema'
import {
  ApiError,
  clearSessionCookie,
  clientIp,
  readBody,
  requireAuth,
  sessionToken,
  setSessionCookie,
  toPublicUser,
  UUID_RE,
  type AppEnv,
  type Ctx,
  type Deps,
} from '../http'
import { RULES } from '../rate-limit'
import { loginBody, passwordBody, patchMeBody, registerBody } from '../validation'

const DAY_MS = 86_400_000

export function authRoutes(deps: Deps) {
  const { db, env, bus, limiter } = deps
  const app = new Hono<AppEnv>()
  const auth = requireAuth(deps)

  const limit = (c: Ctx, key: string, rule: (typeof RULES)[keyof typeof RULES]) => {
    const r = limiter.hit(key, rule)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
  }

  /** Create a session row (fresh token every time) and set the cookie. */
  const startSession = async (c: Ctx, userId: string) => {
    const token = newToken()
    const now = deps.clock()
    await db.insert(authSessions).values({
      userId,
      tokenHash: hashToken(token),
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + SESSION_TTL_MS),
      userAgent: c.req.header('user-agent')?.slice(0, 256) ?? null,
    })
    setSessionCookie(c, env, token)
  }

  app.post('/register', async (c) => {
    limit(c, `register:ip:${clientIp(c, env.trustProxy)}`, RULES.registerIp)
    const body = await readBody(c, registerBody)
    const passwordHash = await hashPassword(body.password, env.passwordPeppers)
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1)
    if (taken) throw new ApiError(409, 'email_taken')
    let user = null
    for (let attempt = 0; attempt < 8 && !user; attempt++) {
      const friendCode = newFriendCode()
      try {
        user = await db.transaction(async (tx) => {
          const [u] = await tx
            .insert(users)
            .values({ email: body.email, passwordHash, trainerName: body.trainerName, country: body.country, friendCode })
            .returning()
          await tx.insert(playerDocs).values({ userId: u!.id, doc: EMPTY_DOC, version: 0 })
          return u!
        })
      } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const [again] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1)
        if (again) throw new ApiError(409, 'email_taken')
        // otherwise a friend code collision: retry with a new code
      }
    }
    if (!user) throw new ApiError(500, 'friend_code_exhausted')
    await startSession(c, user.id)
    return c.json({ user: toPublicUser(user) }, 201)
  })

  app.post('/login', async (c) => {
    const ip = clientIp(c, env.trustProxy)
    const body = await readBody(c, loginBody)
    // Only FAILED attempts count (audit M5): checking first, counting after a wrong password. So a stranger spamming
    // wrong passwords for your email from his IP blocks his own IP/pair, not you from yours.
    const keys = [
      [`login:ip:${ip}`, RULES.loginIp],
      [`login:pair:${ip}:${body.email}`, RULES.loginPair],
      [`login:email:${body.email}`, RULES.loginEmail],
    ] as const
    for (const [key, rule] of keys) {
      const b = limiter.isBlocked(key, rule)
      if (b.blocked) {
        c.header('Retry-After', String(b.retryAfter))
        throw new ApiError(429, 'rate_limited', { retryAfter: b.retryAfter })
      }
    }
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1)
    const valid = user ? await verifyPassword(body.password, user.passwordHash, env.passwordPeppers) : await verifyDummy(body.password, env.passwordPeppers)
    if (!user || !valid) {
      for (const [key, rule] of keys) limiter.hit(key, rule)
      throw new ApiError(401, 'invalid_credentials')
    }
    limiter.reset(`login:pair:${ip}:${body.email}`)
    // Upgrade legacy (no pepper) or old-pepper hashes now that we have the plain password.
    // Conditional on the old hash so a concurrent password change is never overwritten.
    if (needsRehash(user.passwordHash, env.passwordPeppers)) {
      const passwordHash = await hashPassword(body.password, env.passwordPeppers)
      await db.update(users).set({ passwordHash }).where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)))
    }
    await startSession(c, user.id)
    return c.json({ user: toPublicUser(user) })
  })

  app.post('/logout', async (c) => {
    const token = sessionToken(c)
    if (token) await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)))
    clearSessionCookie(c, env)
    return c.body(null, 204)
  })

  app.post('/logout-all', auth, async (c) => {
    const user = c.get('user')
    const gone = await db.delete(authSessions).where(eq(authSessions.userId, user.id)).returning({ id: authSessions.id })
    bus.logoutSessions(
      user.id,
      gone.map((s) => s.id),
    )
    clearSessionCookie(c, env)
    return c.body(null, 204)
  })

  app.get('/me', auth, (c) => c.json({ user: toPublicUser(c.get('user')) }))

  app.patch('/me', auth, async (c) => {
    const body = await readBody(c, patchMeBody)
    const me = c.get('user')
    const now = deps.clock()
    const { updated, version } = await db.transaction(async (tx) => {
      // Lock the row before deciding, so two concurrent changes cannot both pass the lock.
      const [cur] = await tx.select().from(users).where(eq(users.id, me.id)).for('update')
      if (!cur) throw new ApiError(401, 'unauthorized')
      // A "change" is a value that differs from the current one; the same value is a no-op.
      const newName = body.trainerName !== undefined && body.trainerName !== cur.trainerName ? body.trainerName : null
      const newCountry = body.country !== undefined && body.country !== cur.country ? body.country : null
      // Any locked change fails the whole request (name first). DEV_TOOLS ignores the locks.
      if (!env.devTools) {
        const unlockAt = (last: Date | null, days: number) => (last && now < last.getTime() + days * DAY_MS ? last.getTime() + days * DAY_MS : null)
        const nameUnlock = newName !== null ? unlockAt(cur.trainerNameChangedAt, NAME_LOCK_DAYS) : null
        if (nameUnlock !== null) throw new ApiError(409, 'name_locked', { unlockAt: nameUnlock })
        const countryUnlock = newCountry !== null ? unlockAt(cur.countryChangedAt, COUNTRY_LOCK_DAYS) : null
        if (countryUnlock !== null) throw new ApiError(409, 'country_locked', { unlockAt: countryUnlock })
      }
      const patch: Partial<typeof users.$inferInsert> = {
        ...(newName !== null && { trainerName: newName, trainerNameChangedAt: new Date(now) }),
        ...(newCountry !== null && { country: newCountry, countryChangedAt: new Date(now) }),
        ...(body.anonymousRankings !== undefined && { anonymousRankings: body.anonymousRankings }),
        ...(body.trainerSprite !== undefined && { trainerSprite: body.trainerSprite }),
      }
      const [changed] = Object.keys(patch).length > 0 ? await tx.update(users).set(patch).where(eq(users.id, me.id)).returning() : []
      const u = changed ?? cur
      let version: number | null = null
      // Keep the name inside the game doc in sync (it is shown in game screens).
      if (body.trainerName !== undefined) {
        const [row] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, me.id)).for('update')
        const player = row?.doc.player
        if (row && player && player.profile.trainerName !== body.trainerName) {
          version = row.version + 1
          const doc = { ...row.doc, player: { ...player, profile: { ...player.profile, trainerName: body.trainerName } } }
          await tx.update(playerDocs).set({ doc, version, updatedAt: new Date(now) }).where(eq(playerDocs.userId, me.id))
        }
      }
      return { updated: u, version }
    })
    if (version !== null) bus.publish(me.id, { type: 'game', version })
    return c.json({ user: toPublicUser(updated) })
  })

  app.post('/password', auth, async (c) => {
    const body = await readBody(c, passwordBody)
    const me = c.get('user')
    const current = c.get('session')
    limit(c, `password:user:${me.id}`, RULES.passwordUser)
    if (!(await verifyPassword(body.current, me.passwordHash, env.passwordPeppers))) throw new ApiError(403, 'wrong_password')
    limiter.reset(`password:user:${me.id}`)
    const passwordHash = await hashPassword(body.next, env.passwordPeppers)
    const gone = await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, me.id))
      return tx
        .delete(authSessions)
        .where(and(eq(authSessions.userId, me.id), ne(authSessions.id, current.id)))
        .returning({ id: authSessions.id })
    })
    bus.logoutSessions(
      me.id,
      gone.map((s) => s.id),
    )
    return c.body(null, 204)
  })

  app.get('/sessions', auth, async (c) => {
    const me = c.get('user')
    const current = c.get('session')
    const rows = await db.select().from(authSessions).where(eq(authSessions.userId, me.id)).orderBy(authSessions.lastSeenAt)
    const sessions: AuthSessionInfo[] = rows
      .filter((s) => s.expiresAt.getTime() > deps.clock())
      .reverse()
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt.getTime(),
        lastSeenAt: s.lastSeenAt.getTime(),
        userAgent: s.userAgent,
        current: s.id === current.id,
      }))
    return c.json({ sessions })
  })

  app.delete('/sessions/:id', auth, async (c) => {
    const id = c.req.param('id')
    const me = c.get('user')
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    const gone = await db
      .delete(authSessions)
      .where(and(eq(authSessions.id, id), eq(authSessions.userId, me.id)))
      .returning({ id: authSessions.id })
    if (gone.length === 0) throw new ApiError(404, 'not_found')
    bus.logoutSessions(me.id, [id])
    if (id === c.get('session').id) clearSessionCookie(c, env)
    return c.body(null, 204)
  })

  return app
}

/** Delete expired sessions (run on an interval). Returns how many were removed. */
export async function deleteExpiredSessions(db: Db, now: number): Promise<number> {
  const gone = await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date(now))).returning({ id: authSessions.id })
  return gone.length
}
