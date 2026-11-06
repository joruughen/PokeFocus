import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { installFakeServer } from '../test/fakeServer'
import { cancelSessionEnd, resyncSessionEnd, scheduleSessionEnd, sessionEndScheduled, syncSessionEndToAudio } from './sound'

const live = () => bells.filter((b) => !b.stopped)
const server = installFakeServer()
afterAll(() => server.restore())

beforeEach(async () => {
  bells.length = 0
  cancelSessionEnd()
  server.reset()
  usePrefs.setState((s) => ({ dev: { ...s.dev, anchor: null, rate: 1, seed: 'test', rngCounter: 0 } }))
  useGame.getState().clear()
  await useGame.getState().load()
  await useGame.getState().createPlayer({ locale: 'es', timezone: 'America/Lima', starterSlug: 'squirtle' })
})

describe('end-of-session bell vs the dev clock', () => {
  it('re-times the scheduled bell when the clock rate changes mid-session', async () => {
    await useGame.getState().start(25)
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

  it('drops the bell when a time jump passes the end (the watcher rings it instead)', async () => {
    await useGame.getState().start(25)
    const timer = useGame.getState().timer!
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    usePrefs.getState().advanceClock(30 * MINUTE_MS)
    resyncSessionEnd()
    expect(live()).toHaveLength(0)
    expect(sessionEndScheduled(timer.sessionId)).toBe(false)
  })

  it('does nothing in a tab that never scheduled a bell', async () => {
    await useGame.getState().start(25)
    usePrefs.getState().setRate(60)
    resyncSessionEnd()
    expect(bells).toHaveLength(0)
  })
})

describe('end-of-session bell when audio starts running (reload, then a tap)', () => {
  it('the leader tab schedules the bell for the running session', async () => {
    await useGame.getState().start(25)
    const timer = useGame.getState().timer!
    syncSessionEndToAudio(true)
    expect(live()).toHaveLength(1)
    expect(live()[0]!.delaySec).toBeGreaterThan(24 * 60)
    expect(sessionEndScheduled(timer.sessionId)).toBe(true)
  })

  it('another tab does not (no double bell)', async () => {
    await useGame.getState().start(25)
    syncSessionEndToAudio(false)
    expect(bells).toHaveLength(0)
  })

  it('re-times a bell this tab scheduled while the audio clock was frozen', async () => {
    await useGame.getState().start(25)
    const timer = useGame.getState().timer!
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    usePrefs.getState().advanceClock(10 * MINUTE_MS)
    syncSessionEndToAudio(false)
    expect(live()).toHaveLength(1)
    expect(live()[0]!.delaySec).toBeLessThan(15 * 60 + 1)
  })

  it('nothing while paused or without a session', async () => {
    syncSessionEndToAudio(true)
    await useGame.getState().start(25)
    await useGame.getState().pause()
    syncSessionEndToAudio(true)
    expect(bells).toHaveLength(0)
  })
})
