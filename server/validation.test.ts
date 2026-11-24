import { describe, expect, it } from 'vitest'
import { gameActionBody } from './validation'

const ok = (body: unknown) => gameActionBody.safeParse(body).success

describe('damage split actions (validation)', () => {
  it('accepts well-formed bodies', () => {
    expect(ok({ type: 'assignDamage', waveIndex: 0, uid: 'p1', wildIndex: 2 })).toBe(true)
    // Attacks are irreversible: there is no "take it back" (null) any more.
    expect(ok({ type: 'assignDamage', waveIndex: 1, uid: 'p1', wildIndex: null })).toBe(false)
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

describe('ackLevelUp (validation)', () => {
  it('takes no payload: the type alone is enough, a wrong type is not', () => {
    expect(ok({ type: 'ackLevelUp' })).toBe(true)
    expect(ok({ type: 'ackLevelUps' })).toBe(false)
    expect(ok({ type: 'ackLevelUp', level: 5 })).toBe(true) // extra keys are stripped, never trusted
    expect(gameActionBody.parse({ type: 'ackLevelUp', level: 5 })).toEqual({ type: 'ackLevelUp' })
  })
})

describe('releaseMany (validation)', () => {
  it('accepts 1..200 unique uids', () => {
    expect(ok({ type: 'releaseMany', uids: ['p2'] })).toBe(true)
    expect(ok({ type: 'releaseMany', uids: Array.from({ length: 200 }, (_, i) => `p${i}`) })).toBe(true)
  })
  it('rejects empty, oversized, repeated or malformed lists', () => {
    expect(ok({ type: 'releaseMany', uids: [] })).toBe(false)
    expect(ok({ type: 'releaseMany', uids: Array.from({ length: 201 }, (_, i) => `p${i}`) })).toBe(false)
    expect(ok({ type: 'releaseMany', uids: ['p2', 'p2'] })).toBe(false)
    expect(ok({ type: 'releaseMany', uids: [''] })).toBe(false)
    expect(ok({ type: 'releaseMany', uids: 'p2' })).toBe(false)
    expect(ok({ type: 'releaseMany' })).toBe(false)
  })
})

describe('setCopy (Transformación)', () => {
  it('accepts a uid, random or null; rejects the rest', () => {
    expect(ok({ type: 'setCopy', uid: 'p1', target: 'p2' })).toBe(true)
    expect(ok({ type: 'setCopy', uid: 'p1', target: 'random' })).toBe(true)
    expect(ok({ type: 'setCopy', uid: 'p1', target: null })).toBe(true)
    expect(ok({ type: 'setCopy', uid: 'p1' })).toBe(false)
    expect(ok({ type: 'setCopy', uid: '', target: 'p2' })).toBe(false)
    expect(ok({ type: 'setCopy', uid: 'p1', target: 7 })).toBe(false)
  })
})

describe('advanced item actions (validation, F4)', () => {
  it('accepts well-formed bodies', () => {
    expect(ok({ type: 'useTera', uid: 'p1', teraType: 'water' })).toBe(true)
    expect(ok({ type: 'useTm', uid: 'p1', move: 'thunderbolt' })).toBe(true)
    expect(ok({ type: 'useMint', uid: 'p1', nature: 'modest' })).toBe(true)
    expect(ok({ type: 'useBottleCap', uid: 'p1', stat: 'specialAttack' })).toBe(true)
    expect(ok({ type: 'useAbilityCapsule', uid: 'p1', ability: 'tangled-feet' })).toBe(true)
  })
  it('rejects malformed ones (unknown type or stat, missing fields, long slugs)', () => {
    expect(ok({ type: 'useTera', uid: 'p1', teraType: 'stellar' })).toBe(false)
    expect(ok({ type: 'useTera', uid: 'p1' })).toBe(false)
    expect(ok({ type: 'useTm', uid: 'p1', move: '' })).toBe(false)
    expect(ok({ type: 'useTm', uid: 'p1', move: 'x'.repeat(65) })).toBe(false)
    expect(ok({ type: 'useMint', uid: '', nature: 'modest' })).toBe(false)
    expect(ok({ type: 'useBottleCap', uid: 'p1', stat: 'luck' })).toBe(false)
    expect(ok({ type: 'useBottleCap', uid: 'p1' })).toBe(false)
    expect(ok({ type: 'useAbilityCapsule', uid: 'p1', ability: 7 })).toBe(false)
  })
})
