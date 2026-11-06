import { describe, expect, it } from 'vitest'
import { createRng, MINUTE_MS } from '../engine'
import { applyAction, type ActionEnv } from './actions'
import { EMPTY_DOC, type GameAction, type GameDoc } from './protocol'
import { resolveSessionWeather, toGeoCell } from './weather'

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
  it('detected (location or city) or nothing; the manual weather only counts in dev', () => {
    expect(resolveSessionWeather(SUN, RAIN, false)).toEqual({ weather: SUN, source: 'detected' })
    expect(resolveSessionWeather(null, RAIN, false)).toEqual({ weather: null, source: 'none' })
    expect(resolveSessionWeather(undefined, null, false)).toEqual({ weather: null, source: 'none' })
    expect(resolveSessionWeather(SUN, RAIN, true)).toEqual({ weather: RAIN, source: 'manual' })
    expect(resolveSessionWeather(null, RAIN, true)).toEqual({ weather: RAIN, source: 'manual' })
    expect(resolveSessionWeather(SUN, null, true)).toEqual({ weather: SUN, source: 'detected' })
  })
})

describe('location cells', () => {
  it('rounds to 0.1° and wraps the longitude', () => {
    expect(toGeoCell(-12.0464, -77.0428)).toEqual({ lat: -12, lon: -77 })
    expect(toGeoCell(40.4168, -3.7038)).toEqual({ lat: 40.4, lon: -3.7 })
    expect(toGeoCell(0.04, -0.04)).toEqual({ lat: 0, lon: 0 }) // no −0
    expect(toGeoCell(10, 181)).toEqual({ lat: 10, lon: -179 })
    expect(toGeoCell(10, -180)).toEqual({ lat: 10, lon: 180 })
    expect(toGeoCell(91, 0)).toBeNull()
    expect(toGeoCell(Number.NaN, 0)).toBeNull()
  })

  it('updateProfile stores only the rounded cell, and null clears it', () => {
    let doc = newPlayer()
    expect(doc.player?.profile.location ?? null).toBeNull()
    doc = must(doc, { type: 'updateProfile', patch: { location: { lat: 51.50735, lon: -0.12776 } } }, env(T0))
    expect(doc.player?.profile.location).toEqual({ lat: 51.5, lon: -0.1 })
    doc = must(doc, { type: 'updateProfile', patch: { location: null } }, env(T0))
    expect(doc.player?.profile.location).toBeNull()
  })
})

describe('manual weather is dev-only', () => {
  it('setWeather is refused outside dev', () => {
    const r = applyAction(newPlayer(), { type: 'setWeather', weather: RAIN }, env(T0))
    expect(r).toEqual({ ok: false, error: 'dev_disabled' })
  })

  it('an old save with profile.weather gets no weather in production, and gets it in dev', () => {
    const base = newPlayer()
    const old = { ...base, player: { ...base.player!, profile: { ...base.player!.profile, weather: RAIN } } }
    const prod = must(old, { type: 'start', minutes: 30 }, env(T0, { weather: null }))
    expect(prod.player?.activeSession?.weather).toBeNull()
    expect(claim(prod, { type: 'claim' }, env(T0 + 31 * MINUTE_MS)).conditions).not.toContain('water')
    const dev = must(old, { type: 'start', minutes: 30 }, env(T0, { weather: SUN, dev: true }))
    expect(dev.player?.activeSession?.weather).toEqual(RAIN)
  })
})

describe('session weather', () => {
  it('stores the detected weather on the active session and uses it at claim', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0, { weather: SUN }))
    expect(doc.player?.activeSession?.weather).toEqual(SUN)
    // Changing the (dev) manual weather mid-session does not change the session's weather.
    doc = must(doc, { type: 'setWeather', weather: RAIN }, env(T0 + MINUTE_MS, { dev: true }))
    const r = claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    expect(r.weather).toEqual(SUN)
    expect(r.conditions).toContain('fire')
    expect(r.conditions).not.toContain('water')
    expect(r.members[0]?.conditionType).toBe('fire')
  })

  it('nothing detected → the session has no weather', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0, { weather: null }))
    expect(doc.player?.activeSession?.weather).toBeNull()
    const r = claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS))
    expect(r.conditions).not.toContain('water')
    expect(r.conditions).not.toContain('fire') // 10:00, outside the afternoon window
  })

  it('older saves without session weather: no weather at claim in production, profile.weather in dev', () => {
    let doc = newPlayer()
    doc = must(doc, { type: 'start', minutes: 30 }, env(T0))
    const s = doc.player!.activeSession!
    const { weather: _w, ...legacy } = s
    void _w
    doc = { ...doc, player: { ...doc.player!, activeSession: legacy, profile: { ...doc.player!.profile, weather: SUN } } }
    expect(claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS)).weather).toBeNull()
    expect(claim(doc, { type: 'claim' }, env(T0 + 31 * MINUTE_MS, { dev: true })).weather).toEqual(SUN)
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
