/**
 * Serializable player state (JSON-safe: plain objects, arrays, strings, numbers,
 * booleans, null). Persisted by zustand now and by Supabase later. All reducers
 * in the engine are pure: they return a new state and never mutate their input.
 */
import type { BaseStats, LocaleCode, TypeSlug } from './data-types'
import type { BallSlug, FocusLabel, LeagueId, WildStatus } from './config'
import type { TimeZoneSpec } from './time'

// ---------------------------------------------------------------------------
// Inputs shared by several APIs
// ---------------------------------------------------------------------------

export interface WeatherInput {
  rain: boolean
  sun: boolean
  snow?: boolean
  /** Null if unknown. */
  tempC: number | null
}

/** Shares of the session (0–1); they need not sum exactly to 1. */
export interface SoundProfile {
  silence: number
  music: number
  voice: number
  noise: number
}

// ---------------------------------------------------------------------------
// Pokémon
// ---------------------------------------------------------------------------

/** Data every individual has (owned or wild). */
export interface IndividualCore {
  speciesSlug: string
  level: number
  ivs: BaseStats
  /** Nature slug. */
  nature: string
  /** Ability slug (always one defined in custom-abilities), or null if the species has none defined. */
  ability: string | null
  isShiny: boolean
  /** 2–3 extra techniques rolled at creation from egg/tutor/machine (usable only). */
  extraMoves: string[]
}

export interface OwnedPokemon extends IndividualCore {
  uid: string
  /** Total EXP (level L needs `expForLevel(L)`). */
  exp: number
  /** Minutes studied in the team (Bond, GDD §8). */
  bondMinutes: number
  /** Level-up techniques learned so far (usable only, no duplicates). */
  learnedMoves: string[]
  /** Equipped techniques, at most `techniqueSlots(level)`. */
  equippedMoves: string[]
  /** Minutes each technique has been equipped during sessions (Mastery, GDD §7.2). */
  moveMasteryMinutes: Record<string, number>
  /** Daily energy (= HP). `current` is valid as of `updatedAt` (ms). */
  energy: { current: number; updatedAt: number }
  /** Set by Rest: skips the next session (still gets EXP). */
  asleepNextSession: boolean
  teraType: TypeSlug | null
  teraUntil: number | null
  teraSessionsLeft: number
  caughtAt: number
  caughtBall: BallSlug | 'study-ball' | 'starter'
  metLevel: number
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface ActiveSession {
  id: string
  startedAt: number
  plannedMinutes: number
  /** Team snapshot at start (leader first). Teams can only change between sessions. */
  teamUids: string[]
  /** Energy of each team member at start (after daily reset/regen and Wish). */
  startEnergy: Record<string, number>
  /** Members asleep from Rest: they skip this session (still get EXP). */
  asleepUids: string[]
  note: string | null
  subjectTag: string | null
  /** Heals applied at start (Wish). */
  startHeals: { uid: string; amount: number; sourceUid: string }[]
}

export interface SessionSummary {
  id: string
  startedAt: number
  endedAt: number
  claimedAt: number
  dayKey: string
  weekKey: string
  minutes: number
  pausedSeconds: number
  focus: number
  screenshotLabels: string[] | null
  lateClaim: boolean
  rewardFactor: number
  points: number
  exp: number
  dust: number
  pokeBalls: number
  conditions: TypeSlug[]
  soundProfile: SoundProfile | null
  wilds: number
  caught: number
  techniqueActivations: number
  note: string | null
  subjectTag: string | null
}

export interface DaySummary {
  minutes: number
  sessions: number
  /** Local minute of day of the first session start. */
  firstStartMinute: number
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

/** Catch energy of one team member against one type, for one wave. */
export interface EnergyContribution {
  uid: string
  type: TypeSlug
  amount: number
  /** Same energy computed with `targetLegendary: true` effects. */
  amountVsLegendary: number
  effectivenessFloors: { from: number; to: number }[]
}

export interface WildPokemon extends IndividualCore {
  isLegendary: boolean
  isRoaming: boolean
  maxHp: number
  damage: number
  /** Remaining HP fraction, never below `capture.minHpFraction`. */
  hpFraction: number
  status: WildStatus | null
  studyBallEligible: boolean
  /** Lowest ball that guarantees the catch because it is shiny (GDD §11.1), or null. */
  guaranteedBall: BallSlug | null
  failedThrows: number
  /** Multiplier for the next throw (nextThrowBonus), 1 if none. */
  nextThrowBonus: number
  outcome: 'pending' | 'caught' | 'fled'
  caughtUid: string | null
}

export interface Wave {
  index: number
  wilds: WildPokemon[]
  /** available → used/lost; `converted` = no eligible wild, became a Poké Ball in the inventory. */
  studyBall: 'available' | 'used' | 'lost' | 'converted'
  contributions: EnergyContribution[]
  /** Types whose condition counted as active for species weighting. */
  activeConditionTypes: TypeSlug[]
}

export interface Charge {
  id: string
  kind: 'status' | 'reroll'
  status?: WildStatus
  sourceUid: string
  /** Technique or ability slug that produced it. */
  source: string
}

/** Everything needed to roll a replacement wild (reroll charge). */
export interface WaveGenParams {
  focus: number
  trainerLevel: number
  soundDominant: 'silence' | 'music' | 'voice' | 'noise' | null
  teamTypes: TypeSlug[]
  typeWeightMults: Partial<Record<TypeSlug, number>>
  syncNature: { nature: string; chance: number } | null
}

export interface EncounterState {
  sessionId: string
  waves: Wave[]
  currentWave: number
  charges: Charge[]
  gen: WaveGenParams
  /** When-context of the session, for counterattack effects. */
  env: { localHour: number; weekend: boolean; weather: WeatherInput | null; noPauses: boolean; sessionMinutes: number }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PlayerProfile {
  trainerName: string
  locale: LocaleCode
  /** IANA zone (e.g. 'America/Lima') or fixed UTC offset in minutes. */
  timezone: TimeZoneSpec
  city: string | null
  /** Placeholder for the city's current weather (set by the app; null = unknown). */
  weather: WeatherInput | null
  createdAt: number
}

export interface PlayerState {
  version: 1
  profile: PlayerProfile
  trainer: { level: number; exp: number }
  dust: number
  /** Item slug → amount (balls, potions, stones, mints…). The Study Ball never enters the inventory. */
  inventory: Record<string, number>
  candies: { chains: Record<string, number>; types: Partial<Record<TypeSlug, number>> }
  pokemon: Record<string, OwnedPokemon>
  /** Up to 6 uids, compact, slot 0 = leader. */
  team: string[]
  pokedex: { seen: string[]; caught: string[] }
  history: SessionSummary[]
  streak: {
    current: number
    best: number
    lastDayKey: string | null
    /** Days without sessions right before `lastDayKey` (for the Dark condition). */
    gapBeforeLastDay: number
    /** Week key in which streakProtect was last consumed. */
    protectUsedWeek: string | null
  }
  league: {
    weeklyPoints: Record<string, number>
    monthlyPoints: Record<string, number>
    bestLeague: LeagueId
  }
  roaming: { speciesSlug: string; sessionsLeft: number }[]
  pendingWishes: { sourceUid: string; pct: number; target: 'self' | 'team' | 'lowestAlly' }[]
  activeSession: ActiveSession | null
  encounter: EncounterState | null
  /** Per local day: minutes, sessions, first start (pruned to the last 14 days). */
  days: Record<string, DaySummary>
  lastSessionEndedAt: number | null
  /** Uses of techniques with `limitPerWeek` (key `uid:move`), for `weekKey`. */
  techniqueWeekUses: { weekKey: string; uses: Record<string, number> }
  counters: { pokemon: number; session: number; charge: number }
}

export type FocusInputs = {
  /** Labels returned by the classifier; null = no screen permission. */
  screenshotLabels: (FocusLabel | string)[] | null
  /** Scheduled screenshots that no tab could take. */
  missedCaptures: number
}

export type Result<T, E extends string = string> = { ok: true; value: T } | { ok: false; error: E }

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}
export function err<E extends string>(error: E): { ok: false; error: E } {
  return { ok: false, error }
}

/** structuredClone-free deep copy for plain JSON state. */
export function cloneState<T>(s: T): T {
  return JSON.parse(JSON.stringify(s)) as T
}
