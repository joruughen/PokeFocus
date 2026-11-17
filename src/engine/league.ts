/**
 * Leagues (GDD §14): weekly points decide the current league and subrank; every week
 * (local Monday 00:00) everybody starts again in Base 1.
 *
 * The ladder has one rung per subrank (Base 1–5, Super 1–5, Ultra 1–5, Master 1–25 with the
 * shipped config). Its thresholds are geometric inside each league: from the league's first
 * subrank (`leagues.weeklyThresholds`) to the next league's, and in the last league up to
 * `leagues.topRankPoints`. The first league starts at 0, so its second rung is
 * `leagues.secondRankPoints` and the rest grow geometrically from there.
 */
import type { GameConfig, LeagueId } from './config'
import { defaultContext, type EngineContext } from './context'
import type { ProgressEvent } from './progression'
import type { LeagueNotice, PlayerState } from './state'
import { monthKeyOf, weekKeyOf } from './time'

export type LeaguePeriod = 'week' | 'month'

/** One rung of the ladder. */
export interface LeagueRank {
  league: LeagueId
  /** Subrank inside the league, from 1. */
  sub: number
  /** Position in the whole ladder, from 0 (Base 1). */
  index: number
}

/** A rung with the weekly points that reach it. */
export interface LadderRung extends LeagueRank {
  points: number
}

/** Round to 3 significant digits (thresholds people can read). */
function round3(n: number): number {
  if (n <= 0) return 0
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 2))
  return Math.round(n / mag) * mag
}

const ladders = new WeakMap<GameConfig, LadderRung[]>()

/** Subranks of a league (1 when the config has none: older contents). */
export function subranksOf(league: LeagueId, cfg: GameConfig): number {
  return Math.max(1, Math.floor(cfg.leagues.subranks?.[league] ?? 1))
}

/** The weekly ladder of a config (memoized per config object). */
export function weeklyLadderOf(cfg: GameConfig): LadderRung[] {
  const hit = ladders.get(cfg)
  if (hit) return hit
  const l = cfg.leagues
  const out: LadderRung[] = []
  l.order.forEach((league, li) => {
    const n = subranksOf(league, cfg)
    const start = l.weeklyThresholds[league]
    const nextLeague = l.order[li + 1]
    // The last league ends on its last subrank (`topRankPoints`); the others, on the next league's first one.
    const end = nextLeague ? l.weeklyThresholds[nextLeague] : Math.max(start, l.topRankPoints ?? start)
    const steps = nextLeague ? n : n - 1
    for (let k = 1; k <= n; k++) {
      let pts: number
      if (k === 1) pts = start
      else if (start > 0) pts = start * Math.pow(end / start, (k - 1) / steps)
      else {
        // From 0 there is no ratio: the second rung is given and the rest grow from it.
        const second = Math.min(Math.max(1, l.secondRankPoints ?? end / (steps + 1)), end)
        pts = steps > 1 ? second * Math.pow(end / second, (k - 2) / (steps - 1)) : second
      }
      const prev = out[out.length - 1]
      const rounded = k === 1 ? start : round3(pts)
      out.push({ league, sub: k, index: out.length, points: prev ? Math.max(prev.points + 1, rounded) : rounded })
    }
  })
  ladders.set(cfg, out)
  return out
}

/** Every rung with its points (monthly: thresholds × monthlyMultiplier). */
export function leagueLadder(period: LeaguePeriod = 'week', ctx: EngineContext = defaultContext()): LadderRung[] {
  const weekly = weeklyLadderOf(ctx.config)
  if (period === 'week') return weekly
  const mult = ctx.config.leagues.monthlyMultiplier
  return weekly.map((r) => ({ ...r, points: r.points * mult }))
}

/** Rung for an amount of points. */
export function rankForPoints(points: number, period: LeaguePeriod = 'week', ctx: EngineContext = defaultContext()): LadderRung {
  const ladder = leagueLadder(period, ctx)
  let rung = ladder[0] as LadderRung
  for (const r of ladder) {
    if (points >= r.points) rung = r
    else break
  }
  return rung
}

/** Rung at a ladder position (clamped to the ladder). */
export function rankAt(index: number, period: LeaguePeriod = 'week', ctx: EngineContext = defaultContext()): LadderRung {
  const ladder = leagueLadder(period, ctx)
  return ladder[Math.max(0, Math.min(ladder.length - 1, Math.floor(index)))] as LadderRung
}

/** Rung of a league and subrank (clamped), e.g. to read a board chosen by the player. */
export function rankOf(league: LeagueId, sub: number, period: LeaguePeriod = 'week', ctx: EngineContext = defaultContext()): LadderRung {
  const ladder = leagueLadder(period, ctx)
  const inLeague = ladder.filter((r) => r.league === league)
  return (inLeague[Math.max(0, Math.min(inLeague.length - 1, Math.floor(sub) - 1))] ?? ladder[0]) as LadderRung
}

/** Points interval `[from, to)` of a rung (`to` null on the last one). */
export function rankInterval(index: number, period: LeaguePeriod = 'week', ctx: EngineContext = defaultContext()): { from: number; to: number | null } {
  const ladder = leagueLadder(period, ctx)
  const r = rankAt(index, period, ctx)
  return { from: r.points, to: ladder[r.index + 1]?.points ?? null }
}

/** League for an amount of weekly points (monthly: thresholds × monthlyMultiplier). */
export function leagueForPoints(points: number, period: LeaguePeriod = 'week', ctx: EngineContext = defaultContext()): LeagueId {
  return rankForPoints(points, period, ctx).league
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

/** Current rung (league and subrank) from this local week's points. */
export function currentRank(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): LadderRung {
  return rankForPoints(weeklyPoints(state, now), 'week', ctx)
}

/** `from → to` along the subranks 1..`leagueRampSubranks` of a league; later subranks keep `to`. */
function ramp(range: { from: number; to: number }, sub: number, cfg: GameConfig): number {
  const n = Math.max(1, cfg.encounters.leagueRampSubranks ?? 1)
  const t = n <= 1 ? 1 : Math.min(1, Math.max(0, (sub - 1) / (n - 1)))
  return range.from + (range.to - range.from) * t
}

/** Most wilds a wave can have at a rung (GDD §10.1): interpolated by subrank and rounded. */
export function waveSizeForRank(rank: Pick<LeagueRank, 'league' | 'sub'>, cfg: GameConfig): number {
  return Math.max(1, Math.round(ramp(cfg.encounters.leagueWaveSize[rank.league], rank.sub, cfg)))
}

/** Which wilds a rung offers (GDD §10.2): weight multipliers of evolved stages and of the legendary roll. */
export interface StageWeights {
  stage2: number
  stage3: number
  legendary: number
}

export function stageWeightsForRank(rank: Pick<LeagueRank, 'league' | 'sub'>, cfg: GameConfig): StageWeights {
  const w = cfg.encounters.leagueStageWeights?.[rank.league]
  if (!w) return { stage2: 1, stage3: 1, legendary: 1 }
  return { stage2: ramp(w.stage2, rank.sub, cfg), stage3: ramp(w.stage3, rank.sub, cfg), legendary: w.legendary }
}

/** Weight multiplier of a species stage under some stage weights (stage 1: always 1; 3 and beyond: `stage3`). */
export function stageWeight(stage: number, w: StageWeights | null | undefined): number {
  if (!w || stage <= 1) return 1
  return stage === 2 ? w.stage2 : w.stage3
}

/** Max wilds per wave for the current rung. */
export function currentMaxWaveSize(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): number {
  return waveSizeForRank(currentRank(state, now, ctx), ctx.config)
}

/** Next rung, the points still needed this week and the progress inside the current rung (null at the top). */
export function nextRankProgress(
  state: PlayerState,
  now: number,
  ctx: EngineContext = defaultContext(),
): { next: LadderRung; pointsNeeded: number; from: number; to: number; progress: number } | null {
  const points = weeklyPoints(state, now)
  const cur = rankForPoints(points, 'week', ctx)
  const next = leagueLadder('week', ctx)[cur.index + 1]
  if (!next) return null
  const span = Math.max(1, next.points - cur.points)
  return { next, pointsNeeded: Math.max(0, next.points - points), from: cur.points, to: next.points, progress: Math.min(1, Math.max(0, (points - cur.points) / span)) }
}

/** Next league and the points still needed this week (null in the top league). */
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

/**
 * Best rung ever reached. Saves from before the subranks only have `bestLeague`: they count as the
 * first subrank of that league.
 */
export function bestRank(state: PlayerState, ctx: EngineContext = defaultContext()): LadderRung {
  const saved = state.league.bestRank
  if (saved !== undefined) return rankAt(saved, 'week', ctx)
  return rankOf(state.league.bestLeague, 1, 'week', ctx)
}

/** Dust for reaching a rung in a week (`leagues.rankUpDust`; rung 0 pays nothing). */
export function rankUpDust(index: number, cfg: GameConfig): number {
  const d = cfg.leagues.rankUpDust
  if (!d || index <= 0) return 0
  return Math.max(0, Math.round(d.base + d.perRank * index))
}

/** Dust for every rung climbed from `fromIndex` (exclusive) to `toIndex` (inclusive). */
export function rankUpDustBetween(fromIndex: number, toIndex: number, cfg: GameConfig): number {
  let dust = 0
  for (let i = fromIndex + 1; i <= toIndex; i++) dust += rankUpDust(i, cfg)
  return dust
}

/** Dust of a podium place (1–3…) on the board of a rung; 0 when the place has no prize. */
export function podiumDust(index: number, place: number, cfg: GameConfig): number {
  const p = cfg.leagues.podium
  const mult = p?.placeMult[place - 1]
  if (!p || mult === undefined) return 0
  return Math.max(0, Math.round((p.dustBase + p.dustPerRank * index) * mult))
}

/** Settled weeks kept in the state (older ones can no longer be asked for). */
const PODIUM_SETTLED_KEPT = 8

/** Was the podium of that week already settled for this player? */
export function podiumSettled(state: PlayerState, weekKeyOfBoard: string): boolean {
  return (state.league.podiumSettled ?? []).includes(weekKeyOfBoard)
}

/** Most league notices kept unseen (the oldest go first). */
export const MAX_LEAGUE_NOTICES = 12

/** Queue a league notice; a climb right after another climb of the same week extends it. */
export function addLeagueNotice(list: readonly LeagueNotice[] | undefined, n: LeagueNotice): LeagueNotice[] {
  const out = [...(list ?? [])]
  const last = out[out.length - 1]
  if (n.kind === 'rankUp' && last?.kind === 'rankUp' && last.weekKey === n.weekKey && last.to === n.from) {
    out[out.length - 1] = { ...last, to: n.to, dust: last.dust + n.dust, at: n.at }
  } else out.push(n)
  return out.slice(-MAX_LEAGUE_NOTICES)
}

/**
 * Close a finished week for the player (pure): mark it settled and pay the podium Dust of `place` on the board of
 * the rung `index` (`place` null = no podium), queueing its notice. Settling twice does nothing. The caller (the
 * server) decides the place from the final board.
 */
export function settlePodium(
  state: PlayerState,
  input: { weekKey: string; index: number; place: number | null; scope?: 'country' | 'global'; at?: number },
  ctx: EngineContext = defaultContext(),
): { state: PlayerState; dust: number } {
  if (podiumSettled(state, input.weekKey)) return { state, dust: 0 }
  const dust = input.place === null ? 0 : podiumDust(input.index, input.place, ctx.config)
  const settled = [...(state.league.podiumSettled ?? []), input.weekKey].slice(-PODIUM_SETTLED_KEPT)
  let next: PlayerState = { ...state, dust: state.dust + dust, league: { ...state.league, podiumSettled: settled } }
  if (input.place !== null && dust > 0) {
    next = {
      ...next,
      pendingLeagueNotices: addLeagueNotice(next.pendingLeagueNotices, { kind: 'podium', weekKey: input.weekKey, rank: input.index, place: input.place, scope: input.scope ?? 'country', dust, at: input.at ?? 0 }),
    }
  }
  return { state: next, dust }
}

/**
 * Add league points of the week `wk` and month `mk` (pure, used by the claim): the best rung and best league, the
 * rank-up Dust of every rung climbed (each rung is reached once a week because points only grow inside a week),
 * the `leagueUp` event and the `rankUp` notice. The caller adds `dust` to the state.
 */
export function addLeaguePoints(
  state: Pick<PlayerState, 'league' | 'pendingLeagueNotices'>,
  wk: string,
  mk: string,
  points: number,
  at: number,
  ctx: EngineContext = defaultContext(),
): { league: PlayerState['league']; dust: number; event: Extract<ProgressEvent, { type: 'leagueUp' }> | null; notices: LeagueNotice[] | null } {
  const l = state.league
  const prevWeek = l.weeklyPoints[wk] ?? 0
  const from = rankForPoints(prevWeek, 'week', ctx)
  const to = rankForPoints(prevWeek + points, 'week', ctx)
  const up = to.index > from.index
  const dust = up ? rankUpDustBetween(from.index, to.index, ctx.config) : 0
  const prevBest = l.bestRank ?? rankOf(l.bestLeague, 1, 'week', ctx).index
  const league: PlayerState['league'] = {
    weeklyPoints: { ...l.weeklyPoints, [wk]: prevWeek + points },
    monthlyPoints: { ...l.monthlyPoints, [mk]: (l.monthlyPoints[mk] ?? 0) + points },
    ...(l.podiumSettled && { podiumSettled: l.podiumSettled }),
    bestLeague: leagueRank(to.league, ctx) > leagueRank(l.bestLeague, ctx) ? to.league : l.bestLeague,
    bestRank: Math.max(prevBest, to.index),
  }
  return {
    league,
    dust,
    event: up ? { type: 'leagueUp', from: from.league, to: to.league, fromSub: from.sub, toSub: to.sub, dust } : null,
    notices: up ? addLeagueNotice(state.pendingLeagueNotices, { kind: 'rankUp', weekKey: wk, from: from.index, to: to.index, dust, at }) : null,
  }
}
