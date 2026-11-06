import { describe, expect, it } from 'vitest'
import { coveredMs, fairyMultiplier, groupOverlap, memberInterval } from './group'

const M = 60_000
const mem = (userId: string, joinedAt: number, minutes: number, leftAt: number | null = null) => ({ userId, joinedAt, endsAt: joinedAt + minutes * M, leftAt })

describe('group overlap', () => {
  it('union of the others, clipped to my interval', () => {
    expect(coveredMs({ from: 0, to: 100 }, [{ from: 10, to: 30 }, { from: 20, to: 50 }, { from: 90, to: 200 }])).toBe(50)
    expect(coveredMs({ from: 0, to: 100 }, [])).toBe(0)
    expect(coveredMs({ from: 50, to: 60 }, [{ from: 0, to: 10 }])).toBe(0)
  })

  it('two people the whole session → 1', () => {
    const ms = [mem('a', 0, 25), mem('b', 0, 25)]
    expect(groupOverlap(ms, 'a')).toEqual({ accompaniedMs: 25 * M, sessionMs: 25 * M, overlap: 1 })
  })

  it('a friend who pauses at minute 10 → 10/25 for both', () => {
    const ms = [mem('a', 0, 25), mem('b', 0, 25, 10 * M)]
    expect(groupOverlap(ms, 'a')?.overlap).toBeCloseTo(0.4)
    expect(groupOverlap(ms, 'b')?.overlap).toBeCloseTo(0.4)
  })

  it('late join: 25-min sessions, B joins at minute 15 → A 10/25, B 10/25', () => {
    const ms = [mem('a', 0, 25), mem('b', 15 * M, 25)]
    expect(groupOverlap(ms, 'a')?.overlap).toBeCloseTo(0.4)
    expect(groupOverlap(ms, 'b')?.overlap).toBeCloseTo(0.4)
  })

  it('three people: covered while at least one other is in', () => {
    // A all 50 min; B leaves at 10; C joins at 20 → A accompanied 0–10 and 20–50 = 40/50.
    const ms = [mem('a', 0, 50), mem('b', 0, 50, 10 * M), mem('c', 20 * M, 50)]
    expect(groupOverlap(ms, 'a')?.overlap).toBeCloseTo(0.8)
    // C: A is in from 20 to 50 → 30/50.
    expect(groupOverlap(ms, 'c')?.overlap).toBeCloseTo(0.6)
  })

  it('live estimate with `until`; alone stops accruing; unknown user → null', () => {
    const ms = [mem('a', 0, 25), mem('b', 0, 25)]
    expect(groupOverlap(ms, 'a', 5 * M)?.accompaniedMs).toBe(5 * M)
    expect(groupOverlap([mem('a', 0, 25)], 'a')?.overlap).toBe(0)
    expect(groupOverlap(ms, 'z')).toBeNull()
    expect(memberInterval(mem('a', 100, 1, 50))).toEqual({ from: 100, to: 100 })
  })

  it('fairy multiplier', () => {
    expect(fairyMultiplier(null, 1.4)).toBe(1)
    expect(fairyMultiplier(0.5, 1.4)).toBeCloseTo(1.2)
    expect(fairyMultiplier(1, 1.4)).toBeCloseTo(1.4)
    expect(fairyMultiplier(3, 1.4)).toBeCloseTo(1.4)
  })
})
