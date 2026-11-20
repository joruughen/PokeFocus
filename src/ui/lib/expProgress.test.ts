import { describe, expect, it } from 'vitest'
import type { PokemonView } from '../../engine'
import { expProgress } from './expProgress'

const view = (level: number, into: number, next: number) => ({ pokemon: { level }, expIntoLevel: into, expForNextLevel: next }) as unknown as PokemonView

describe('expProgress', () => {
  it('normal level: proportional bar', () => {
    expect(expProgress(view(10, 30, 100), 100)).toEqual({ value: 30, max: 100, full: false, remaining: 70 })
  })
  it('level cap with EXP piled up: full bar, nothing negative', () => {
    expect(expProgress(view(30, 250, 100), 100)).toEqual({ value: 100, max: 100, full: true, remaining: 0 })
  })
  it('max level (0 into a level that does not exist): full instead of empty', () => {
    expect(expProgress(view(100, 0, 500), 100).full).toBe(true)
  })
  it('EXP below the level start never goes negative', () => {
    expect(expProgress(view(10, -20, 100), 100)).toMatchObject({ value: 0, remaining: 100 })
  })
})
