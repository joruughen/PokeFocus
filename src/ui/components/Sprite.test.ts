import { describe, expect, it } from 'vitest'
import { spriteScale } from './Sprite'

describe('spriteScale', () => {
  it('keeps the integer scale when it fits, drops to a smaller integer when it does not', () => {
    expect(spriteScale(50, 2, 128)).toBe(2) // 100 px fits
    expect(spriteScale(80, 2, 128)).toBe(1) // 160 px would overflow: ×1 (80 px)
    expect(spriteScale(50, 3, 128)).toBe(2) // ×3 = 150 too tall, ×2 = 100 fits
    expect(spriteScale(200, 2, 128)).toBeCloseTo(0.64) // even ×1 too tall: fractional fit
    expect(spriteScale(80, 2)).toBe(2) // no limit
  })
})
