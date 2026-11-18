import { describe, expect, it } from 'vitest'
import { createEngineContext, defaultContext, getSpecies } from './context'
import { applySessionResult } from './session'
import { studyCandyGrants } from './studyCandy'
import type { PlayerState } from './state'
import { makeMon, makePlayer, MIN, runSession, T0 } from './test-helpers'

const ctx = defaultContext()
const chain = (slug: string) => String(getSpecies(slug, ctx).evolutionChainId)

function team(): PlayerState {
  return makePlayer([
    makeMon('charmander', 10, { uid: 'lead' }),
    makeMon('pidgey', 10, { uid: 'bird' }),
    makeMon('squirtle', 10, { uid: 'sq1' }),
    makeMon('squirtle', 10, { uid: 'sq2' }),
    makeMon('charmander', 10, { uid: 'char2' }),
  ])
}

/** Run and apply one session; returns the new state and the events. */
function study(state: PlayerState, minutes: number, startedAt = T0, c = ctx, seed = 7) {
  const { result, state: running } = runSession(state, minutes, seed, { startedAt }, c)
  const applied = applySessionResult(running, result, c)
  if (!applied.ok) throw new Error(applied.error)
  return { state: applied.value.state, events: applied.value.events, result }
}

describe('partner candies (GDD §12.2)', () => {
  it('config: 1 candy per team line, leader 2, 25 min, once a day', () => {
    expect(ctx.config.progression.studyCandy).toEqual({ amount: 1, leaderBonus: 1, minMinutes: 25, perDay: 1 })
  })

  it('gives the leader line 2 and every other distinct line 1; duplicates of a line count once', () => {
    const s = team()
    const g = studyCandyGrants(s, s.team, ctx)
    expect(g).toHaveLength(3) // charmander (leader + char2), pidgey, squirtle (×2 counts once)
    expect(g.find((x) => x.chainId === chain('charmander'))).toMatchObject({ amount: 2, leader: true, speciesSlug: 'charmander' })
    expect(g.find((x) => x.chainId === chain('pidgey'))).toMatchObject({ amount: 1, leader: false })
    expect(g.find((x) => x.chainId === chain('squirtle'))).toMatchObject({ amount: 1, leader: false })
  })

  it('a non-leader duplicate of the leader line does not raise it; a leader that repeats a line keeps the bigger amount', () => {
    const s = makePlayer([makeMon('pidgey', 5, { uid: 'a' }), makeMon('charmander', 5, { uid: 'b' }), makeMon('pidgey', 5, { uid: 'c' })])
    const g = studyCandyGrants(s, s.team, ctx)
    expect(g.find((x) => x.chainId === chain('pidgey'))).toMatchObject({ amount: 2, leader: true })
    expect(g.find((x) => x.chainId === chain('charmander'))?.amount).toBe(1)
  })

  it('a 25-min session pays the candies into the player and emits one studyCandy event', () => {
    const before = team()
    const { state, events } = study(before, 25)
    expect(state.candies.chains[chain('charmander')]).toBe(2)
    expect(state.candies.chains[chain('pidgey')]).toBe(1)
    expect(state.candies.chains[chain('squirtle')]).toBe(1)
    const ev = events.filter((e) => e.type === 'studyCandy')
    expect(ev).toHaveLength(1)
    expect(ev[0]?.type === 'studyCandy' && ev[0].grants.reduce((a, x) => a + x.amount, 0)).toBe(4)
  })

  it('a valid session shorter than 25 min gives nothing and does not use up the day', () => {
    const short = study(team(), 15)
    expect(short.result.valid).toBe(true)
    expect(short.state.candies.chains).toEqual({})
    expect(short.events.some((e) => e.type === 'studyCandy')).toBe(false)
    expect(short.state.days['2026-11-03']?.candySessions).toBeUndefined()
    // The 25-min one right after still pays.
    const long = study(short.state, 25, T0 + 60 * MIN)
    expect(long.state.candies.chains[chain('charmander')]).toBe(2)
  })

  it('only the first qualifying session of the day pays; the next day pays again', () => {
    const a = study(team(), 25)
    const b = study(a.state, 25, T0 + 60 * MIN)
    expect(b.state.candies.chains[chain('charmander')]).toBe(2)
    expect(b.events.some((e) => e.type === 'studyCandy')).toBe(false)
    expect(b.state.days['2026-11-03']?.candySessions).toBe(1)
    const c = study(b.state, 25, T0 + 24 * 60 * MIN)
    expect(c.state.candies.chains[chain('charmander')]).toBe(4)
    expect(c.state.candies.chains[chain('pidgey')]).toBe(2)
  })

  it('perDay is configurable: with 2, the second session pays and the third does not', () => {
    const c2 = createEngineContext({ config: { progression: { studyCandy: { perDay: 2 } } } })
    const a = study(team(), 25, T0, c2)
    const b = study(a.state, 25, T0 + 60 * MIN, c2)
    const c = study(b.state, 25, T0 + 120 * MIN, c2)
    expect(a.state.candies.chains[chain('charmander')]).toBe(2)
    expect(b.state.candies.chains[chain('charmander')]).toBe(4)
    expect(c.state.candies.chains[chain('charmander')]).toBe(4)
    expect(c.state.days['2026-11-03']?.candySessions).toBe(2)
  })

  it('amounts are configurable and 0/0 turns the feature off', () => {
    const big = createEngineContext({ config: { progression: { studyCandy: { amount: 2, leaderBonus: 3 } } } })
    const a = study(team(), 25, T0, big)
    expect(a.state.candies.chains[chain('charmander')]).toBe(5)
    expect(a.state.candies.chains[chain('pidgey')]).toBe(2)
    const off = createEngineContext({ config: { progression: { studyCandy: { amount: 0, leaderBonus: 0 } } } })
    const b = study(team(), 25, T0, off)
    expect(b.state.candies.chains).toEqual({})
    expect(b.events.some((e) => e.type === 'studyCandy')).toBe(false)
  })

  it('the same result cannot be applied twice (no double candies)', () => {
    const { result, state: running } = runSession(team(), 25, 7, { startedAt: T0 })
    const first = applySessionResult(running, result, ctx)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(applySessionResult(first.value.state, result, ctx).ok).toBe(false)
  })

  it('a cancelled session counts only if it reached 25 studied minutes', () => {
    const c = study(team(), 50)
    expect(c.state.candies.chains[chain('charmander')]).toBe(2)
    const st = makePlayer([makeMon('charmander', 10, { uid: 'lead' })])
    const { result, state: running } = runSession(st, 50, 7, { startedAt: T0, endedAt: T0 + 20 * MIN, cancelled: true })
    expect(result.minutes).toBeLessThan(25)
    const applied = applySessionResult(running, result, ctx)
    expect(applied.ok && applied.value.state.candies.chains).toEqual({})
  })
})
