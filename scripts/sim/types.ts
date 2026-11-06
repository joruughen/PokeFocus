import type { DamagePolicy } from './capture-policy.ts'
import type { EngineContext, LeagueId, TypeSlug } from '../../src/engine/index.ts'
import type { ProfileId } from './profiles.ts'

export interface RunOptions {
  profile: ProfileId
  seed: number | string
  weeks: number
  ctx: EngineContext
  /**
   * Claim the engine's missions (GDD §13: daily / weekly missions and
   * Pokédex milestones) as soon as they are completed.
   */
  missions: boolean
  /** Multiplier on Great / Ultra Balls from missions (extra balls are added on claim). Default 1. */
  missionScale?: number
  /** Throw balls at wild Pokémon at all. */
  captures: boolean
  /** Spend candies and dust. */
  candies: boolean
  /** Keep the team fixed to the starter alone (reference leveling run). */
  soloStarter: boolean
  /** Record per-session records (needed for coverage and wave stats). */
  detail: boolean
  /** Damage split policy (default `auto`: the player keeps the "Auto" preference on). */
  damagePolicy?: DamagePolicy
}

export interface SessionRec {
  day: number
  week: number
  minutes: number
  valid: boolean
  rewarded: boolean
  rewardFactor: number
  focus: number
  points: number
  dust: number
  balls: number
  waves: number
  wilds: number
  league: LeagueId
  /** Wave sizes of this session. */
  waveSizes: number[]
  teamSize: number
  /** Valid sessions earlier the same local day (0 = first of the day). */
  ordinal: number
  /** Members that were awake. */
  active: number
  asleep: number
  /** Awake members that ran out of energy during the session. */
  exhausted: number
  /** Awake members that started the session without energy. */
  startedEmpty: number
  /** Mean (energy end / max) of awake members. */
  endEnergyFrac: number
  /** typeConditionMult for each of the 18 types at the start (index = ALL_TYPES order). */
  condMult: number[]
  /** Was the engine's active-condition list identical to ours? (consistency check) */
  condMatch: boolean
  lateClaim: boolean
  techniqueActivations: number
}

export interface DayRec {
  day: number
  /** Highest level among team members and highest level reachable by EXP alone (ignores the cap). */
  maxLevel: number
  maxExpLevel: number
  meanTeamLevel: number
  /** Median level and median EXP-only level (ignores the cap) of the team. */
  medTeamLevel: number
  medTeamExpLevel: number
  starterExpLevel: number
  starterLevel: number
  caught: number
  seen: number
  cap: number
  trainerLevel: number
  dust: number
  cumPoints: number
  cumMinutes: number
}

export interface Tally {
  // balls
  pokeBallsFromSessions: number
  pokeBallsFromConverted: number
  pokeBallsFromMissions: number
  greatBallsFromMissions: number
  ultraBallsFromMissions: number
  dustFromMissions: number
  missionsClaimed: number
  wavesTotal: number
  /** Σ hpFraction of the legendaries seen (mean = / legendarySeen). */
  legendaryHpSum: number
  throws: Record<'study-ball' | 'poke-ball' | 'great-ball' | 'ultra-ball', number>
  catches: Record<'study-ball' | 'poke-ball' | 'great-ball' | 'ultra-ball', number>
  shinyGuaranteedCatches: number
  fled: number
  newSpecies: number
  catchesTotal: number
  // dust and candies
  dustEarned: number
  dustSpent: number
  candiesFromCatch: number
  candiesFromRelease: number
  candiesSpent: number
  candyExpGained: number
  released: number
  evolutions: number
  // encounters
  wavesSeen: number
  wildsSeen: number
  wildsAtHpFloor: number
  wildsAsleepOrParalyzed: number
  legendarySeen: number
  legendaryRoamingSeen: number
  legendaryCaught: number
  /** Captures of legendaries met for the first time (not roaming re-appearances). */
  legendaryFreshCaught: number
  legendaryFled: number
  legendaryThrows: number
  legendaryPrepared: number
  shinySeen: number
  shinyCaught: number
  statusCharges: number
  statusChargesUsed: number
  rerollCharges: number
  rerollChargesUsed: number
  extraWild: number
  // energy / counters
  counterHits: number
  counterEnergyLost: number
  counterOnLeader: number
  restSessions: number
  sleepingStuckEnd: number
  // sessions
  sessionsTotal: number
  sessionsValid: number
  sessionsRewarded: number
  lateClaims: number
  // catch rate by rarity class (non-Study throws only): common R ≥ 150, mid 75–149, rare < 75, legendary
  throwsByClass: Record<'common' | 'mid' | 'rare' | 'legendary', number>
  catchesByClass: Record<'common' | 'mid' | 'rare' | 'legendary', number>
  // sanity
  condMismatch: number
}

/** One legendary wild thrown at: what is needed to replay its catch odds with another minimum capture rate. */
export interface LegendaryEncounter {
  /** Met for the first time (not a roaming re-appearance). */
  fresh: boolean
  slug: string
  /** Species capture_rate (the engine uses max(rate, legendaryMinCaptureRate)). */
  rate: number
  /** Per throw: chance ÷ (R_eff / 255), i.e. the part of the catch chance that does not depend on R. */
  mults: number[]
  /** Failed throws allowed before it flees. */
  maxThrows: number
  caught: boolean
}

export interface PlayerMetrics {
  profile: ProfileId
  seed: number | string
  weeks: number
  weeklyPoints: number[]
  weeklyMinutes: number[]
  weeklyBestLeague: LeagueId[]
  /** Weekday (0 = Mon) when each league was first reached that week, or null. */
  weeklyLeagueDay: Record<LeagueId, number | null>[]
  weeklyCaught: number[]
  dailyPoints: number[]
  days: DayRec[]
  sessions: SessionRec[]
  tally: Tally
  /** damage / maxHp of every wild seen (uncapped), per week. */
  dmgRatioByWeek: number[][]
  legendaryEncounters: LegendaryEncounter[]
  /** Caught species at the end and the order in which they were first caught (day index). */
  speciesFirstCaughtDay: Record<string, number>
  finalTeam: { slug: string; level: number }[]
  finalDust: number
  finalCandies: number
  finalBalls: Record<string, number>
  boxSize: number
  /** Wasted EXP above the cap at the end (sum over team members). */
  expAboveCap: number
}

export function emptyTally(): Tally {
  return {
    pokeBallsFromSessions: 0,
    pokeBallsFromConverted: 0,
    pokeBallsFromMissions: 0,
    greatBallsFromMissions: 0,
    ultraBallsFromMissions: 0,
    dustFromMissions: 0,
    missionsClaimed: 0,
    wavesTotal: 0,
    legendaryHpSum: 0,
    throws: { 'study-ball': 0, 'poke-ball': 0, 'great-ball': 0, 'ultra-ball': 0 },
    catches: { 'study-ball': 0, 'poke-ball': 0, 'great-ball': 0, 'ultra-ball': 0 },
    shinyGuaranteedCatches: 0,
    fled: 0,
    newSpecies: 0,
    catchesTotal: 0,
    dustEarned: 0,
    dustSpent: 0,
    candiesFromCatch: 0,
    candiesFromRelease: 0,
    candiesSpent: 0,
    candyExpGained: 0,
    released: 0,
    evolutions: 0,
    wavesSeen: 0,
    wildsSeen: 0,
    wildsAtHpFloor: 0,
    wildsAsleepOrParalyzed: 0,
    legendarySeen: 0,
    legendaryRoamingSeen: 0,
    legendaryCaught: 0,
    legendaryFreshCaught: 0,
    legendaryFled: 0,
    legendaryThrows: 0,
    legendaryPrepared: 0,
    shinySeen: 0,
    shinyCaught: 0,
    statusCharges: 0,
    statusChargesUsed: 0,
    rerollCharges: 0,
    rerollChargesUsed: 0,
    extraWild: 0,
    counterHits: 0,
    counterEnergyLost: 0,
    counterOnLeader: 0,
    restSessions: 0,
    sleepingStuckEnd: 0,
    sessionsTotal: 0,
    sessionsValid: 0,
    sessionsRewarded: 0,
    lateClaims: 0,
    throwsByClass: { common: 0, mid: 0, rare: 0, legendary: 0 },
    catchesByClass: { common: 0, mid: 0, rare: 0, legendary: 0 },
    condMismatch: 0,
  }
}

export type TypeIndex = Record<TypeSlug, number>
