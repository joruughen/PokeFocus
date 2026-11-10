import { describe, expect, it } from 'vitest'
import { usableBall } from './ballChoice'

const row = (ball: string, usable: boolean) => ({ ball, usable })

describe('usableBall', () => {
  it('keeps a usable selection', () => {
    expect(usableBall('study-ball', [row('study-ball', true), row('poke-ball', true)])).toBe('study-ball')
  })

  it('leaves a Study Ball that is no longer eligible for the first usable ball', () => {
    expect(usableBall('study-ball', [row('study-ball', false), row('poke-ball', true), row('great-ball', true)])).toBe('poke-ball')
  })

  it('skips balls the bag has run out of', () => {
    expect(usableBall('study-ball', [row('study-ball', false), row('poke-ball', false), row('great-ball', true)])).toBe('great-ball')
  })

  it('moves a spent Poké Ball to the Study Ball when the wild is eligible', () => {
    expect(usableBall('poke-ball', [row('study-ball', true), row('poke-ball', false)])).toBe('study-ball')
  })

  it('keeps the selection when nothing is usable', () => {
    expect(usableBall('study-ball', [row('study-ball', false), row('poke-ball', false)])).toBe('study-ball')
  })
})
