/**
 * Capture (GDD §11): balls, guarantees, capture formula, counterattacks,
 * fleeing, status/reroll charges and wave progression.
 */
import type { BallSlug, GameConfig, WildStatus } from './config'
import { defaultContext, getSpecies, type EngineContext } from './context'
import { encounterModifiers, resolveCounter } from './counter'
import { effectiveHits, lockWaveAttacks } from './damage'
import { toOwnedPokemon } from './individual'
import { recordMissionEvent } from './missions'
import { trainerLevelFromExp } from './progression'
import { chance, type Rng } from './rng'
import { err, ok, type CounterResult, type PlayerState, type Result, type WildPokemon, type EncounterState } from './state'
import { ballCovers, rollWild } from './waves'

export { ballCounterTarget, counterDamage, encounterModifiers, resolveCounter, resolveCounterOn, wildCanStrikeBack } from './counter'
export type { CounterResult } from './state'

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

/** Catch chance of a wild with a ball given the current team (0..1; 1 when guaranteed). */
export function wildCatchChance(state: PlayerState, wild: WildPokemon, ball: ThrowBall, ctx: EngineContext = defaultContext()): number {
  if (ball === 'study-ball') return wild.studyBallEligible ? 1 : 0
  if (ballCovers(ball, wild.guaranteedBall)) return 1
  const sp = getSpecies(wild.speciesSlug, ctx)
  const mods = encounterModifiers(state, ctx)
  return captureChance(sp.captureRate, wild.isLegendary, wild.hpFraction, ctx.config.capture.balls[ball].mult * mods.ballMult, wild.status, ctx.config, wild.nextThrowBonus)
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
  const rawWave = enc.waves[ref.waveIndex]
  if (!rawWave?.wilds[ref.wildIndex]) return err('unknown_wild')
  if (rawWave.wilds[ref.wildIndex]?.outcome !== 'pending') return err('wild_resolved')
  // The first ball locks the wave: every member that has not attacked yet (and has Energy) attacks
  // with the automatic split, and each attacked wild strikes back at its attacker (GDD §11.4).
  let s: PlayerState = lockWaveAttacks(state, ref.waveIndex, rng, ctx)
  let encounter: EncounterState = s.encounter as EncounterState
  const wave = encounter.waves[ref.waveIndex] as EncounterState['waves'][number]
  const wild = wave.wilds[ref.wildIndex] as WildPokemon
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
    s = recordMissionEvent(s, { kind: 'catch', types: sp.types, ball, firstThrow: wild.failedThrows === 0 }, now, ctx)
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

export type ChargeError = 'no_encounter' | 'unknown_charge' | 'wrong_charge_kind' | 'unknown_wild' | 'wild_resolved' | 'wave_passed' | 'already_has_status'

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
  // A wild that is already asleep/paralyzed would waste the charge.
  if (wild.status) return err('already_has_status')
  const next = replaceWild(enc, ref, { ...wild, status: charge.status ?? null })
  return ok({ ...state, encounter: { ...next, charges: enc.charges.filter((c) => c.id !== chargeId) } })
}

/** Use a reroll charge: replace a wild with a freshly rolled one (it takes the hits aimed at that slot). */
export function rerollWild(state: PlayerState, chargeId: string, ref: WildRef, rng: Rng, ctx: EngineContext = defaultContext()): Result<PlayerState, ChargeError> {
  const r = chargeTarget(state, chargeId, 'reroll', ref)
  if (!r.ok) return r
  const { enc } = r.value
  const wave = enc.waves[ref.waveIndex]
  if (!wave) return err('unknown_wild')
  // The new wild takes the damage aimed at its slot (in manual mode: the tokens assigned to it).
  const hits = wave.hits ? effectiveHits(wave) : undefined
  const fresh = rollWild(rng, { waveIndex: ref.waveIndex, gen: enc.gen, activeConditionTypes: wave.activeConditionTypes, contributions: wave.contributions, hits, slot: ref.wildIndex }, ctx)
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
