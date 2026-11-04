import { beforeEach, describe, expect, it } from 'vitest'
import { MINUTE_MS } from '../../engine'
import { phaseOf, useGame } from './game'
import { now, usePrefs } from './prefs'

beforeEach(() => {
  usePrefs.setState((s) => ({ dev: { ...s.dev, anchor: null, rate: 1, seed: 'test', rngCounter: 0, focusLabel: 'studying' } }))
  useGame.getState().resetAll()
  useGame.getState().createPlayer({ trainerName: 'Test', locale: 'es', timezone: 'America/Lima', starterSlug: 'squirtle' })
})

describe('game store: the core loop', () => {
  it('goes idle → focus → paused → focus → claim → results → waves → idle', () => {
    const g = () => useGame.getState()
    const phase = () => phaseOf(g(), now())
    expect(phase()).toBe('idle')
    expect(g().start(25)).toBeNull()
    expect(phase()).toBe('focus')

    const endsAt = g().timer!.endsAt
    g().pause()
    expect(phase()).toBe('paused')
    usePrefs.getState().advanceClock(5 * MINUTE_MS)
    g().resume()
    // Pausing moves the end by the paused time.
    expect(g().timer!.endsAt - endsAt).toBeGreaterThanOrEqual(5 * MINUTE_MS)
    expect(g().timer!.pausedMs).toBeGreaterThanOrEqual(5 * MINUTE_MS)

    g().devFinishNow()
    expect(phase()).toBe('claim')
    expect(g().claim()).toBe(true)
    // Idempotent: nothing to claim twice.
    expect(g().claim()).toBe(false)
    expect(phase()).toBe('results')
    expect(g().outcome!.result.minutes).toBe(25)
    g().dismissResults()
    expect(phase()).toBe(g().player!.encounter ? 'waves' : 'idle')
    g().finishWaves()
    expect(phase()).toBe('idle')
  })

  it('claims late after the window and the engine marks it', () => {
    const g = useGame.getState()
    g.start(25)
    useGame.getState().devFinishNow()
    usePrefs.getState().advanceClock(6 * MINUTE_MS)
    expect(phaseOf(useGame.getState(), now())).toBe('late')
    useGame.getState().claim()
    expect(useGame.getState().outcome!.result.lateClaim).toBe(true)
  })
})
