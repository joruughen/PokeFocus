import { describe, expect, it } from 'vitest'
import { receiveGroupHeal } from './energy'
import { defaultContext } from './context'
import { maxEnergyOf } from './stats'
import { makeMon, makePlayer, runSession, T0 } from './test-helpers'

const ctx = defaultContext()
const amount = ctx.config.energy.groupHeal.amount

describe('receiveGroupHeal (study-group heal)', () => {
  const mon = (current: number) => makeMon('pidgey', 50, { uid: 'a', energy: { current, updatedAt: T0 } })
  const max = maxEnergyOf(mon(0), ctx)

  it('adds the heal amount to the current energy', () => {
    const r = receiveGroupHeal(makePlayer([mon(10)]), 'a', T0, ctx)
    expect(r.ok && r.value.pokemon.a!.energy.current).toBe(Math.min(max, 10 + amount))
    expect(amount).toBe(20)
  })

  it('never goes above the max energy', () => {
    const r = receiveGroupHeal(makePlayer([mon(max - 5)]), 'a', T0, ctx)
    expect(r.ok && r.value.pokemon.a!.energy.current).toBe(max)
  })

  it('refuses a full or unknown Pokémon', () => {
    expect(receiveGroupHeal(makePlayer([mon(max)]), 'a', T0, ctx)).toEqual({ ok: false, error: 'already_full' })
    expect(receiveGroupHeal(makePlayer([mon(10)]), 'zz', T0, ctx)).toEqual({ ok: false, error: 'unknown_pokemon' })
  })

  it('refuses a Pokémon of the running session', () => {
    const p = makePlayer([mon(10)])
    const { state } = runSession(p, 25)
    const running = { ...p, activeSession: { ...state.activeSession!, teamUids: ['a'] } }
    expect(receiveGroupHeal(running, 'a', T0, ctx)).toEqual({ ok: false, error: 'session_active' })
  })
})
