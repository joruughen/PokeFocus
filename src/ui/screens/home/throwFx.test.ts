import { describe, expect, it } from 'vitest'
import type { ThrowFx } from './throwFx'
import { clearThrowFx, loadThrowFx, saveThrowFx, throwTimeline } from './throwFx'

function memory() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size }
}

const failed = { kind: 'failed', ball: 'poke-ball', chance: 0.3, counter: null, failedThrows: 1, throwsLeft: 2 } as const
const caught = { kind: 'caught', uid: 'x', ball: 'poke-ball', chance: 0.3, guaranteed: null } as const
const fx = (over: Partial<ThrowFx> = {}): ThrowFx => ({
  sessionId: 's1',
  ref: { waveIndex: 0, wildIndex: 1 },
  ball: 'poke-ball',
  outcome: failed,
  before: { uid: 'w' } as unknown as ThrowFx['before'],
  energyBy: { a: 20 },
  cardUid: 'a',
  at: 1000,
  ...over,
})

describe('throw animation across a reload (QA R-04)', () => {
  it('a caught ball takes longer than a failed one', () => {
    expect(throwTimeline(caught).land).toBeGreaterThan(throwTimeline(failed).land)
    expect(throwTimeline(failed)).toEqual({ wobble: 550, result: 1550, land: 2450 })
  })

  it('resumes a throw that is still playing, with the ms already elapsed', () => {
    const s = memory()
    saveThrowFx(fx(), s)
    const r = loadThrowFx('s1', 1900, s)
    expect(r?.elapsed).toBe(900)
    expect(r?.fx.energyBy).toEqual({ a: 20 })
  })

  it('ignores (and drops) a finished throw, another encounter or garbage', () => {
    const s = memory()
    saveThrowFx(fx(), s)
    expect(loadThrowFx('s1', 1000 + throwTimeline(failed).land, s)).toBeNull()
    expect(s.size()).toBe(0)
    saveThrowFx(fx(), s)
    expect(loadThrowFx('other', 1500, s)).toBeNull()
    s.setItem('pokefocus-throw-fx', '{nope')
    expect(loadThrowFx('s1', 1500, s)).toBeNull()
    expect(s.size()).toBe(0)
  })

  it('clear removes it, and a missing store is harmless', () => {
    const s = memory()
    saveThrowFx(fx(), s)
    clearThrowFx(s)
    expect(loadThrowFx('s1', 1500, s)).toBeNull()
    expect(() => {
      saveThrowFx(fx(), null)
      clearThrowFx(null)
    }).not.toThrow()
    expect(loadThrowFx('s1', 1500, null)).toBeNull()
  })
})
