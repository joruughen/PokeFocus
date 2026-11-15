/**
 * F4 mission sources of the advanced items, on the real game data: Tera Shards only from trainer level 15
 * (Tera Crystallization unlocks at 20) and the "Choice Mint" instead of a random mint.
 */
import { describe, expect, it } from 'vitest'
import { CHOICE_MINT, TERA_SHARD } from './advanced'
import { defaultContext } from './context'
import { resolveReward, type MissionRewardDef } from './missions'
import { trainerLevelRewards } from './progression'
import { createRng } from './rng'

const ctx = defaultContext()
const TERA_FROM = 15
const defs = [...ctx.missions.pool, ...ctx.missions.pokedex]
const tiers = defs.flatMap((d) => d.rewards.map((r) => ({ id: d.id, r })))
const hasTera = (r: MissionRewardDef) => (r.items?.[TERA_SHARD] ?? 0) > 0 || (r.randomItem?.pool ?? []).includes(TERA_SHARD)

describe('Tera Shards from missions start at trainer level 15', () => {
  it('every reward tier that gives a Tera Shard requires trainer level 15 or more', () => {
    const givers = tiers.filter((t) => hasTera(t.r))
    expect(givers.map((t) => t.id).sort()).toEqual(['weekly-days', 'weekly-evolve', 'weekly-techniques'])
    for (const t of givers) expect(t.r.minTrainerLevel ?? 1, t.id).toBeGreaterThanOrEqual(TERA_FROM)
  })

  it('the tiers below 15 of those missions give no Tera Shard but still give something', () => {
    for (const id of ['weekly-days', 'weekly-techniques', 'weekly-evolve']) {
      const def = ctx.missions.pool.find((d) => d.id === id)!
      for (const level of [1, 10, 14]) {
        const reward = resolveReward(def.rewards, level, null, createRng(`t|${id}|${level}`))
        expect(reward.items[TERA_SHARD] ?? 0, `${id} @${level}`).toBe(0)
        expect(Object.keys(reward.items).length + reward.dust, `${id} @${level}`).toBeGreaterThan(0)
      }
      expect(resolveReward(def.rewards, TERA_FROM, null, createRng('x')).items[TERA_SHARD], id).toBeGreaterThan(0)
    }
  })

  it('the other sources give none before the unlock: Pokédex milestones and trainer level rewards', () => {
    for (const d of ctx.missions.pokedex) for (const r of d.rewards) expect(hasTera(r), d.id).toBe(false)
    const before = trainerLevelRewards(1, 19, ctx)
    expect(before.items[TERA_SHARD] ?? 0).toBe(0)
    // The one-time unlock gift arrives with the level-20 reward.
    expect(trainerLevelRewards(19, 20, ctx).items[TERA_SHARD]).toBe(ctx.config.advanced.tera.unlockGift)
    expect(ctx.config.advanced.tera.minTrainerLevel).toBe(20)
  })
})

describe('the Choice Mint replaces the random mint in mission rewards', () => {
  it('no reward draws from a pool of mints, and the choice mint is a known item', () => {
    for (const t of tiers) expect((t.r.randomItem?.pool ?? []).some((s) => s.endsWith('-mint')), t.id).toBe(false)
    expect(Object.keys(ctx.missions.placeholderItems)).toContain(CHOICE_MINT)
    const item = ctx.missions.placeholderItems[CHOICE_MINT]!
    expect(item.names.es).toBe('Menta a elegir')
    expect(item.names.en).toBe('Choice Mint')
    expect(item.description?.es).toBeTruthy()
    expect(item.description?.en).toBeTruthy()
  })

  it('"Fondo" and "Gran cosecha" give one Choice Mint from level 25', () => {
    for (const id of ['weekly-long-sessions', 'weekly-catch']) {
      const def = ctx.missions.pool.find((d) => d.id === id)!
      expect(resolveReward(def.rewards, 24, null, createRng('a')).items[CHOICE_MINT] ?? 0, id).toBe(0)
      for (const level of [25, 30, 50]) expect(resolveReward(def.rewards, level, null, createRng('a')).items[CHOICE_MINT], `${id} @${level}`).toBe(1)
    }
  })
})
