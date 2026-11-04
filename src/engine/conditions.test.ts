import { describe, expect, it } from 'vitest'
import { evaluateWhen, pokemonConditionMult, typeConditionMult, type ConditionEnv } from './conditions'
import { defaultContext } from './context'
import { passiveEffects, teamStatMults } from './effects'
import { makeMon } from './test-helpers'

const cfg = defaultContext().config
const c = cfg.conditions

const env = (patch: Partial<ConditionEnv> = {}): ConditionEnv => ({
  minutes: 25,
  localHour: 19,
  weekday: 2,
  startMinuteOfDay: 19 * 60,
  weather: null,
  soundProfile: null,
  pausedSeconds: 30,
  friendOverlap: null,
  sessionsEarlierToday: 1,
  minutesSincePreviousEnd: null,
  streakDays: 1,
  missedDaysBeforeToday: 0,
  yesterdayFirstStartMinute: null,
  bugCount: 0,
  ...patch,
})

describe('type conditions (GDD §9.2)', () => {
  it('neutral env: only Normal is active', () => {
    const e = env()
    expect(typeConditionMult('normal', e, cfg)).toBe(c.normal)
    for (const t of ['fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'ground', 'flying', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'] as const) {
      expect(typeConditionMult(t, e, cfg), t).toBe(1)
    }
  })

  it('each condition activates on its trigger', () => {
    const m = (t: Parameters<typeof typeConditionMult>[0], p: Partial<ConditionEnv>) => typeConditionMult(t, env(p), cfg)
    expect(m('fire', { localHour: 13 })).toBe(c.fire)
    expect(m('fire', { weather: { rain: false, sun: false, tempC: 26 } })).toBe(c.fire)
    expect(m('water', { weather: { rain: true, sun: false, tempC: 15 } })).toBe(c.water)
    expect(m('grass', { localHour: 6 })).toBe(c.grass)
    expect(m('electric', { minutesSincePreviousEnd: 10 })).toBe(c.electric)
    expect(m('electric', { minutesSincePreviousEnd: 10, minutes: 50 })).toBe(1)
    expect(m('ice', { weather: { rain: false, sun: false, tempC: 5 } })).toBe(c.ice)
    expect(m('fighting', { minutes: 50 })).toBe(c.fighting)
    expect(m('poison', { sessionsEarlierToday: 2 })).toBeCloseTo(1 + 2 * c.poisonPerSession)
    expect(m('poison', { sessionsEarlierToday: 20 })).toBe(c.poisonMax)
    expect(m('ground', { weekday: 6 })).toBe(c.ground)
    expect(m('flying', { soundProfile: { silence: 0.6, music: 0.2, voice: 0, noise: 0.2 } })).toBe(c.flying)
    expect(m('psychic', { sessionsEarlierToday: 0 })).toBe(c.psychic)
    expect(m('psychic', { soundProfile: { silence: 0.8, music: 0, voice: 0.2, noise: 0 } })).toBe(c.psychic)
    expect(m('bug', { bugCount: 3 })).toBeCloseTo(1 + 3 * c.bugPerBug)
    expect(m('rock', { pausedSeconds: 0 })).toBe(c.rock)
    expect(m('ghost', { localHour: 23 })).toBe(c.ghost)
    expect(m('ghost', { localHour: 3 })).toBe(c.ghost)
    expect(m('dragon', { streakDays: 7 })).toBe(c.dragon)
    expect(m('dark', { missedDaysBeforeToday: 2 })).toBe(c.dark)
    expect(m('steel', { yesterdayFirstStartMinute: 18 * 60 + 10 })).toBe(c.steel)
    expect(m('steel', { yesterdayFirstStartMinute: 17 * 60 })).toBe(1)
    expect(m('fairy', { friendOverlap: 0.85 })).toBe(c.fairy)
  })

  it('dual types take the best condition (no sum); conditionBonusMult scales the bonus; forced types count', () => {
    const e = env({ localHour: 13, weather: { rain: true, sun: false, tempC: 20 } })
    expect(pokemonConditionMult(['fire', 'water'], e, cfg).mult).toBe(Math.max(c.fire, c.water))
    expect(pokemonConditionMult(['electric'], env(), cfg, new Set(), 1.5).mult).toBe(1)
    expect(pokemonConditionMult(['normal'], env(), cfg, new Set(), 1.5).mult).toBeCloseTo(1 + (c.normal - 1) * 1.5)
    expect(pokemonConditionMult(['water'], env(), cfg, new Set(['water'])).mult).toBe(c.water)
  })
})

describe('`when` conditions (docs/effects.md)', () => {
  const t = (when: Parameters<typeof evaluateWhen>[0], wc: Parameters<typeof evaluateWhen>[1]) => evaluateWhen(when, wc, cfg)
  it('evaluates every key', () => {
    expect(t(undefined, {})).toBe(true)
    expect(t({ sessionMinMinutes: 50 }, { sessionMinutes: 50 })).toBe(true)
    expect(t({ sessionMinMinutes: 50 }, { sessionMinutes: 49 })).toBe(false)
    expect(t({ energyBelow: 0.33 }, { energyFraction: 0.3 })).toBe(true)
    expect(t({ energyBelow: 0.33 }, { energyFraction: 0.33 })).toBe(false)
    expect(t({ energyFull: true }, { energyFraction: 1 })).toBe(true)
    expect(t({ energyFull: true }, { energyFraction: 0.99 })).toBe(false)
    expect(t({ timeWindow: 'daylight' }, { localHour: 5 })).toBe(true)
    expect(t({ timeWindow: 'daylight' }, { localHour: 18 })).toBe(false)
    expect(t({ timeWindow: 'notDaylight' }, { localHour: 18 })).toBe(true)
    expect(t({ timeWindow: 'night' }, { localHour: 20 })).toBe(true)
    expect(t({ timeWindow: 'night' }, { localHour: 4 })).toBe(true)
    expect(t({ timeWindow: 'notNight' }, { localHour: 19 })).toBe(true)
    expect(t({ timeWindow: 'earlyMorning' }, { localHour: 8 })).toBe(true)
    expect(t({ timeWindow: 'earlyMorning' }, { localHour: 9 })).toBe(false)
    expect(t({ weather: 'rain' }, { weather: { rain: true, sun: false, tempC: null } })).toBe(true)
    expect(t({ weather: 'sun' }, { weather: { rain: false, sun: false, tempC: c.fireHotCelsius } })).toBe(true)
    expect(t({ weather: 'cold' }, { weather: { rain: false, sun: false, snow: true, tempC: 20 } })).toBe(true)
    expect(t({ weather: 'cold' }, { weather: null })).toBe(false)
    expect(t({ weekend: true }, { weekend: true })).toBe(true)
    expect(t({ noPauses: true }, { noPauses: false })).toBe(false)
    expect(t({ isLeader: true }, { isLeader: true })).toBe(true)
    expect(t({ isLeader: true }, { isLeader: false })).toBe(false)
    expect(t({ targetLegendary: true }, { targetLegendary: true })).toBe(true)
    expect(t({ targetLegendary: true }, {})).toBe(false)
    expect(t({ isLeader: true, energyBelow: 0.5 }, { isLeader: true, energyFraction: 0.6 })).toBe(false)
  })
})

describe('team-scope effects do not stack (docs/effects.md)', () => {
  it('the strongest member effect per stat applies', () => {
    const a = makeMon('eevee', 20, { uid: 'a', equippedMoves: ['helping-hand'] })
    const b = makeMon('jolteon', 20, { uid: 'b', equippedMoves: ['helping-hand'] })
    const sg = makeMon('dratini', 20, { uid: 'c', equippedMoves: ['safeguard'] })
    const fg = makeMon('clefairy', 20, { uid: 'd', ability: 'friend-guard' })
    const providers = [a, b, sg, fg].flatMap((p) => passiveEffects(p))
    const mods = teamStatMults(providers, () => ({}), cfg)
    expect(mods.points).toBe(1.05)
    expect(mods.counterDamageTaken).toBe(0.75)
  })
})
