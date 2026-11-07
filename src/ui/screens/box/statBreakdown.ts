import { computeStats, type EngineContext, type IndividualCore, type StatKey } from '../../../engine'

/** Where one stat number comes from. The three parts always add up to `total`. */
export interface StatBreakdown {
  /** Species and level (a neutral nature, IV at 0): what any individual of this species has at this level. */
  base: number
  /** What the nature adds or takes away (negative when it lowers the stat). */
  nature: number
  /** What this Pokémon's IV adds on top, today (the same figure the IVs tab shows). */
  iv: number
  total: number
}

type Core = Pick<IndividualCore, 'speciesSlug' | 'level' | 'ivs' | 'nature'>

/**
 * Splits a stat into species+level, nature and IV, using the engine itself so it
 * can never disagree with the number on screen: the IV part is the stat minus the
 * same stat with that IV at 0 (same nature); the nature part is that stat with IV 0
 * minus the same with a neutral nature (an empty slug has no modifier).
 */
export function statBreakdown(p: Core, stat: StatKey, ctx?: EngineContext): StatBreakdown {
  const total = computeStats(p, ctx)[stat]
  const noIv: Core = { ...p, ivs: { ...p.ivs, [stat]: 0 } }
  const withNatureNoIv = computeStats(noIv, ctx)[stat]
  const base = computeStats({ ...noIv, nature: '' }, ctx)[stat]
  return { base, nature: withNatureNoIv - base, iv: total - withNatureNoIv, total }
}
