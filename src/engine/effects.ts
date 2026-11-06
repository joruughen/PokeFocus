/**
 * Effect evaluation (docs/effects.md): gathering passive effects of a Pokémon
 * (ability + equipped passive techniques), statMod products, and team-scope
 * non-stacking (the strongest member effect wins).
 */
import type { GameConfig } from './config'
import { defaultContext, type EngineContext } from './context'
import { evaluateWhen, type WhenContext } from './conditions'
import { LOWER_IS_BETTER, type Effect, type EffectKind, type EffectOf, type ModStat } from './effect-types'
import { getTechnique } from './moves'
import type { OwnedPokemon } from './state'

export interface SourcedEffect<E extends Effect = Effect> {
  effect: E
  uid: string
  /** Ability or technique slug. */
  source: string
  sourceKind: 'ability' | 'technique'
}

/** Passive effects of a Pokémon: its ability plus its equipped passive techniques. */
export function passiveEffects(p: OwnedPokemon, ctx: EngineContext = defaultContext()): SourcedEffect[] {
  const out: SourcedEffect[] = []
  if (p.ability) {
    const def = ctx.abilities[p.ability]
    if (def) for (const effect of def.effects) out.push({ effect, uid: p.uid, source: p.ability, sourceKind: 'ability' })
  }
  for (const m of p.equippedMoves) {
    const t = getTechnique(m, ctx)
    if (t?.kind === 'passive' && t.def) for (const effect of t.def.effects) out.push({ effect, uid: p.uid, source: m, sourceKind: 'technique' })
  }
  return out
}

export function ofKind<K extends EffectKind>(list: readonly SourcedEffect[], kind: K): SourcedEffect<EffectOf<K>>[] {
  return list.filter((e) => e.effect.kind === kind) as SourcedEffect<EffectOf<K>>[]
}

/** Is a statMod or counterMiss team-scoped? */
export function isTeamScope(e: Effect): boolean {
  return (e.kind === 'statMod' || e.kind === 'counterMiss') && e.scope === 'team'
}

/** Product of self-scope statMods for `stat` whose `when` holds. */
export function selfStatMult(list: readonly SourcedEffect[], stat: ModStat, wc: WhenContext, cfg: GameConfig): number {
  let m = 1
  for (const { effect: e } of list) {
    if (e.kind === 'statMod' && e.stat === stat && e.scope !== 'team' && evaluateWhen(e.when, wc, cfg)) m *= e.mult
  }
  return m
}

/** Pick the strongest of several multipliers for a stat (non-stacking). */
export function strongest(stat: ModStat, mults: readonly number[]): number {
  if (mults.length === 0) return 1
  return LOWER_IS_BETTER.has(stat) ? Math.min(...mults) : Math.max(...mults)
}

/**
 * Team-scope statMods: per stat, the strongest across providers.
 * `wcFor(uid)` gives each provider's when-context.
 */
export function teamStatMults(
  providers: readonly SourcedEffect[],
  wcFor: (uid: string) => WhenContext,
  cfg: GameConfig,
): Partial<Record<ModStat, number>> {
  const by: Partial<Record<ModStat, number[]>> = {}
  for (const { effect: e, uid } of providers) {
    if (e.kind !== 'statMod' || e.scope !== 'team') continue
    if (!evaluateWhen(e.when, wcFor(uid), cfg)) continue
    ;(by[e.stat] ??= []).push(e.mult)
  }
  const out: Partial<Record<ModStat, number>> = {}
  for (const [stat, mults] of Object.entries(by) as [ModStat, number[]][]) out[stat] = strongest(stat, mults)
  return out
}

/** Team-wide capture modifiers (non-stacking: the strongest member wins). */
export interface TeamCaptureMods {
  ballMult: number
  extraFailedThrows: number
  counterNoFirst: boolean
  revealWildIvs: boolean
  /** Counter damage multiplier from team-scope statMods (strongest). */
  teamCounterDamageMult: number
  /** Chance that a counterattack misses whoever it hits, from team-scope counterMiss (strongest; 0 = none). */
  teamCounterMiss: number
}

export function teamCaptureMods(team: readonly OwnedPokemon[], wcFor: (p: OwnedPokemon) => WhenContext, ctx: EngineContext = defaultContext()): TeamCaptureMods {
  const cfg = ctx.config
  let ballMult = 1
  let extra = 0
  let noFirst = false
  let reveal = false
  let counterMiss = 0
  const counterMults: number[] = []
  for (const p of team) {
    const wc = wcFor(p)
    for (const { effect: e } of passiveEffects(p, ctx)) {
      if (!evaluateWhen(e.when, wc, cfg)) continue
      if (e.kind === 'ballMult') ballMult = Math.max(ballMult, e.mult)
      else if (e.kind === 'maxFailedThrows') extra = Math.max(extra, e.add)
      else if (e.kind === 'counterNoFirst') noFirst = true
      else if (e.kind === 'revealWildIvs') reveal = true
      else if (e.kind === 'statMod' && e.scope === 'team' && e.stat === 'counterDamageTaken') counterMults.push(e.mult)
      else if (e.kind === 'counterMiss' && e.scope === 'team') counterMiss = Math.max(counterMiss, e.chance)
    }
  }
  return {
    ballMult,
    extraFailedThrows: extra,
    counterNoFirst: noFirst,
    revealWildIvs: reveal,
    teamCounterDamageMult: strongest('counterDamageTaken', counterMults),
    teamCounterMiss: counterMiss,
  }
}
