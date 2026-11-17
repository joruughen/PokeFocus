/**
 * Session report ("what fired"): turns a `SessionResult` into the facts the
 * report shows. No formulas: every number comes from the engine's log
 * (`MemberResult.activables/passives/conditionLog`, `SessionResult.wildFactors`)
 * or from the config the engine used. Older results without the log degrade
 * to what they have.
 */
import {
  defaultContext,
  isDaylight,
  waveSizeForRank,
  isNight,
  type Charge,
  type ConditionLog,
  type ForcedCondition,
  type GameConfig,
  type LeagueId,
  type MemberResult,
  type SessionResult,
  type SoundKind,
  type TypeSlug,
} from '../../../engine'

export type WildFactor =
  | { kind: 'time'; hour: number; period: 'night' | 'day' | 'evening' }
  | { kind: 'conditions'; types: TypeSlug[]; mult: number; forced: ForcedCondition[] }
  | { kind: 'team'; types: TypeSlug[]; mult: number }
  | { kind: 'sound'; dominant: SoundKind | null; types: TypeSlug[]; mult: number }
  | { kind: 'typeWeight'; type: TypeSlug; mult: number; uid: string | null; source: string | null }
  | { kind: 'sync'; uid: string | null; source: string | null; nature: string; chance: number }
  | { kind: 'league'; league: LeagueId; sub: number; max: number; sizes: number[] }
  | { kind: 'extraWild'; count: number }
  | { kind: 'lowFocus'; focus: number }
  | { kind: 'roaming'; species: string[] }
  | { kind: 'longSession'; waves: number }

/** The factors that shaped the wilds of a session, most influential first. */
export function wildFactors(result: SessionResult, cfg: GameConfig = defaultContext().config): WildFactor[] {
  const e = cfg.encounters
  const wf = result.wildFactors
  const out: WildFactor[] = []
  const hour = wf?.localHour ?? result.env.localHour
  out.push({ kind: 'time', hour, period: isNight(hour, cfg) ? 'night' : isDaylight(hour, cfg) ? 'day' : 'evening' })

  // Normal is always active: it never changes which species show up.
  const condTypes = [...new Set(result.waves.flatMap((w) => w.activeConditionTypes))].filter((t) => t !== 'normal')
  if (condTypes.length > 0) out.push({ kind: 'conditions', types: condTypes, mult: e.conditionTypeWeight, forced: result.forcedConditions })

  if (result.gen.teamTypes.length > 0) out.push({ kind: 'team', types: result.gen.teamTypes, mult: e.teamTypeWeight })

  const dominant = result.gen.soundDominant
  out.push({ kind: 'sound', dominant, types: dominant ? e.soundProfileTypes[dominant] : [], mult: e.soundProfileWeight })

  if (wf) {
    for (const w of wf.typeWeights) out.push({ kind: 'typeWeight', ...w })
    if (wf.sync) out.push({ kind: 'sync', ...wf.sync })
  } else {
    for (const [type, mult] of Object.entries(result.gen.typeWeightMults)) {
      if (mult !== undefined && mult !== 1) out.push({ kind: 'typeWeight', type: type as TypeSlug, mult, uid: null, source: null })
    }
    const s = result.gen.syncNature
    if (s) out.push({ kind: 'sync', uid: null, source: null, nature: s.nature, chance: s.chance })
  }

  const league = wf?.league ?? result.league
  out.push({ kind: 'league', league, sub: result.gen.rank?.sub ?? 1, max: waveSizeForRank({ league, sub: result.gen.rank?.sub ?? 1 }, cfg), sizes: wf?.waveSizes ?? result.waves.map((w) => w.wilds.length) })
  if (result.extraWild > 0) out.push({ kind: 'extraWild', count: result.extraWild })
  if (result.focus < e.lowFocusThreshold) out.push({ kind: 'lowFocus', focus: result.focus })
  if (wf && wf.roaming.length > 0) out.push({ kind: 'roaming', species: wf.roaming })
  if (result.waves.length > 1) out.push({ kind: 'longSession', waves: result.waves.length })
  return out
}

/** Charges a member produced this session. */
export function chargesBy(result: Pick<SessionResult, 'charges'>, uid: string): Charge[] {
  return result.charges.filter((c) => c.sourceUid === uid)
}

export interface ConditionLine extends ConditionLog {
  type: TypeSlug
  /** The technique that forced it, when `forced`. */
  forcedBy: ForcedCondition | null
}

/** Condition multipliers that raised a member's points (mult > 1), most actions first. */
export function conditionLines(m: MemberResult, result: Pick<SessionResult, 'forcedConditions'>): ConditionLine[] {
  const log = m.conditionLog ?? (m.conditionType && m.conditionMult > 1 ? [{ type: m.conditionType, mult: m.conditionMult, actions: m.actions, forced: false }] : [])
  return log
    .filter((c): c is ConditionLog & { type: TypeSlug } => c.type !== null && c.mult > 1)
    .map((c) => ({ ...c, forcedBy: c.forced ? (result.forcedConditions.find((f) => f.type === c.type) ?? null) : null }))
    .sort((a, b) => b.actions - a.actions)
}

/** Total techniques activated by a member (from the log, or the legacy `techniques`). */
export function activationsOf(m: MemberResult): number {
  return m.techniques.reduce((a, t) => a + t.count, 0)
}

/** Items the live events of the session's content dropped (`SessionResult.eventItems`), most first; empty when none. */
export function eventDrops(result: Pick<SessionResult, 'eventItems'>): { item: string; count: number }[] {
  return Object.entries(result.eventItems ?? {})
    .filter(([, count]) => count > 0)
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count || (a.item < b.item ? -1 : 1))
}
