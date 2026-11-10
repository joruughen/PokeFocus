import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MINUTE_MS } from '../../engine'
import { DEV_NOW_HEADER, DEV_SEED_HEADER } from '../../game/protocol'
import { installFakeServer } from '../test/fakeServer'
import { phaseOf, useGame } from './game'
import { getServerOffset, now, setServerOffset, usePrefs } from './prefs'

const server = installFakeServer()
afterAll(() => server.restore())

beforeEach(async () => {
  server.reset()
  setServerOffset(0)
  usePrefs.setState((s) => ({ dev: { ...s.dev, anchor: null, rate: 1, seed: 'test', rngCounter: 0, focusLabel: 'studying' } }))
  useGame.getState().clear()
  expect(await useGame.getState().load()).toBe(true)
  expect(await useGame.getState().createPlayer({ locale: 'es', timezone: 'America/Lima', starterSlug: 'squirtle' })).toBe(true)
})

describe('game store: a cache of the server doc', () => {
  it('goes idle → focus → paused → focus → claim → results → waves → idle', async () => {
    const g = () => useGame.getState()
    const phase = () => phaseOf(g(), now())
    expect(g().player!.profile.trainerName).toBe('Test') // the server uses the account name
    expect(phase()).toBe('idle')
    expect(await g().start(25)).toBeNull()
    expect(phase()).toBe('focus')

    const endsAt = g().timer!.endsAt
    expect(await g().pause()).toBeNull()
    expect(phase()).toBe('paused')
    usePrefs.getState().advanceClock(5 * MINUTE_MS)
    expect(await g().resume()).toBeNull()
    // Pausing moves the end by the paused time (the dev clock travels as x-dev-now).
    expect(g().timer!.endsAt - endsAt).toBeGreaterThanOrEqual(5 * MINUTE_MS)
    expect(g().timer!.pausedMs).toBeGreaterThanOrEqual(5 * MINUTE_MS)

    await g().devFinishNow()
    expect(phase()).toBe('claim')
    expect(await g().claim()).toBe(true)
    // Idempotent: nothing to claim twice.
    expect(await g().claim()).toBe(false)
    expect(phase()).toBe('results')
    expect(g().outcome!.result.minutes).toBe(25)
    expect(await g().dismissResults()).toBeNull()
    expect(phase()).toBe(g().player!.encounter ? 'waves' : 'idle')
    expect(await g().finishWaves()).toBeNull()
    expect(phase()).toBe('idle')
    expect(g().pending).toBe(0)
  })

  it('claims late after the window and the engine marks it', async () => {
    await useGame.getState().start(25)
    await useGame.getState().devFinishNow()
    usePrefs.getState().advanceClock(6 * MINUTE_MS)
    expect(phaseOf(useGame.getState(), now())).toBe('late')
    expect(await useGame.getState().claim()).toBe(true)
    expect(useGame.getState().outcome!.result.lateClaim).toBe(true)
  })

  it('returns rule errors from a 409 and keeps the doc', async () => {
    const before = useGame.getState().version
    expect(await useGame.getState().start(3)).toBe('invalid_duration')
    expect(useGame.getState().error).toBe('invalid_duration')
    expect(useGame.getState().player!.activeSession).toBeNull()
    expect(useGame.getState().version).toBe(before)
  })

  it('reports network failures without touching the doc', async () => {
    const player = useGame.getState().player
    server.failNext = () => 'network'
    expect(await useGame.getState().start(25)).toBe('network')
    expect(useGame.getState().player).toBe(player)
    expect(useGame.getState().pending).toBe(0)
  })

  it('ignores responses older than the doc it holds', async () => {
    const g = useGame.getState()
    const v = g.version
    // Another tab moved ahead: we learn version v+5 first, then a stale v+1 response arrives.
    useGame.setState({ version: v + 5 })
    expect(await g.setWeather(null)).toBeNull()
    expect(useGame.getState().version).toBe(v + 5)
  })

  it('sends the dev clock and seed as headers only when set', async () => {
    usePrefs.setState((s) => ({ dev: { ...s.dev, seed: null } }))
    await useGame.getState().setWeather(null)
    let last = server.calls.at(-1)!
    expect(last.headers[DEV_NOW_HEADER]).toBeUndefined()
    expect(last.headers[DEV_SEED_HEADER]).toBeUndefined()
    expect(last.headers['content-type']).toBe('application/json')

    usePrefs.setState((s) => ({ dev: { ...s.dev, seed: 'abc', rngCounter: 0 } }))
    usePrefs.getState().advanceClock(MINUTE_MS)
    await useGame.getState().setWeather(null)
    last = server.calls.at(-1)!
    expect(Number(last.headers[DEV_NOW_HEADER])).toBeGreaterThan(Date.now() + 50_000)
    expect(last.headers[DEV_SEED_HEADER]).toBe('abc:0')
  })

  it('maps action results (feedCandy, claimAllMissions)', async () => {
    const g = useGame.getState()
    await g.devAddCandies(5)
    await g.devAddDust(5000)
    const r = await useGame.getState().feedCandy('p1', { kind: 'species' }, 2)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.used).toBe(2)
      expect(r.dustSpent).toBeGreaterThan(0)
    }
    expect(usePrefs.getState().milestones.candy).toBeDefined()
    expect(Array.isArray(await useGame.getState().claimAllMissions())).toBe(true)
  })

  it('clear() forgets the doc (logout)', () => {
    useGame.getState().clear()
    const s = useGame.getState()
    expect(s.player).toBeNull()
    expect(s.loaded).toBe(false)
    expect(s.version).toBe(-1)
  })
})

describe('game store: nicknames and saved teams', () => {
  it('sets and removes a nickname through the server, which also validates it', async () => {
    const g = () => useGame.getState()
    expect(await g().setNickname('p1', '  Monito ')).toBeNull()
    expect(g().player!.pokemon.p1!.nickname).toBe('Monito')
    expect(await g().setNickname('p1', 'WWWWWWWWWWWWW')).toBe('nickname_too_long')
    expect(g().player!.pokemon.p1!.nickname).toBe('Monito')
    expect(await g().setNickname('p1', null)).toBeNull()
    expect(g().player!.pokemon.p1!.nickname).toBeUndefined()
  })
  it('saves, applies, renames, overwrites and deletes a team; switching is refused during a session', async () => {
    const g = () => useGame.getState()
    expect(await g().savePreset('Estudio')).toEqual({ ok: true, id: 't1' })
    expect(await g().renamePreset('t1', 'Repaso')).toBeNull()
    expect(g().player!.teamPresets).toEqual([{ id: 't1', name: 'Repaso', uids: ['p1'] }])
    expect(await g().applyPreset('t1')).toEqual({ ok: true, missing: 0 })
    expect(await g().overwritePreset('t1')).toBeNull()
    expect(await g().start(25)).toBeNull()
    expect(await g().applyPreset('t1')).toEqual({ ok: false, error: 'session_active' })
    expect(await g().cancel()).toEqual({ ok: true, outcome: null })
    expect(await g().deletePreset('t1')).toBeNull()
    expect(g().player!.teamPresets).toEqual([])
    expect(await g().applyPreset('t1')).toEqual({ ok: false, error: 'unknown_preset' })
  })
})

describe('clock skew', () => {
  it('estimates the server offset from serverNow and applies it to now()', async () => {
    const skewed = installFakeServer({ skewMs: 120_000 })
    try {
      useGame.getState().clear()
      await useGame.getState().load()
      expect(Math.abs(getServerOffset() - 120_000)).toBeLessThan(1000)
      expect(Math.abs(now() - (Date.now() + 120_000))).toBeLessThan(1000)
    } finally {
      skewed.restore()
      setServerOffset(0)
    }
  })
})
