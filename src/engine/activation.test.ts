import { describe, expect, it } from 'vitest'
import { conditionOutlook, conditionMaxMult, nextActivation, type Activation } from './activation'
import { ALL_TYPES, typeConditionMult } from './conditions'
import { defaultContext } from './context'
import type { TypeSlug } from './data-types'
import { conditionEnvAt } from './session'
import type { PlayerState } from './state'
import { MIN, makeMon, makePlayer, T0 } from './test-helpers'
import { addDays, dayKeyOf, localToTs, startOfLocalDay, toLocal } from './time'

const cfg = defaultContext().config
const HOUR = 60 * MIN
const TODAY = '2026-11-03' // Tuesday, T0 = 10:00 UTC and the profile zone is UTC

const player = (patch: Partial<PlayerState> = {}) => makePlayer([makeMon('bulbasaur', 20, { uid: 'a' })], patch)
const act = (type: TypeSlug, state: PlayerState, from = T0, minutes = 25, weather: null | undefined = null): Activation =>
  nextActivation(type, state, from, minutes, weather === undefined ? {} : { weather })
const at = (day: string, hour: number, minute = 0) => localToTs(day, hour * 60 + minute, 0)

describe('localToTs', () => {
  it('maps a local wall-clock time to an instant, DST included', () => {
    expect(localToTs(TODAY, 600, 0)).toBe(T0)
    expect(startOfLocalDay(TODAY, 0)).toBe(Date.UTC(2026, 10, 3))
    // Europe/Madrid left DST on 2026-10-25: 05:00 that day is UTC+1, the day before it was UTC+2.
    const before = localToTs('2026-10-24', 5 * 60, 'Europe/Madrid')
    const after = localToTs('2026-10-25', 5 * 60, 'Europe/Madrid')
    expect(toLocal(before, 'Europe/Madrid')).toMatchObject({ hour: 5, minute: 0, day: 24 })
    expect(toLocal(after, 'Europe/Madrid')).toMatchObject({ hour: 5, minute: 0, day: 25 })
    expect((after - before) / HOUR).toBe(25)
    expect(localToTs(TODAY, 1440, 0)).toBe(Date.UTC(2026, 10, 4))
  })
})

describe('hour windows (Fire, Grass, Ghost)', () => {
  it('Grass is on until noon in the morning', () => {
    const a = act('grass', player())
    expect(a).toEqual({ kind: 'window', inWindow: true, at: null, until: at(TODAY, 12), orSun: false })
  })

  it('Grass in the afternoon: tomorrow at 05:00', () => {
    const a = act('grass', player(), at(TODAY, 13, 30))
    expect(a).toEqual({ kind: 'window', inWindow: false, at: at('2026-11-04', 5), until: null, orSun: false })
  })

  it('Ghost: tonight, and a night window that wraps midnight', () => {
    expect(act('ghost', player())).toMatchObject({ inWindow: false, at: at(TODAY, 20) })
    expect(act('ghost', player(), at(TODAY, 23))).toMatchObject({ inWindow: true, until: at('2026-11-04', 5) })
    expect(act('ghost', player(), at('2026-11-04', 3))).toMatchObject({ inWindow: true, until: at('2026-11-04', 5) })
  })

  it('Fire also lists the sun as another way in', () => {
    expect(act('fire', player())).toMatchObject({ inWindow: false, at: at(TODAY, 12), orSun: true })
    // Sunny at 10:00: on although outside the window.
    const sunny = { rain: false, sun: true, tempC: 20 }
    const s = nextActivation('fire', player(), T0, 25, { weather: sunny })
    expect(s).toMatchObject({ kind: 'window', inWindow: false, orSun: true })
    expect(typeConditionMult('fire', conditionEnvAt(player(), T0, 25, { weather: sunny }), cfg)).toBeGreaterThan(1)
  })

  it('works in the profile time zone', () => {
    // 12:00 UTC is 07:00 in Lima: Grass is on there, and ends at 12:00 Lima = 17:00 UTC.
    const lima = player({ profile: { ...player().profile, timezone: 'America/Lima' } })
    const a = nextActivation('grass', lima, at(TODAY, 12), 25, { weather: null })
    expect(a).toMatchObject({ inWindow: true, until: Date.UTC(2026, 10, 3, 17) })
  })
})

describe('Ground (weekend)', () => {
  it('on a weekday it points at the next Saturday 00:00', () => {
    const a = act('ground', player())
    expect(a).toEqual({ kind: 'weekend', at: Date.UTC(2026, 10, 7), until: null })
    expect(toLocal(Date.UTC(2026, 10, 7), 0).weekday).toBe(6)
  })

  it('on Saturday and Sunday it is on until Monday 00:00', () => {
    expect(act('ground', player(), at('2026-11-07', 9))).toEqual({ kind: 'weekend', at: null, until: Date.UTC(2026, 10, 9) })
    expect(act('ground', player(), at('2026-11-08', 22))).toEqual({ kind: 'weekend', at: null, until: Date.UTC(2026, 10, 9) })
  })

  it('on Friday it is tomorrow, on Monday five days away', () => {
    expect(act('ground', player(), at('2026-11-06', 9))).toMatchObject({ at: Date.UTC(2026, 10, 7) })
    expect(act('ground', player(), at('2026-11-09', 9))).toMatchObject({ at: Date.UTC(2026, 10, 14) })
  })
})

describe('Psychic (first session of the day)', () => {
  it('is on with no session today', () => {
    expect(act('psychic', player())).toMatchObject({ kind: 'firstOfDay', at: null, silencePct: 70 })
  })

  it('waits for tomorrow once today has a session', () => {
    const s = player({ days: { [TODAY]: { minutes: 25, sessions: 1, firstStartMinute: 9 * 60 } } })
    expect(act('psychic', s)).toMatchObject({ kind: 'firstOfDay', at: Date.UTC(2026, 10, 4) })
  })
})

describe('Steel (same hour as yesterday)', () => {
  const withYesterday = (minute: number) => player({ days: { '2026-11-02': { minutes: 25, sessions: 1, firstStartMinute: minute } } })

  it('without a session yesterday there is nothing to compare with', () => {
    expect(act('steel', player())).toEqual({ kind: 'sameHour', windowMinutes: 60, at: null, until: null, hasReference: false })
  })

  it('gives today\'s window when it has not opened yet', () => {
    // Yesterday 18:10 → today 17:10 to 19:10.
    expect(act('steel', withYesterday(18 * 60 + 10))).toEqual({
      kind: 'sameHour', windowMinutes: 60, at: at(TODAY, 17, 10), until: at(TODAY, 19, 10), hasReference: true,
    })
  })

  it('is on inside the window, with the end of it', () => {
    expect(act('steel', withYesterday(10 * 60 + 30), T0)).toMatchObject({ at: null, until: at(TODAY, 11, 30), hasReference: true })
  })

  it('after the window has passed it points at tomorrow, which uses today as the reference', () => {
    const s = player({
      days: {
        '2026-11-02': { minutes: 25, sessions: 1, firstStartMinute: 8 * 60 },
        [TODAY]: { minutes: 25, sessions: 1, firstStartMinute: 9 * 60 + 30 },
      },
    })
    // At 14:00 today's 07:00–09:00 window is gone; tomorrow it is 08:30–10:30.
    expect(act('steel', s, at(TODAY, 14))).toMatchObject({ at: at('2026-11-04', 8, 30), until: at('2026-11-04', 10, 30), hasReference: true })
  })

  it('a window around midnight wraps', () => {
    const s = player({ days: { '2026-11-02': { minutes: 25, sessions: 1, firstStartMinute: 30 } } })
    // Reference 00:30: minutes 00:00–01:30 and 23:30–23:59 of the same date.
    const a = act('steel', s, at(TODAY, 12))
    expect(a).toMatchObject({ at: at(TODAY, 23, 30), until: at(TODAY, 23, 59) })
  })
})

describe('Electric (chained short sessions)', () => {
  it('is on within the gap of a short session, until the deadline', () => {
    const s = player({ lastSessionEndedAt: T0 - 5 * MIN })
    expect(act('electric', s, T0, 25)).toEqual({ kind: 'chain', maxMinutes: 25, gapMinutes: 15, durationOk: true, until: T0 + 10 * MIN })
    expect(typeConditionMult('electric', conditionEnvAt(s, T0, 25), cfg)).toBeGreaterThan(1)
  })

  it('a long session is off but the open gap is reported', () => {
    const s = player({ lastSessionEndedAt: T0 - 5 * MIN })
    expect(act('electric', s, T0, 50)).toMatchObject({ durationOk: false, until: T0 + 10 * MIN })
  })

  it('there is no deadline once the gap has passed or without a previous session', () => {
    expect(act('electric', player({ lastSessionEndedAt: T0 - 60 * MIN }))).toMatchObject({ durationOk: true, until: null })
    expect(act('electric', player())).toMatchObject({ until: null })
  })
})

describe('streak and comeback', () => {
  it('Dragon: counts the running streak and the day it is reached', () => {
    const s = player({ streak: { current: 3, best: 3, lastDayKey: TODAY, gapBeforeLastDay: 0, protectUsedWeek: null } })
    // Studied today with 3 days: 4 more days of studying, the 7th day is 2026-11-07.
    expect(act('dragon', s)).toEqual({ kind: 'streak', needed: 7, have: 3, at: startOfLocalDay('2026-11-07', 0) })
  })

  it('Dragon: yesterday\'s streak of 6 makes a session today the 7th day', () => {
    const s = player({ streak: { current: 6, best: 6, lastDayKey: '2026-11-02', gapBeforeLastDay: 0, protectUsedWeek: null } })
    expect(act('dragon', s)).toEqual({ kind: 'streak', needed: 7, have: 6, at: null })
    expect(typeConditionMult('dragon', conditionEnvAt(s, T0, 25), cfg)).toBeGreaterThan(1)
  })

  it('Dragon: a broken streak starts over', () => {
    const s = player({ streak: { current: 5, best: 5, lastDayKey: '2026-10-30', gapBeforeLastDay: 0, protectUsedWeek: null } })
    expect(act('dragon', s)).toMatchObject({ have: 0, at: startOfLocalDay('2026-11-09', 0) })
  })

  it('Dark: on when today is the return after 2+ days, else the first day it would apply', () => {
    const away = player({ streak: { current: 4, best: 4, lastDayKey: '2026-10-31', gapBeforeLastDay: 0, protectUsedWeek: null } })
    expect(act('dark', away)).toEqual({ kind: 'comeback', needed: 2, have: 2, at: null })
    const recent = player({ streak: { current: 4, best: 4, lastDayKey: '2026-11-02', gapBeforeLastDay: 0, protectUsedWeek: null } })
    const a = act('dark', recent)
    // Last session Monday: skipping Tue and Wed, Thursday 2026-11-05 is the return.
    expect(a).toEqual({ kind: 'comeback', needed: 2, have: 0, at: startOfLocalDay('2026-11-05', 0) })
  })

  it('Dark: no history, no date', () => {
    expect(act('dark', player({ streak: { current: 0, best: 0, lastDayKey: null, gapBeforeLastDay: 0, protectUsedWeek: null } }))).toMatchObject({ at: null })
  })
})

describe('rule-only types', () => {
  it('carry the numbers the UI needs, from the config', () => {
    const s = player({ days: { [TODAY]: { minutes: 25, sessions: 2, firstStartMinute: 9 * 60 } } })
    expect(act('normal', s)).toEqual({ kind: 'always' })
    expect(act('water', s)).toEqual({ kind: 'weather', weather: 'rain' })
    expect(act('ice', s)).toEqual({ kind: 'weather', weather: 'cold' })
    expect(act('fighting', s)).toEqual({ kind: 'duration', minMinutes: 50 })
    expect(act('poison', s)).toEqual({ kind: 'sessions', have: 2, perSessionPct: 8, maxPct: 40 })
    expect(act('flying', s)).toEqual({ kind: 'sound', sharePct: 30 })
    expect(act('bug', s)).toEqual({ kind: 'team', have: 0, perBugPct: 7 })
    expect(act('rock', s)).toEqual({ kind: 'noPause' })
    expect(act('fairy', s)).toEqual({ kind: 'friend', maxPct: 40 })
  })

  it('Bug counts the Bug-type members of the team', () => {
    const s = makePlayer([makeMon('caterpie', 10, { uid: 'a' }), makeMon('metapod', 10, { uid: 'b' }), makeMon('bulbasaur', 10, { uid: 'c' })])
    expect(act('bug', s)).toMatchObject({ have: 2 })
  })
})

describe('conditionOutlook', () => {
  it('lists the 18 types with the engine multiplier and max', () => {
    const s = player()
    const rows = conditionOutlook(s, T0, 25, { weather: null })
    expect(rows.map((r) => r.type)).toEqual([...ALL_TYPES])
    const env = conditionEnvAt(s, T0, 25, { weather: null })
    for (const r of rows) {
      expect(r.mult).toBe(typeConditionMult(r.type, env, cfg))
      expect(r.active).toBe(r.mult > 1)
      expect(r.maxMult).toBeGreaterThanOrEqual(r.mult)
    }
    // 10:00 UTC on a Tuesday, first session: Normal, Grass and Psychic are on.
    expect(rows.filter((r) => r.active).map((r) => r.type)).toEqual(['normal', 'grass', 'psychic', 'rock'])
  })

  it('maxMult: variable types top out at their cap', () => {
    expect(conditionMaxMult('poison', cfg)).toBe(1.4)
    expect(conditionMaxMult('bug', cfg)).toBeCloseTo(1.42)
    expect(conditionMaxMult('water', cfg)).toBe(1.5)
    expect(conditionMaxMult('normal', cfg)).toBe(1.1)
  })

  it('uses the profile weather unless the caller says otherwise', () => {
    const rainy = player({ profile: { ...player().profile, weather: { rain: true, sun: false, tempC: 15 } } })
    expect(conditionOutlook(rainy, T0, 25).find((r) => r.type === 'water')?.active).toBe(true)
    expect(conditionOutlook(rainy, T0, 25, { weather: null }).find((r) => r.type === 'water')?.active).toBe(false)
  })

  it('a planned start recomputes the table (hour, weekday, duration)', () => {
    const s = player()
    const sat = conditionOutlook(s, at('2026-11-07', 22), 60, { weather: null })
    const on = sat.filter((r) => r.active).map((r) => r.type)
    expect(on).toEqual(expect.arrayContaining(['normal', 'ghost', 'ground', 'fighting', 'psychic']))
    expect(on).not.toContain('grass')
  })
})

describe('the computed instant really turns the condition on (consistency with typeConditionMult)', () => {
  const states: PlayerState[] = [
    player(),
    player({ days: { [TODAY]: { minutes: 25, sessions: 2, firstStartMinute: 9 * 60 }, '2026-11-02': { minutes: 50, sessions: 1, firstStartMinute: 15 * 60 + 20 } } }),
    player({ streak: { current: 2, best: 4, lastDayKey: '2026-11-02', gapBeforeLastDay: 0, protectUsedWeek: null } }),
    player({ profile: { ...player().profile, timezone: 'Europe/Madrid' } }),
  ]
  const TIMED: TypeSlug[] = ['fire', 'grass', 'ghost', 'ground', 'psychic', 'steel', 'dark']

  it.each(states.map((s, i) => [i, s] as const))('state %i: every `at` is on, and a minute earlier it is off', (_i, s) => {
    let checked = 0
    for (let k = 0; k < 40; k++) {
      const from = T0 + k * 5 * HOUR + k * 7 * MIN
      for (const type of TIMED) {
        const a = nextActivation(type, s, from, 25, { weather: null })
        const target = 'at' in a ? a.at : null
        if (target === null || target === undefined) continue
        checked++
        const on = typeConditionMult(type, conditionEnvAt(s, target, 25, { weather: null }), cfg)
        const before = typeConditionMult(type, conditionEnvAt(s, target - MIN, 25, { weather: null }), cfg)
        expect(on, `${type} at ${new Date(target).toISOString()} (from ${new Date(from).toISOString()})`).toBeGreaterThan(1)
        expect(before, `${type} one minute before`).toBe(1)
        expect(target).toBeGreaterThan(from)
      }
    }
    expect(checked).toBeGreaterThan(40)
  })

  it('`until` is the first instant the window is over', () => {
    const s = player()
    for (let k = 0; k < 30; k++) {
      const from = T0 + k * 3 * HOUR
      for (const type of ['fire', 'grass', 'ghost'] as const) {
        const a = nextActivation(type, s, from, 25, { weather: null })
        if (a.kind !== 'window' || a.until === null) continue
        const env = (t: number) => conditionEnvAt(s, t, 25, { weather: null })
        expect(typeConditionMult(type, env(a.until - MIN), cfg)).toBeGreaterThan(1)
        expect(typeConditionMult(type, env(a.until), cfg)).toBe(1)
      }
    }
  })

  it('stays in order: day keys of `at` follow the profile zone', () => {
    const s = player({ profile: { ...player().profile, timezone: 'America/Lima' } })
    const a = nextActivation('ground', s, T0, 25, { weather: null })
    expect(a.kind === 'weekend' && a.at !== null && dayKeyOf(a.at, 'America/Lima')).toBe(addDays(TODAY, 4))
  })
})
