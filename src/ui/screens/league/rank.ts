import type { LeagueId } from '../../../engine'

/** Plate colors of the four leagues. */
export const LEAGUE_STYLE: Record<string, string> = {
  base: 'bg-dusk-600 text-mist-100',
  super: 'bg-exp-400 text-ink',
  ultra: 'bg-volt-400 text-ink',
  master: 'bg-type-psychic text-ink',
}

type T = (key: string, opts?: Record<string, unknown>) => string

/** "Liga Super 3": the full name of a rung. */
export function rankName(t: T, rank: { league: string; sub: number }): string {
  return t('league.rank', { league: t(`league.names.${rank.league as LeagueId}`, { defaultValue: rank.league }), sub: rank.sub })
}

/** "Super 3": the short name of a rung (chips, tables). */
export function rankShort(t: T, rank: { league: string; sub: number }): string {
  return t('league.rank', { league: t(`league.short.${rank.league as LeagueId}`, { defaultValue: rank.league }), sub: rank.sub })
}
