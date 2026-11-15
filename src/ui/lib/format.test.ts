import { describe, expect, it } from 'vitest'
import { clampMinutes, fmtNum } from './format'

describe('fmtNum (multipliers in the UI language)', () => {
  it('uses the decimal separator of the language, at most two decimals', () => {
    expect(fmtNum(1.35, 'es')).toBe('1,35')
    expect(fmtNum(1.35, 'en')).toBe('1.35')
    expect(fmtNum(0.5, 'es')).toBe('0,5')
    expect(fmtNum(1.1000000000000001, 'en')).toBe('1.1')
  })
})

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
