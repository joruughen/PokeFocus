/**
 * "When does this type's condition switch on?" for the types guide and the
 * session planner (GDD §9.2). Pure: it never reads a clock, everything comes
 * from `from` (the real or hypothetical start) and the player state.
 *
 * The answer is data, not text: a discriminated `Activation` with timestamps
 * (epoch ms) wherever the time can be computed. The UI turns it into a
 * sentence. Whether a type is active is always decided by `typeConditionMult`
 * on the env `conditionEnvAt` builds, so the rules live in one place; the
 * helpers here only work out the next instant that makes them true (using the
 * same config windows).
 *
 * Assumptions, shared with `conditionEnvAt`: no pauses, no sound profile, no
 * friend; sessions, streak and "yesterday" come from the saved state, so a
 * start on a future day assumes nothing is studied in between.
 */
import { ALL_TYPES, typeConditionMult, type ConditionEnv } from './conditions'
import type { GameConfig } from './config'
import { defaultContext, type EngineContext } from './context'
import type { TypeSlug } from './data-types'
import { conditionEnvAt, projectStreak } from './session'
import type { PlayerState, WeatherInput } from './state'
import { addDays, inHourWindow, localToTs, MINUTE_MS, startOfLocalDay, toLocal, type TimeZoneSpec } from './time'

/** Team size limit (`setTeam` in box.ts); the Bug condition tops out with a full team of Bug types. */
const TEAM_SIZE = 6

/** Weather that a type waits for (the player picks the weather in Settings for now). */
export type WeatherNeed = 'rain' | 'cold'

/**
 * How a type's condition switches on. `at` is the next instant it turns on
 * (null when it is already on or cannot be computed), `until` the instant the
 * current window ends (only while on, or the end of the window `at` opens).
 */
export type Activation =
  /** Normal. */
  | { kind: 'always' }
  /** Fire, Grass, Ghost: an hour-of-day window (config), plus sun for Fire. `inWindow`: the start falls inside it. */
  | { kind: 'window'; inWindow: boolean; at: number | null; until: number | null; orSun: boolean }
  /** Ground: Saturday and Sunday. `at` is local midnight of the next Saturday; `until` local midnight of Monday. */
  | { kind: 'weekend'; at: number | null; until: number | null }
  /** Psychic: first session of the local day (`at` = next local midnight when today already has one); silence also works (needs the microphone). */
  | { kind: 'firstOfDay'; at: number | null; silencePct: number }
  /** Steel: within ±`windowMinutes` of yesterday's first start. `hasReference`: there is a session yesterday to compare with. */
  | { kind: 'sameHour'; windowMinutes: number; at: number | null; until: number | null; hasReference: boolean }
  /** Water, Ice: needs this weather where you study. */
  | { kind: 'weather'; weather: WeatherNeed }
  /** Fighting: sessions of at least `minMinutes`. */
  | { kind: 'duration'; minMinutes: number }
  /** Electric: a session of up to `maxMinutes` that starts within `gapMinutes` of the previous one's end. `until`: deadline of the open gap, if any. */
  | { kind: 'chain'; maxMinutes: number; gapMinutes: number; durationOk: boolean; until: number | null }
  /** Poison: +`perSessionPct`% per session already done that day (up to `maxPct`%). */
  | { kind: 'sessions'; have: number; perSessionPct: number; maxPct: number }
  /** Flying: music or noise for at least `sharePct`% of the session (needs the microphone). */
  | { kind: 'sound'; sharePct: number }
  /** Bug: +`perBugPct`% per Bug-type team member. */
  | { kind: 'team'; have: number; perBugPct: number }
  /** Rock: no pauses. */
  | { kind: 'noPause' }
  /** Dragon: a streak of `needed` days. `have`: days already in the running streak (not counting a session today). `at`: local midnight of the day it is reached if you study every day from the start day on. */
  | { kind: 'streak'; needed: number; have: number; at: number | null }
  /** Dark: coming back after `needed` days without study. `have`: days missed right before the start day. `at`: first local day it applies if you do not study until then. */
  | { kind: 'comeback'; needed: number; have: number; at: number | null }
  /** Fairy: a simultaneous session with a friend (overlap of at least `overlapPct`%). */
  | { kind: 'friend'; overlapPct: number }

export interface ConditionOutlook {
  type: TypeSlug
  /** Multiplier of a session started at `from` (1 = inactive). */
  mult: number
  /** The highest multiplier this type can reach. */
  maxMult: number
  active: boolean
  activation: Activation
}

export interface OutlookOptions {
  /** Weather for the hypothetical start (default: the profile's). Pass `null` when it cannot be known (another day). */
  weather?: WeatherInput | null
}

/** Highest multiplier of a type's condition (variable ones: Poison and Bug at their cap). */
export function conditionMaxMult(type: TypeSlug, cfg: GameConfig): number {
  const c = cfg.conditions
  switch (type) {
    case 'poison':
      return c.poisonMax
    case 'bug':
      return 1 + c.bugPerBug * TEAM_SIZE
    default:
      return c[type]
  }
}

/** First instant strictly after `from` at which the local clock reads `minuteOfDay`. */
function nextLocalMinute(from: number, tz: TimeZoneSpec, minuteOfDay: number): number {
  const day = toLocal(from, tz).dayKey
  const today = localToTs(day, minuteOfDay, tz)
  return today > from ? today : localToTs(addDays(day, 1), minuteOfDay, tz)
}

/** Minutes of the day [a, b] (inclusive) within ±`w` minutes of `ref`, wrapping at midnight. */
function minutesAround(ref: number, w: number): [number, number][] {
  const lo = ref - w
  const hi = ref + w
  const out: [number, number][] = [[Math.max(0, lo), Math.min(1439, hi)]]
  if (lo < 0) out.push([1440 + lo, 1439])
  if (hi > 1439) out.push([0, hi - 1440])
  return out
}

function windowActivation(win: readonly [number, number], env: ConditionEnv, from: number, tz: TimeZoneSpec, orSun: boolean): Activation {
  const inWindow = inHourWindow(env.localHour, win)
  return {
    kind: 'window',
    inWindow,
    at: inWindow ? null : nextLocalMinute(from, tz, win[0] * 60),
    until: inWindow ? nextLocalMinute(from, tz, win[1] * 60) : null,
    orSun,
  }
}

function steelActivation(active: boolean, state: PlayerState, from: number, tz: TimeZoneSpec, cfg: GameConfig): Activation {
  const w = cfg.conditions.steelWindowMinutes
  const local = toLocal(from, tz)
  const refOf = (day: string): number | null => state.days[addDays(day, -1)]?.firstStartMinute ?? null
  const ref = refOf(local.dayKey)
  if (active && ref !== null) {
    const inside = minutesAround(ref, w).find(([a, b]) => local.minuteOfDay >= a && local.minuteOfDay <= b)
    return { kind: 'sameHour', windowMinutes: w, at: null, until: inside ? localToTs(local.dayKey, inside[1], tz) : null, hasReference: true }
  }
  // The first window that opens after `from`: today's, or the next days' (their reference is the day before).
  let best: { at: number; until: number } | null = null
  for (let d = 0; d <= 2; d++) {
    const day = addDays(local.dayKey, d)
    const r = refOf(day)
    if (r === null) continue
    for (const [a, b] of minutesAround(r, w)) {
      const at = localToTs(day, a, tz)
      if (at > from && (best === null || at < best.at)) best = { at, until: localToTs(day, b, tz) }
    }
  }
  return { kind: 'sameHour', windowMinutes: w, at: best?.at ?? null, until: best?.until ?? null, hasReference: ref !== null }
}

function activationFor(type: TypeSlug, env: ConditionEnv, state: PlayerState, from: number, cfg: GameConfig): Activation {
  const c = cfg.conditions
  const tz = state.profile.timezone
  const active = typeConditionMult(type, env, cfg) > 1
  const local = toLocal(from, tz)
  switch (type) {
    case 'normal':
      return { kind: 'always' }
    case 'fire':
      return windowActivation(c.afternoonWindow, env, from, tz, true)
    case 'grass':
      return windowActivation(c.dayWindow, env, from, tz, false)
    case 'ghost':
      return windowActivation(c.nightWindow, env, from, tz, false)
    case 'water':
      return { kind: 'weather', weather: 'rain' }
    case 'ice':
      return { kind: 'weather', weather: 'cold' }
    case 'fighting':
      return { kind: 'duration', minMinutes: c.fightingMinMinutes }
    case 'electric': {
      const last = state.lastSessionEndedAt
      const deadline = last === null ? null : last + c.electricChainGapMinutes * MINUTE_MS
      return {
        kind: 'chain',
        maxMinutes: c.electricMaxMinutes,
        gapMinutes: c.electricChainGapMinutes,
        durationOk: env.minutes <= c.electricMaxMinutes,
        until: deadline !== null && deadline >= from ? deadline : null,
      }
    }
    case 'poison':
      return { kind: 'sessions', have: env.sessionsEarlierToday, perSessionPct: Math.round(c.poisonPerSession * 100), maxPct: Math.round((c.poisonMax - 1) * 100) }
    case 'ground': {
      if (env.weekday === 6 || env.weekday === 0) {
        return { kind: 'weekend', at: null, until: startOfLocalDay(addDays(local.dayKey, env.weekday === 6 ? 2 : 1), tz) }
      }
      return { kind: 'weekend', at: startOfLocalDay(addDays(local.dayKey, 6 - env.weekday), tz), until: null }
    }
    case 'flying':
      return { kind: 'sound', sharePct: Math.round(c.flyingNoiseShare * 100) }
    case 'psychic':
      return { kind: 'firstOfDay', at: active ? null : startOfLocalDay(addDays(local.dayKey, 1), tz), silencePct: Math.round(c.psychicSilenceShare * 100) }
    case 'bug':
      return { kind: 'team', have: env.bugCount, perBugPct: Math.round(c.bugPerBug * 100) }
    case 'rock':
      return { kind: 'noPause' }
    case 'dragon': {
      const proj = projectStreak(state.streak, local.dayKey, false)
      const have = Math.max(0, proj.current - (state.streak.lastDayKey === local.dayKey ? 0 : 1))
      const days = c.dragonStreakDays - proj.current
      return { kind: 'streak', needed: c.dragonStreakDays, have, at: active || days <= 0 ? null : startOfLocalDay(addDays(local.dayKey, days), tz) }
    }
    case 'dark': {
      const last = state.streak.lastDayKey
      return {
        kind: 'comeback',
        needed: c.darkMissedDays,
        have: env.missedDaysBeforeToday,
        // A gap of N days since the last session means N − 1 missed days.
        at: active || last === null ? null : startOfLocalDay(addDays(last, c.darkMissedDays + 1), tz),
      }
    }
    case 'steel':
      return steelActivation(active, state, from, tz, cfg)
    case 'fairy':
      return { kind: 'friend', overlapPct: Math.round(c.fairyOverlap * 100) }
  }
}

/**
 * How and when `type`'s condition is on for a session that starts at `from`
 * (planned for `plannedMinutes`). Already on: see `until` where it exists.
 */
export function nextActivation(
  type: TypeSlug,
  state: PlayerState,
  from: number,
  plannedMinutes: number,
  opts: OutlookOptions = {},
  ctx: EngineContext = defaultContext(),
): Activation {
  const env = conditionEnvAt(state, from, plannedMinutes, opts.weather === undefined ? {} : { weather: opts.weather }, ctx)
  return activationFor(type, env, state, from, ctx.config)
}

/** All 18 types for a session starting at `from`: multiplier, whether it is on, and when it switches on. */
export function conditionOutlook(
  state: PlayerState,
  from: number,
  plannedMinutes: number,
  opts: OutlookOptions = {},
  ctx: EngineContext = defaultContext(),
): ConditionOutlook[] {
  const cfg = ctx.config
  const env = conditionEnvAt(state, from, plannedMinutes, opts.weather === undefined ? {} : { weather: opts.weather }, ctx)
  return ALL_TYPES.map((type) => {
    const mult = typeConditionMult(type, env, cfg)
    return { type, mult, maxMult: conditionMaxMult(type, cfg), active: mult > 1, activation: activationFor(type, env, state, from, cfg) }
  })
}
