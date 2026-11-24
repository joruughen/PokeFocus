import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../engine'
import { fitSpriteSize, SHOWCASE_GAMMA } from '../lib/spriteSize'
import { spriteScale, spriteUrl } from './Sprite'

describe('spriteScale', () => {
  it('keeps the integer scale when it fits, drops to a smaller integer when it does not', () => {
    expect(spriteScale(50, 2, 128)).toBe(2) // 100 px fits
    expect(spriteScale(80, 2, 128)).toBe(1) // 160 px would overflow: ×1 (80 px)
    expect(spriteScale(50, 3, 128)).toBe(2) // ×3 = 150 too tall, ×2 = 100 fits
    expect(spriteScale(200, 2, 128)).toBeCloseTo(0.64) // even ×1 too tall: fractional fit
    expect(spriteScale(80, 2)).toBe(2) // no limit
  })

  it('also limits the width: a wide sprite drops scale even when it is short enough', () => {
    expect(spriteScale(106, 2, 200, 145, 200)).toBe(1) // Zapdos: 212 tall fits 200? no → ×1; 290 wide would not fit anyway
    expect(spriteScale(60, 2, 200, 120, 200)).toBe(1) // 120 px tall at ×2 fits, 240 wide does not
    expect(spriteScale(60, 2, 200, 90, 200)).toBe(2)
    expect(spriteScale(181, 2, 220, 217, 150)).toBeCloseTo(150 / 217) // Moltres in a narrow box: fractional by width
    expect(spriteScale(181, 3, 150, 217, 300)).toBeCloseTo(150 / 181) // ... or by height
    expect(spriteScale(80, 2, undefined, 300, undefined)).toBe(2)
  })
})

describe('spriteUrl', () => {
  it('items PokeAPI has no sprite for are drawn SVGs shipped in public/', () => {
    expect(spriteUrl('item', 'tera-shard')).toBe('/sprites/items/tera-shard.svg')
    expect(spriteUrl('item', 'technical-machine')).toBe('/sprites/items/technical-machine.svg')
    expect(spriteUrl('item', 'potion')).toBe('/sprites/items/potion.png')
  })
})

describe('fitSpriteSize (shared size rule)', () => {
  const box = { height: 136, width: 128 }
  const size = (slug: string) => {
    const id = defaultContext().speciesBySlug.get(slug)!.id
    return fitSpriteSize(id, box)!
  }
  it('keeps the real order of sizes and never exceeds the box', () => {
    const order = ['pidgey', 'dratini', 'snorlax', 'dragonite', 'charizard', 'moltres'].map((s) => ({ s, ...size(s) }))
    for (const o of order) {
      expect(o.h).toBeLessThanOrEqual(136)
      expect(o.w).toBeLessThanOrEqual(128)
    }
    const area = order.map((o) => o.w * o.h)
    for (let i = 1; i < area.length; i++) expect(area[i]!).toBeGreaterThan(area[i - 1]!)
    // Charizard is clearly bigger than Pidgey and Dratini (it used to be barely bigger).
    expect(size("charizard").h).toBeGreaterThan(size("pidgey").h * 1.4)
    expect(size('charizard').h).toBeGreaterThan(size('dratini').h * 1.3)
  })
  it('an unknown species falls back to null', () => {
    expect(fitSpriteSize(99999, box)).toBeNull()
  })
})

describe('fitSpriteSize showcase', () => {
  it('a flatter exponent keeps a medium Pokémon bigger than the shared rule does', () => {
    const id = defaultContext().speciesBySlug.get('venusaur')!.id
    const shared = fitSpriteSize(id, { height: 190, width: 300 })!
    const showcase = fitSpriteSize(id, { height: 190, width: 300, gamma: SHOWCASE_GAMMA })!
    expect(showcase.h).toBeGreaterThan(shared.h * 1.05)
    expect(showcase.h).toBeLessThanOrEqual(190)
  })
})
