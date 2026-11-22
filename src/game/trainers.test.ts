import { describe, expect, it } from 'vitest'
import { defaultTrainerSprite, TRAINER_CORE, trainerSpriteUrl } from './trainers'

describe('trainer core and default', () => {
  it('is the 24 featured characters of 0.16.0, unique, in that order (the default pool depends on it)', () => {
    expect(TRAINER_CORE).toHaveLength(24)
    expect(new Set(TRAINER_CORE).size).toBe(24)
    expect(TRAINER_CORE.slice(0, 4)).toEqual(['hilbert', 'hilda', 'nate', 'rosa'])
    expect(TRAINER_CORE.at(-1)).toBe('psychicf')
  })

  it('the default is stable per user, one of the core, and spreads over them', () => {
    const id = '0d1c2f3e-aaaa-4bbb-8ccc-111122223333'
    expect(defaultTrainerSprite(id)).toBe(defaultTrainerSprite(id))
    expect(TRAINER_CORE).toContain(defaultTrainerSprite(id))
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) seen.add(defaultTrainerSprite(`user-${i}`))
    expect(seen.size).toBeGreaterThanOrEqual(20)
  })

  it('freezes the defaults of 0.16.0: these ids keep their character forever', () => {
    // If this fails, TRAINER_CORE was reordered or the hash changed: every player who never chose would get another character.
    expect(defaultTrainerSprite('user-0')).toBe('bugcatcher')
    expect(defaultTrainerSprite('user-1')).toBe('ethan')
    expect(defaultTrainerSprite('user-2')).toBe('youngster')
    expect(defaultTrainerSprite('user-3')).toBe('nate')
    expect(defaultTrainerSprite('0d1c2f3e-aaaa-4bbb-8ccc-111122223333')).toBe('lucas')
  })

  it('builds the sprite URL', () => {
    expect(trainerSpriteUrl('hilbert')).toBe('/sprites/trainers/hilbert.png')
  })
})
