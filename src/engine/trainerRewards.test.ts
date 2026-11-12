import { describe, expect, it } from 'vitest'
import { throwBall } from './capture'
import { createEngineContext, defaultContext } from './context'
import { grantTrainerLevelUp, MAX_PENDING_LEVEL_UPS, trainerExpForLevel, trainerLevelRewards } from './progression'
import { createRng } from './rng'
import { applySessionResult } from './session'
import type { EncounterState, PlayerState, WildPokemon } from './state'
import { makeMon, makePlayer, runSession, T0 } from './test-helpers'
import { rollWild } from './waves'

const ctx = defaultContext()

describe('trainer level rewards', () => {
  it('each level gives 50 + 10·L Dust and 3 Poké Balls; every 5th adds 3 Great Balls and a Potion; every 10th 2 Ultra Balls', () => {
    expect(trainerLevelRewards(1, 2, ctx)).toEqual({ dust: 70, items: { 'poke-ball': 3 } })
    expect(trainerLevelRewards(4, 5, ctx)).toEqual({ dust: 100, items: { 'poke-ball': 3, 'great-ball': 3, potion: 1 } })
    expect(trainerLevelRewards(9, 10, ctx)).toEqual({ dust: 150, items: { 'poke-ball': 3, 'great-ball': 3, potion: 1, 'ultra-ball': 2 } })
  })

  it('sums the levels from+1..to, nothing for no climb, capped at trainer.maxLevel', () => {
    const r = trainerLevelRewards(3, 11, ctx) // levels 4..11
    let dust = 0
    for (let l = 4; l <= 11; l++) dust += 50 + 10 * l
    expect(r.dust).toBe(dust)
    expect(r.items).toEqual({ 'poke-ball': 24, 'great-ball': 6, potion: 2, 'ultra-ball': 2 })
    expect(trainerLevelRewards(5, 5, ctx)).toEqual({ dust: 0, items: {} })
    expect(trainerLevelRewards(7, 3, ctx)).toEqual({ dust: 0, items: {} })
    const max = ctx.config.trainer.maxLevel
    expect(trainerLevelRewards(max - 1, max + 20, ctx)).toEqual(trainerLevelRewards(max - 1, max, ctx))
    expect(trainerLevelRewards(max, max + 5, ctx)).toEqual({ dust: 0, items: {} })
  })

  it('is configurable and ignores zero amounts and invalid steps', () => {
    const c = createEngineContext({ config: { trainer: { levelRewards: { dustBase: 0, dustPerLevel: 5, tiers: [{ step: 2, 'ultra-ball': 1, potion: 0 }, { step: 0, 'poke-ball': 9 }] } } } })
    expect(trainerLevelRewards(0, 4, c)).toEqual({ dust: 5 * (1 + 2 + 3 + 4), items: { 'ultra-ball': 2 } })
  })

  it('every default item slug exists in the data', () => {
    const slugs = new Set(ctx.data.items.map((i) => i.slug))
    for (const tier of ctx.config.trainer.levelRewards.tiers) for (const k of Object.keys(tier)) if (k !== 'step') expect(slugs.has(k)).toBe(true)
  })

  it('grantTrainerLevelUp pays into inventory and dust and queues a notice; old saves without the field work', () => {
    const s = makePlayer([makeMon('bulbasaur', 5)], { dust: 10, inventory: { 'poke-ball': 1 } })
    expect(s.pendingLevelUps).toBeUndefined()
    const g = grantTrainerLevelUp(s, 4, 6, 123, ctx)
    expect(g.dust).toBe(10 + 100 + 110)
    expect(g.inventory['poke-ball']).toBe(1 + 6)
    expect(g.inventory['great-ball']).toBe(3)
    expect(g.pendingLevelUps).toEqual([{ from: 4, to: 6, items: { 'poke-ball': 6, 'great-ball': 3, potion: 1 }, dust: 100 + 110, at: 123 }])
    expect(grantTrainerLevelUp(g, 6, 6, 5, ctx)).toBe(g)
    expect(grantTrainerLevelUp(g, 6, 7, 200, ctx).pendingLevelUps).toHaveLength(2)
  })

  it('keeps at most MAX_PENDING_LEVEL_UPS notices by merging the oldest two', () => {
    let s = makePlayer([makeMon('bulbasaur', 5)])
    for (let i = 1; i <= MAX_PENDING_LEVEL_UPS + 3; i++) s = grantTrainerLevelUp(s, i, i + 1, i, ctx)
    expect(s.pendingLevelUps).toHaveLength(MAX_PENDING_LEVEL_UPS)
    expect(s.pendingLevelUps?.[0]?.from).toBe(1)
    expect(s.pendingLevelUps?.[0]?.to).toBe(5)
  })
})

describe('every path that raises the trainer level pays the rewards', () => {
  it('a study session: event with the rewards, items/Dust paid, notice queued, no change to the rest of the result', () => {
    const exp = trainerExpForLevel(5, ctx) - 3 // 3 minutes short of level 5 (expPerMinute 1)
    const base = makePlayer([makeMon('bulbasaur', 20)], { trainer: { level: 4, exp }, dust: 0, inventory: { 'poke-ball': 0 } })
    const { result, state } = runSession(base, 25)
    const r = applySessionResult(state, result, ctx)
    if (!r.ok) throw new Error(r.error)
    const lvl = r.value.state.trainer.level
    expect(lvl).toBeGreaterThanOrEqual(5)
    const rw = trainerLevelRewards(4, lvl, ctx)
    const ev = r.value.events.find((e) => e.type === 'trainerLevelUp')
    expect(ev).toEqual({ type: 'trainerLevelUp', from: 4, to: lvl, items: rw.items, dust: rw.dust })
    expect(r.value.state.dust).toBe(result.dust + rw.dust)
    const converted = result.waves.filter((w) => w.studyBall === 'converted').length
    expect(r.value.state.inventory['poke-ball']).toBe(result.pokeBalls + converted + rw.items['poke-ball']!)
    expect(r.value.state.pendingLevelUps).toEqual([{ from: 4, to: lvl, items: rw.items, dust: rw.dust, at: result.claimedAt }])
  })

  it('a session without a level-up queues nothing', () => {
    const base = makePlayer([makeMon('bulbasaur', 20)], { trainer: { level: 1, exp: 0 } })
    const { result, state } = runSession(base, 25)
    const r = applySessionResult(state, result, ctx)
    if (!r.ok) throw new Error(r.error)
    expect(r.value.state.trainer.level).toBe(1)
    expect(r.value.state.pendingLevelUps).toBeUndefined()
  })

  it('catching a new species (trainer EXP) pays the rewards without touching the capture roll', () => {
    const gen = { focus: 1, trainerLevel: 1, soundDominant: null, teamTypes: [], typeWeightMults: {}, syncNature: null }
    const w: WildPokemon = {
      ...rollWild(createRng('pidgey'), { waveIndex: 0, gen, activeConditionTypes: [], contributions: [], forceSpecies: 'pidgey' }, ctx),
      level: 5,
      isShiny: false,
      guaranteedBall: null,
      studyBallEligible: true,
    }
    const enc: EncounterState = {
      sessionId: 's0',
      waves: [{ index: 0, wilds: [w], studyBall: 'available', contributions: [], activeConditionTypes: [] }],
      currentWave: 0,
      charges: [],
      gen,
      env: { localHour: 10, weekend: false, weather: null, noPauses: true, sessionMinutes: 25 },
    }
    const need = trainerExpForLevel(2, ctx)
    const mk = (exp: number): PlayerState => ({ ...makePlayer([makeMon('squirtle', 10)], { trainer: { level: 1, exp }, dust: 0, inventory: {} }), encounter: enc })
    const lacking = throwBall(mk(need - ctx.config.trainer.expPerNewSpecies - 1), { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    if (!lacking.ok) throw new Error(lacking.error)
    expect(lacking.value.state.trainer.level).toBe(1)
    expect(lacking.value.state.pendingLevelUps).toBeUndefined()

    const r = throwBall(mk(need - ctx.config.trainer.expPerNewSpecies), { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    if (!r.ok) throw new Error(r.error)
    expect(r.value.outcome.kind).toBe('caught')
    expect(r.value.state.trainer.level).toBe(2)
    expect(r.value.state.dust).toBe(70)
    expect(r.value.state.inventory['poke-ball']).toBe(3)
    expect(r.value.state.pendingLevelUps).toEqual([{ from: 1, to: 2, items: { 'poke-ball': 3 }, dust: 70, at: T0 }])
    // A species already in the Pokédex gives no trainer EXP: no second reward.
    const again = throwBall({ ...r.value.state, encounter: enc }, { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    if (!again.ok) throw new Error(again.error)
    expect(again.value.state.pendingLevelUps).toHaveLength(1)
  })
})
