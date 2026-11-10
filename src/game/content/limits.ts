/**
 * Live content limits (docs/admin-plan.md §2 «Validación»): the whitelist of
 * config paths an admin may change in a `ContentPatch`, with their ranges.
 * It drives the zod schema (schema.ts), the big-change guard (validate.ts) and
 * the admin forms (grouped, with step/unit/label).
 *
 * Shared with the admin client chunk: no server dependencies, no engine
 * runtime imports (types only).
 *
 * Not editable live (read at module load by the server or would invalidate
 * saves): `session.*`, `focus.*`, `progression.ivMax/maxLevel`, `statCurves`,
 * `starters`, `starterLevel`, `historyLimit`, `trainer.expCoef/expExponent/maxLevel`,
 * `energy.dailyResetHour`, `leagues.order`. Anything not listed here is rejected.
 */

/**
 * How a number is shown and guarded:
 * - `prob`: a probability (0–1, shown as %); the big-change guard fires at ×5.
 * - `fraction`: a share 0–1 that is not a chance (heal %, threshold…).
 * - `mult`: a multiplier.
 * - `int`: an integer count/level/amount.
 * - `number`: any other real number (divisors, scales…).
 */
export type LimitKind = 'prob' | 'fraction' | 'mult' | 'int' | 'number'

export type LimitGroup = 'encounters' | 'capture' | 'energy' | 'actions' | 'economy' | 'leagues' | 'conditions'

export const LIMIT_GROUPS: readonly LimitGroup[] = ['encounters', 'capture', 'energy', 'actions', 'economy', 'leagues', 'conditions']

/**
 * Changes that cannot be pinned to a session and apply at once to every player
 * (docs/admin-plan.md §1 «Riesgos»): the publish UI warns about them.
 * - `leagueWeek`: applies to the current league week (propose scheduling it for Monday 00:00).
 * - `owned`: changes Pokémon already caught (level caps, candies…).
 */
export type LiveImpact = 'leagueWeek' | 'owned'

export interface NumberBounds {
  kind: LimitKind
  min: number
  max: number
  /** Form step (ints: 1). */
  step: number
  /** Display unit hint for the form ('%', 'min', 's', 'lv', 'pts'…). */
  unit?: string
}

/** A scalar config path. */
export interface ConfigLimit extends NumberBounds {
  path: string
  group: LimitGroup
  /** i18n key of the form label (`admin.config.<path>`). */
  labelKey: string
  impact?: LiveImpact
}

/** A list of numbers (e.g. one multiplier per wave). */
export interface ConfigListLimit {
  path: string
  group: LimitGroup
  labelKey: string
  minItems: number
  maxItems: number
  item: NumberBounds
  impact?: LiveImpact
}

/** A table of rows with numeric columns (e.g. wild levels by trainer level). */
export interface ConfigTableLimit {
  path: string
  group: LimitGroup
  labelKey: string
  minItems: number
  maxItems: number
  columns: Record<string, NumberBounds>
  impact?: LiveImpact
}

const STEP: Record<LimitKind, number> = { prob: 0.0001, fraction: 0.01, mult: 0.05, int: 1, number: 0.01 }

function b(kind: LimitKind, min: number, max: number, unit?: string, step = STEP[kind]): NumberBounds {
  return { kind, min, max, step, ...(unit !== undefined && { unit }) }
}

function scalar(group: LimitGroup, path: string, bounds: NumberBounds, impact?: LiveImpact): ConfigLimit {
  return { path, group, labelKey: `admin.config.${path}`, ...bounds, ...(impact && { impact }) }
}

const LEAGUES = ['base', 'super', 'ultra', 'master'] as const
const BALLS = ['poke-ball', 'great-ball', 'ultra-ball'] as const
const POTIONS = ['potion', 'super-potion', 'hyper-potion'] as const
/** Type condition multipliers (GDD §9): the flat ones (poison and bug scale per session/bug). */
const CONDITION_TYPES = [
  'normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'ground',
  'flying', 'psychic', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const

const E = 'encounters' as const
const C = 'capture' as const
const N = 'energy' as const
const A = 'actions' as const
const X = 'economy' as const
const L = 'leagues' as const
const K = 'conditions' as const

/** Scalar whitelist. Order = form order inside each group. */
export const CONFIG_LIMITS: readonly ConfigLimit[] = [
  // --- Encounters ---------------------------------------------------------
  scalar(E, 'encounters.legendaryChance', b('prob', 0, 0.05, '%')),
  scalar(E, 'encounters.shinyChance', b('prob', 0, 0.02, '%')),
  scalar(E, 'encounters.conditionTypeWeight', b('mult', 1, 5)),
  scalar(E, 'encounters.soundProfileWeight', b('mult', 1, 5)),
  scalar(E, 'encounters.teamTypeWeight', b('mult', 1, 5)),
  scalar(E, 'encounters.baseWaveSize', b('int', 1, 8)),
  scalar(E, 'encounters.waveSizeJitter', b('int', 0, 3)),
  scalar(E, 'encounters.minWaveSize', b('int', 1, 8)),
  scalar(E, 'encounters.lowFocusThreshold', b('fraction', 0, 1)),
  ...LEAGUES.map((l) => scalar(E, `encounters.leagueMaxWaveSize.${l}`, b('int', 1, 12))),
  ...LEAGUES.map((l) => scalar(E, `encounters.leagueWaveBonus.${l}`, b('int', 0, 6))),
  scalar(E, 'encounters.roamingSessions', b('int', 1, 10)),
  scalar(E, 'encounters.roamingChance', b('prob', 0, 1, '%')),
  scalar(E, 'encounters.studyBallMaxLevel', b('int', 1, 100, 'lv')),
  scalar(E, 'encounters.studyBallLevelMargin', b('int', 0, 50, 'lv')),
  scalar(E, 'encounters.legendaryMinLevel', b('int', 1, 100, 'lv')),
  scalar(E, 'encounters.nonLevelEvolutionLevelGap', b('int', 0, 50, 'lv')),

  // --- Capture ------------------------------------------------------------
  ...BALLS.map((ball) => scalar(C, `capture.balls.${ball}.mult`, b('mult', 0.5, 5))),
  ...BALLS.map((ball) => scalar(C, `capture.balls.${ball}.shinyGuarantee.maxStage`, b('int', 0, 3))),
  ...BALLS.map((ball) => scalar(C, `capture.balls.${ball}.shinyGuarantee.maxLevel`, b('int', 1, 100, 'lv'))),
  scalar(C, 'capture.statusMult.sleep', b('mult', 1, 5)),
  scalar(C, 'capture.statusMult.paralysis', b('mult', 1, 5)),
  scalar(C, 'capture.captureDamageScale', b('number', 0.005, 0.5, undefined, 0.001)),
  scalar(C, 'capture.legendaryMinCaptureRate', b('int', 1, 255)),
  scalar(C, 'capture.minHpFraction', b('fraction', 0.01, 0.5)),
  scalar(C, 'capture.maxFailedThrows', b('int', 1, 10)),
  scalar(C, 'capture.damageReferenceSpeed', b('number', 10, 250, undefined, 1)),
  scalar(C, 'capture.levelSync.ratio', b('mult', 0.5, 2)),
  scalar(C, 'capture.levelSync.gap', b('int', -20, 20, 'lv')),
  scalar(C, 'capture.counter.basePct', b('fraction', 0, 0.5)),
  scalar(C, 'capture.counter.levelExponent', b('number', 0, 2)),
  scalar(C, 'capture.counter.defenseDivisor', b('number', 50, 2000, undefined, 1)),
  scalar(C, 'capture.counter.defenseMaxReduction', b('fraction', 0, 0.9)),
  scalar(C, 'capture.counter.legendaryMult', b('mult', 1, 5)),
  scalar(C, 'capture.counter.damageMult', b('mult', 0, 5)),
  scalar(C, 'capture.counter.immuneHealPct', b('fraction', 0, 1)),

  // --- Energy -------------------------------------------------------------
  scalar(N, 'energy.costBase', b('number', 0.05, 5)),
  scalar(N, 'energy.costLevelDivisor', b('number', 1, 200, undefined, 1)),
  scalar(N, 'energy.breakRecoverPct', b('fraction', 0, 1)),
  scalar(N, 'energy.boxRecoverPctPerHour', b('fraction', 0, 1)),
  ...POTIONS.map((p) => scalar(N, `energy.potions.${p}`, b('int', 1, 1000))),
  scalar(N, 'energy.revivePct', b('fraction', 0.05, 1)),

  // --- Actions / damage ---------------------------------------------------
  scalar(A, 'actions.intervalBaseSeconds', b('number', 60, 900, 's', 1)),
  scalar(A, 'actions.intervalSpeedOffset', b('number', 0, 300, undefined, 1)),
  scalar(A, 'actions.pointsBase', b('number', 0.5, 50)),
  scalar(A, 'actions.pointsSpAtkDivisor', b('number', 1, 50)),
  scalar(A, 'actions.energyAtkDivisor', b('number', 1, 50)),
  scalar(A, 'actions.energyPowerDivisor', b('number', 10, 300, undefined, 1)),
  scalar(A, 'actions.noDamageMoveEnergyFactor', b('fraction', 0, 2)),
  scalar(A, 'actions.techMultBase', b('number', 0, 2)),
  scalar(A, 'actions.techMultSpDefDivisor', b('number', 10, 500, undefined, 1)),
  scalar(A, 'actions.techMultMax', b('mult', 1, 5)),
  scalar(A, 'actions.maxActivationChance', b('prob', 0, 0.9, '%')),
  scalar(A, 'actions.defenseFocusMaxBonus', b('fraction', 0, 0.5)),
  scalar(A, 'actions.defenseFocusCap', b('number', 50, 500, undefined, 1)),

  // --- Economy ------------------------------------------------------------
  scalar(X, 'rewards.expPerMinute', b('number', 0, 200)),
  scalar(X, 'rewards.dustPerMinute', b('number', 0, 100)),
  scalar(X, 'rewards.pokeBallsPerSession', b('int', 0, 20)),
  scalar(X, 'trainer.expPerMinute', b('number', 0, 20)),
  scalar(X, 'trainer.expPerNewSpecies', b('int', 0, 1000)),
  scalar(X, 'bond.maxBonus', b('fraction', 0, 0.5)),
  scalar(X, 'progression.candyExp', b('int', 1, 5000), 'owned'),
  scalar(X, 'progression.typeCandyExp', b('int', 1, 5000), 'owned'),
  scalar(X, 'progression.candyDustBase', b('int', 0, 1000), 'owned'),
  scalar(X, 'progression.candyDustPerLevel', b('number', 0, 100), 'owned'),
  scalar(X, 'progression.candiesOnCatch', b('int', 0, 20)),
  scalar(X, 'progression.hiddenAbilityChance', b('prob', 0, 0.5, '%')),

  // --- Leagues ------------------------------------------------------------
  // `base` stays 0: everybody starts in it.
  scalar(L, 'leagues.weeklyThresholds.super', b('int', 1, 10_000_000, 'pts'), 'leagueWeek'),
  scalar(L, 'leagues.weeklyThresholds.ultra', b('int', 1, 10_000_000, 'pts'), 'leagueWeek'),
  scalar(L, 'leagues.weeklyThresholds.master', b('int', 1, 10_000_000, 'pts'), 'leagueWeek'),
  scalar(L, 'leagues.monthlyMultiplier', b('mult', 1, 10), 'leagueWeek'),

  // --- Type conditions (point multipliers) --------------------------------
  ...CONDITION_TYPES.map((t) => scalar(K, `conditions.${t}`, b('mult', 1, 3))),
  scalar(K, 'conditions.poisonPerSession', b('fraction', 0, 0.5)),
  scalar(K, 'conditions.poisonMax', b('mult', 1, 3)),
  scalar(K, 'conditions.bugPerBug', b('fraction', 0, 0.5)),
]

/** Number lists (the whole list is replaced, like every array in `deepMerge`). */
export const CONFIG_LIST_LIMITS: readonly ConfigListLimit[] = [
  {
    path: 'encounters.longSessionLegendaryMult',
    group: E,
    labelKey: 'admin.config.encounters.longSessionLegendaryMult',
    minItems: 1,
    maxItems: 8,
    item: b('mult', 1, 5),
  },
  {
    path: 'encounters.longSessionRareBoost',
    group: E,
    labelKey: 'admin.config.encounters.longSessionRareBoost',
    minItems: 1,
    maxItems: 8,
    item: b('mult', 1, 3),
  },
]

/** Tables (the whole table is replaced). Row order rules are checked in validate.ts. */
export const CONFIG_TABLE_LIMITS: readonly ConfigTableLimit[] = [
  {
    path: 'encounters.wildLevelByTrainerLevel',
    group: E,
    labelKey: 'admin.config.encounters.wildLevelByTrainerLevel',
    minItems: 1,
    maxItems: 20,
    columns: { trainerLevel: b('int', 1, 100, 'lv'), min: b('int', 1, 100, 'lv'), max: b('int', 1, 100, 'lv') },
  },
  {
    path: 'progression.levelCaps',
    group: X,
    labelKey: 'admin.config.progression.levelCaps',
    minItems: 1,
    maxItems: 20,
    columns: { species: b('int', 0, 1000), cap: b('int', 1, 100, 'lv') },
    impact: 'owned',
  },
]

/** Every editable config path (scalars, lists and tables). */
export const EDITABLE_CONFIG_PATHS: readonly string[] = [
  ...CONFIG_LIMITS.map((l) => l.path),
  ...CONFIG_LIST_LIMITS.map((l) => l.path),
  ...CONFIG_TABLE_LIMITS.map((l) => l.path),
]

const scalarByPath = new Map(CONFIG_LIMITS.map((l) => [l.path, l]))
const listByPath = new Map(CONFIG_LIST_LIMITS.map((l) => [l.path, l]))
const tableByPath = new Map(CONFIG_TABLE_LIMITS.map((l) => [l.path, l]))

export function configLimit(path: string): ConfigLimit | undefined {
  return scalarByPath.get(path)
}

export function configListLimit(path: string): ConfigListLimit | undefined {
  return listByPath.get(path)
}

export function configTableLimit(path: string): ConfigTableLimit | undefined {
  return tableByPath.get(path)
}

// --- Data and event limits ---------------------------------------------------

/** Species / moves / missions / events ranges (used by schema.ts). */
export const DATA_LIMITS = {
  captureRate: b('int', 1, 255),
  spawnWeightMult: b('mult', 0, 20),
  /** Local hours `[from, to)`; 24 = end of day. */
  spawnHour: b('int', 0, 24, 'h'),
  spawnMaxWindows: 6,
  minTrainerLevel: b('int', 1, 100, 'lv'),
  movePower: b('int', 1, 250),
  moveAccuracy: b('int', 1, 100, '%'),
  missionCount: b('int', 0, 6),
  missionTarget: b('int', 1, 100_000),
  missionMinMinutes: b('int', 15, 600, 'min'),
  missionWeight: b('number', 0, 100),
  missionPoolMax: 100,
  rewardTiersMax: 6,
  rewardItemCount: b('int', 1, 99),
  rewardDust: b('int', 0, 100_000),
  rewardTypeCandies: b('int', 1, 100),
  rewardRandomCount: b('int', 1, 10),
  pokedexSpecies: b('int', 1, 1000),
  effectsMax: 8,
  techniqueLimit: b('int', 1, 20),
  eventFeaturedMax: 20,
  eventFeaturedMult: b('mult', 1, 10),
  eventShinyChance: b('prob', 0, 0.05, '%'),
  eventLegendaryMult: b('mult', 1, 10),
  eventDropsMax: 10,
  eventDropChance: b('prob', 0, 1, '%'),
  eventDropMax: b('int', 1, 99),
  eventMissionsMax: 10,
  eventItemsMax: 20,
  /** Longest event (ms): 62 days. */
  eventMaxDurationMs: 62 * 86_400_000,
  /** Short texts (titles, names) and long ones (descriptions). */
  shortText: 80,
  longText: 400,
} as const

/** Big-change guard: a number × or ÷ by more than this vs the base needs «confirm». */
export const BIG_CHANGE_FACTOR = 3
/** Same, for probabilities. */
export const BIG_CHANGE_FACTOR_PROB = 5
/** Spawn coverage: every hour × weather × level band needs at least this many species. */
export const MIN_SPAWN_SPECIES = 5
