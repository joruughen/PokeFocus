/**
 * The server announces its developer tools (GET /api/config). Without them the
 * client must not pretend: dev mode is off, dev headers are not sent, and a
 * shifted clock from an earlier visit is dropped.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DEV_NOW_HEADER, DEV_SEED_HEADER } from '../../game/protocol'
import { devHeaders } from '../api/endpoints'
import { claimErrorText } from '../lib/errors'
import { installFakeServer } from '../test/fakeServer'
import { useGame } from './game'
import { devEnabled, devRequested, now, serverHasDevTools, setServerOffset, usePrefs } from './prefs'
import { useServerConfig } from './serverConfig'

const server = installFakeServer()
afterAll(() => server.restore())

const configGets = () => server.calls.filter((c) => c.method === 'GET' && c.path === '/api/config')

beforeEach(() => {
  server.reset()
  setServerOffset(0)
  useServerConfig.setState({ devTools: null })
  usePrefs.setState((s) => ({ dev: { ...s.dev, panelOpen: true, anchor: null, rate: 1, seed: null, rngCounter: 0 } }))
})

describe('server config store', () => {
  it('loads devTools from GET /api/config (public: no session needed)', async () => {
    await useServerConfig.getState().load()
    expect(configGets()).toHaveLength(1)
    expect(useServerConfig.getState().devTools).toBe(true)
    server.devTools = false
    await useServerConfig.getState().load()
    expect(useServerConfig.getState().devTools).toBe(false)
  })

  it('a failed request leaves it unknown (null), and unknown behaves as before', async () => {
    server.failNext = () => 'network'
    await useServerConfig.getState().load()
    expect(useServerConfig.getState().devTools).toBeNull()
    expect(serverHasDevTools()).toBe(true)
    expect(devEnabled()).toBe(true)
    // A later failure does not erase what we knew.
    useServerConfig.setState({ devTools: false })
    server.failNext = () => 'network'
    await useServerConfig.getState().load()
    expect(useServerConfig.getState().devTools).toBe(false)
  })
})

describe('against a server without developer tools', () => {
  beforeEach(() => {
    server.devTools = false
  })

  it('devEnabled() is off even though the panel was asked for; devRequested() is not', async () => {
    expect(devEnabled()).toBe(true) // not known yet
    await useServerConfig.getState().load()
    expect(devRequested()).toBe(true)
    expect(devEnabled()).toBe(false)
  })

  it('does not send x-dev-now / x-dev-seed, and drops a shifted clock', async () => {
    usePrefs.getState().setDev({ seed: 'abc', rngCounter: 0 })
    usePrefs.getState().advanceClock(3_600_000)
    expect(devHeaders()[DEV_NOW_HEADER]).toBeDefined()
    expect(devHeaders()[DEV_SEED_HEADER]).toBeDefined()
    await useServerConfig.getState().load()
    expect(usePrefs.getState().dev.anchor).toBeNull()
    expect(Math.abs(now() - Date.now())).toBeLessThan(1_000)
    usePrefs.getState().advanceClock(3_600_000) // e.g. a stale tab: still no headers
    expect(devHeaders()).toEqual({})
  })

  it('with the tools on, nothing changes', async () => {
    server.devTools = true
    usePrefs.getState().advanceClock(3_600_000)
    await useServerConfig.getState().load()
    expect(usePrefs.getState().dev.anchor).not.toBeNull()
    expect(devHeaders()[DEV_NOW_HEADER]).toBeDefined()
  })

  it('claim with a shifted clock (config still unknown) is refused as not_finished, with the specific text', async () => {
    const g = () => useGame.getState()
    g().clear()
    await g().load()
    expect(await g().createPlayer({ locale: 'en', timezone: 'America/Lima', starterSlug: 'squirtle' })).toBe(true)
    expect(await g().start(25)).toBeNull()
    await g().devFinishNow() // moves only the client clock
    expect(usePrefs.getState().dev.anchor).not.toBeNull()
    expect(await g().claim()).toBe(false)
    expect(g().error).toBe('not_finished')
    expect(claimErrorText(g().error, usePrefs.getState().dev.anchor !== null)).toMatch(/developer tools/)
    // The dev action buttons answer 403 dev_disabled.
    expect(await g().devAddDust(10)).toBe('dev_disabled')
  })
})
