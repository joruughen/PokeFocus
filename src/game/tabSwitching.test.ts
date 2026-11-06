/// <reference types="vite/client" />
/**
 * Product rule (GDD principle 5): a player may need other tabs or apps as part
 * of studying, so switching tabs never costs rewards. The timer is
 * timestamp-based and the engine and the server are the only places that decide
 * rewards; neither may read anything about the page being visible or focused.
 * (The UI may react to visibility for comfort — audio, notifications, titles —
 * but never to the player's loss; see docs/GDD.md.)
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>(
  ['../engine/*.ts', '../game/*.ts', '../../server/**/*.ts', '!../**/*.test.ts', '!../../server/**/*.test.ts'],
  { query: '?raw', import: 'default', eager: true },
)

describe('switching tabs never costs the player', () => {
  it('the engine, the reducer and the server never read page visibility or window focus', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
    const re = /\b(visibilitychange|visibilityState|document\.hidden|pagehide|pageshow|window\.(?:onblur|onfocus)|addEventListener\(\s*['"](?:blur|focus)['"])/
    const offenders = Object.entries(sources)
      .filter(([, src]) => re.test(src))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
