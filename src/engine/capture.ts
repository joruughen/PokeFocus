/**
 * Capture (GDD §11): balls, guarantees, capture formula, counterattacks,
 * fleeing, status/reroll charges and wave progression.
 */
import type { BallSlug, GameConfig, WildStatus } from './config'
import { defaultContext, getSpecies, type EngineContext } from './context'
import { evaluateWhen, type WhenContext } from './conditions'
import type { TypeSlug } from './data-types'
import { ofKind, passiveEffects, selfStatMult, teamCaptureMods, type TeamCaptureMods } from './effects'
import { toOwnedPokemon } from './individual'
import { trainerLevelFromExp } from './progression'
import { chance, type Rng } from './rng'
import { err, ok, type OwnedPokemon, type PlayerState, type Result, type WildPokemon, type EncounterState } from './state'
import { computeStats } from './stats'
import { ballCovers, hpFractionAfter, rollWild, typeEffectiveness } from './waves'

export type ThrowBall = BallSlug | 'study-ball'

/**
 * Catch probability: p = min(1, (1 − 2h/3) · (R/255) · ball · status · extra),
 * R = captureRate (≥ legendaryMinCaptureRate for legendaries/mythicals).
 */
export function captureChance(
  captureRate: number,
  isLegendary: boolean,
  hpFraction: number,
  ballMult: number,
  status: WildStatus | null,
  cfg: GameConfig,
  extraMult = 1,
): number {
  const R = isLegendary ? Math.max(captureRate, cfg.capture.legendaryMinCaptureRate) : captureRate
  const h = Math.max(cfg.capture.minHpFraction, Math.min(1, hpFraction))
  const statusMult = cfg.capture.statusMult[status ?? 'none']
  return Math.min(1, (1 - (2 * h) / 3) * (R / 255) * ballMult * statusMult * extraMult)
}

function teamMembers(state: PlayerState): OwnedPokemon[] {
  return state.team.map((u) => state.pokemon[u]).filter((p): p is OwnedPokemon => Boolean(p))
}

function counterWc(enc: EncounterState | null, p: OwnedPokemon, isLeader: boolean, ctx: EngineContext): WhenContext {
  const max = computeStats(p, ctx).hp
  return {
    sessionMinutes: enc?.env.sessionMinutes,
    localHour: enc?.env.localHour,
    weather: enc?.env.weather ?? null,
    weekend: enc?.env.weekend,
    noPauses: enc?.env.noPauses,
    isLeader,
    energyFraction: max > 0 ? p.energy.current / max : 0,
    targetLegendary: false,
  }
}

/** Team capture modifiers from the current team (ballMult, extra throws, counterNoFirst, revealWildIvs). */
export function encounterModifiers(state: PlayerState, ctx: EngineContext = defaultContext()): TeamCaptureMods & { maxFailedThrows: number } {
  const team = teamMembers(state)
  const mods = teamCaptureMods(team, (p) => counterWc(state.encounter, p, state.team[0] === p.uid, ctx), ctx)
  return { ...mods, maxFailedThrows: ctx.config.capture.maxFailedThrows + mods.extraFailedThrows }
}

/** Catch chance of a wild with a ball given the current team (0..1; 1 when guaranteed). */
export function wildCatchChance(state: PlayerState, wild: WildPokemon, ball: ThrowBall, ctx: EngineContext = defaultContext()): number {
  if (ball === 'study-ball') return wild.studyBallEligible ? 1 : 0
  if (ballCovers(ball, wild.guaranteedBall)) return 1
  const sp = getSpecies(wild.speciesSlug, ctx)
  const mods = encounterModifiers(state, ctx)
  return captureChance(sp.captureRate, wild.isLegendary, wild.hpFraction, ctx.config.capture.balls[ball].mult * mods.ballMult, wild.status, ctx.config, wild.nextThrowBonus)
}

export interface CounterResult {
  targetUid: string
  attackType: TypeSlug
  effectiveness: number
  /** Energy removed (0 if missed, healed or immune). */
  damage: number
  missed: boolean
  /** Energy healed by counterImmuneType (0 otherwise). */
  healed: number
  /** Wild HP fraction removed by counterReflect. */
  reflected: number
  statusInflicted: WildStatus | null
  /** counterMinHp1 kept it at 1. */
  survivedWith1: boolean
  energyAfter: number
}

export type ThrowOutcome =
  | { kind: 'caught'; uid: string; ball: ThrowBall; chance: number; guaranteed: 'study' | 'shiny' | null }
  | { kind: 'failed'; ball: ThrowBall; chance: number; counter: CounterResult | null; failedThrows: number; throwsLeft: number }
  | { kind: 'fled'; ball: ThrowBall; chance: number; counter: CounterResult | null; roaming: boolean }

export type ThrowError =
  | 'no_encounter'
  | 'wave_not_current'
  | 'unknown_wild'
  | 'wild_resolved'
  | 'no_ball'
  | 'study_ball_unavailable'
  | 'not_study_eligible'
  | 'session_active'

export interface WildRef {
  waveIndex: number
  wildIndex: number
}

function replaceWild(enc: EncounterState, ref: WildRef, wild: WildPokemon, patch: Partial<EncounterState['waves'][number]> = {}): EncounterState {
  return {
    ...enc,
    waves: enc.waves.map((w) =>
      w.index === ref.waveIndex ? { ...w, ...patch, wilds: w.wilds.map((x, i) => (i === ref.wildIndex ? wild : x)) } : w,
    ),
  }
}

/** Counterattack damage before target effects (GDD §11.4). */
export function counterDamage(
  targetMaxHp: number,
  targetLevel: number,
  targetDefense: number,
  wildLevel: number,
  effectiveness: number,
  legendary: boolean,
  cfg: GameConfig,
): number {
  const c = cfg.capture.counter
  return (
    targetMaxHp *
    c.basePct *
    Math.pow(wildLevel / Math.max(1, targetLevel), c.levelExponent) *
    effectiveness *
    (1 - Math.min(c.defenseMaxReduction, targetDefense / c.defenseDivisor)) *
    (legendary ? c.legendaryMult : 1)
  )
}

/** Resolve a counterattack against the team. Pure: returns the updated team member and wild. */
export function resolveCounter(
  state: PlayerState,
  wild: WildPokemon,
  rng: Rng,
  ctx: EngineContext = defaultContext(),
): { counter: CounterResult; target: OwnedPokemon; wild: WildPokemon } | null {
  const cfg = ctx.config
  const team = teamMembers(state)
  const target = team.find((p) => p.energy.current > 0)
  if (!target) return null
  const isLeader = state.team[0] === target.uid
  const stats = computeStats(target, ctx)
  const targetTypes = getSpecies(target.speciesSlug, ctx).types
  const wildTypes = getSpecies(wild.speciesSlug, ctx).types
  let attackType = wildTypes[0] as TypeSlug
  let eff = -1
  for (const t of wildTypes) {
    const e = typeEffectiveness(t, targetTypes, ctx.chart)
    if (e > eff) {
      eff = e
      attackType = t
    }
  }
  const effects = passiveEffects(target, ctx)
  const wc = counterWc(state.encounter, target, isLeader, ctx)
  const active = effects.filter((e) => evaluateWhen(e.effect.when, wc, cfg))
  const counter: CounterResult = {
    targetUid: target.uid,
    attackType,
    effectiveness: eff,
    damage: 0,
    missed: false,
    healed: 0,
    reflected: 0,
    statusInflicted: null,
    survivedWith1: false,
    energyAfter: target.energy.current,
  }
  let missChance = 0
  for (const { effect: e } of ofKind(active, 'counterMiss')) missChance = Math.max(missChance, e.chance)
  let nextWild = wild
  let current = target.energy.current
  if (chance(rng, missChance)) {
    counter.missed = true
  } else {
    if (ofKind(active, 'counterImmuneType').some((e) => e.effect.type === attackType)) {
      const healed = Math.min(stats.hp - current, stats.hp * cfg.capture.counter.immuneHealPct)
      counter.healed = Math.max(0, healed)
      current += counter.healed
    } else {
      const teamMult = encounterModifiers(state, ctx).teamCounterDamageMult
      const selfMult = selfStatMult(active, 'counterDamageTaken', wc, cfg)
      let dmg = counterDamage(stats.hp, target.level, stats.defense, wild.level, eff, wild.isLegendary, cfg) * selfMult * teamMult
      dmg = Math.min(dmg, current)
      if (current - dmg <= 0 && active.some((e) => e.effect.kind === 'counterMinHp1') && current >= 1) {
        dmg = current - 1
        counter.survivedWith1 = true
      }
      counter.damage = Math.max(0, dmg)
      current -= counter.damage
    }
    let reflect = 0
    for (const { effect: e } of ofKind(active, 'counterReflect')) reflect = Math.max(reflect, e.wildHpPct)
    if (reflect > 0) {
      const before = nextWild.hpFraction
      const hp = hpFractionAfter((1 - before + reflect) * nextWild.maxHp, nextWild.maxHp, cfg)
      counter.reflected = before - hp
      nextWild = { ...nextWild, hpFraction: hp }
    }
    for (const { effect: e } of ofKind(active, 'counterStatus')) {
      if (nextWild.status === null && chance(rng, e.chance)) {
        nextWild = { ...nextWild, status: e.status }
        counter.statusInflicted = e.status
      }
    }
    let bonus = 1
    for (const { effect: e } of ofKind(active, 'nextThrowBonus')) bonus = Math.max(bonus, e.mult)
    if (bonus > 1) nextWild = { ...nextWild, nextThrowBonus: Math.max(nextWild.nextThrowBonus, bonus) }
  }
  counter.energyAfter = current
  return { counter, target: { ...target, energy: { ...target.energy, current } }, wild: nextWild }
}

/**
 * Throw a ball at a wild of the current wave. Consumes the ball (Study Ball:
 * one per wave, only on eligible wilds, never in the inventory). On a fail the
 * wild counterattacks (except the first fail with counterNoFirst); after
 * `maxFailedThrows` (+ team bonus) fails it flees (legendaries become roaming).
 */
export function throwBall(
  state: PlayerState,
  ref: WildRef,
  ball: ThrowBall,
  rng: Rng,
  now: number,
  ctx: EngineContext = defaultContext(),
): Result<{ state: PlayerState; outcome: ThrowOutcome }, ThrowError> {
  const cfg = ctx.config
  const enc = state.encounter
  if (!enc) return err('no_encounter')
  if (state.activeSession) return err('session_active')
  if (ref.waveIndex !== enc.currentWave) return err('wave_not_current')
  const wave = enc.waves[ref.waveIndex]
  const wild = wave?.wilds[ref.wildIndex]
  if (!wave || !wild) return err('unknown_wild')
  if (wild.outcome !== 'pending') return err('wild_resolved')
  let s: PlayerState = state
  let encounter = enc
  let guaranteed: 'study' | 'shiny' | null = null
  let p: number
  if (ball === 'study-ball') {
    if (wave.studyBall !== 'available') return err('study_ball_unavailable')
    if (!wild.studyBallEligible) return err('not_study_eligible')
    guaranteed = 'study'
    p = 1
  } else {
    if ((s.inventory[ball] ?? 0) <= 0) return err('no_ball')
    s = { ...s, inventory: { ...s.inventory, [ball]: (s.inventory[ball] ?? 0) - 1 } }
    if (ballCovers(ball, wild.guaranteedBall)) {
      guaranteed = 'shiny'
      p = 1
    } else {
      p = wildCatchChance(s, wild, ball, ctx)
    }
  }
  const usedWild: WildPokemon = { ...wild, nextThrowBonus: 1 }
  const wavePatch = ball === 'study-ball' ? { studyBall: 'used' as const } : {}

  if (guaranteed || chance(rng, p)) {
    const uid = `p${s.counters.pokemon + 1}`
    const owned = toOwnedPokemon(wild, uid, now, ball, ctx)
    const sp = getSpecies(wild.speciesSlug, ctx)
    const isNewSpecies = !s.pokedex.caught.includes(sp.slug)
    const chainKey = String(sp.evolutionChainId)
    encounter = replaceWild(encounter, ref, { ...usedWild, outcome: 'caught', caughtUid: uid }, wavePatch)
    const trainerExp = s.trainer.exp + (isNewSpecies ? cfg.trainer.expPerNewSpecies : 0)
    s = {
      ...s,
      pokemon: { ...s.pokemon, [uid]: owned },
      candies: { ...s.candies, chains: { ...s.candies.chains, [chainKey]: (s.candies.chains[chainKey] ?? 0) + cfg.progression.candiesOnCatch } },
      pokedex: {
        seen: s.pokedex.seen.includes(sp.slug) ? s.pokedex.seen : [...s.pokedex.seen, sp.slug],
        caught: isNewSpecies ? [...s.pokedex.caught, sp.slug] : s.pokedex.caught,
      },
      roaming: s.roaming.filter((r) => r.speciesSlug !== sp.slug),
      trainer: { exp: trainerExp, level: s.trainer.level },
      counters: { ...s.counters, pokemon: s.counters.pokemon + 1 },
      history: s.history.map((h) => (h.id === enc.sessionId ? { ...h, caught: h.caught + 1 } : h)),
      encounter,
    }
    s = { ...s, trainer: { exp: s.trainer.exp, level: Math.max(s.trainer.level, trainerLevelFromExp(s.trainer.exp, ctx)) } }
    return ok({ state: s, outcome: { kind: 'caught', uid, ball, chance: p, guaranteed } })
  }

  // Failed throw
  const mods = encounterModifiers(s, ctx)
  const failed = usedWild.failedThrows + 1
  let nextWild: WildPokemon = { ...usedWild, failedThrows: failed }
  let counter: CounterResult | null = null
  if (!(mods.counterNoFirst && failed === 1)) {
    const r = resolveCounter(s, nextWild, rng, ctx)
    if (r) {
      counter = r.counter
      nextWild = r.wild
      s = { ...s, pokemon: { ...s.pokemon, [r.target.uid]: r.target } }
    }
  }
  if (failed >= mods.maxFailedThrows) {
    nextWild = { ...nextWild, outcome: 'fled' }
    encounter = replaceWild(encounter, ref, nextWild, wavePatch)
    s = { ...s, encounter, roaming: nextWild.isLegendary ? addRoaming(s.roaming, nextWild.speciesSlug, cfg) : s.roaming }
    return ok({ state: s, outcome: { kind: 'fled', ball, chance: p, counter, roaming: nextWild.isLegendary } })
  }
  encounter = replaceWild(encounter, ref, nextWild, wavePatch)
  s = { ...s, encounter }
  return ok({ state: s, outcome: { kind: 'failed', ball, chance: p, counter, failedThrows: failed, throwsLeft: mods.maxFailedThrows - failed } })
}

function addRoaming(list: PlayerState['roaming'], slug: string, cfg: GameConfig): PlayerState['roaming'] {
  return [...list.filter((r) => r.speciesSlug !== slug), { speciesSlug: slug, sessionsLeft: cfg.encounters.roamingSessions }]
}

export type ChargeError = 'no_encounter' | 'unknown_charge' | 'wrong_charge_kind' | 'unknown_wild' | 'wild_resolved' | 'wave_passed'

function chargeTarget(state: PlayerState, chargeId: string, kind: 'status' | 'reroll', ref: WildRef) {
  const enc = state.encounter
  if (!enc) return err('no_encounter' as const)
  const charge = enc.charges.find((c) => c.id === chargeId)
  if (!charge) return err('unknown_charge' as const)
  if (charge.kind !== kind) return err('wrong_charge_kind' as const)
  if (ref.waveIndex < enc.currentWave) return err('wave_passed' as const)
  const wild = enc.waves[ref.waveIndex]?.wilds[ref.wildIndex]
  if (!wild) return err('unknown_wild' as const)
  if (wild.outcome !== 'pending') return err('wild_resolved' as const)
  return ok({ enc, charge, wild })
}

/** Use a status charge (sleep/paralysis) on a wild of the current or a later wave. */
export function applyStatusCharge(state: PlayerState, chargeId: string, ref: WildRef): Result<PlayerState, ChargeError> {
  const r = chargeTarget(state, chargeId, 'status', ref)
  if (!r.ok) return r
  const { enc, charge, wild } = r.value
  const next = replaceWild(enc, ref, { ...wild, status: charge.status ?? null })
  return ok({ ...state, encounter: { ...next, charges: enc.charges.filter((c) => c.id !== chargeId) } })
}

/** Use a reroll charge: replace a wild with a freshly rolled one (same wave energy). */
export function rerollWild(state: PlayerState, chargeId: string, ref: WildRef, rng: Rng, ctx: EngineContext = defaultContext()): Result<PlayerState, ChargeError> {
  const r = chargeTarget(state, chargeId, 'reroll', ref)
  if (!r.ok) return r
  const { enc } = r.value
  const wave = enc.waves[ref.waveIndex]
  if (!wave) return err('unknown_wild')
  const fresh = rollWild(rng, { waveIndex: ref.waveIndex, gen: enc.gen, activeConditionTypes: wave.activeConditionTypes, contributions: wave.contributions }, ctx)
  let next = replaceWild(enc, ref, fresh)
  let inventory = state.inventory
  const nw = next.waves[ref.waveIndex]
  if (nw && nw.studyBall === 'available' && !nw.wilds.some((w) => w.studyBallEligible && w.outcome === 'pending')) {
    // No eligible wild left: the Study Ball becomes a Poké Ball (GDD §11.1).
    next = { ...next, waves: next.waves.map((w) => (w.index === nw.index ? { ...w, studyBall: 'converted' } : w)) }
    inventory = { ...inventory, 'poke-ball': (inventory['poke-ball'] ?? 0) + 1 }
  }
  const seen = state.pokedex.seen.includes(fresh.speciesSlug) ? state.pokedex.seen : [...state.pokedex.seen, fresh.speciesSlug]
  return ok({ ...state, inventory, pokedex: { ...state.pokedex, seen }, encounter: { ...next, charges: enc.charges.filter((c) => c.id !== chargeId) } })
}

/**
 * Move to the next wave. An unused Study Ball is lost; uncaught legendaries
 * of the wave left behind become roaming. After the last wave the encounter ends.
 */
export function advanceWave(state: PlayerState, ctx: EngineContext = defaultContext()): PlayerState {
  const enc = state.encounter
  if (!enc) return state
  const cur = enc.waves[enc.currentWave]
  let roaming = state.roaming
  const waves = enc.waves.map((w) => {
    if (w.index !== enc.currentWave) return w
    return { ...w, studyBall: w.studyBall === 'available' ? ('lost' as const) : w.studyBall }
  })
  if (cur) for (const w of cur.wilds) if (w.outcome === 'pending' && w.isLegendary) roaming = addRoaming(roaming, w.speciesSlug, ctx.config)
  const nextIndex = enc.currentWave + 1
  if (nextIndex >= enc.waves.length) return { ...state, roaming, encounter: null }
  return { ...state, roaming, encounter: { ...enc, waves, currentWave: nextIndex } }
}

/** End the encounter now (remaining waves are skipped, charges expire). */
export function finishEncounter(state: PlayerState, ctx: EngineContext = defaultContext()): PlayerState {
  let s = state
  while (s.encounter) s = advanceWave(s, ctx)
  return s
}
