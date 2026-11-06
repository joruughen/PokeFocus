/**
 * `useAuth.updateMe` against the fake server (PATCH /api/auth/me with the
 * 30-day name / country locks): the answer replaces `user`, a stale lock
 * refreshes the user and throws, and the error codes read as friendly text.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { COUNTRY_LOCK_DAYS, NAME_LOCK_DAYS } from '../../../game/protocol'
import { isApiError } from '../../api/client'
import { requestErrorText } from '../../lib/errors'
import { installFakeServer } from '../../test/fakeServer'
import { useAuth } from '../../store/auth'
import { lockState } from './accountLocks'

const DAY = 86_400_000
const server = installFakeServer({ trainerName: 'Ash' })
afterAll(() => server.restore())

const patchCalls = () => server.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/auth/me')
const meGets = () => server.calls.filter((c) => c.method === 'GET' && c.path === '/api/auth/me')

beforeEach(() => {
  server.reset()
  useAuth.setState({ status: 'authed', user: server.user, bootError: null })
})

describe('useAuth.updateMe', () => {
  it('replaces the user with the PATCH answer and starts the lock of what changed', async () => {
    const saved = await useAuth.getState().updateMe({ trainerName: 'Brock' })
    expect(patchCalls()[0]!.body).toEqual({ trainerName: 'Brock' })
    expect(saved.trainerName).toBe('Brock')
    expect(saved.nameChangedAt).not.toBeNull()
    expect(saved.countryChangedAt).toBeNull()
    expect(useAuth.getState().user).toEqual(saved)
    expect(lockState(saved.nameChangedAt, NAME_LOCK_DAYS, Date.now(), false).locked).toBe(true)
    expect(lockState(saved.countryChangedAt, COUNTRY_LOCK_DAYS, Date.now(), false).locked).toBe(false)
  })

  it('the privacy switch has no lock and can flip back and forth', async () => {
    expect((await useAuth.getState().updateMe({ anonymousRankings: true })).anonymousRankings).toBe(true)
    expect(useAuth.getState().user!.anonymousRankings).toBe(true)
    expect((await useAuth.getState().updateMe({ anonymousRankings: false })).anonymousRankings).toBe(false)
    expect(useAuth.getState().user!.nameChangedAt).toBeNull()
  })

  it('a locked name answers 409 name_locked, refreshes the user and throws', async () => {
    const changedAt = Date.now() - DAY
    server.user = { ...server.user, nameChangedAt: changedAt }
    // The client still holds the old user (it never saw the change): no lock shown.
    expect(useAuth.getState().user!.nameChangedAt).toBeNull()
    const err = await useAuth.getState().updateMe({ trainerName: 'Misty' }).catch((e: unknown) => e)
    expect(isApiError(err) && err.status === 409 && err.code === 'name_locked').toBe(true)
    expect(meGets()).toHaveLength(1) // refreshed
    expect(useAuth.getState().user!.nameChangedAt).toBe(changedAt)
    expect(useAuth.getState().user!.trainerName).toBe('Ash')
  })

  it('a locked country answers 409 country_locked', async () => {
    server.user = { ...server.user, countryChangedAt: Date.now() - 2 * DAY }
    const err = await useAuth.getState().updateMe({ country: 'ES' }).catch((e: unknown) => e)
    expect(isApiError(err) && err.code === 'country_locked').toBe(true)
    expect(useAuth.getState().user!.country).toBe('PE')
    expect(useAuth.getState().user!.countryChangedAt).toBe(server.user.countryChangedAt)
  })

  it('does not refresh for other errors', async () => {
    server.failNext = () => new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400, headers: { 'content-type': 'application/json' } })
    await expect(useAuth.getState().updateMe({ trainerName: 'x' })).rejects.toMatchObject({ code: 'invalid_body' })
    expect(meGets()).toHaveLength(0)
  })
})

describe('lock error texts', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`name_locked and country_locked read as plain text (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      server.user = { ...server.user, nameChangedAt: Date.now(), countryChangedAt: Date.now() }
      for (const [patch, code] of [
        [{ trainerName: 'Misty' }, 'name_locked'],
        [{ country: 'ES' }, 'country_locked'],
      ] as const) {
        const err = await useAuth.getState().updateMe(patch).catch((e: unknown) => e)
        expect(isApiError(err) && err.code).toBe(code)
        const text = requestErrorText(err)
        expect(text).not.toMatch(/errors\.|_locked/)
        expect(text).toContain(lng === 'es' ? 'hace poco' : 'recently')
      }
    })
  }
})
