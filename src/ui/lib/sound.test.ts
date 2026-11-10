import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake audio clock: records every scheduled bell and whether it was stopped.
const bells: { delaySec: number; stopped: boolean }[] = []
const played: string[] = []
let audioState = 'running'
vi.mock('../../audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../audio')>()),
  audio: {
    sfx: (name: string) => {
      played.push(name)
      return null
    },
    getSnapshot: () => ({ state: audioState }),
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
import {
  cancelSessionEnd,
  chimeUnlessOtherTabRings,
  dropBellClaim,
  resyncSessionEnd,
  scheduleSessionEnd,
  sessionEndScheduled,
  syncSessionEndToAudio,
} from './sound'

const live = () => bells.filter((b) => !b.stopped)
const server = installFakeServer()
afterAll(() => {
  server.restore()
  vi.unstubAllGlobals()
})

/** Web Locks stand-in shared by every "tab" of a test (one module instance plays all tabs). */
function fakeLocks() {
  const held = new Set<string>()
  return {
    held,
    request: async (name: string, a: unknown, b?: unknown) => {
      const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean }
      const cb = (typeof a === 'function' ? a : b) as (lock: { name: string } | null) => unknown
      if (held.has(name)) {
        if (opts.ifAvailable) return cb(null)
        return new Promise(() => undefined) // a real queue is not needed here
      }
      held.add(name)
      try {
        return await cb({ name })
      } finally {
        held.delete(name)
      }
    },
  }
}
let locks = fakeLocks()
/** Another tab holding the bell claim (its audio clock is running and has the bell). */
const otherTabClaims = (key: string) => void locks.request(`pokefocus-end-bell:${key}`, () => new Promise(() => undefined))

beforeEach(async () => {
  bells.length = 0
  played.length = 0
  audioState = 'running'
  locks = fakeLocks()
  vi.stubGlobal('navigator', { locks })
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

describe('one end sound across tabs (QA R-03)', () => {
  const claimOf = (key: string) => `pokefocus-end-bell:${key}`

  async function startSession() {
    await useGame.getState().start(25)
    return useGame.getState().timer!
  }

  it('the leader stays silent when the tab that started the session rings the bell', async () => {
    const timer = await startSession()
    otherTabClaims(timer.sessionId) // tab B (not the leader) scheduled the bell on a running clock
    await chimeUnlessOtherTabRings(timer.sessionId) // the leader tab A at the end
    expect(played).toEqual([])
  })

  it('the leader chimes when no other tab has a bell (reload, or the starter never unlocked audio)', async () => {
    const timer = await startSession()
    await chimeUnlessOtherTabRings(timer.sessionId)
    expect(played).toEqual(['sessionEnd'])
  })

  it('the leader chimes when the other tab closed (its lock is released)', async () => {
    const timer = await startSession()
    otherTabClaims(timer.sessionId)
    locks.held.clear() // tab B closed
    await chimeUnlessOtherTabRings(timer.sessionId)
    expect(played).toEqual(['sessionEnd'])
  })

  it('a tab with its own bell on the audio clock does not chime on top of it', async () => {
    const timer = await startSession()
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    await chimeUnlessOtherTabRings(timer.sessionId)
    expect(played).toEqual([])
  })

  it('a bell on a running clock claims the session; cancelling gives the claim back', async () => {
    const timer = await startSession()
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    await Promise.resolve()
    expect(locks.held.has(claimOf(timer.sessionId))).toBe(true)
    cancelSessionEnd()
    await Promise.resolve()
    expect(locks.held.has(claimOf(timer.sessionId))).toBe(false)
  })

  it('a bell on a suspended clock does not claim (the leader must still chime)', async () => {
    audioState = 'suspended'
    const timer = await startSession()
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    await Promise.resolve()
    expect(locks.held.size).toBe(0)
    // The tap that unlocks audio re-times the bell and claims the session.
    audioState = 'running'
    syncSessionEndToAudio(false)
    await Promise.resolve()
    expect(locks.held.has(claimOf(timer.sessionId))).toBe(true)
  })

  it('dropBellClaim lets the leader chime when the context stops running', async () => {
    const timer = await startSession()
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    await Promise.resolve()
    audioState = 'suspended'
    dropBellClaim()
    await Promise.resolve()
    expect(locks.held.size).toBe(0)
  })

  it('a single tab (leader that started the session) rings exactly once', async () => {
    const timer = await startSession()
    scheduleSessionEnd(timer.sessionId, timer.endsAt)
    await chimeUnlessOtherTabRings(timer.sessionId)
    expect(live()).toHaveLength(1)
    expect(played).toEqual([])
  })

  it('without Web Locks the leader chimes as before', async () => {
    vi.stubGlobal('navigator', {})
    const timer = await startSession()
    await chimeUnlessOtherTabRings(timer.sessionId)
    expect(played).toEqual(['sessionEnd'])
  })
})
