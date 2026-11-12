// tsconfig.server.json (which also type-checks src/game) has no vite/client types.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { baseContext, createEngineContext } from '../../engine/context'
import { trainerLevelRewards } from '../../engine/progression'
import { contentPatchSchema } from './schema'
import { validateContentPatch } from './validate'

const NO_SMOKE = { smoke: false } as const
const row = (step: number, over: Record<string, number> = {}) => ({ step, 'poke-ball': 0, 'great-ball': 0, 'ultra-ball': 0, potion: 0, 'super-potion': 0, 'hyper-potion': 0, ...over })

describe('trainer.levelRewards is editable from the admin', () => {
  it('the base values are the documented defaults', () => {
    const lr = baseContext().config.trainer.levelRewards
    expect(lr.dustBase).toBe(50)
    expect(lr.dustPerLevel).toBe(10)
    expect(lr.tiers.map((t) => t.step)).toEqual([1, 5, 10])
  })

  it('a patch with new Dust values and tiers validates and changes the rewards', () => {
    const patch = { config: { trainer: { levelRewards: { dustBase: 100, dustPerLevel: 0, tiers: [row(2, { 'super-potion': 2 })] } } } }
    const r = validateContentPatch(patch, NO_SMOKE)
    expect(r.errors).toEqual([])
    const ctx = createEngineContext({ config: patch.config })
    expect(trainerLevelRewards(0, 4, ctx)).toEqual({ dust: 400, items: { 'super-potion': 4 } })
  })

  it('rejects out-of-range amounts, too many tiers and item slugs that are not editable columns', () => {
    const bad = (tiers: unknown[]) => contentPatchSchema.safeParse({ config: { trainer: { levelRewards: { tiers } } } }).success
    expect(bad([row(1)])).toBe(true)
    expect(bad([])).toBe(true)
    expect(bad([row(0)])).toBe(false)
    expect(bad([row(1, { 'poke-ball': 100 })])).toBe(false)
    expect(bad([row(1, { 'poke-ball': 1.5 })])).toBe(false)
    expect(bad(Array.from({ length: 7 }, (_, i) => row(i + 1)))).toBe(false)
    expect(bad([{ ...row(1), 'master-ball': 1 }])).toBe(false)
    expect(contentPatchSchema.safeParse({ config: { trainer: { levelRewards: { dustBase: -1 } } } }).success).toBe(false)
    expect(contentPatchSchema.safeParse({ config: { trainer: { maxLevel: 99 } } }).success).toBe(false)
  })
})
