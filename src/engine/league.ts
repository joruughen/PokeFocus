/**
 * Leagues (GDD §14): weekly points decide the current league; every week
 * (local Monday 00:00) everybody starts again in Base.
 */
import type { LeagueId } from './config'
import { defaultContext, type EngineContext } from './context'
import type { PlayerState } from './state'
import { monthKeyOf, weekKeyOf } from './time'

/** League for an amount of weekly points (monthly: thresholds × monthlyMultiplier). */
export function leagueForPoints(points: number, period: 'week' | 'month' = 'week', ctx: EngineContext = defaultContext()): LeagueId {
  const l = ctx.config.leagues
  const mult = period === 'month' ? l.monthlyMultiplier : 1
  let league: LeagueId = l.order[0] ?? 'base'
  for (const id of l.order) if (points >= l.weeklyThresholds[id] * mult) league = id
  return league
}

export function weekKey(state: PlayerState, now: number): string {
  return weekKeyOf(now, state.profile.timezone)
}

export function monthKey(state: PlayerState, now: number): string {
  return monthKeyOf(now, state.profile.timezone)
}

export function weeklyPoints(state: PlayerState, now: number): number {
  return state.league.weeklyPoints[weekKey(state, now)] ?? 0
}

export function monthlyPoints(state: PlayerState, now: number): number {
  return state.league.monthlyPoints[monthKey(state, now)] ?? 0
}

/** Current league (from this local week's points). */
export function currentLeague(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): LeagueId {
  return leagueForPoints(weeklyPoints(state, now), 'week', ctx)
}

/** Max wilds per wave for the current league. */
export function currentMaxWaveSize(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): number {
  return ctx.config.encounters.leagueMaxWaveSize[currentLeague(state, now, ctx)]
}

/** Next league and the points still needed this week (null at the top). */
export function nextLeagueProgress(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): { next: LeagueId; pointsNeeded: number } | null {
  const order = ctx.config.leagues.order
  const cur = currentLeague(state, now, ctx)
  const next = order[order.indexOf(cur) + 1]
  if (!next) return null
  return { next, pointsNeeded: Math.max(0, ctx.config.leagues.weeklyThresholds[next] - weeklyPoints(state, now)) }
}

export function leagueRank(id: LeagueId, ctx: EngineContext = defaultContext()): number {
  return ctx.config.leagues.order.indexOf(id)
}
