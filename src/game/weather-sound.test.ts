import { describe, expect, it } from 'vitest'
import { createRng, MINUTE_MS } from '../engine'
import { applyAction, type ActionEnv } from './actions'
import { EMPTY_DOC, type GameAction, type GameDoc } from './protocol'
import { resolveSessionWeather } from './weather'

// Tuesday 10:00 UTC: outside the Fire afternoon window, so Fire only comes from the weather.
const T0 = Date.UTC(2026, 10, 3, 10, 0)
const SUN = { rain: false, sun: true, snow: false, tempC: 27 }
const RAIN = { rain: true, sun: false, snow: false, tempC: 14 }

function env(now: number, patch: Partial<ActionEnv> = {}): ActionEnv {
  return { now, rng: createRng(`seed-${now}`), dev: false, trainerName: 'Ash', ...patch }
}

function must(doc: GameDoc, action: GameAction, e: ActionEnv): GameDoc {
  const r = applyAction(doc, action, e)
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`)
  return r.doc
}

function newPlayer(): GameDoc {
  return must(EMPTY_DOC, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'charmander' }, env(T0))
}

function claim(doc: GameDoc, action: Extract<GameAction, { type: 'claim' }>, e: ActionEnv) {
  const r = applyAction(doc, action, e)
  if (!r.ok) throw new Error(`claim: ${r.error}`)
  return r.result.outcome.result
}

describe('resolveSessionWeather', () => {
  it('detected wins, manual is the fallback, dev manual overrides', () => {
    expect(resolveSessionWeather(SUN, RAIN, false)).toEqual({ weather: SUN, source: 'detected' })
    expect(resolveSessionWeather(null, RAIN, false)).toEqual({ weather: RAIN, source: 'manual' })
    expect(resolveSessionWeather(undefined, null, false)).toEqual({ weather: null, source: 'none' })
    expect(resolveSessionWeather(SUN, RAIN, true)).toEqual({ weather: RAIN, source: 'manual' })
    expect(resolveSessionWeather(SUN, null, true)).toEqual({ weather: SUN, source: 'detected' })
  })
})

describe('session weather', () => {
  it('stores the detected weather on the active session and uses it at claim', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0, { weather: SUN }))
    expect(doc.player?.activeSession?.weather).toEqual(SUN)
    // Changing the manual weather mid-session does not change the session's weather.
    doc = must(doc, { type: 'setWeather', weather: RAIN }, env(T0 + MINUTE_MS))
    const r = claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    expect(r.weather).toEqual(SUN)
    expect(r.conditions).toContain('fire')
    expect(r.conditions).not.toContain('water')
    expect(r.members[0]?.conditionType).toBe('fire')
  })

  it('falls back to the manual weather when detection failed', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'setWeather', weather: RAIN }, env(T0))
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0, { weather: null }))
    expect(doc.player?.activeSession?.weather).toEqual(RAIN)
    const r = claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    expect(r.conditions).toContain('water')
  })

  it('older saves without session weather use profile.weather at claim', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    const s = doc.player!.activeSession!
    const { weather: _w, ...legacy } = s
    void _w
    doc = { ...doc, player: { ...doc.player!, activeSession: legacy, profile: { ...doc.player!.profile, weather: SUN } } }
    const r = claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    expect(r.weather).toEqual(SUN)
  })
})

describe('claim soundProfile', () => {
  it('passes the shares to the session (outside dev too) and activates Flying', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    const sp = { silence: 0.5, music: 0.35, voice: 0.1, noise: 0.05 }
    const r = claim(doc, { type: 'claim', soundProfile: sp }, env(T0 + 31 * MINUTE_MS))
    expect(r.soundProfile).toEqual(sp)
    expect(r.conditions).toContain('flying')
    expect(r.gen.soundDominant).toBe('silence')
  })

  it('without a profile Flying stays off', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    const r = claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    expect(r.soundProfile).toBeNull()
    expect(r.conditions).not.toContain('flying')
    expect(r.gen.soundDominant).toBeNull()
  })

  it('≥ 70 % silence activates Psychic even after an earlier session that day', () => {
    // Two sessions the same day: the second is not "first of the day".
    let d2 = newPlayer()
    d2 = must(d2, { type: 'start', minutes: 30 }, env(T0))
    d2 = must(d2, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    d2 = must(d2, { type: 'dismissResults' }, env(T0 + 32 * MINUTE_MS))
    if (d2.player?.encounter) d2 = must(d2, { type: 'finishWaves' }, env(T0 + 33 * MINUTE_MS))
    d2 = must(d2, { type: 'start', minutes: 30 }, env(T0 + 40 * MINUTE_MS))
    const quiet = claim(d2, { type: 'claim', soundProfile: { silence: 0.8, music: 0.1, voice: 0.05, noise: 0.05 } }, env(T0 + 71 * MINUTE_MS))
    expect(quiet.conditions).toContain('psychic')
    const loud = claim(d2, { type: 'claim', soundProfile: { silence: 0.5, music: 0.1, voice: 0.3, noise: 0.1 } }, env(T0 + 71 * MINUTE_MS))
    expect(loud.conditions).not.toContain('psychic')
  })
})
