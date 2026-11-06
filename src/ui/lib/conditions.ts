/**
 * "Conditions if you start now": the engine builds the `ConditionEnv` of a
 * hypothetical session starting at `now` (`conditionEnvAt`) and gives the
 * multipliers (`typeConditionMult` / `pokemonConditionMult`). No formula here.
 */
import {
  ALL_TYPES,
  conditionEnvAt,
  conditionTypes,
  defaultContext,
  isCold,
  isRainy,
  isSunny,
  pokemonConditionMult,
  typeConditionMult,
  type ConditionEnv,
  type PlayerState,
  type TypeSlug,
  type WeatherInput,
} from '../../engine'

const ctx = defaultContext()

/** `weather`: what the session would use (detected or manual); defaults to `profile.weather`. */
export function conditionEnvNow(state: PlayerState, now: number, plannedMinutes: number, weather?: WeatherInput | null): ConditionEnv {
  return conditionEnvAt(state, now, plannedMinutes, weather !== undefined ? { weather } : {})
}

export interface ConditionRow {
  type: TypeSlug
  mult: number
  active: boolean
  /** Team members whose best condition is this type. */
  teamUids: string[]
}

/** Every type with its multiplier now, sorted: team types first, then active, then the rest. */
export function conditionsNow(
  state: PlayerState,
  now: number,
  plannedMinutes: number,
  weather?: WeatherInput | null,
): { env: ConditionEnv; rows: ConditionRow[]; member: Record<string, { mult: number; type: TypeSlug | null }> } {
  const env = conditionEnvNow(state, now, plannedMinutes, weather)
  const cfg = ctx.config
  const member: Record<string, { mult: number; type: TypeSlug | null }> = {}
  const teamTypes = new Set<TypeSlug>()
  for (const uid of state.team) {
    const p = state.pokemon[uid]
    if (!p) continue
    const types = conditionTypes(p, now, ctx)
    types.forEach((t) => teamTypes.add(t))
    member[uid] = pokemonConditionMult(types, env, cfg)
  }
  const rows: ConditionRow[] = ALL_TYPES.map((type) => {
    const mult = typeConditionMult(type, env, cfg)
    return {
      type,
      mult,
      active: mult > 1,
      teamUids: Object.entries(member).filter(([, m]) => m.type === type).map(([u]) => u),
    }
  })
  const rank = (r: ConditionRow) => (teamTypes.has(r.type) ? 0 : 2) + (r.active ? 0 : 1)
  rows.sort((a, b) => rank(a) - rank(b) || b.mult - a.mult)
  return { env, rows, member }
}

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night'

/** Sky phase for the route band, aligned with the condition windows. */
export function timeOfDay(hour: number): TimeOfDay {
  const c = ctx.config.conditions
  if (hour >= c.dayWindow[0] && hour < c.dayWindow[1]) return 'morning'
  if (hour >= c.afternoonWindow[0] && hour < c.afternoonWindow[1]) return 'day'
  if (hour >= c.afternoonWindow[1] && hour < c.nightWindow[0]) return 'evening'
  return 'night'
}

export type WeatherKind = 'clear' | 'sun' | 'rain' | 'cold'

export const WEATHER_PRESETS: Record<WeatherKind, WeatherInput> = {
  clear: { rain: false, sun: false, snow: false, tempC: null },
  sun: { rain: false, sun: true, snow: false, tempC: 27 },
  rain: { rain: true, sun: false, snow: false, tempC: 16 },
  cold: { rain: false, sun: false, snow: false, tempC: 6 },
}

export function weatherKind(w: WeatherInput | null): WeatherKind {
  const cfg = ctx.config
  if (!w) return 'clear'
  if (isRainy(w)) return 'rain'
  if (isCold(w, cfg)) return 'cold'
  if (isSunny(w, cfg)) return 'sun'
  return 'clear'
}
