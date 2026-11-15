import { describe, expect, it } from 'vitest'
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
