import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake audio clock: records every scheduled bell and whether it was stopped.
const bells: { delaySec: number; stopped: boolean }[] = []
vi.mock('../../audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../audio')>()),
  audio: {
    sfx: () => null,
    sfxAt: (_name: string, delaySec: number) => {
      const bell = { delaySec, stopped: false }
      bells.push(bell)
      return { stop: () => (bell.stopped = true) }
    },
  },
}))

import { MINUTE_MS } from '../../engine'
import { useGame } from '../store/game'
import { usePrefs } from '../store/prefs'
import { cancelSessionEnd, resyncSessionEnd, scheduleSessionEnd, sessionEndScheduled } from './sound'

const live = () => bells.filter((b) => !b.stopped)

beforeEach(() => {
  bells.length = 0
  cancelSessionEnd()
  usePrefs.setState((s) => ({ dev: { ...s.dev, anchor: null, rate: 1, seed: 'test', rngCounter: 0 } }))
  useGame.getState().resetAll()
  useGame.getState().createPlayer({ trainerName: 'Test', locale: 'es', timezone: 'America/Lima', starterSlug: 'squirtle' })
})

describe('end-of-session bell vs the dev clock', () => {
  it('re-times the scheduled bell when the clock rate changes mid-session', () => {
    useGame.getState().start(25)
    const timer = useGame.getState().timer!
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    expect(live()).toHaveLength(1)
    expect(live()[0]!.delaySec).toBeGreaterThan(24 * 60) // real time: ~25 min

    usePrefs.getState().setRate(60)
    resyncSessionEnd() // SessionWatcher calls this when dev.anchor changes
    expect(live()).toHaveLength(1) // the old one was cancelled, a new one exists
    expect(live()[0]!.delaySec).toBeLessThan(26) // 25 game minutes = 25 real seconds
    expect(live()[0]!.delaySec).toBeGreaterThan(23)
    expect(sessionEndScheduled(timer.sessionId)).toBe(true)
  })

  it('drops the bell when a time jump passes the end (the watcher rings it instead)', () => {
    useGame.getState().start(25)
    const timer = useGame.getState().timer!
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    usePrefs.getState().advanceClock(30 * MINUTE_MS)
    resyncSessionEnd()
    expect(live()).toHaveLength(0)
    expect(sessionEndScheduled(timer.sessionId)).toBe(false)
  })

  it('does nothing in a tab that never scheduled a bell', () => {
    useGame.getState().start(25)
    usePrefs.getState().setRate(60)
    resyncSessionEnd()
    expect(bells).toHaveLength(0)
  })
})
