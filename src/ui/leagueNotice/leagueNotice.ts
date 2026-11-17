/**
 * League news (GDD §14): what to tell the player about `PlayerState.pendingLeagueNotices` (pure logic; the UI is
 * `LeagueNoticeDialog.tsx`). The Dust is already in the account when the notice shows.
 *
 * - A new league (Base → Super…) or a weekly podium opens a window, in the spirit of the trainer level-up one.
 * - Rungs climbed inside the same league only raise a toast: they happen in most sessions early in the week,
 *   and a window each time would get in the way. The Results screen also tells them.
 */
import { rankAt, type EngineContext, type LadderRung, type LeagueNotice } from '../../engine'

export interface LeagueNews {
  /** The climb of the week, merged: first rung and last rung, and the Dust of every rung in between. */
  climb: { from: LadderRung; to: LadderRung; dust: number } | null
  /** Podiums of closed weeks. */
  podiums: { rank: LadderRung; place: number; scope: 'country' | 'global'; dust: number; weekKey: string }[]
  dust: number
  /** `dialog`: a new league or a podium. `toast`: only rungs inside the same league. */
  how: 'dialog' | 'toast'
}

/** The pending notices as one piece of news. `null` when none. */
export function mergeLeagueNotices(pending: readonly LeagueNotice[] | undefined, ctx?: EngineContext): LeagueNews | null {
  if (!pending || pending.length === 0) return null
  const climbs = pending.filter((n): n is Extract<LeagueNotice, { kind: 'rankUp' }> => n.kind === 'rankUp')
  const podiums = pending
    .filter((n): n is Extract<LeagueNotice, { kind: 'podium' }> => n.kind === 'podium')
    .map((n) => ({ rank: rankAt(n.rank, 'week', ctx), place: n.place, scope: n.scope, dust: n.dust, weekKey: n.weekKey }))
  // Only the latest week's climb matters (an older week's one is stale news).
  const lastWeek = climbs[climbs.length - 1]?.weekKey
  const week = climbs.filter((c) => c.weekKey === lastWeek)
  const climb =
    week.length > 0
      ? { from: rankAt(Math.min(...week.map((c) => c.from)), 'week', ctx), to: rankAt(Math.max(...week.map((c) => c.to)), 'week', ctx), dust: climbs.reduce((a, c) => a + c.dust, 0) }
      : null
  const dust = (climb?.dust ?? 0) + podiums.reduce((a, p) => a + p.dust, 0)
  const newLeague = climb !== null && climb.from.league !== climb.to.league
  return { climb, podiums, dust, how: podiums.length > 0 || newLeague ? 'dialog' : 'toast' }
}

/** Stable identity of the pending notices, to remember them as seen while the `ackLeagueNotices` is in flight. */
export const leagueNoticesKey = (pending: readonly LeagueNotice[]): string => pending.map((n) => `${n.kind}:${n.weekKey}:${n.kind === 'rankUp' ? n.to : n.place}:${n.at}`).join('|')

/** Home phases where the news may show: not focusing, claiming, catching or resting. */
export const LEAGUE_NOTICE_CALM_PHASES: readonly string[] = ['idle', 'results']

export interface LeagueNoticeContext {
  news: LeagueNews | null
  phase: string
  hintOpen: boolean
  otherDialogOpen: boolean
  whatsNewPending: boolean
  /** The trainer level-up window is owed: it goes first. */
  levelUpOwed: boolean
}

export type LeagueNoticeDecision = 'none' | 'wait' | 'dialog' | 'toast'

export function decideLeagueNotice(c: LeagueNoticeContext): LeagueNoticeDecision {
  if (!c.news) return 'none'
  if (!LEAGUE_NOTICE_CALM_PHASES.includes(c.phase)) return 'wait'
  // A toast covers nothing, so only the home loop holds it back.
  if (c.news.how === 'toast') return 'toast'
  if (c.hintOpen || c.otherDialogOpen || c.whatsNewPending || c.levelUpOwed) return 'wait'
  return 'dialog'
}
