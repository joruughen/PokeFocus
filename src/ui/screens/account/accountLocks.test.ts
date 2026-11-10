import { describe, expect, it } from 'vitest'
import { lockState, profileChange, serverUnlockAt } from './accountLocks'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 10, 6, 12)

describe('serverUnlockAt', () => {
  it('takes the epoch ms the server sent', () => {
    expect(serverUnlockAt({ error: 'name_locked', unlockAt: T0 + 20 * DAY })).toBe(T0 + 20 * DAY)
  })

  it('is null when it is missing or unusable, so the caller falls back to lockState', () => {
    expect(serverUnlockAt(null)).toBeNull()
    expect(serverUnlockAt(undefined)).toBeNull()
    expect(serverUnlockAt({ error: 'name_locked' })).toBeNull()
    expect(serverUnlockAt({ unlockAt: '1800000000000' })).toBeNull()
    expect(serverUnlockAt({ unlockAt: Number.NaN })).toBeNull()
    expect(serverUnlockAt({ unlockAt: 0 })).toBeNull()
  })
})

describe('lockState', () => {
  it('a field that was never changed is free', () => {
    expect(lockState(null, 30, T0, false)).toEqual({ locked: false, unlockAt: null })
  })

  it('is locked right after a change and says when it opens', () => {
    expect(lockState(T0, 30, T0, false)).toEqual({ locked: true, unlockAt: T0 + 30 * DAY })
    expect(lockState(T0 - 10 * DAY, 30, T0, false)).toEqual({ locked: true, unlockAt: T0 + 20 * DAY })
  })

  it('stays locked until the very last millisecond and opens at exactly 30 days', () => {
    const changedAt = T0 - 30 * DAY
    expect(lockState(changedAt, 30, T0 - 1, false).locked).toBe(true)
    expect(lockState(changedAt, 30, T0, false)).toEqual({ locked: false, unlockAt: T0 })
    expect(lockState(changedAt, 30, T0 + 1, false).locked).toBe(false)
  })

  it('dev mode ignores the lock but still reports the date', () => {
    expect(lockState(T0, 30, T0, true)).toEqual({ locked: false, unlockAt: T0 + 30 * DAY })
  })

  it('uses the number of days it is given', () => {
    expect(lockState(T0 - 6 * DAY, 7, T0, false).locked).toBe(true)
    expect(lockState(T0 - 7 * DAY, 7, T0, false).locked).toBe(false)
  })
})

describe('profileChange', () => {
  const current = { trainerName: 'Ash', country: 'PE' }
  const free = { name: false, country: false }

  it('the same values change nothing (no confirm, no lock)', () => {
    expect(profileChange(current, { name: 'Ash', country: 'PE' }, free)).toBeNull()
    expect(profileChange(current, { name: '  Ash  ', country: 'PE' }, free)).toBeNull()
  })

  it('lists only the fields that differ, with the name trimmed', () => {
    expect(profileChange(current, { name: ' Brock ', country: 'PE' }, free)).toEqual({ trainerName: 'Brock' })
    expect(profileChange(current, { name: 'Ash', country: 'ES' }, free)).toEqual({ country: 'ES' })
    expect(profileChange(current, { name: 'Brock', country: 'ES' }, free)).toEqual({ trainerName: 'Brock', country: 'ES' })
  })

  it('a locked field never counts', () => {
    expect(profileChange(current, { name: 'Brock', country: 'ES' }, { name: true, country: false })).toEqual({ country: 'ES' })
    expect(profileChange(current, { name: 'Brock', country: 'ES' }, { name: true, country: true })).toBeNull()
  })
})
