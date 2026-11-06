/**
 * Turns the engine's `Activation` (data) into a sentence for the types guide.
 * No rules here: every number and instant comes from `conditionOutlook`; this
 * only picks the words ("mañana a las 05:00", "el sábado").
 */
import type { TFunction } from 'i18next'
import { dayKeyOf, daysBetween, type ConditionOutlook, type TimeZoneSpec } from '../../../engine'
import { fmtClock, fmtDate, fmtWeekday } from '../../lib/format'
import { conditionRuleValues } from './conditionCopy'

export interface GuideTextEnv {
  t: TFunction
  lng: string
  tz: TimeZoneSpec
  /** The real current time: "tomorrow" and weekdays are counted from it. */
  now: number
  /** Planned session minutes (for the numbers in the rule copy). */
  minutes: number
}

/** "hoy a las 12:00", "mañana a las 05:00", "el sábado a las 05:00". With `withTime: false` only the day. */
export function whenText({ t, lng, tz, now }: GuideTextEnv, at: number, withTime: boolean): string {
  const diff = daysBetween(dayKeyOf(now, tz), dayKeyOf(at, tz))
  const time = fmtClock(at, tz, lng)
  const sfx = withTime ? '' : 'Day'
  if (diff <= 0) return t(`typesGuide.when.today${sfx}`, { time })
  if (diff === 1) return t(`typesGuide.when.tomorrow${sfx}`, { time })
  if (diff === 2) return t(`typesGuide.when.dayAfter${sfx}`, { time })
  if (diff <= 6) return t(`typesGuide.when.weekday${sfx}`, { day: fmtWeekday(at, tz, lng), time })
  return t(`typesGuide.when.date${sfx}`, { date: fmtDate(at, tz, lng), time })
}

/**
 * One sentence: why the type is on, or when and how it switches on. Empty when the
 * rule already says it all (Normal is always on, Rock is on unless you pause).
 */
export function activationText(env: GuideTextEnv, o: ConditionOutlook): string {
  const { t, lng, tz, minutes } = env
  const a = o.activation
  const k = (name: string) => `typesGuide.next.${name}`
  const clock = (ts: number | null) => (ts === null ? '' : fmtClock(ts, tz, lng))
  const day = (ts: number) => whenText(env, ts, false)
  const values = conditionRuleValues(minutes)
  switch (a.kind) {
    case 'always':
      return ''
    case 'window':
      if (o.active) return a.inWindow ? t(k('windowOn'), { time: clock(a.until) }) : t(k('fireWeatherOn'))
      return a.at === null ? '' : t(k(a.orSun ? 'fireOff' : 'windowOff'), { when: whenText(env, a.at, true) })
    case 'weekend':
      return o.active || a.at === null ? t(k('weekendOn')) : t(k('weekendOff'), { when: day(a.at) })
    case 'firstOfDay':
      return o.active || a.at === null ? t(k('firstOfDayOn')) : t(k('firstOfDayOff'), { when: day(a.at) })
    case 'sameHour':
      if (o.active) return t(k('sameHourOn'), { time: clock(a.until) })
      return a.at === null || a.until === null
        ? t(k('sameHourNone'), { window: a.windowMinutes })
        : t(k('sameHourOff'), { when: day(a.at), from: clock(a.at), to: clock(a.until) })
    case 'weather':
      return o.active ? t(k('weatherOn')) : t(k(a.weather === 'rain' ? 'rainOff' : 'coldOff'), values)
    case 'duration':
      return t(k(o.active ? 'durationOn' : 'durationOff'), { min: a.minMinutes, minutes })
    case 'chain':
      if (o.active) return t(k('chainOn'), { time: clock(a.until) })
      return a.until !== null && !a.durationOk
        ? t(k('chainWait'), { max: a.maxMinutes, time: clock(a.until) })
        : t(k('chainOff'), { max: a.maxMinutes, gap: a.gapMinutes })
    case 'sessions':
      return o.active
        ? t(k('sessionsOn'), { per: a.perSessionPct, count: a.have })
        : t(k('sessionsOff'), { per: a.perSessionPct, max: a.maxPct })
    case 'sound':
      return t(k('soundOff'), { pct: a.sharePct })
    case 'team':
      return o.active ? t(k('teamOn'), { per: a.perBugPct, count: a.have }) : t(k('teamOff'), { per: a.perBugPct })
    case 'noPause':
      return ''
    case 'streak':
      if (o.active) return t(k('streakOn'), { needed: a.needed })
      return a.at === null
        ? t(k('streakNoDate'), { needed: a.needed, have: a.have })
        : t(k('streakOff'), { needed: a.needed, have: a.have, when: day(a.at) })
    case 'comeback':
      if (o.active) return t(k('comebackOn'), { count: a.have })
      return a.at === null ? t(k('comebackNoDate'), { needed: a.needed }) : t(k('comebackOff'), { needed: a.needed, when: day(a.at) })
    case 'friend':
      return t(k('friendOff'), { pct: a.overlapPct })
  }
}
