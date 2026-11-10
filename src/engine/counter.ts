/**
 * Wild counterattacks (GDD §11.4). Two triggers, one resolution:
 *  - a failed ball → the wild strikes the **leader** (or the next member with Energy);
 *  - an attack (assigning a damage token, `damage.ts`) → the wild strikes **the attacker**,
 *    unless a status technique worked on it (asleep or paralyzed: no counterattack).
 * Every target-side effect (own counterMiss, counterDamageTaken, counterImmuneType,
 * counterMinHp1, counterReflect, counterStatus, nextThrowBonus) belongs to whoever takes the hit.
 */
import type { GameConfig } from './config'
import { defaultContext, getSpecies, type EngineContext } from './context'
import { evaluateWhen, type WhenContext } from './conditions'
import type { TypeSlug } from './data-types'
import { ofKind, passiveEffects, selfStatMult, teamCaptureMods, type TeamCaptureMods } from './effects'
import { chance, type Rng } from './rng'
import type { CounterResult, EncounterState, OwnedPokemon, PlayerState, WildPokemon } from './state'
import { computeStats } from './stats'
import { hpFractionAfter, typeEffectiveness } from './waves'

export type { CounterResult } from './state'

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

/** Counterattack damage before target effects (GDD §11.4), with the global `capture.counter.damageMult`. */
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
    (legendary ? c.legendaryMult : 1) *
    (c.damageMult ?? 1)
  )
}

/** Who a failed ball hits: the leader, or the next member with Energy; null when everyone is at 0. */
export function ballCounterTarget(state: PlayerState): string | null {
  return teamMembers(state).find((p) => p.energy.current > 0)?.uid ?? null
}

/**
 * The wild's counterattack against `targetUid`: its type most effective against that Pokémon,
 * then the target's own effects. Pure; returns the updated member and wild (counterReflect
 * also grows `wild.extraHpLoss`, so a later damage recompute keeps it).
 */
export function resolveCounterOn(
  state: PlayerState,
  targetUid: string,
  wild: WildPokemon,
  rng: Rng,
  ctx: EngineContext = defaultContext(),
): { counter: CounterResult; target: OwnedPokemon; wild: WildPokemon } | null {
  const cfg = ctx.config
  const target = state.pokemon[targetUid]
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
  // Miss chance: the target's own counterMiss or the best team-scope one on the team (strongest, never summed).
  // `chance(rng, 0)` draws nothing, so a team without any counterMiss consumes the same random numbers as before.
  const mods = encounterModifiers(state, ctx)
  let missChance = mods.teamCounterMiss
  for (const { effect: e } of ofKind(active, 'counterMiss')) if (e.scope !== 'team') missChance = Math.max(missChance, e.chance)
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
      const teamMult = mods.teamCounterDamageMult
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
      nextWild = { ...nextWild, hpFraction: hp, extraHpLoss: (nextWild.extraHpLoss ?? 0) + counter.reflected }
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

/** Counterattack of a failed ball: always the leader chain (`ballCounterTarget`). */
export function resolveCounter(
  state: PlayerState,
  wild: WildPokemon,
  rng: Rng,
  ctx: EngineContext = defaultContext(),
): { counter: CounterResult; target: OwnedPokemon; wild: WildPokemon } | null {
  const uid = ballCounterTarget(state)
  return uid ? resolveCounterOn(state, uid, wild, rng, ctx) : null
}

/**
 * Can this wild strike back at an attacker? Not when a status technique worked on it
 * (Sleep Powder, Hypnosis, Thunder Wave…): asleep or paralyzed wilds never counterattack
 * attackers (GDD §11.4). Draws no random number.
 */
export function wildCanStrikeBack(wild: Pick<WildPokemon, 'status'>): { ok: true } | { ok: false; why: 'asleep' | 'paralyzed' } {
  if (wild.status === 'sleep') return { ok: false, why: 'asleep' }
  if (wild.status === 'paralysis') return { ok: false, why: 'paralyzed' }
  return { ok: true }
}
