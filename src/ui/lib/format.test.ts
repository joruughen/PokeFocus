import { describe, expect, it } from 'vitest'
import { clampMinutes } from './format'

describe('clampMinutes (custom session length field)', () => {
  it('keeps what was typed when it is in range', () => {
    expect(clampMinutes('45', 40, 15, 120)).toBe(45)
    expect(clampMinutes('90', 40, 15, 120)).toBe(90)
  })
  it('clamps only at the edges, once typing is done', () => {
    expect(clampMinutes('5', 40, 15, 120)).toBe(15)
    expect(clampMinutes('200', 40, 15, 120)).toBe(120)
  })
  it('falls back when the field is empty or garbage', () => {
    expect(clampMinutes('', 40, 15, 120)).toBe(40)
    expect(clampMinutes('  ', 40, 15, 120)).toBe(40)
    expect(clampMinutes('abc', 40, 15, 120)).toBe(40)
  })
  it('rounds decimals', () => {
    expect(clampMinutes('27.6', 40, 15, 120)).toBe(28)
  })
})
