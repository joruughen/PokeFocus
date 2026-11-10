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

describe('nickname and saved team actions (validation)', () => {
  it('accepts well-formed bodies (the reducer does the trimming and the grapheme limit)', () => {
    expect(ok({ type: 'setNickname', uid: 'p1', nickname: 'Monito' })).toBe(true)
    expect(ok({ type: 'setNickname', uid: 'p1', nickname: null })).toBe(true)
    expect(ok({ type: 'savePreset', name: 'Estudio' })).toBe(true)
    expect(ok({ type: 'renamePreset', id: 't1', name: 'Otro' })).toBe(true)
    expect(ok({ type: 'overwritePreset', id: 't1' })).toBe(true)
    expect(ok({ type: 'deletePreset', id: 't1' })).toBe(true)
    expect(ok({ type: 'applyPreset', id: 't1' })).toBe(true)
  })
  it('rejects malformed ones and absurdly long raw text', () => {
    expect(ok({ type: 'setNickname', uid: 'p1' })).toBe(false)
    expect(ok({ type: 'setNickname', uid: '', nickname: 'x' })).toBe(false)
    expect(ok({ type: 'setNickname', uid: 'p1', nickname: 42 })).toBe(false)
    expect(ok({ type: 'setNickname', uid: 'p1', nickname: 'x'.repeat(201) })).toBe(false)
    expect(ok({ type: 'savePreset' })).toBe(false)
    expect(ok({ type: 'savePreset', name: 'x'.repeat(201) })).toBe(false)
    expect(ok({ type: 'applyPreset' })).toBe(false)
    expect(ok({ type: 'renamePreset', id: 't1' })).toBe(false)
  })
})
