/**
 * Type conditions (GDD §9.2, §9.3) and `when` evaluation (docs/effects.md).
 */
import type { GameConfig } from './config'
import type { TypeSlug } from './data-types'
import type { When } from './effect-types'
import type { SoundProfile, WeatherInput } from './state'
import { inHourWindow } from './time'

export const ALL_TYPES: readonly TypeSlug[] = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]

/** Facts about a session that decide which conditions are active. */
export interface ConditionEnv {
  /** Validated session minutes. */
  minutes: number
  /** Local hour (0–23) and weekday (0 = Sunday) at session start. */
  localHour: number
  weekday: number
  /** Local minute of day at session start. */
  startMinuteOfDay: number
  weather: WeatherInput | null
  soundProfile: SoundProfile | null
  pausedSeconds: number
  /** Overlap (0–1) with a friend's session, null if unknown. */
  friendOverlap: number | null
  /** Completed sessions earlier the same local day. */
  sessionsEarlierToday: number
  /** Minutes between the previous session's end and this start (null if none). */
  minutesSincePreviousEnd: number | null
  /** Streak in days counting this session's day. */
  streakDays: number
  /** Days without study right before today's first session (0 if none). */
  missedDaysBeforeToday: number
  /** Local minute of day the first session of yesterday started (null if none). */
  yesterdayFirstStartMinute: number | null
  /** Number of Bug-type team members (incl. Tera). */
  bugCount: number
}

export function isSunny(w: WeatherInput | null, cfg: GameConfig): boolean {
  if (!w) return false
  return w.sun || (w.tempC !== null && w.tempC >= cfg.conditions.fireHotCelsius)
}

export function isCold(w: WeatherInput | null, cfg: GameConfig): boolean {
  if (!w) return false
  return Boolean(w.snow) || (w.tempC !== null && w.tempC <= cfg.conditions.iceColdCelsius)
}

export function isRainy(w: WeatherInput | null): boolean {
  return Boolean(w?.rain)
}

/** Daylight window = start of `dayWindow` to end of `afternoonWindow` (05–18). */
export function isDaylight(hour: number, cfg: GameConfig): boolean {
  return inHourWindow(hour, [cfg.conditions.dayWindow[0], cfg.conditions.afternoonWindow[1]])
}

export function isNight(hour: number, cfg: GameConfig): boolean {
  return inHourWindow(hour, cfg.conditions.nightWindow)
}

/**
 * Multiplier of one type's condition (1 if inactive). Types in `forced`
 * (activateCondition) count as active with their full multiplier.
 */
export function typeConditionMult(type: TypeSlug, env: ConditionEnv, cfg: GameConfig, forced: ReadonlySet<TypeSlug> = new Set()): number {
  const c = cfg.conditions
  const isForced = forced.has(type)
  const on = (active: boolean, m: number) => (active || isForced ? m : 1)
  switch (type) {
    case 'normal':
      return c.normal
    case 'fire':
      return on(isSunny(env.weather, cfg) || inHourWindow(env.localHour, c.afternoonWindow), c.fire)
    case 'water':
      return on(isRainy(env.weather), c.water)
    case 'grass':
      return on(inHourWindow(env.localHour, c.dayWindow), c.grass)
    case 'electric':
      return on(
        env.minutes <= c.electricMaxMinutes &&
          env.minutesSincePreviousEnd !== null &&
          env.minutesSincePreviousEnd >= 0 &&
          env.minutesSincePreviousEnd <= c.electricChainGapMinutes,
        c.electric,
      )
    case 'ice':
      return on(isCold(env.weather, cfg), c.ice)
    case 'fighting':
      return on(env.minutes >= c.fightingMinMinutes, c.fighting)
    case 'poison': {
      if (isForced) return c.poisonMax
      return Math.min(c.poisonMax, 1 + c.poisonPerSession * env.sessionsEarlierToday)
    }
    case 'ground':
      return on(env.weekday === 0 || env.weekday === 6, c.ground)
    case 'flying': {
      const sp = env.soundProfile
      return on(sp !== null && sp.music + sp.noise >= c.flyingNoiseShare, c.flying)
    }
    case 'psychic': {
      const sp = env.soundProfile
      return on(env.sessionsEarlierToday === 0 || (sp !== null && sp.silence >= c.psychicSilenceShare), c.psychic)
    }
    case 'bug':
      return 1 + c.bugPerBug * Math.max(env.bugCount, isForced ? 1 : 0)
    case 'rock':
      return on(env.pausedSeconds <= 0, c.rock)
    case 'ghost':
      return on(isNight(env.localHour, cfg), c.ghost)
    case 'dragon':
      return on(env.streakDays >= c.dragonStreakDays, c.dragon)
    case 'dark':
      return on(env.missedDaysBeforeToday >= c.darkMissedDays, c.dark)
    case 'steel': {
      if (env.yesterdayFirstStartMinute === null) return on(false, c.steel)
      let diff = Math.abs(env.startMinuteOfDay - env.yesterdayFirstStartMinute)
      diff = Math.min(diff, 1440 - diff)
      return on(diff <= c.steelWindowMinutes, c.steel)
    }
    case 'fairy':
      return on(env.friendOverlap !== null && env.friendOverlap >= c.fairyOverlap, c.fairy)
  }
}

/** All types with an active condition (multiplier > 1). */
export function activeConditionTypes(env: ConditionEnv, cfg: GameConfig, forced: ReadonlySet<TypeSlug> = new Set()): TypeSlug[] {
  return ALL_TYPES.filter((t) => typeConditionMult(t, env, cfg, forced) > 1)
}

/**
 * Condition multiplier of a Pokémon: the best of its types (GDD §9.3, no
 * stacking), with `conditionBonusMult` applied as 1 + (M − 1) · mult.
 */
export function pokemonConditionMult(
  types: readonly TypeSlug[],
  env: ConditionEnv,
  cfg: GameConfig,
  forced: ReadonlySet<TypeSlug> = new Set(),
  bonusMult = 1,
): { mult: number; type: TypeSlug | null } {
  let best = 1
  let bestType: TypeSlug | null = null
  for (const t of types) {
    const m = typeConditionMult(t, env, cfg, forced)
    if (m > best) {
      best = m
      bestType = t
    }
  }
  return { mult: 1 + (best - 1) * bonusMult, type: bestType }
}

// ---------------------------------------------------------------------------
// `when`
// ---------------------------------------------------------------------------

/** Context for `when` checks. A key whose context value is missing fails. */
export interface WhenContext {
  sessionMinutes?: number
  /** current / max energy (0–1). */
  energyFraction?: number
  localHour?: number
  weather?: WeatherInput | null
  weekend?: boolean
  noPauses?: boolean
  isLeader?: boolean
  targetLegendary?: boolean
}

export function evaluateWhen(when: When | undefined, c: WhenContext, cfg: GameConfig): boolean {
  if (!when) return true
  if (when.sessionMinMinutes !== undefined && !(c.sessionMinutes !== undefined && c.sessionMinutes >= when.sessionMinMinutes)) return false
  if (when.energyBelow !== undefined && !(c.energyFraction !== undefined && c.energyFraction < when.energyBelow)) return false
  if (when.energyFull !== undefined && (c.energyFraction === undefined || (c.energyFraction >= 1 - 1e-9) !== when.energyFull)) return false
  if (when.timeWindow !== undefined) {
    if (c.localHour === undefined) return false
    const h = c.localHour
    const ok =
      when.timeWindow === 'daylight' ? isDaylight(h, cfg)
      : when.timeWindow === 'notDaylight' ? !isDaylight(h, cfg)
      : when.timeWindow === 'night' ? isNight(h, cfg)
      : when.timeWindow === 'notNight' ? !isNight(h, cfg)
      : inHourWindow(h, cfg.conditions.earlyMorningWindow)
    if (!ok) return false
  }
  if (when.weather !== undefined) {
    const w = c.weather ?? null
    const ok = when.weather === 'rain' ? isRainy(w) : when.weather === 'sun' ? isSunny(w, cfg) : isCold(w, cfg)
    if (!ok) return false
  }
  if (when.weekend !== undefined && (c.weekend === undefined || c.weekend !== when.weekend)) return false
  if (when.noPauses !== undefined && (c.noPauses === undefined || c.noPauses !== when.noPauses)) return false
  if (when.isLeader !== undefined && (c.isLeader === undefined || c.isLeader !== when.isLeader)) return false
  if (when.targetLegendary !== undefined && (c.targetLegendary ?? false) !== when.targetLegendary) return false
  return true
}

/** Dominant sound profile kind, or null without a profile. */
export function dominantSound(sp: SoundProfile | null): 'silence' | 'music' | 'voice' | 'noise' | null {
  if (!sp) return null
  const entries: ['silence' | 'music' | 'voice' | 'noise', number][] = [
    ['silence', sp.silence],
    ['music', sp.music],
    ['voice', sp.voice],
    ['noise', sp.noise],
  ]
  let best = entries[0] as ['silence' | 'music' | 'voice' | 'noise', number]
  for (const e of entries) if (e[1] > best[1]) best = e
  return best[1] > 0 ? best[0] : null
}
