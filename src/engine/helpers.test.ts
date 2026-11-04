import { describe, expect, it } from 'vitest'
import { activeConditionTypes, typeConditionMult } from './conditions'
import { defaultContext } from './context'
import { ivQuality } from './individual'
import { completeSession, conditionEnvAt, startSession } from './session'
import { createRng } from './rng'
import { IV15, makeMon, makePlayer, MIN, STUDYING, T0 } from './test-helpers'

const cfg = defaultContext().config

describe('ivQuality', () => {
  it('classifies totals into tiers', () => {
    expect(ivQuality(IV15).tier).toBe(1)
    expect(ivQuality({ hp: 31, attack: 31, defense: 31, specialAttack: 31, specialDefense: 31, speed: 31 })).toMatchObject({ tier: 4, fraction: 1, total: 186 })
    expect(ivQuality({ hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 31 }).best).toEqual(['speed'])
  })
})

describe('conditionEnvAt', () => {
  it('matches the conditions completeSession sees for a session started at the same time', () => {
    const state = makePlayer([makeMon('charmander', 20, { uid: 'a' }), makeMon('gastly', 20, { uid: 'b' })], {
      profile: { trainerName: 'T', locale: 'es', timezone: 0, city: null, weather: { rain: false, sun: true, tempC: 28 }, createdAt: T0 - 1e9 },
    })
    const start = T0 + 2 * 60 * MIN // 12:00 UTC, sunny
    const env = conditionEnvAt(state, start, 50)
    const st = startSession(state, { plannedMinutes: 50, startedAt: start })
    if (!st.ok) throw new Error(st.error)
    const r = completeSession(st.value.state, st.value.session, { endedAt: start + 50 * MIN, claimedAt: start + 51 * MIN, pausedSeconds: 0, focusInputs: STUDYING }, createRng(3))
    if (!r.ok) throw new Error(r.error)
    expect(activeConditionTypes(env, cfg)).toEqual(r.value.conditions)
    expect(typeConditionMult('fire', env, cfg)).toBeGreaterThan(1)
  })
})
