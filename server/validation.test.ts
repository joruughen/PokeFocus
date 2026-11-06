import { describe, expect, it } from 'vitest'
import { gameActionBody } from './validation'

const ok = (body: unknown) => gameActionBody.safeParse(body).success

describe('damage split actions (validation)', () => {
  it('accepts well-formed bodies', () => {
    expect(ok({ type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 2 })).toBe(true)
    expect(ok({ type: 'assignDamage', waveIndex: 1, uid: 'p1', wildIndex: null })).toBe(true)
    expect(ok({ type: 'autoAssignDamage', waveIndex: 3 })).toBe(true)
    expect(ok({ type: 'setAutoDamage', value: true })).toBe(true)
  })
  it('rejects malformed ones', () => {
    expect(ok({ type: 'assignDamage', waveIndex: 0, uid: 'p1' })).toBe(false)
    expect(ok({ type: 'assignDamage', waveIndex: -1, uid: 'p1', wildIndex: 0 })).toBe(false)
    expect(ok({ type: 'assignDamage', waveIndex: 0, uid: '', wildIndex: 0 })).toBe(false)
    expect(ok({ type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 1.5 })).toBe(false)
    expect(ok({ type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 100 })).toBe(false)
    expect(ok({ type: 'autoAssignDamage' })).toBe(false)
    expect(ok({ type: 'setAutoDamage', value: 'yes' })).toBe(false)
    expect(ok({ type: 'setAutoDamage' })).toBe(false)
  })
})
