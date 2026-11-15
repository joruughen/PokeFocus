import { describe, expect, it } from 'vitest'
import { defaultContext } from './context'
import { createRng } from './rng'
import { makeMon, makePlayer, T0 } from './test-helpers'
import {
  applyTrade,
  inSavedTeam,
  receiveBlock,
  tradeBlock,
  tradeCost,
  tradeDustCostOf,
  tradeEvolution,
  tradesToday,
  type TradeSide,
} from './trade'
import type { PlayerState } from './state'

const ctx = defaultContext()
const HOUR = 3_600_000

function player(extra: Parameters<typeof makeMon>[0][] = ['caterpie'], patch: Partial<PlayerState> = {}): PlayerState {
  const leader = makeMon('pidgey', 10, { uid: 'lead' })
  const box = extra.map((slug, i) => makeMon(slug, 10, { uid: `b${i}` }))
  const p = makePlayer([leader], { dust: 1000, ...patch })
  for (const m of box) p.pokemon[m.uid] = m
  p.pokedex = { seen: ['pidgey', ...extra], caught: ['pidgey', ...extra] }
  p.counters = { ...p.counters, pokemon: 50 }
  return p
}

function side(receive = makeMon('abra', 12, { uid: 'x9', nickname: 'Zippy', bondMinutes: 900 }), patch: Partial<TradeSide> = {}): TradeSide {
  return { give: 'b0', receive, partnerName: 'Ash', selfName: 'Test', dust: 100, ...patch }
}

describe('trade costs', () => {
  it('100 normal, ×5 shiny, ×10 legendary/mythical; both pay the dearer one', () => {
    expect(tradeDustCostOf({ speciesSlug: 'caterpie', isShiny: false }, ctx)).toBe(100)
    expect(tradeDustCostOf({ speciesSlug: 'caterpie', isShiny: true }, ctx)).toBe(500)
    expect(tradeDustCostOf({ speciesSlug: 'mewtwo', isShiny: false }, ctx)).toBe(1000)
    expect(tradeDustCostOf({ speciesSlug: 'mew', isShiny: true }, ctx)).toBe(5000)
    expect(tradeCost({ speciesSlug: 'caterpie', isShiny: false }, { speciesSlug: 'caterpie', isShiny: true }, ctx)).toBe(500)
  })
})

describe('tradeBlock', () => {
  it('blocks team members, the running session, the last Pokémon and a legendary already traded', () => {
    const p = player()
    expect(tradeBlock(p, 'b0', ctx)).toBeNull()
    expect(tradeBlock(p, 'lead', ctx)).toBe('in_team')
    expect(tradeBlock(p, 'nope', ctx)).toBe('unknown_pokemon')
    const alone = makePlayer([makeMon('pidgey', 10, { uid: 'lead' })])
    expect(tradeBlock(alone, 'lead', ctx)).toBe('last_pokemon')
    const s = { ...p, activeSession: { teamUids: ['b0'] } as PlayerState['activeSession'] }
    expect(tradeBlock(s, 'b0', ctx)).toBe('session_active')
    const legend = player(['mewtwo'])
    expect(tradeBlock(legend, 'b0', ctx)).toBeNull()
    legend.pokemon.b0 = { ...legend.pokemon.b0!, traded: { originalTrainer: 'A', receivedFrom: 'A', receivedAt: T0, count: 1 } }
    expect(tradeBlock(legend, 'b0', ctx)).toBe('legendary_traded')
    // A non-legendary can be traded again.
    p.pokemon.b0 = { ...p.pokemon.b0!, traded: { originalTrainer: 'A', receivedFrom: 'A', receivedAt: T0, count: 3 } }
    expect(tradeBlock(p, 'b0', ctx)).toBeNull()
  })

  it('saved teams do not block, but are reported', () => {
    const p = player(['caterpie'], { teamPresets: [{ id: 't1', name: 'Gym', uids: ['lead', 'b0'] }] })
    expect(tradeBlock(p, 'b0', ctx)).toBeNull()
    expect(inSavedTeam(p, 'b0')).toEqual(['Gym'])
  })
})

describe('receiveBlock and trade evolutions', () => {
  it('a Pokémon above the receiver level cap cannot be received', () => {
    const p = player()
    expect(receiveBlock(p, { level: 30 }, ctx)).toBeNull()
    expect(receiveBlock(p, { level: 31 }, ctx)).toBe('over_level_cap')
  })

  it('Kadabra, Machoke, Graveler and Haunter evolve by trade; others do not', () => {
    expect(tradeEvolution('kadabra', ctx)).toBe('alakazam')
    expect(tradeEvolution('machoke', ctx)).toBe('machamp')
    expect(tradeEvolution('graveler', ctx)).toBe('golem')
    expect(tradeEvolution('haunter', ctx)).toBe('gengar')
    expect(tradeEvolution('abra', ctx)).toBeNull()
    expect(tradeEvolution('caterpie', ctx)).toBeNull()
  })
})

describe('applyTrade', () => {
  it('swaps the Pokémon, keeps its individual state, resets Bond and nickname, records the OT and pays Dust', () => {
    const p = player(['caterpie'], { teamPresets: [{ id: 't1', name: 'Gym', uids: ['lead', 'b0'] }] })
    const got = makeMon('abra', 12, { uid: 'x9', nickname: 'Zippy', bondMinutes: 900, moveMasteryMinutes: { teleport: 120 }, isShiny: true })
    const r = applyTrade(p, side(got), T0, createRng(1), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { state, uid, evolvedTo, arrival } = r.value
    expect(uid).toBe('p51')
    expect(evolvedTo).toBeNull()
    expect(state.pokemon.b0).toBeUndefined()
    const m = state.pokemon[uid]!
    expect(m.speciesSlug).toBe('abra')
    expect(m.level).toBe(12)
    expect(m.ivs).toEqual(got.ivs)
    expect(m.nature).toBe(got.nature)
    expect(m.ability).toBe(got.ability)
    expect(m.isShiny).toBe(true)
    expect(m.exp).toBe(got.exp)
    expect(m.moveMasteryMinutes).toEqual({ teleport: 120 })
    expect(m.learnedMoves).toEqual(got.learnedMoves)
    expect(m.bondMinutes).toBe(0)
    expect(m.nickname).toBeUndefined()
    expect(m.traded).toEqual({ originalTrainer: 'Ash', receivedFrom: 'Ash', receivedAt: T0, count: 1 })
    expect(state.dust).toBe(900)
    expect(state.pokedex.caught).toContain('abra')
    expect(state.pokedex.seen).toContain('abra')
    expect(state.trades).toEqual({ dayKey: '2026-11-03', count: 1 })
    expect(state.pendingTrades).toEqual([arrival])
    expect(arrival).toMatchObject({ uid, fromSpecies: 'abra', toSpecies: 'abra', shiny: true, partnerName: 'Ash' })
    // The saved team keeps the uid (it shows as missing, as after a release).
    expect(state.teamPresets?.[0]?.uids).toEqual(['lead', 'b0'])
    // The input is not mutated.
    expect(p.pokemon.b0).toBeDefined()
    expect(p.dust).toBe(1000)
  })

  it('keeps the first original trainer on later trades', () => {
    const p = player()
    const got = makeMon('caterpie', 5, { uid: 'z', traded: { originalTrainer: 'Misty', receivedFrom: 'Misty', receivedAt: T0 - HOUR, count: 1 } })
    const r = applyTrade(p, side(got), T0, createRng(1), ctx)
    expect(r.ok && r.value.state.pokemon[r.value.uid]!.traded).toEqual({ originalTrainer: 'Misty', receivedFrom: 'Ash', receivedAt: T0, count: 2 })
  })

  it('a trade evolution happens on arrival and is registered in the Pokédex', () => {
    const p = player()
    const r = applyTrade(p, side(makeMon('kadabra', 20, { uid: 'k' })), T0, createRng(1), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.evolvedTo).toBe('alakazam')
    expect(r.value.state.pokemon[r.value.uid]!.speciesSlug).toBe('alakazam')
    expect(r.value.state.pokedex.caught).toEqual(expect.arrayContaining(['kadabra', 'alakazam']))
    expect(r.value.arrival).toMatchObject({ fromSpecies: 'kadabra', toSpecies: 'alakazam' })
  })

  it('fails cleanly on level cap, Dust, daily limit and blocked Pokémon', () => {
    const p = player()
    expect(applyTrade(p, side(makeMon('abra', 31, { uid: 'x' })), T0, createRng(1), ctx)).toEqual({ ok: false, error: 'over_level_cap' })
    expect(applyTrade({ ...p, dust: 99 }, side(), T0, createRng(1), ctx)).toEqual({ ok: false, error: 'not_enough_dust' })
    expect(applyTrade(p, side(undefined, { give: 'lead' }), T0, createRng(1), ctx)).toEqual({ ok: false, error: 'in_team' })
    const full = { ...p, trades: { dayKey: '2026-11-03', count: 3 } }
    expect(applyTrade(full, side(), T0, createRng(1), ctx)).toEqual({ ok: false, error: 'daily_limit' })
    // The next local day the counter starts again.
    expect(tradesToday(full, T0)).toBe(3)
    expect(tradesToday(full, T0 + 24 * HOUR)).toBe(0)
    expect(applyTrade(full, side(), T0 + 24 * HOUR, createRng(1), ctx).ok).toBe(true)
  })

  it('a legendary can be traded once: after it arrives it is blocked for its new owner', () => {
    const p = player()
    const r = applyTrade(p, side(makeMon('mewtwo', 20, { uid: 'm' }), { dust: 1000 }), T0, createRng(1), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(tradeBlock(r.value.state, r.value.uid, ctx)).toBe('legendary_traded')
  })
})
