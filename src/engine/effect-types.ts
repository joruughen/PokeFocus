/**
 * Effect primitives contract (docs/effects.md). Techniques and abilities are
 * lists of these effects; the engine implements each primitive once.
 */
import type { LocalizedText, TypeSlug } from './data-types'
import type { FocusLabel, WildStatus } from './config'

export type TimeWindow = 'daylight' | 'notDaylight' | 'night' | 'notNight' | 'earlyMorning'
export type WeatherWhen = 'rain' | 'sun' | 'cold'

/** All present keys must hold (AND). */
export interface When {
  sessionMinMinutes?: number
  energyBelow?: number
  energyFull?: boolean
  timeWindow?: TimeWindow
  weather?: WeatherWhen
  weekend?: boolean
  noPauses?: boolean
  isLeader?: boolean
  targetLegendary?: boolean
}

export type ModStat =
  | 'points'
  | 'pace'
  | 'captureEnergy'
  | 'techChance'
  | 'energyCost'
  | 'exp'
  | 'bondGain'
  | 'counterDamageTaken'

/** Stats where a lower multiplier is the "stronger" effect (team non-stacking). */
export const LOWER_IS_BETTER: ReadonlySet<ModStat> = new Set<ModStat>(['energyCost', 'counterDamageTaken'])

export type HealTarget = 'self' | 'team' | 'lowestAlly'
export type HealTiming = 'now' | 'sessionEnd' | 'nextSessionStart'

interface Base {
  when?: When
}

export type Effect =
  | (Base & { kind: 'statMod'; stat: ModStat; mult: number; scope?: 'self' | 'team' })
  | (Base & { kind: 'heal'; pct: number; target: HealTarget; timing?: HealTiming })
  | (Base & { kind: 'healOverTime'; pctPerAction: number })
  | (Base & { kind: 'restFullHeal' })
  | (Base & { kind: 'wildStatus'; status: WildStatus })
  | (Base & { kind: 'statusOnAction'; status: WildStatus; chance: number; limit: number })
  | (Base & { kind: 'extraWild'; count: number })
  | (Base & { kind: 'rerollWild' })
  | (Base & { kind: 'activateCondition'; type: TypeSlug })
  | (Base & { kind: 'pointsBurst'; actions: number; mult: number })
  | (Base & { kind: 'lastActionMult'; mult: number })
  | (Base & { kind: 'conditionBonusMult'; mult: number })
  | (Base & { kind: 'streakProtect' })
  | (Base & { kind: 'lateClaimImmune' })
  | (Base & { kind: 'focusFloor'; min: number })
  | (Base & { kind: 'focusLabelFloor'; labels: FocusLabel[]; value: number })
  | (Base & { kind: 'effectivenessFloor'; from: number; to: number })
  | (Base & { kind: 'encounterWeight'; match: { type: TypeSlug } | { natureOfSelf: true }; mult: number })
  | (Base & { kind: 'ballMult'; mult: number })
  | (Base & { kind: 'maxFailedThrows'; add: number })
  | (Base & { kind: 'revealWildIvs' })
  | (Base & { kind: 'counterImmuneType'; type: TypeSlug })
  | (Base & { kind: 'counterMinHp1' })
  | (Base & { kind: 'counterMiss'; chance: number; scope?: 'self' | 'team' })
  | (Base & { kind: 'counterReflect'; wildHpPct: number })
  | (Base & { kind: 'counterStatus'; status: WildStatus; chance: number })
  | (Base & { kind: 'counterNoFirst' })
  | (Base & { kind: 'nextThrowBonus'; mult: number })
  | (Base & { kind: 'noSleepFromRest' })

export type EffectKind = Effect['kind']
export type EffectOf<K extends EffectKind> = Extract<Effect, { kind: K }>

export interface TechniqueDef {
  category: 'passive' | 'activable'
  baseChance?: number
  limitPerSession?: number
  limitPerWeek?: number
  effects: Effect[]
  description: LocalizedText
}

export interface AbilityDef {
  effects: Effect[]
  description: LocalizedText
}

export const EFFECT_KINDS: readonly EffectKind[] = [
  'statMod', 'heal', 'healOverTime', 'restFullHeal', 'wildStatus', 'statusOnAction', 'extraWild',
  'rerollWild', 'activateCondition', 'pointsBurst', 'lastActionMult', 'conditionBonusMult',
  'streakProtect', 'lateClaimImmune', 'focusFloor', 'focusLabelFloor', 'effectivenessFloor',
  'encounterWeight', 'ballMult', 'maxFailedThrows', 'revealWildIvs', 'counterImmuneType',
  'counterMinHp1', 'counterMiss', 'counterReflect', 'counterStatus', 'counterNoFirst',
  'nextThrowBonus', 'noSleepFromRest',
]
