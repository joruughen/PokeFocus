/**
 * Study sessions (GDD §3–§5, §7, §9–§11.3): start, simulate a completed
 * session, and apply its result to the player state.
 */
import type { GameConfig, LeagueId, WildStatus } from './config'
import { defaultContext, getSpecies, type EngineContext } from './context'
import {
  activeConditionTypes,
  dominantSound,
  pokemonConditionMult,
  type ConditionEnv,
  type WhenContext,
  evaluateWhen,
} from './conditions'
import type { BaseStats, TypeSlug } from './data-types'
import type { Effect, ModStat } from './effect-types'
import { ofKind, passiveEffects, selfStatMult, teamStatMults, type SourcedEffect } from './effects'
import { refreshEnergy } from './energy'
import { finishEncounter } from './capture'
import { leagueForPoints, leagueRank } from './league'
import { recordMissionEvent } from './missions'
import { getTechnique, type TechniqueInfo } from './moves'
import { gainExp, levelCap, trainerLevelFromExp, type ProgressEvent } from './progression'
import { chance, pick, weightedPick, type Rng } from './rng'
import {
  err,
  ok,
  type ActiveSession,
  type Charge,
  type EncounterState,
  type EnergyContribution,
  type FocusInputs,
  type OwnedPokemon,
  type PlayerState,
  type Result,
  type SessionSummary,
  type SoundProfile,
  type Wave,
  type WaveGenParams,
  type WaveHit,
  type DamageMode,
  type WeatherInput,
} from './state'
import {
  actionIntervalSeconds,
  basePointsPerAction,
  bondMultiplier,
  catchEnergyPerAction,
  computeStats,
  defenseFocusBonus,
  effectiveFocus,
  energyCostPerAction,
  masteryMultiplier,
  noDamageMoveEnergy,
  techniqueMultiplier,
} from './stats'
import { addDays, daysBetween, MINUTE_MS, monthKeyOf, toLocal, weekKeyOf } from './time'
import { toManualWave } from './damage'
import { rollEventDrops } from './spawn'
import { blockIndexAt, damageFromHits, fullBlocks, hpFractionAfter, rollWaveSize, rollWild, waveCount } from './waves'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Types used for conditions: the Tera type while active, else the species types. */
export function conditionTypes(p: OwnedPokemon, at: number, ctx: EngineContext = defaultContext()): TypeSlug[] {
  if (p.teraType && p.teraUntil !== null && at < p.teraUntil && p.teraSessionsLeft > 0) return [p.teraType]
  return getSpecies(p.speciesSlug, ctx).types
}

const LABEL_ALIASES: Record<string, string> = {
  estudiando: 'studying',
  material_educativo: 'educational',
  redes_sociales: 'social',
  juego: 'game',
  indeterminado: 'unknown',
}

/**
 * Screenshot value (GDD §4.1): mean of label values, missed captures count as
 * `missedCaptureValue`; no labels (production: there is no classifier) or nothing to average →
 * `baseValue` (1.0). The labels only exist for the dev panel's simulated screenshots.
 * `labelFloors` (focusLabelFloor) raise specific labels for one Pokémon.
 */
export function captureValue(inputs: FocusInputs, cfg: GameConfig, labelFloors: Partial<Record<string, number>> = {}): number {
  if (inputs.screenshotLabels === null) return cfg.focus.baseValue
  const values: number[] = []
  for (const raw of inputs.screenshotLabels) {
    const label = LABEL_ALIASES[raw] ?? raw
    const v = (cfg.focus.labelValues as Record<string, number>)[label] ?? cfg.focus.labelValues.unknown
    values.push(Math.max(v, labelFloors[label] ?? 0))
  }
  for (let i = 0; i < Math.max(0, inputs.missedCaptures); i++) values.push(cfg.focus.missedCaptureValue)
  if (values.length === 0) return cfg.focus.baseValue
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Reward factor from daily diminishing returns (GDD §3.3), pro-rated across thresholds. */
export function dailyRewardFactor(minutesBefore: number, minutes: number, cfg: GameConfig): number {
  if (minutes <= 0) return 0
  const full = cfg.session.dailyFullRewardMinutes
  const half = cfg.session.dailyHalfRewardMinutes
  const seg = (a: number, b: number) => Math.max(0, Math.min(minutesBefore + minutes, b) - Math.max(minutesBefore, a))
  return (seg(0, full) + seg(full, half) * cfg.session.dailyHalfRewardFactor) / minutes
}

/**
 * Per-action activation chance of an activable technique (GDD §7.2):
 * min(maxActivationChance, baseChance · Mult_Técnica · Mult_Dominio · techChance).
 */
export function activationChance(
  baseChance: number,
  specialDefense: number,
  masteryMinutes: number,
  techChanceMult: number,
  cfg: GameConfig,
): number {
  return Math.min(
    cfg.actions.maxActivationChance,
    baseChance * techniqueMultiplier(specialDefense, cfg) * masteryMultiplier(masteryMinutes, cfg) * techChanceMult,
  )
}

/** Validated minutes: min(planned, elapsed − paused), floored. */
export function validatedMinutes(session: Pick<ActiveSession, 'startedAt' | 'plannedMinutes'>, endedAt: number, pausedSeconds: number): number {
  const elapsed = (endedAt - session.startedAt) / MINUTE_MS - Math.max(0, pausedSeconds) / 60
  return Math.max(0, Math.floor(Math.min(session.plannedMinutes, elapsed) + 1e-9))
}

/** Streak if a session happens on `dayKey` (GDD: Dragon, streakProtect). */
export function projectStreak(
  streak: PlayerState['streak'],
  dayKey: string,
  protectAvailable: boolean,
): { current: number; usedProtect: boolean; missedDaysBeforeToday: number } {
  if (streak.lastDayKey === null) return { current: 1, usedProtect: false, missedDaysBeforeToday: 0 }
  const gap = daysBetween(streak.lastDayKey, dayKey)
  if (gap <= 0) return { current: Math.max(1, streak.current), usedProtect: false, missedDaysBeforeToday: streak.gapBeforeLastDay }
  if (gap === 1) return { current: streak.current + 1, usedProtect: false, missedDaysBeforeToday: 0 }
  if (gap === 2 && protectAvailable) return { current: streak.current + 1, usedProtect: true, missedDaysBeforeToday: 1 }
  return { current: 1, usedProtect: false, missedDaysBeforeToday: gap - 1 }
}

/**
 * Conditions env of a hypothetical session that starts at `now` with no
 * pauses, no sound profile and no friend (the "conditions if you start now"
 * preview). Mirrors the env `completeSession` builds from the same state.
 */
export function conditionEnvAt(
  state: PlayerState,
  now: number,
  plannedMinutes: number,
  opts: { weather?: PlayerState['profile']['weather'] } = {},
  ctx: EngineContext = defaultContext(),
): ConditionEnv {
  const local = toLocal(now, state.profile.timezone)
  const today = state.days[local.dayKey]
  const streak = projectStreak(state.streak, local.dayKey, false)
  const members = state.team.map((u) => state.pokemon[u]).filter((p): p is OwnedPokemon => Boolean(p))
  return {
    minutes: plannedMinutes,
    localHour: local.hour,
    weekday: local.weekday,
    startMinuteOfDay: local.minuteOfDay,
    weather: opts.weather !== undefined ? opts.weather : state.profile.weather,
    soundProfile: null,
    pausedSeconds: 0,
    friendOverlap: null,
    sessionsEarlierToday: today?.sessions ?? 0,
    minutesSincePreviousEnd: state.lastSessionEndedAt === null ? null : (now - state.lastSessionEndedAt) / MINUTE_MS,
    streakDays: streak.current,
    missedDaysBeforeToday: streak.missedDaysBeforeToday,
    yesterdayFirstStartMinute: state.days[addDays(local.dayKey, -1)]?.firstStartMinute ?? null,
    bugCount: members.filter((p) => conditionTypes(p, now, ctx).includes('bug')).length,
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export interface StartSessionInput {
  plannedMinutes: number
  startedAt: number
  note?: string | null
  subjectTag?: string | null
}

export type StartSessionError = 'session_active' | 'invalid_duration' | 'empty_team'

/**
 * Start a session. Enforces a single active session. Refreshes energy to
 * `startedAt`, applies pending Wish heals, snapshots the team.
 */
export function startSession(
  state: PlayerState,
  input: StartSessionInput,
  ctx: EngineContext = defaultContext(),
): Result<{ state: PlayerState; session: ActiveSession }, StartSessionError> {
  const cfg = ctx.config
  if (state.activeSession) return err('session_active')
  if (!(input.plannedMinutes >= cfg.session.minMinutes && input.plannedMinutes <= cfg.session.maxMinutes)) return err('invalid_duration')
  const teamUids = state.team.filter((u) => state.pokemon[u])
  if (teamUids.length === 0) return err('empty_team')
  let s = refreshEnergy(state, input.startedAt, ctx)
  const pokemon = { ...s.pokemon }
  const startHeals: ActiveSession['startHeals'] = []
  const maxOf = (uid: string) => computeStats(pokemon[uid] as OwnedPokemon, ctx).hp
  const heal = (uid: string, pct: number, sourceUid: string) => {
    const p = pokemon[uid]
    if (!p) return
    const max = maxOf(uid)
    const amount = Math.min(max - p.energy.current, max * pct)
    if (amount <= 0) return
    pokemon[uid] = { ...p, energy: { ...p.energy, current: p.energy.current + amount } }
    startHeals.push({ uid, amount, sourceUid })
  }
  for (const w of s.pendingWishes) {
    if (w.target === 'team') for (const u of teamUids) heal(u, w.pct, w.sourceUid)
    else if (w.target === 'self') {
      if (teamUids.includes(w.sourceUid)) heal(w.sourceUid, w.pct, w.sourceUid)
    } else {
      let low: string | null = null
      let lowFrac = Infinity
      for (const u of teamUids) {
        const f = (pokemon[u] as OwnedPokemon).energy.current / maxOf(u)
        if (f < lowFrac) {
          lowFrac = f
          low = u
        }
      }
      if (low) heal(low, w.pct, w.sourceUid)
    }
  }
  const id = `s${s.counters.session + 1}`
  const session: ActiveSession = {
    id,
    startedAt: input.startedAt,
    plannedMinutes: input.plannedMinutes,
    teamUids,
    startEnergy: Object.fromEntries(teamUids.map((u) => [u, (pokemon[u] as OwnedPokemon).energy.current])),
    asleepUids: teamUids.filter((u) => (pokemon[u] as OwnedPokemon).asleepNextSession),
    note: input.note ?? null,
    subjectTag: input.subjectTag ?? null,
    startHeals,
  }
  s = { ...s, pokemon, pendingWishes: [], activeSession: session, counters: { ...s.counters, session: s.counters.session + 1 } }
  return ok({ state: s, session })
}

/** What cancelling a session keeps (GDD §3.4). */
export interface CancelKeep {
  /** Something is kept: the session is resolved like a claim with `cancelled: true`. */
  keeps: boolean
  /** Why nothing is kept: a session of one block or less, or fewer than `session.minMinutes` studied. */
  reason: 'short_session' | 'too_few_minutes' | null
  /** Whole minutes studied (pauses excluded). */
  minutes: number
  /** Waves kept = full 25-min blocks studied (0 before the first one). */
  waves: number
}

/**
 * Cancel rule (GDD §3.4, decided 2026-11-09). Only a long session (planned
 * longer than one 25-min block) keeps anything, and only once `minMinutes`
 * (15) have been studied: then the points, EXP and Polvo of the minutes
 * studied, and one wave per full block. A short session, or fewer than 15 min,
 * keeps nothing (as before). Pure: the server feeds it its own clock.
 */
export function cancelKeep(plannedMinutes: number, studiedMinutes: number, cfg: GameConfig): CancelKeep {
  const minutes = Math.max(0, Math.min(plannedMinutes, Math.floor(studiedMinutes + 1e-9)))
  if (plannedMinutes <= cfg.session.waveMinutes) return { keeps: false, reason: 'short_session', minutes, waves: 0 }
  if (minutes < cfg.session.minMinutes) return { keeps: false, reason: 'too_few_minutes', minutes, waves: 0 }
  return { keeps: true, reason: null, minutes, waves: fullBlocks(minutes, cfg) }
}

/** Abandon the active session without rewards. */
export function cancelSession(state: PlayerState): PlayerState {
  return { ...state, activeSession: null }
}

// ---------------------------------------------------------------------------
// Complete (simulation)
// ---------------------------------------------------------------------------

export interface CompleteSessionInput {
  /** When the timer finished (or the user stopped). */
  endedAt: number
  /** When the user pressed Claim. */
  claimedAt: number
  pausedSeconds: number
  focusInputs: FocusInputs
  soundProfile?: SoundProfile | null
  /** Defaults to `state.profile.weather`. */
  weather?: WeatherInput | null
  friendOverlap?: number | null
  /**
   * The player cancelled a long session before its end (GDD §3.4,
   * `cancelSessionKeep`): `endedAt` = when it was cancelled (or the start of
   * the pause it was cancelled in). Waves only for the 25-min blocks fully
   * studied (0 before the first one), never a late claim, no Poké Balls and no
   * roaming tick without a wave.
   */
  cancelled?: boolean
}

export interface TechniqueUse {
  move: string
  count: number
}

/** Uses of a damage move during the session (`move` null = the no-move Normal hit). */
export interface MoveUse {
  move: string | null
  count: number
}

/** Activable technique log (session report): rolls, successes and the per-action chance used. */
export interface ActivableLog {
  move: string
  /** Actions on which the activation chance was rolled (limits not reached). */
  attempts: number
  activations: number
  /** Per-action activation chance (it can vary with `techChance` mods whose `when` changes). */
  chanceMin: number
  chanceMax: number
  chanceAvg: number
  limitPerSession: number | null
  /** The session or weekly limit stopped further rolls. */
  limitReached: boolean
}

/** A passive effect (ability or passive technique) that did something this session. */
export interface PassiveLog {
  source: string
  sourceKind: 'ability' | 'technique'
  effect: Effect
  /** Actions on which it applied (per-action effects), successful triggers (statusOnAction), or 1 (once per session). */
  count: number
}

/** Condition multiplier applied to a member's actions, grouped by type and value. */
export interface ConditionLog {
  type: TypeSlug | null
  mult: number
  actions: number
  /** The type's condition was forced by a technique (`activateCondition`), not met naturally. */
  forced: boolean
}

/**
 * Running totals of a member's points, in the order the multipliers apply
 * (docs: "how the points are calculated"). Every stage is the sum over the
 * member's actions of the product so far, so each step's value is exactly what
 * that multiplier added. `raw` is the total before the daily reduction and
 * rounding (`points = round(raw · rewardFactor)`).
 */
export interface PointsStages {
  /** Σ (5 + SpAtk / 4) over the actions. */
  base: number
  afterCondition: number
  afterBond: number
  /** After the session Focus (100 % on time, 50 % late). */
  afterFocus: number
  /** After the Grit bonus (Defense, up to +10 %). */
  afterGrit: number
  /** After Focus effects of abilities (focus floors, late-claim immunity). */
  afterFocusAdj: number
  /** After the `points` effects of abilities and techniques (own, activated and team). */
  afterMods: number
  /** After the point bursts of activable techniques. */
  afterBurst: number
  /** After the "last action" bonus: the total before the daily factor. */
  raw: number
}

export interface MemberResult {
  uid: string
  speciesSlug: string
  slot: number
  /** Asleep from Rest: did not act (still gets EXP and Bond). */
  asleep: boolean
  actions: number
  points: number
  /** Catch energy produced (sum over types, before effectiveness). */
  catchEnergy: number
  energyStart: number
  energyEnd: number
  energyMax: number
  energySpent: number
  energyHealed: number
  /** Session minute the Pokémon first hit 0 energy, or null. */
  exhaustedAtMinute: number | null
  techniques: TechniqueUse[]
  /** Condition multiplier at the start of the session (after conditionBonusMult). */
  conditionMult: number
  conditionType: TypeSlug | null
  focusEffective: number
  exp: number
  bondMinutes: number
  masteryMinutes: Record<string, number>
  /** Rest was used: asleep next session. */
  rested: boolean
  // --- Session report (absent in results saved before it) ---
  damageMoves?: MoveUse[]
  activables?: ActivableLog[]
  passives?: PassiveLog[]
  conditionLog?: ConditionLog[]
  /** conditionBonusMult in effect (1 = none). */
  conditionBonusMult?: number
  /** How the points add up, step by step (absent in results saved before it). */
  pointsStages?: PointsStages
}

/** Why the wilds of this session were what they were (session report). */
export interface WildFactors {
  localHour: number
  weekday: number
  league: LeagueId
  /** Rolled size of each wave. */
  waveSizes: number[]
  extraWild: number
  /** Species weight boosts by type and the member/ability that caused each (encounterWeight). */
  typeWeights: { type: TypeSlug; mult: number; uid: string; source: string }[]
  /** Synchronize-like nature sharing and who caused it. */
  sync: { uid: string; source: string; nature: string; chance: number } | null
  /** Roaming legendaries that appeared. */
  roaming: string[]
}

export interface ForcedCondition {
  type: TypeSlug
  atMinute: number
  byUid: string
  move: string
}

export interface SessionResult {
  sessionId: string
  startedAt: number
  endedAt: number
  claimedAt: number
  plannedMinutes: number
  minutes: number
  pausedSeconds: number
  dayKey: string
  weekKey: string
  monthKey: string
  /** False when the session was shorter than `session.minMinutes`. */
  valid: boolean
  /** Cancelled before its end and kept (GDD §3.4): rewards of the minutes studied, waves of the full blocks. Absent = completed. */
  cancelled?: boolean
  lateClaim: boolean
  /** Daily diminishing-returns factor (0–1). */
  rewardFactor: number
  /** Session Focus: base value (1.0) × late-claim multiplier (0.5). No Grit bonus: drives dust, wave size, legendary and shiny odds. */
  focus: number
  captureValue: number
  /** Types whose condition was active at the start (incl. Normal). */
  conditions: TypeSlug[]
  forcedConditions: ForcedCondition[]
  members: MemberResult[]
  totalPoints: number
  dust: number
  pokeBalls: number
  /** Items dropped by the live events of the session's content (`rollEventDrops`); absent = none. */
  eventItems?: Record<string, number>
  /** Catch energy per type for each 25-min block (= wave). */
  energyByBlock: Partial<Record<TypeSlug, number>>[]
  waves: Wave[]
  /** Status/reroll charges for this session's waves. */
  charges: Charge[]
  extraWild: number
  wishes: PlayerState['pendingWishes']
  streak: { current: number; usedProtect: boolean }
  roamingAfter: PlayerState['roaming']
  league: LeagueId
  gen: WaveGenParams
  env: EncounterState['env']
  soundProfile: SoundProfile | null
  weather: WeatherInput | null
  screenshotLabels: string[] | null
  /** Accompanied share (0–1) of a study-group session (Fairy condition); null/absent = solo. */
  friendOverlap?: number | null
  /** Activations of techniques with limitPerWeek (key `uid:move`). */
  weeklyUses: Record<string, number>
  note: string | null
  subjectTag: string | null
  /** Session report: wild generation factors (absent in results saved before it). */
  wildFactors?: WildFactors
}

interface ActLog {
  attempts: number
  activations: number
  sum: number
  min: number
  max: number
  limitReached: boolean
}

interface Sim {
  uid: string
  p: OwnedPokemon
  slot: number
  stats: BaseStats
  max: number
  energy: number
  energyStart: number
  types: TypeSlug[]
  asleep: boolean
  passives: SourcedEffect[]
  /** statMods gained from activations (rest of the session). */
  activated: SourcedEffect[]
  damageMoves: TechniqueInfo[]
  activables: TechniqueInfo[]
  bond: number
  focusEff: number
  /** Session Focus and Grit multiplier, to split `focusEff` in the points breakdown (report only). */
  focusSession: number
  gritMult: number
  /** Running totals for the points breakdown (report only: never read by the rules). */
  stg: { base: number; cond: number; bond: number; focus: number; grit: number; adj: number; mods: number; burst: number }
  bonusMult: number
  lastMult: number
  nextT: number
  actions: number
  pointsRaw: number
  lastPoints: number
  spent: number
  healed: number
  catchEnergy: number
  exhaustedAt: number | null
  techCounts: Map<string, number>
  statusCounts: Map<number, number>
  bursts: { remaining: number; mult: number }[]
  hot: number
  rested: boolean
  endHealPct: number
  // Session report logging (never read by the rules).
  logMoves: Map<string | null, number>
  logAct: Map<string, ActLog>
  /** Index in `passives` → times it applied. */
  logPassive: Map<number, number>
  logCond: Map<string, ConditionLog>
}

export type CompleteSessionError = 'no_active_session' | 'invalid_times'

interface BlockAction {
  sim: Sim
  move: TechniqueInfo | null
  units: number
  unitsVsLegendary: number
}

/**
 * Each action targets one wild of its wave (with probability ∝ `weights`,
 * see `capture.hitTargeting`); actions with the same
 * member, move and target are merged into a `WaveHit`. No damage move →
 * Normal, power 40, physical (units already × noDamageMoveEnergyFactor).
 */
function assignHits(
  actions: readonly BlockAction[],
  weights: readonly number[],
  rng: Rng,
  floorsOf: (s: Sim) => { from: number; to: number }[],
): WaveHit[] {
  const out = new Map<string, WaveHit>()
  for (const a of actions) {
    const target = weightedPick(rng, weights.map((_, i) => i), (i) => weights[i] ?? 0) ?? 0
    const key = `${a.sim.uid}|${a.move?.slug ?? ''}|${target}`
    let h = out.get(key)
    if (!h) {
      const type: TypeSlug = a.move ? a.move.type : 'normal'
      const damageClass = a.move?.damageClass === 'special' ? 'special' : 'physical'
      h = {
        uid: a.sim.uid,
        target,
        move: a.move?.slug ?? null,
        type,
        power: a.move ? a.move.power : NO_DAMAGE_MOVE_POWER,
        damageClass,
        level: a.sim.p.level,
        attack: damageClass === 'special' ? a.sim.stats.specialAttack : a.sim.stats.attack,
        stab: a.sim.types.includes(type),
        units: 0,
        unitsVsLegendary: 0,
        effectivenessFloors: floorsOf(a.sim),
      }
      out.set(key, h)
    }
    h.units += a.units
    h.unitsVsLegendary += a.unitsVsLegendary
  }
  return [...out.values()]
}

/** Power of the Normal hit used when a Pokémon has no damage technique equipped. */
export const NO_DAMAGE_MOVE_POWER = 40

/**
 * Simulate a completed session. Pure: `state` is not modified. Pass the result
 * to `applySessionResult`. Deterministic for a given rng seed.
 */
export function completeSession(
  state: PlayerState,
  session: ActiveSession,
  input: CompleteSessionInput,
  rng: Rng,
  ctx: EngineContext = defaultContext(),
): Result<SessionResult, CompleteSessionError> {
  const cfg = ctx.config
  if (!state.activeSession || state.activeSession.id !== session.id) return err('no_active_session')
  if (input.endedAt < session.startedAt || input.claimedAt < input.endedAt) return err('invalid_times')
  const tz = state.profile.timezone
  const local = toLocal(session.startedAt, tz)
  const dayKey = local.dayKey
  const weekKey = weekKeyOf(session.startedAt, tz)
  const monthKey = monthKeyOf(session.startedAt, tz)
  const weather = input.weather !== undefined ? input.weather : state.profile.weather
  const soundProfile = input.soundProfile ?? null
  const minutes = validatedMinutes(session, input.endedAt, input.pausedSeconds)
  const valid = minutes >= cfg.session.minMinutes
  const cancelled = input.cancelled === true
  // Cancelling is not a claim: the player stops the clock while it runs (the reducer refuses it once the timer ended).
  const lateClaim = !cancelled && input.claimedAt - input.endedAt > cfg.session.claimWindowMinutes * MINUTE_MS
  const lateMult = lateClaim ? cfg.session.lateClaimMultiplier : 1
  const today = state.days[dayKey]
  const rewardFactor = valid ? dailyRewardFactor(today?.minutes ?? 0, minutes, cfg) : 0
  const baseCapture = captureValue(input.focusInputs, cfg)
  const focus = baseCapture * lateMult
  const totalSeconds = minutes * 60
  // A cancelled session only gets the waves of its full 25-min blocks (a completed one always gets at least 1).
  const nWaves = cancelled ? fullBlocks(minutes, cfg) : waveCount(minutes, cfg)

  // --- Team --------------------------------------------------------------
  const members = session.teamUids.map((u) => state.pokemon[u]).filter((p): p is OwnedPokemon => Boolean(p))
  const streakProtectAvailable =
    state.streak.protectUsedWeek !== weekKey &&
    members.some((p) => !session.asleepUids.includes(p.uid) && passiveEffects(p, ctx).some((e) => e.effect.kind === 'streakProtect'))
  const streak = valid ? projectStreak(state.streak, dayKey, streakProtectAvailable) : { current: state.streak.current, usedProtect: false, missedDaysBeforeToday: 0 }
  const env: ConditionEnv = {
    minutes,
    localHour: local.hour,
    weekday: local.weekday,
    startMinuteOfDay: local.minuteOfDay,
    weather,
    soundProfile,
    pausedSeconds: input.pausedSeconds,
    friendOverlap: input.friendOverlap ?? null,
    sessionsEarlierToday: today?.sessions ?? 0,
    minutesSincePreviousEnd: state.lastSessionEndedAt === null ? null : (session.startedAt - state.lastSessionEndedAt) / MINUTE_MS,
    streakDays: streak.current,
    missedDaysBeforeToday: streak.missedDaysBeforeToday,
    yesterdayFirstStartMinute: state.days[addDays(dayKey, -1)]?.firstStartMinute ?? null,
    bugCount: members.filter((p) => conditionTypes(p, session.startedAt, ctx).includes('bug')).length,
  }
  const baseWc: WhenContext = {
    sessionMinutes: minutes,
    localHour: local.hour,
    weather,
    weekend: local.weekday === 0 || local.weekday === 6,
    noPauses: input.pausedSeconds <= 0,
    targetLegendary: false,
  }

  const sims: Sim[] = members.map((p, slot) => {
    const stats = computeStats(p, ctx)
    const energyStart = Math.min(stats.hp, session.startEnergy[p.uid] ?? p.energy.current)
    const passives = passiveEffects(p, ctx)
    const wc: WhenContext = { ...baseWc, isLeader: slot === 0, energyFraction: stats.hp > 0 ? energyStart / stats.hp : 0 }
    const flags = (k: Effect['kind']) => passives.filter((e) => e.effect.kind === k && evaluateWhen(e.effect.when, wc, cfg))
    // Report: passive flags that changed something (once per session).
    const logPassive = new Map<number, number>()
    const mark = (se: SourcedEffect) => logPassive.set(passives.indexOf(se), 1)
    const immune = flags('lateClaimImmune').length > 0
    if (lateClaim) flags('lateClaimImmune').forEach(mark)
    const labelFloors: Record<string, number> = {}
    for (const { effect: e } of ofKind(flags('focusLabelFloor'), 'focusLabelFloor')) {
      for (const l of e.labels) labelFloors[l] = Math.max(labelFloors[l] ?? 0, e.value)
    }
    const floored = captureValue(input.focusInputs, cfg, labelFloors)
    if (floored > baseCapture) flags('focusLabelFloor').forEach(mark)
    let f = floored * (lateClaim && !immune ? cfg.session.lateClaimMultiplier : 1)
    f = effectiveFocus(f, stats.defense, cfg)
    for (const se of ofKind(flags('focusFloor'), 'focusFloor')) {
      if (se.effect.min > f) mark(se)
      f = Math.max(f, se.effect.min)
    }
    flags('conditionBonusMult').forEach(mark)
    flags('effectivenessFloor').forEach(mark)
    const techs = p.equippedMoves.map((m) => getTechnique(m, ctx)).filter((t): t is TechniqueInfo => t !== null)
    let bonusMult = 1
    for (const { effect: e } of ofKind(flags('conditionBonusMult'), 'conditionBonusMult')) bonusMult = Math.max(bonusMult, e.mult)
    let lastMult = 1
    for (const { effect: e } of ofKind(flags('lastActionMult'), 'lastActionMult')) lastMult = Math.max(lastMult, e.mult)
    return {
      uid: p.uid,
      p,
      slot,
      stats,
      max: stats.hp,
      energy: energyStart,
      energyStart,
      types: conditionTypes(p, session.startedAt, ctx),
      asleep: session.asleepUids.includes(p.uid),
      passives,
      activated: [],
      damageMoves: techs.filter((t) => t.kind === 'damage'),
      activables: techs.filter((t) => t.kind === 'activable'),
      bond: bondMultiplier(p.bondMinutes, cfg),
      focusEff: f,
      focusSession: focus,
      gritMult: 1 + defenseFocusBonus(stats.defense, cfg),
      stg: { base: 0, cond: 0, bond: 0, focus: 0, grit: 0, adj: 0, mods: 0, burst: 0 },
      bonusMult,
      lastMult,
      nextT: 0,
      actions: 0,
      pointsRaw: 0,
      lastPoints: 0,
      spent: 0,
      healed: 0,
      catchEnergy: 0,
      exhaustedAt: null,
      techCounts: new Map(),
      statusCounts: new Map(),
      bursts: [],
      hot: 0,
      rested: false,
      endHealPct: 0,
      logMoves: new Map(),
      logAct: new Map(
        techs
          .filter((t) => t.kind === 'activable' && t.def)
          .map((t) => [t.slug, { attempts: 0, activations: 0, sum: 0, min: Infinity, max: 0, limitReached: false }]),
      ),
      logPassive,
      logCond: new Map(),
    }
  })
  const active = sims.filter((s) => !s.asleep)
  const byUid = new Map(sims.map((s) => [s.uid, s]))
  const wcOf = (s: Sim): WhenContext => ({ ...baseWc, isLeader: s.slot === 0, energyFraction: s.max > 0 ? s.energy / s.max : 0 })
  let teamProviders: SourcedEffect[] = active.flatMap((s) => s.passives)
  let teamMods = teamStatMults(teamProviders, (u) => wcOf(byUid.get(u) as Sim), cfg)
  const mult = (s: Sim, stat: ModStat, wc: WhenContext) => selfStatMult([...s.passives, ...s.activated], stat, wc, cfg) * (teamMods[stat] ?? 1)
  const interval = (s: Sim) => actionIntervalSeconds(s.stats.speed, cfg) / Math.max(0.01, mult(s, 'pace', wcOf(s)))

  const forced = new Map<TypeSlug, number>()
  const forcedList: ForcedCondition[] = []
  const charges: Charge[] = []
  const wishes: PlayerState['pendingWishes'] = []
  const weeklyUses: Record<string, number> = {}
  let chargeN = state.counters.charge
  let extraWild = 0
  const contrib: Map<string, EnergyContribution>[] = Array.from({ length: nWaves }, () => new Map())
  /** Every action of each block, for the per-wild damage (targets are drawn once the wave size is known). */
  const blockActions: BlockAction[][] = Array.from({ length: nWaves }, () => [])
  const effFloorsOf = (s: Sim) =>
    ofKind(s.passives, 'effectivenessFloor')
      .filter((e) => evaluateWhen(e.effect.when, wcOf(s), cfg))
      .map((e) => ({ from: e.effect.from, to: e.effect.to }))

  const addCharge = (kind: Charge['kind'], sourceUid: string, source: string, status?: WildStatus) => {
    chargeN++
    charges.push({ id: `c${chargeN}`, kind, sourceUid, source, ...(status ? { status } : {}) })
  }
  const logPassiveHit = (s: Sim, se: SourcedEffect) => {
    const i = s.passives.indexOf(se)
    if (i >= 0) s.logPassive.set(i, (s.logPassive.get(i) ?? 0) + 1)
  }
  /** Per-action passive statMods whose `when` holds on this action (report only). */
  const PER_ACTION_STATS: ReadonlySet<ModStat> = new Set<ModStat>(['points', 'pace', 'captureEnergy', 'techChance', 'energyCost'])
  const naturalConditions = new Set(activeConditionTypes(env, cfg))
  const healSim = (s: Sim, amount: number) => {
    const real = Math.max(0, Math.min(s.max - s.energy, amount))
    s.energy += real
    s.healed += real
  }

  const applyEffect = (s: Sim, e: Effect, source: string, t: number) => {
    const wc = wcOf(s)
    if (!evaluateWhen(e.when, wc, cfg)) return
    switch (e.kind) {
      case 'statMod':
        s.activated.push({ effect: e, uid: s.uid, source, sourceKind: 'technique' })
        if (e.scope === 'team') {
          teamProviders = [...teamProviders, { effect: e, uid: s.uid, source, sourceKind: 'technique' }]
          teamMods = teamStatMults(teamProviders, (u) => wcOf(byUid.get(u) as Sim), cfg)
        }
        break
      case 'heal': {
        const timing = e.timing ?? 'now'
        if (timing === 'nextSessionStart') wishes.push({ sourceUid: s.uid, pct: e.pct, target: e.target })
        else if (timing === 'sessionEnd') s.endHealPct += e.pct
        else if (e.target === 'self') healSim(s, s.max * e.pct)
        else if (e.target === 'team') for (const o of active) healSim(o, o.max * e.pct)
        else {
          let low = s
          for (const o of active) if (o.energy / o.max < low.energy / low.max) low = o
          healSim(low, low.max * e.pct)
        }
        break
      }
      case 'healOverTime':
        s.hot = Math.max(s.hot, e.pctPerAction)
        break
      case 'restFullHeal': {
        healSim(s, s.max)
        const noSleep = ofKind(s.passives, 'noSleepFromRest').filter((n) => evaluateWhen(n.effect.when, wc, cfg))
        for (const n of noSleep) logPassiveHit(s, n)
        if (noSleep.length === 0) s.rested = true
        break
      }
      case 'wildStatus':
      case 'statusOnAction':
        addCharge('status', s.uid, source, e.status)
        break
      case 'rerollWild':
        addCharge('reroll', s.uid, source)
        break
      case 'extraWild':
        extraWild += e.count
        break
      case 'activateCondition':
        if (!forced.has(e.type)) {
          forced.set(e.type, t)
          forcedList.push({ type: e.type, atMinute: t / 60, byUid: s.uid, move: source })
        }
        break
      case 'pointsBurst':
        s.bursts.push({ remaining: e.actions, mult: e.mult })
        break
      case 'lastActionMult':
        s.lastMult = Math.max(s.lastMult, e.mult)
        break
      default:
        // Other primitives are passive-only (flags read elsewhere).
        break
    }
  }

  // --- Action loop ---------------------------------------------------------
  if (valid && rewardFactor > 0) {
    for (const s of active) s.nextT = interval(s)
    for (;;) {
      let s: Sim | null = null
      for (const c of active) if (c.nextT <= totalSeconds && (s === null || c.nextT < s.nextT)) s = c
      if (!s) break
      const t = s.nextT
      if (s.energy <= 1e-9) {
        s.nextT = t + interval(s)
        continue
      }
      const forcedNow = new Set([...forced].filter(([, at]) => at < t).map(([ty]) => ty))
      const wc = wcOf(s)
      // Points
      const condRes = pokemonConditionMult(s.types, env, cfg, forcedNow, s.bonusMult)
      const cond = condRes.mult
      {
        const ck = `${condRes.type ?? ''}|${cond}`
        const cl = s.logCond.get(ck) ?? { type: condRes.type, mult: cond, actions: 0, forced: condRes.type !== null && !naturalConditions.has(condRes.type) }
        cl.actions++
        s.logCond.set(ck, cl)
      }
      s.passives.forEach((se, i) => {
        const e = se.effect
        if (e.kind !== 'statMod' || !PER_ACTION_STATS.has(e.stat)) return
        if (!evaluateWhen(e.when, e.when?.targetLegendary ? { ...wc, targetLegendary: true } : wc, cfg)) return
        ;(s as Sim).logPassive.set(i, ((s as Sim).logPassive.get(i) ?? 0) + 1)
      })
      let burst = 1
      for (const b of s.bursts) {
        if (b.remaining > 0) {
          burst *= b.mult
          b.remaining--
        }
      }
      const basePts = basePointsPerAction(s.stats.specialAttack, cfg)
      const pointsMod = mult(s, 'points', wc)
      const pts = basePts * cond * s.bond * s.focusEff * pointsMod * burst
      // Breakdown (report only): the same product, stage by stage.
      {
        const g = s.stg
        const afterFocus = basePts * cond * s.bond * s.focusSession
        const afterGrit = afterFocus * s.gritMult
        g.base += basePts
        g.cond += basePts * cond
        g.bond += basePts * cond * s.bond
        g.focus += afterFocus
        g.grit += afterGrit
        g.adj += basePts * cond * s.bond * s.focusEff
        g.mods += basePts * cond * s.bond * s.focusEff * pointsMod
        g.burst += pts
      }
      s.pointsRaw += pts
      s.lastPoints = pts
      // Catch energy
      let type: TypeSlug = 'normal'
      let amount: number
      let move: TechniqueInfo | null = null
      if (s.damageMoves.length > 0) {
        move = pick(rng, s.damageMoves)
        type = move.type
        amount = catchEnergyPerAction(s.stats.attack, move.power, cfg)
      } else {
        amount = noDamageMoveEnergy(s.stats.attack, cfg)
      }
      s.logMoves.set(move?.slug ?? null, (s.logMoves.get(move?.slug ?? null) ?? 0) + 1)
      const capMultNormal = mult(s, 'captureEnergy', { ...wc, targetLegendary: false })
      const capMultLeg = mult(s, 'captureEnergy', { ...wc, targetLegendary: true })
      const capNormal = amount * capMultNormal
      s.catchEnergy += capNormal
      // No wave (a session cancelled before its first full block): the catch energy has nowhere to go.
      if (nWaves > 0) {
        const bi = blockIndexAt(t, nWaves, cfg)
        const block = contrib[bi] as Map<string, EnergyContribution>
        const key = `${s.uid}:${type}`
        const c = block.get(key) ?? { uid: s.uid, type, amount: 0, amountVsLegendary: 0, effectivenessFloors: effFloorsOf(s) }
        c.amount += capNormal
        c.amountVsLegendary += amount * capMultLeg
        block.set(key, c)
        // Pace-neutral damage: a faster Pokémon acts more often but each action hits proportionally softer.
        const refSpeed = cfg.capture.damageReferenceSpeed
        const paceFactor = refSpeed === null || refSpeed === undefined ? 1 : interval(s) / actionIntervalSeconds(refSpeed, cfg)
        const unit = (move ? 1 : cfg.actions.noDamageMoveEnergyFactor) * paceFactor
        ;(blockActions[bi] as BlockAction[]).push({ sim: s, move, units: unit * capMultNormal, unitsVsLegendary: unit * capMultLeg })
      }
      // Energy cost
      const cost = energyCostPerAction(s.p.level, cfg) * mult(s, 'energyCost', wc)
      s.spent += Math.min(cost, s.energy)
      s.energy = Math.max(0, s.energy - cost)
      s.actions++
      // Activable techniques
      for (const tech of s.activables) {
        const def = tech.def
        if (!def) continue
        const al = s.logAct.get(tech.slug)
        const used = s.techCounts.get(tech.slug) ?? 0
        if (def.limitPerSession !== undefined && used >= def.limitPerSession) {
          if (al) al.limitReached = true
          continue
        }
        const wkKey = `${s.uid}:${tech.slug}`
        if (def.limitPerWeek !== undefined) {
          const prev = state.techniqueWeekUses.weekKey === weekKey ? (state.techniqueWeekUses.uses[wkKey] ?? 0) : 0
          if (prev + (weeklyUses[wkKey] ?? 0) >= def.limitPerWeek) {
            if (al) al.limitReached = true
            continue
          }
        }
        const p = activationChance(def.baseChance ?? 0, s.stats.specialDefense, s.p.moveMasteryMinutes[tech.slug] ?? 0, mult(s, 'techChance', wcOf(s)), cfg)
        if (al) {
          al.attempts++
          al.sum += p
          al.min = Math.min(al.min, p)
          al.max = Math.max(al.max, p)
        }
        if (!chance(rng, p)) continue
        if (al) al.activations++
        s.techCounts.set(tech.slug, used + 1)
        if (def.limitPerWeek !== undefined) weeklyUses[wkKey] = (weeklyUses[wkKey] ?? 0) + 1
        for (const e of def.effects) applyEffect(s, e, tech.slug, t)
      }
      // Passive statusOnAction
      s.passives.forEach((se, i) => {
        const e = se.effect
        if (e.kind !== 'statusOnAction' || !evaluateWhen(e.when, wcOf(s as Sim), cfg)) return
        const n = (s as Sim).statusCounts.get(i) ?? 0
        if (n >= e.limit || !chance(rng, e.chance)) return
        ;(s as Sim).statusCounts.set(i, n + 1)
        ;(s as Sim).logPassive.set(i, n + 1)
        addCharge('status', (s as Sim).uid, se.source, e.status)
      })
      // Heal over time
      if (s.hot > 0) healSim(s, s.max * s.hot)
      if (s.energy <= 1e-9 && s.exhaustedAt === null) s.exhaustedAt = t / 60
      s.nextT = t + interval(s)
    }
  }

  // --- Session end -----------------------------------------------------------
  for (const s of active) {
    if (s.actions > 0 && s.lastMult > 1) s.pointsRaw += s.lastPoints * (s.lastMult - 1)
    if (s.actions > 0) for (const se of ofKind(s.passives, 'lastActionMult')) if (evaluateWhen(se.effect.when, wcOf(s), cfg)) logPassiveHit(s, se)
    // Passive heals: sessionEnd (and 'now', applied at the end too); nextSessionStart → wish.
    if (valid && rewardFactor > 0) {
      for (const se of ofKind(s.passives, 'heal')) {
        const { effect: e, source } = se
        if (!evaluateWhen(e.when, wcOf(s), cfg)) continue
        logPassiveHit(s, se)
        if (e.timing === 'nextSessionStart') wishes.push({ sourceUid: s.uid, pct: e.pct, target: e.target })
        else if (e.target === 'self') s.endHealPct += e.pct
        else applyEffect(s, { ...e, timing: 'now' }, source, totalSeconds)
      }
    }
    if (s.endHealPct > 0) healSim(s, s.max * s.endHealPct)
  }

  const rewarded = valid && rewardFactor > 0
  const passiveLogs = (s: Sim): PassiveLog[] =>
    [...s.logPassive]
      .filter(([i, n]) => n > 0 && s.passives[i])
      .sort(([a], [b]) => a - b)
      .map(([i, count]) => {
        const se = s.passives[i] as SourcedEffect
        return { source: se.source, sourceKind: se.sourceKind, effect: se.effect, count }
      })
  if (streak.usedProtect) {
    const giver = active.find((s) => s.passives.some((e) => e.effect.kind === 'streakProtect'))
    const se = giver?.passives.find((e) => e.effect.kind === 'streakProtect')
    if (giver && se) logPassiveHit(giver, se)
  }
  const memberResults: MemberResult[] = sims.map((s) => {
    const staticWc = { ...baseWc, isLeader: s.slot === 0, energyFraction: s.energyStart / s.max }
    const expMult = selfStatMult(s.passives, 'exp', staticWc, cfg) * (teamMods.exp ?? 1)
    const bondMult = selfStatMult(s.passives, 'bondGain', staticWc, cfg) * (teamMods.bondGain ?? 1)
    const cm = pokemonConditionMult(s.types, env, cfg, new Set(), s.bonusMult)
    if (rewarded) {
      s.passives.forEach((se, i) => {
        const e = se.effect
        if (e.kind === 'statMod' && (e.stat === 'exp' || e.stat === 'bondGain') && evaluateWhen(e.when, staticWc, cfg)) s.logPassive.set(i, 1)
      })
    }
    return {
      uid: s.uid,
      speciesSlug: s.p.speciesSlug,
      slot: s.slot,
      asleep: s.asleep,
      actions: s.actions,
      points: Math.round(s.pointsRaw * rewardFactor),
      catchEnergy: s.catchEnergy,
      energyStart: s.energyStart,
      energyEnd: s.energy,
      energyMax: s.max,
      energySpent: s.spent,
      energyHealed: s.healed,
      exhaustedAtMinute: s.exhaustedAt,
      techniques: [...s.techCounts].map(([move, count]) => ({ move, count })),
      conditionMult: cm.mult,
      conditionType: cm.type,
      focusEffective: s.focusEff,
      exp: rewarded ? Math.round(cfg.rewards.expPerMinute * minutes * s.focusEff * expMult * rewardFactor) : 0,
      bondMinutes: rewarded ? minutes * bondMult : 0,
      masteryMinutes: rewarded && !s.asleep ? Object.fromEntries(s.p.equippedMoves.map((m) => [m, minutes])) : {},
      rested: s.rested,
      damageMoves: [...s.logMoves].map(([move, count]) => ({ move, count })),
      activables: [...s.logAct].map(([move, a]) => ({
        move,
        attempts: a.attempts,
        activations: a.activations,
        chanceMin: a.attempts > 0 ? a.min : 0,
        chanceMax: a.max,
        chanceAvg: a.attempts > 0 ? a.sum / a.attempts : 0,
        limitPerSession: getTechnique(move, ctx)?.def?.limitPerSession ?? null,
        limitReached: a.limitReached,
      })),
      passives: passiveLogs(s),
      conditionLog: [...s.logCond.values()],
      conditionBonusMult: s.bonusMult,
      pointsStages: {
        base: s.stg.base,
        afterCondition: s.stg.cond,
        afterBond: s.stg.bond,
        afterFocus: s.stg.focus,
        afterGrit: s.stg.grit,
        afterFocusAdj: s.stg.adj,
        afterMods: s.stg.mods,
        afterBurst: s.stg.burst,
        raw: s.pointsRaw,
      },
    }
  })
  const totalPoints = memberResults.reduce((a, m) => a + m.points, 0)

  // --- Waves -------------------------------------------------------------------
  const league = leagueForPoints(state.league.weeklyPoints[weekKey] ?? 0, 'week', ctx)
  const typeWeightMults: Partial<Record<TypeSlug, number>> = {}
  let sync: WaveGenParams['syncNature'] = null
  const typeWeightSources: Partial<Record<TypeSlug, { uid: string; source: string }>> = {}
  let syncSource: { uid: string; source: string } | null = null
  for (const s of active) {
    for (const se of ofKind(s.passives, 'encounterWeight')) {
      const e = se.effect
      if (!evaluateWhen(e.when, wcOf(s), cfg)) continue
      if (rewarded) logPassiveHit(s, se)
      if ('type' in e.match) {
        if (e.mult > (typeWeightMults[e.match.type] ?? 1)) typeWeightSources[e.match.type] = { uid: s.uid, source: se.source }
        typeWeightMults[e.match.type] = Math.max(typeWeightMults[e.match.type] ?? 1, e.mult)
      } else if (!sync || e.mult > sync.chance) {
        sync = { nature: s.p.nature, chance: e.mult }
        syncSource = { uid: s.uid, source: se.source }
      }
    }
  }
  // encounterWeight hits were logged after the member results were built.
  for (const m of memberResults) {
    const sim = byUid.get(m.uid)
    if (sim) m.passives = passiveLogs(sim)
  }
  const gen: WaveGenParams = {
    focus,
    trainerLevel: state.trainer.level,
    soundDominant: dominantSound(soundProfile),
    teamTypes: [...new Set(members.flatMap((p) => getSpecies(p.speciesSlug, ctx).types))],
    typeWeightMults,
    syncNature: sync,
  }
  const waves: Wave[] = []
  const waveSizes: number[] = []
  let roamingAfter = state.roaming
  const appeared = new Set<string>()
  const spawnEnv = { localHour: local.hour, weather }
  if (rewarded && nWaves > 0) {
    for (let i = 0; i < nWaves; i++) {
      const blockEnd = (i + 1) * cfg.session.waveMinutes * 60
      const forcedTypes = new Set([...forced].filter(([, at]) => at < blockEnd).map(([ty]) => ty))
      const activeTypes = activeConditionTypes(env, cfg, forcedTypes)
      const contributions = [...(contrib[i] as Map<string, EnergyContribution>).values()]
      const size = rollWaveSize(rng, focus, league, i === 0 ? extraWild : 0, cfg)
      waveSizes.push(size)
      let wilds: Wave['wilds'] = []
      if (i === 0) {
        for (const r of state.roaming) {
          if (wilds.length >= size) break
          if (chance(rng, cfg.encounters.roamingChance)) {
            appeared.add(r.speciesSlug)
            wilds.push(rollWild(rng, { waveIndex: i, gen, activeConditionTypes: activeTypes, contributions, hits: [], forceSpecies: r.speciesSlug, isRoaming: true, env: spawnEnv }, ctx))
          }
        }
      }
      while (wilds.length < size) wilds.push(rollWild(rng, { waveIndex: i, gen, activeConditionTypes: activeTypes, contributions, hits: [], env: spawnEnv }, ctx))
      // Damage (GDD §11.3): each action of the block hits one wild of this wave.
      const weights = cfg.capture.hitTargeting === 'maxHp' ? wilds.map((w) => w.maxHp) : wilds.map(() => 1)
      const hits = assignHits(blockActions[i] as BlockAction[], weights, rng, effFloorsOf)
      wilds = wilds.map((w, slot) => {
        const damage = damageFromHits(hits, slot, w, w.isLegendary, ctx)
        return { ...w, damage, hpFraction: hpFractionAfter(damage, w.maxHp, cfg) }
      })
      waves.push({
        index: i,
        wilds,
        studyBall: wilds.some((w) => w.studyBallEligible) ? 'available' : 'converted',
        contributions,
        hits,
        activeConditionTypes: activeTypes,
      })
    }
    roamingAfter = state.roaming
      .filter((r) => !appeared.has(r.speciesSlug))
      .map((r) => ({ ...r, sessionsLeft: r.sessionsLeft - 1 }))
      .filter((r) => r.sessionsLeft > 0)
  }

  // Event drops (live events): derived RNG per event, the main one is never touched.
  const eventItems = rollEventDrops(session.id, waves.length, ctx)

  const energyByBlock = contrib.map((m) => {
    const out: Partial<Record<TypeSlug, number>> = {}
    for (const c of m.values()) out[c.type] = (out[c.type] ?? 0) + c.amount
    return out
  })

  return ok({
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: input.endedAt,
    claimedAt: input.claimedAt,
    plannedMinutes: session.plannedMinutes,
    minutes,
    pausedSeconds: input.pausedSeconds,
    dayKey,
    weekKey,
    monthKey,
    valid,
    ...(cancelled ? { cancelled: true } : {}),
    lateClaim,
    rewardFactor,
    focus,
    captureValue: baseCapture,
    conditions: activeConditionTypes(env, cfg),
    forcedConditions: forcedList,
    members: memberResults,
    totalPoints,
    dust: rewarded ? Math.round(cfg.rewards.dustPerMinute * minutes * focus * rewardFactor) : 0,
    // Per-session Poké Balls are for completed sessions: a cancelled one would double them with cancel + restart (GDD §3.4).
    pokeBalls: rewarded && !cancelled ? Math.round(cfg.rewards.pokeBallsPerSession * rewardFactor) : 0,
    ...(Object.keys(eventItems).length > 0 ? { eventItems } : {}),
    energyByBlock,
    waves,
    charges: rewarded ? charges : [],
    extraWild,
    wishes,
    streak: { current: streak.current, usedProtect: streak.usedProtect },
    roamingAfter,
    league,
    gen,
    env: { localHour: local.hour, weekend: baseWc.weekend ?? false, weather, noPauses: input.pausedSeconds <= 0, sessionMinutes: minutes },
    soundProfile,
    weather,
    screenshotLabels: input.focusInputs.screenshotLabels ? input.focusInputs.screenshotLabels.map(String) : null,
    friendOverlap: input.friendOverlap ?? null,
    weeklyUses,
    note: session.note,
    subjectTag: session.subjectTag,
    wildFactors: {
      localHour: local.hour,
      weekday: local.weekday,
      league,
      waveSizes,
      extraWild,
      typeWeights: Object.entries(typeWeightMults).flatMap(([type, m]) => {
        const src = typeWeightSources[type as TypeSlug]
        return src && m !== undefined ? [{ type: type as TypeSlug, mult: m, uid: src.uid, source: src.source }] : []
      }),
      sync: sync && syncSource ? { ...syncSource, nature: sync.nature, chance: sync.chance } : null,
      roaming: [...appeared],
    },
  })
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type ApplySessionError = 'session_mismatch' | 'already_applied'

/**
 * Apply a session result: energy, Rest, EXP/level-ups (events), Bond, Mastery,
 * dust, balls, league points, streak, day counters, history, Pokédex (seen),
 * pending Wish heals, roaming legendaries and the new encounter (waves).
 * Idempotent per session id (a second call returns 'already_applied').
 */
export function applySessionResult(
  state: PlayerState,
  result: SessionResult,
  ctx: EngineContext = defaultContext(),
): Result<{ state: PlayerState; events: ProgressEvent[] }, ApplySessionError> {
  const cfg = ctx.config
  if (state.history.some((h) => h.id === result.sessionId)) return err('already_applied')
  if (!state.activeSession || state.activeSession.id !== result.sessionId) return err('session_mismatch')
  let s: PlayerState = state.encounter ? finishEncounter(state, ctx) : state
  const damageMode: DamageMode = state.autoDamage ? 'auto' : 'manual'
  const events: ProgressEvent[] = []
  const cap = levelCap(s, ctx)
  const pokemon = { ...s.pokemon }
  for (const m of result.members) {
    let p = pokemon[m.uid]
    if (!p) continue
    p = {
      ...p,
      energy: { current: m.energyEnd, updatedAt: result.startedAt },
      asleepNextSession: m.rested ? true : m.asleep ? false : p.asleepNextSession,
      asleepSetAt: m.rested ? result.endedAt : m.asleep ? null : (p.asleepSetAt ?? null),
      bondMinutes: p.bondMinutes + m.bondMinutes,
      moveMasteryMinutes: { ...p.moveMasteryMinutes },
      teraSessionsLeft: p.teraType && result.valid ? Math.max(0, p.teraSessionsLeft - 1) : p.teraSessionsLeft,
    }
    for (const [mv, min] of Object.entries(m.masteryMinutes)) p.moveMasteryMinutes[mv] = (p.moveMasteryMinutes[mv] ?? 0) + min
    const g = gainExp(p, m.exp, cap, ctx)
    pokemon[m.uid] = g.pokemon
    events.push(...g.events)
  }
  // Asleep Pokémon that sat out a completed session wake up.
  if (result.valid) {
    const inSession = new Set(result.members.map((m) => m.uid))
    for (const [uid, p] of Object.entries(pokemon)) {
      if (p.asleepNextSession && !inSession.has(uid)) pokemon[uid] = { ...p, asleepNextSession: false, asleepSetAt: null }
    }
  }
  const converted = result.waves.filter((w) => w.studyBall === 'converted').length
  const inventory: Record<string, number> = { ...s.inventory, 'poke-ball': (s.inventory['poke-ball'] ?? 0) + result.pokeBalls + converted }
  for (const [item, n] of Object.entries(result.eventItems ?? {})) inventory[item] = (inventory[item] ?? 0) + n

  // League
  const prevWeek = s.league.weeklyPoints[result.weekKey] ?? 0
  const weekPts = prevWeek + result.totalPoints
  const fromL = leagueForPoints(prevWeek, 'week', ctx)
  const toL = leagueForPoints(weekPts, 'week', ctx)
  if (toL !== fromL) events.push({ type: 'leagueUp', from: fromL, to: toL })
  const league = {
    weeklyPoints: { ...s.league.weeklyPoints, [result.weekKey]: weekPts },
    monthlyPoints: { ...s.league.monthlyPoints, [result.monthKey]: (s.league.monthlyPoints[result.monthKey] ?? 0) + result.totalPoints },
    bestLeague: leagueRank(toL, ctx) > leagueRank(s.league.bestLeague, ctx) ? toL : s.league.bestLeague,
  }

  // Streak & days
  let streak = s.streak
  if (result.valid) {
    const isNewDay = streak.lastDayKey !== result.dayKey
    streak = {
      current: result.streak.current,
      best: Math.max(streak.best, result.streak.current),
      lastDayKey: result.dayKey,
      gapBeforeLastDay: isNewDay ? (streak.lastDayKey === null ? 0 : Math.max(0, daysBetween(streak.lastDayKey, result.dayKey) - 1)) : streak.gapBeforeLastDay,
      protectUsedWeek: result.streak.usedProtect ? result.weekKey : streak.protectUsedWeek,
    }
  }
  const day = s.days[result.dayKey]
  const localStart = toLocal(result.startedAt, s.profile.timezone)
  const days: PlayerState['days'] = {}
  for (const [k, v] of Object.entries(s.days)) if (daysBetween(k, result.dayKey) <= 14) days[k] = v
  days[result.dayKey] = {
    minutes: (day?.minutes ?? 0) + result.minutes,
    sessions: (day?.sessions ?? 0) + (result.valid ? 1 : 0),
    firstStartMinute: day ? day.firstStartMinute : localStart.minuteOfDay,
  }

  // Trainer
  const trainerExp = s.trainer.exp + Math.round(result.minutes * cfg.trainer.expPerMinute)
  const trainerLevel = trainerLevelFromExp(trainerExp, ctx)
  if (trainerLevel > s.trainer.level) events.push({ type: 'trainerLevelUp', from: s.trainer.level, to: trainerLevel })

  // Weekly technique uses
  const twu = s.techniqueWeekUses.weekKey === result.weekKey ? { ...s.techniqueWeekUses.uses } : {}
  for (const [k, n] of Object.entries(result.weeklyUses)) twu[k] = (twu[k] ?? 0) + n

  const seen = new Set(s.pokedex.seen)
  for (const w of result.waves) for (const x of w.wilds) seen.add(x.speciesSlug)

  const summary: SessionSummary = {
    id: result.sessionId,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    claimedAt: result.claimedAt,
    dayKey: result.dayKey,
    weekKey: result.weekKey,
    minutes: result.minutes,
    pausedSeconds: result.pausedSeconds,
    focus: result.focus,
    screenshotLabels: result.screenshotLabels,
    lateClaim: result.lateClaim,
    rewardFactor: result.rewardFactor,
    points: result.totalPoints,
    exp: result.members.reduce((a, m) => a + m.exp, 0),
    dust: result.dust,
    pokeBalls: result.pokeBalls,
    conditions: result.conditions,
    soundProfile: result.soundProfile,
    wilds: result.waves.reduce((a, w) => a + w.wilds.length, 0),
    caught: 0,
    techniqueActivations: result.members.reduce((a, m) => a + m.techniques.reduce((b, t) => b + t.count, 0), 0),
    note: result.note,
    subjectTag: result.subjectTag,
    ...(result.cancelled ? { cancelled: true } : {}),
  }

  const maxCharge = result.charges.reduce((a, c) => Math.max(a, Number(c.id.slice(1)) || 0), s.counters.charge)
  s = {
    ...s,
    pokemon,
    inventory,
    dust: s.dust + result.dust,
    league,
    streak,
    days,
    trainer: { level: trainerLevel, exp: trainerExp },
    techniqueWeekUses: { weekKey: result.weekKey, uses: twu },
    pokedex: { ...s.pokedex, seen: [...seen] },
    history: [...s.history, summary].slice(-cfg.historyLimit),
    pendingWishes: [...s.pendingWishes, ...result.wishes],
    roaming: result.roamingAfter,
    lastSessionEndedAt: result.endedAt,
    activeSession: null,
    counters: { ...s.counters, charge: maxCharge },
    encounter:
      result.waves.length > 0
        ? {
            sessionId: result.sessionId,
            // Manual split (default): the wilds start at full HP until the player assigns the damage tokens.
            waves: damageMode === 'manual' ? result.waves.map((w) => toManualWave(w, ctx)) : result.waves,
            currentWave: 0,
            charges: result.charges,
            gen: result.gen,
            env: result.env,
            damageMode,
          }
        : null,
  }
  if (result.valid && result.rewardFactor > 0) {
    s = recordMissionEvent(
      s,
      { kind: 'session', minutes: result.minutes, dayKey: result.dayKey, techniques: summary.techniqueActivations, ...(result.cancelled ? { cancelled: true } : {}) },
      result.claimedAt,
      ctx,
    )
  }
  return ok({ state: s, events })
}
