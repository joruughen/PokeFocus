import { describe, expect, it } from 'vitest'
import { nextRemountKey } from './remountKey'

describe('nextRemountKey', () => {
  it('game screens follow the content hash: a new hash remounts them', () => {
    expect(nextRemountKey('a', 'a', 'home')).toBe('a')
    expect(nextRemountKey('a', 'b', 'home')).toBe('b')
    expect(nextRemountKey('a', 'b', 'box')).toBe('b')
  })

  it('the admin route keeps the key, so publishing does not remount the admin screen', () => {
    expect(nextRemountKey('a', 'b', 'admin')).toBe('a')
    expect(nextRemountKey('a', 'c', 'admin')).toBe('a')
  })

  it('leaving the admin route catches up with the hash of the content published meanwhile', () => {
    let key = 'a'
    for (const [hash, route] of [['b', 'admin'], ['c', 'admin'], ['c', 'home']] as const) key = nextRemountKey(key, hash, route)
    expect(key).toBe('c')
  })
})
