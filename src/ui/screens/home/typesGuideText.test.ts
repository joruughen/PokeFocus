import { createInstance, type TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { conditionOutlook, localToTs, type ConditionOutlook, type PlayerState, type WeatherInput } from '../../../engine'
import { makeMon, makePlayer, T0 } from '../../../engine/test-helpers'
import en from '../../../i18n/locales/en.json'
import es from '../../../i18n/locales/es.json'
import { activationText, whenText, type GuideTextEnv } from './typesGuideText'

const HOUR = 3_600_000
const MIN = 60_000

async function translator(lng: 'es' | 'en'): Promise<TFunction> {
  const i18n = createInstance()
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng,
    fallbackLng: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  return i18n.getFixedT(lng)
}

/** Tuesday 2026-11-03 10:00 UTC (T0); the player's zone is UTC. */
function player(patch: Partial<PlayerState> = {}, team = [makeMon('bulbasaur', 20, { uid: 'a' })]): PlayerState {
  return makePlayer(team, patch)
}

const row = (rows: ConditionOutlook[], type: string) => rows.find((r) => r.type === type) as ConditionOutlook

describe('types guide copy', () => {
  it('says when the examples from the spec switch on (ES)', async () => {
    const t = await translator('es')
    const p = player({
      streak: { current: 3, best: 3, lastDayKey: '2026-11-03', gapBeforeLastDay: 0, protectUsedWeek: null },
    })
    const env: GuideTextEnv = { t, lng: 'es', tz: 0, now: T0 + 4 * HOUR, minutes: 25 } // 14:00
    const rows = conditionOutlook(p, env.now, 25, { weather: null })
    expect(activationText(env, row(rows, 'grass'))).toBe('Se activa mañana a las 05:00.')
    expect(activationText(env, row(rows, 'ground'))).toBe('Se activa el sábado.')
    expect(activationText(env, row(rows, 'dragon'))).toBe('Se activa con una racha de 7 días (llevas 3). Si estudias cada día, será el sábado.')
    expect(activationText(env, row(rows, 'fire'))).toBe('Activa hasta las 18:00.')
    expect(activationText(env, row(rows, 'ghost'))).toBe('Se activa hoy a las 20:00.')
    expect(activationText(env, row(rows, 'water'))).toBe('Se activa si llueve en tu ciudad.')
    expect(activationText(env, row(rows, 'fairy'))).toContain('en grupo con amigos')
    expect(activationText(env, row(rows, 'flying'))).toContain('micrófono')
  })

  it('says it in English too', async () => {
    const t = await translator('en')
    const env: GuideTextEnv = { t, lng: 'en', tz: 0, now: T0 + 4 * HOUR, minutes: 25 }
    const rows = conditionOutlook(player(), env.now, 25, { weather: null })
    expect(activationText(env, row(rows, 'grass'))).toBe('Activates tomorrow at 05:00 AM.')
    expect(activationText(env, row(rows, 'ground'))).toBe('Activates on Saturday.')
  })

  it('counts days from the real now: today, tomorrow, the day after, a weekday, a date', async () => {
    const t = await translator('es')
    const env: GuideTextEnv = { t, lng: 'es', tz: 0, now: T0, minutes: 25 }
    const at = (day: string) => localToTs(day, 5 * 60, 0)
    expect(whenText(env, at('2026-11-03'), true)).toBe('hoy a las 05:00')
    expect(whenText(env, at('2026-11-04'), true)).toBe('mañana a las 05:00')
    expect(whenText(env, at('2026-11-05'), true)).toBe('pasado mañana a las 05:00')
    expect(whenText(env, at('2026-11-07'), true)).toBe('el sábado a las 05:00')
    expect(whenText(env, at('2026-11-07'), false)).toBe('el sábado')
    expect(whenText(env, at('2026-11-12'), false)).toBe('el 12 de noviembre')
  })

  it.each(['es', 'en'] as const)('every branch has copy in %s (no raw keys, no empty text, no leftover placeholders)', async (lng) => {
    const t = await translator(lng)
    const rainy: WeatherInput = { rain: true, sun: false, tempC: 15 }
    const cold: WeatherInput = { rain: false, sun: false, snow: true, tempC: 2 }
    const sunny: WeatherInput = { rain: false, sun: true, tempC: 28 }
    const day = (k: string, firstStartMinute = 9 * 60) => ({ [k]: { minutes: 25, sessions: 1, firstStartMinute } })
    const streak = (current: number, lastDayKey: string | null) => ({ current, best: current, lastDayKey, gapBeforeLastDay: 0, protectUsedWeek: null })
    const states: PlayerState[] = [
      player(),
      player({ days: { ...day('2026-11-03'), ...day('2026-11-02', 18 * 60 + 10) }, streak: streak(3, '2026-11-03'), lastSessionEndedAt: T0 - 5 * MIN }),
      player({ streak: streak(6, '2026-11-02'), lastSessionEndedAt: T0 - 90 * MIN }),
      player({ streak: streak(4, '2026-10-31') }),
      player({ streak: streak(0, null) }),
      player({ days: day('2026-11-02', 10 * 60 + 30) }),
      player({}, [makeMon('caterpie', 10, { uid: 'a' }), makeMon('butterfree', 30, { uid: 'b' })]),
    ]
    const seen = new Set<string>()
    for (const [i, s] of states.entries()) {
      for (let k = 0; k < 72; k++) {
        const now = T0 + k * 3 * HOUR
        for (const [weather, minutes] of [[null, 25], [rainy, 50], [cold, 25], [sunny, 60]] as const) {
          const env: GuideTextEnv = { t, lng, tz: 0, now, minutes }
          for (const o of conditionOutlook(s, now, minutes, { weather })) {
            const text = activationText(env, o)
            seen.add(`${o.activation.kind}:${o.active}`)
            // Normal and Rock have no second sentence: their rule already says it.
            if (o.activation.kind === 'always' || o.activation.kind === 'noPause') {
              expect(text).toBe('')
              continue
            }
            expect(text, `${o.type} state ${i} +${k * 3}h`).not.toBe('')
            expect(text).not.toMatch(/typesGuide|\{\{|undefined|NaN/)
            expect(text.endsWith('.')).toBe(true)
          }
        }
      }
    }
    // Every kind shows up both ways where it can (the rule-only ones have a single state).
    for (const kind of ['window', 'weekend', 'firstOfDay', 'sameHour', 'weather', 'duration', 'chain', 'sessions', 'team', 'streak', 'comeback']) {
      expect(seen, kind).toContain(`${kind}:true`)
      expect(seen, kind).toContain(`${kind}:false`)
    }
    for (const kind of ['sound:false', 'friend:false']) expect(seen).toContain(kind)
  })
})
