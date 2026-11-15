import { describe, expect, it } from 'vitest'
import { unlockLevel, type AdvancedUnlock } from './advanced'
import { defaultContext } from './context'
import type { MissionRewardDef } from './missions'

/** Which unlock guards each advanced item. */
const UNLOCK_OF_ITEM: Record<string, AdvancedUnlock> = {
  'technical-machine': 'tm',
  'choice-mint': 'mint',
  'ability-capsule': 'abilityCapsule',
}

const ctx = defaultContext()
const COMMON = [
  ...ctx.missions.pool.map((d) => ({ id: d.id, period: d.period as string, rewards: d.rewards })),
  ...ctx.missions.pokedex.map((d) => ({ id: d.id, period: 'pokedex', rewards: d.rewards })),
]
const tiers = COMMON.flatMap((m) => m.rewards.map((t: MissionRewardDef) => ({ ...m, tier: t })))
const itemsOf = (t: MissionRewardDef) => [...Object.keys(t.items ?? {}), ...(t.randomItem?.pool ?? [])]

describe('common missions (daily, weekly, Pokédex)', () => {
  it('never give Bottle Caps: they are event-only', () => {
    for (const x of tiers) expect(itemsOf(x.tier), `${x.id} @${x.tier.minTrainerLevel}`).not.toContain('bottle-cap')
  })

  it('daily and weekly missions never give Ultra Balls (they come from level rewards, Pokédex milestones and events)', () => {
    const periodic = tiers.filter((x) => x.period === 'daily' || x.period === 'weekly')
    expect(periodic.length).toBeGreaterThan(0)
    for (const x of periodic) expect(itemsOf(x.tier), `${x.id} @${x.tier.minTrainerLevel}`).not.toContain('ultra-ball')
  })

  it('no tier gives an item below the trainer level that unlocks its use (TM, Choice Mint, Ability Capsule)', () => {
    for (const x of tiers) {
      for (const slug of itemsOf(x.tier)) {
        const kind = UNLOCK_OF_ITEM[slug]
        if (kind) expect(x.tier.minTrainerLevel ?? 1, `${x.id}: ${slug}`).toBeGreaterThanOrEqual(unlockLevel(kind, ctx))
      }
    }
  })

  it('the thresholds are TM 15, Choice Mint 25, Ability Capsule 30; Tera Shards from 15 (a few are kept before the unlock at 20)', () => {
    const minLevelOf = (slug: string) => Math.min(...tiers.filter((x) => itemsOf(x.tier).includes(slug)).map((x) => x.tier.minTrainerLevel ?? 1))
    expect(minLevelOf('technical-machine')).toBe(15)
    expect(minLevelOf('choice-mint')).toBe(25)
    expect(minLevelOf('ability-capsule')).toBe(30)
    expect(minLevelOf('tera-shard')).toBe(15)
  })

  it('every tier gives something (no empty missions)', () => {
    for (const x of tiers) {
      const gives = itemsOf(x.tier).length > 0 || (x.tier.dust ?? 0) > 0 || (x.tier.typeCandies ?? 0) > 0
      expect(gives, `${x.id} @${x.tier.minTrainerLevel}`).toBe(true)
    }
  })
})
