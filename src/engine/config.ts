/**
 * Typed game configuration (GDD §19 `game_config`).
 *
 * Values come from `src/data/game/custom-game-config.json`. A few parameters the
 * engine needs are not in that file yet; they live in `ENGINE_DEFAULTS` below and
 * are deep-merged *under* the JSON, so adding them to the JSON later overrides them.
 */
import configJson from '../data/game/custom-game-config.json'
import type { StatKey, TypeSlug } from './data-types'

export type LeagueId = 'base' | 'super' | 'ultra' | 'master'
export type BallSlug = 'poke-ball' | 'great-ball' | 'ultra-ball'
export type WildStatus = 'sleep' | 'paralysis'
export type FocusLabel = 'studying' | 'educational' | 'chat' | 'social' | 'game' | 'unknown'
export type SoundKind = 'silence' | 'music' | 'voice' | 'noise'

export interface StatCurve {
  pivot: number
  k: number
}

export interface GameConfig {
  session: {
    presets: number[]
    minMinutes: number
    maxMinutes: number
    waveMinutes: number
    claimWindowMinutes: number
    lateClaimMultiplier: number
    dailyFullRewardMinutes: number
    dailyHalfRewardMinutes: number
    /** Reward factor between full and half thresholds (GDD §3.3: 50%). */
    dailyHalfRewardFactor: number
  }
  focus: {
    screenshotsPerSession: number
    screenshotWindow: [number, number]
    screenshotMinGapMinutes: number
    /** Session Focus when the player claims on time (× `session.lateClaimMultiplier` if late). */
    baseValue: number
    missedCaptureValue: number
    labelValues: Record<FocusLabel, number>
    model: string
  }
  actions: {
    intervalBaseSeconds: number
    intervalSpeedOffset: number
    pointsBase: number
    pointsSpAtkDivisor: number
    energyAtkDivisor: number
    energyPowerDivisor: number
    noDamageMoveEnergyFactor: number
    techMultBase: number
    techMultSpDefDivisor: number
    techMultMax: number
    maxActivationChance: number
    /** Grit (Aguante): max bonus on a Pokémon's own Focus (0.10 = +10 %), reached at `defenseFocusCap` Defense. */
    defenseFocusMaxBonus: number
    defenseFocusCap: number
  }
  statCurves: Record<StatKey, StatCurve>
  energy: {
    costBase: number
    costLevelDivisor: number
    dailyResetHour: number
    breakRecoverPct: number
    boxRecoverPctPerHour: number
    /** Healing items (GDD §5.3): flat energy, or `revivePct` from 0. */
    potions: Record<string, number>
    revivePct: number
  }
  rewards: {
    expPerMinute: number
    dustPerMinute: number
    pokeBallsPerSession: number
  }
  bond: {
    maxBonus: number
    minutesForMax: number
    friendshipEvolutionBond: number
  }
  conditions: {
    normal: number
    fire: number
    water: number
    grass: number
    electric: number
    ice: number
    fighting: number
    poisonPerSession: number
    poisonMax: number
    ground: number
    flying: number
    psychic: number
    bugPerBug: number
    rock: number
    ghost: number
    dragon: number
    dragonStreakDays: number
    dark: number
    darkMissedDays: number
    steel: number
    steelWindowMinutes: number
    fairy: number
    electricMaxMinutes: number
    electricChainGapMinutes: number
    fightingMinMinutes: number
    fireHotCelsius: number
    iceColdCelsius: number
    flyingNoiseShare: number
    psychicSilenceShare: number
    dayWindow: [number, number]
    afternoonWindow: [number, number]
    nightWindow: [number, number]
    /** `timeWindow: earlyMorning` (effects.md: 05–09). */
    earlyMorningWindow: [number, number]
  }
  encounters: {
    waveSizeJitter: number
    minWaveSize: number
    lowFocusThreshold: number
    /**
     * Wilds per wave by league (GDD §10.1): the cap goes from `from` (subrank 1) to `to` (subrank
     * `leagueRampSubranks`), interpolated and rounded; later subranks keep `to`.
     */
    leagueWaveSize: Record<LeagueId, { from: number; to: number }>
    /** Subranks over which `leagueWaveSize` and `leagueStageWeights` go from `from` to `to`. */
    leagueRampSubranks: number
    /**
     * Which wilds a league offers (GDD §10.2): weight multiplier of 2nd- and 3rd-stage species (0 = they never
     * appear), interpolated like the wave size, and the multiplier of the legendary roll.
     */
    leagueStageWeights: Record<LeagueId, { stage2: { from: number; to: number }; stage3: { from: number; to: number }; legendary: number }>
    legendaryChance: number
    longSessionLegendaryMult: number[]
    longSessionRareBoost: number[]
    conditionTypeWeight: number
    soundProfileWeight: number
    teamTypeWeight: number
    shinyChance: number
    roamingSessions: number
    roamingChance: number
    studyBallMaxLevel: number
    /** Study Ball max level = clamp(wild range min + this, studyBallMaxLevel, studyBallLevelCap). */
    studyBallLevelMargin: number
    /** Highest the Study Ball limit can grow with the trainer level (absent = no cap). */
    studyBallLevelCap?: number
    wildLevelByTrainerLevel: { trainerLevel: number; min: number; max: number }[]
    legendaryMinLevel: number
    /** Types favoured by the dominant sound profile (GDD §4.3). */
    soundProfileTypes: Record<SoundKind, TypeSlug[]>
    /**
     * Minimum wild level for an evolved form whose evolution is not by level
     * (stone, friendship, trade): `previous stage min level + this`.
     */
    nonLevelEvolutionLevelGap: number
  }
  capture: {
    legendaryMinCaptureRate: number
    /** Scale of the classic damage formula applied to wilds (GDD §11.3). */
    captureDamageScale: number
    /** Attacker level cap vs the wild: min(L, wildL · ratio + gap); null = off. */
    levelSync: { ratio: number; gap: number } | null
    /**
     * Each action's damage × (its action interval ÷ the interval at this Speed),
     * so Speed/pace raise points but not damage per minute; null = off.
     */
    damageReferenceSpeed: number | null
    /** How each action picks its target in the wave: uniformly, or ∝ the wild's max HP. */
    hitTargeting: 'uniform' | 'maxHp'
    minHpFraction: number
    maxFailedThrows: number
    balls: Record<BallSlug, { mult: number; shinyGuarantee: { maxStage: number; maxLevel: number } }>
    statusMult: Record<WildStatus | 'none', number>
    counter: {
      basePct: number
      levelExponent: number
      defenseDivisor: number
      defenseMaxReduction: number
      legendaryMult: number
      /**
       * Global multiplier on every counterattack (the wilds' damage). Counters are spread over the
       * attackers instead of always hitting the leader, so this tunes the team-wide pressure.
       */
      damageMult: number
      /** `counterImmuneType`: heals this share of max Energy (effects.md: 25%). */
      immuneHealPct: number
    }
  }
  progression: {
    /**
     * Total EXP for level L: `round(coef · L^exponent)`. With `kneeLevel` + `exponentAfter` the curve bends at the
     * knee: up to `kneeLevel` it is the same, above it `EXP(knee) · (L / knee)^exponentAfter` (continuous). That is
     * fast early (hooks the casual player) and much slower later (GDD §12.1). Absent = a single power law.
     */
    expCurve: { coef: number; exponent: number; kneeLevel?: number; exponentAfter?: number }
    candyExp: number
    typeCandyExp: number
    candyDustBase: number
    candyDustPerLevel: number
    /** Optional quadratic term of the Dust per candy: `base + perLevel·L + perLevelSq·L²` (absent = 0). */
    candyDustPerLevelSq?: number
    candiesOnCatch: number
    candiesOnRelease: number[]
    levelCaps: { species: number; cap: number }[]
    techniqueSlots: { level: number; slots: number }[]
    extraMovesPerIndividual: [number, number]
    hiddenAbilityChance: number
    ivMax: number
    legendaryPerfectIvs: number
    mastery: { hours: number; mult: number }[]
    maxLevel: number
    /**
     * Level at which an extra move becomes usable. Damage moves:
     * max(1, round((power − powerOffset) / powerDivisor)); special techniques: statusLevel.
     */
    extraMoveUnlock: { powerOffset: number; powerDivisor: number; statusLevel: number }
  }
  trainer: {
    /** Trainer EXP needed for level L = round(coef · (L − 1)^exponent). */
    expCoef: number
    expExponent: number
    expPerMinute: number
    expPerNewSpecies: number
    maxLevel: number
    /**
     * Reward for every trainer level reached: `dustBase + dustPerLevel · level` Dust, plus the items of every tier
     * whose `step` divides the level (step 1 = every level, 5 = levels 5, 10, 15…). In a tier row every key but
     * `step` is an item slug and its amount (0 = none). See `trainerLevelRewards`.
     */
    levelRewards: { dustBase: number; dustPerLevel: number; tiers: { step: number; [item: string]: number }[] }
  }
  /**
   * Box capacity (GDD §12.9): `baseCapacity + perStep · floor(trainerLevel / stepLevels)`, never above `maxCapacity`.
   * With the Box full, a capture waits as pending (up to `maxPending`; shinies and legendaries always wait) until the
   * player swaps it for a Pokémon, converts it into candies or keeps it; past `maxPending` a normal capture becomes candies.
   */
  box: { baseCapacity: number; perStep: number; stepLevels: number; maxCapacity: number; maxPending: number }
  leagues: {
    order: LeagueId[]
    /** Weekly points of the first subrank of each league. */
    weeklyThresholds: Record<LeagueId, number>
    monthlyMultiplier: number
    /** Subranks of each league (GDD §14): Base/Super/Ultra 1–5, Master 1–25. */
    subranks: Record<LeagueId, number>
    /** Weekly points of the second rung of the ladder (the first one is 0). */
    secondRankPoints: number
    /** Weekly points of the last rung (the last subrank of the last league). */
    topRankPoints: number
    /** Dust for each rung reached in a week: `base + perRank · rung` (rung 1 = the second one of the ladder). */
    rankUpDust: { base: number; perRank: number }
    /**
     * Weekly podium of a rank board (GDD §14): needs `minPlayers` on the board; the place `i` (0 = first) gets
     * `(dustBase + dustPerRank · rung) · placeMult[i]` Dust.
     */
    podium: { minPlayers: number; dustBase: number; dustPerRank: number; placeMult: number[] }
  }
  /**
   * Advanced items (GDD F4: §9.4 Tera, §7 TMs, §6.2 Mints, §6.1 Bottle Caps, §6.3 Ability Capsule).
   * `minTrainerLevel` unlocks the use; `unlockGift` items are given once, with the reward of the trainer
   * level that unlocks it (`trainerLevelRewards`). TMs and Mints have no gift (a Bottle Cap gift is 0: Bottle Caps only come from events).
   */
  advanced: {
    tm: { minTrainerLevel: number }
    tera: { minTrainerLevel: number; shardCost: number; hours: number; sessions: number; unlockGift: number }
    mint: { minTrainerLevel: number }
    bottleCap: { minTrainerLevel: number; unlockGift: number }
    abilityCapsule: { minTrainerLevel: number; unlockGift: number }
  }
  starters: string[]
  starterLevel: number
  starterPokeBalls: number
  /** Max session summaries kept in `PlayerState.history`. */
  historyLimit: number
  /** Trades between friends (GDD §12.8, see trade.ts). Not editable live. */
  trade: TradeConfig
}

/** Trades between friends (GDD §12.8). */
export interface TradeConfig {
  /** Days of accepted friendship before two players can trade. */
  minFriendshipDays: number
  /** An open offer lapses after this many hours without completing. */
  offerTtlHours: number
  /** Completed trades per player and local day. */
  dailyLimit: number
  /** Dust each side pays: `dustBase` × `shinyMult` (shiny) × `legendaryMult` (legendary/mythical), of the dearer Pokémon. */
  dustBase: number
  shinyMult: number
  legendaryMult: number
  /** Longest optional message of an offer (graphemes). */
  messageMax: number
  /** Open offers (offered or countered) a player may have sent at once. */
  maxOpenSent: number
}

/** Parameters the engine needs that are not (yet) in custom-game-config.json. */
export const ENGINE_DEFAULTS = {
  session: { dailyHalfRewardFactor: 0.5 },
  energy: {
    potions: { potion: 20, 'super-potion': 50, 'hyper-potion': 120 },
    revivePct: 0.5,
  },
  conditions: { earlyMorningWindow: [5, 9] },
  encounters: {
    soundProfileTypes: {
      silence: ['psychic', 'ghost', 'ice'],
      music: ['fairy', 'normal', 'electric', 'flying'],
      voice: ['normal', 'fighting'],
      noise: ['poison', 'rock', 'steel'],
    },
    nonLevelEvolutionLevelGap: 15,
  },
  capture: { counter: { immuneHealPct: 0.25, damageMult: 1 } },
  progression: { maxLevel: 100 },
  box: { baseCapacity: 150, perStep: 25, stepLevels: 5, maxCapacity: 400, maxPending: 10 },
  trainer: { expCoef: 100, expExponent: 1.5, expPerMinute: 1, expPerNewSpecies: 60, maxLevel: 50, levelRewards: { dustBase: 0, dustPerLevel: 0, tiers: [] } },
  advanced: {
    tm: { minTrainerLevel: 15 },
    tera: { minTrainerLevel: 20, shardCost: 2, hours: 24, sessions: 5, unlockGift: 2 },
    mint: { minTrainerLevel: 25 },
    bottleCap: { minTrainerLevel: 40, unlockGift: 0 },
    abilityCapsule: { minTrainerLevel: 30, unlockGift: 1 },
  },
  historyLimit: 1000,
  trade: { minFriendshipDays: 3, offerTtlHours: 72, dailyLimit: 3, dustBase: 100, shinyMult: 5, legendaryMult: 10, messageMax: 80, maxOpenSent: 10 },
} as const

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T
export type GameConfigOverrides = DeepPartial<GameConfig>

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep merge (arrays replaced). Returns a new object. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : (over as T))
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('_') || v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

/** Build a config: engine defaults < JSON file < overrides (e.g. from the simulator). */
export function buildConfig(overrides?: GameConfigOverrides, json: unknown = configJson): GameConfig {
  const merged = deepMerge(deepMerge({} as Record<string, unknown>, ENGINE_DEFAULTS), json)
  return deepMerge(merged, overrides ?? {}) as unknown as GameConfig
}
