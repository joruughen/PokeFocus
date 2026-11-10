/**
 * "What will this do, and how often?" for the technique / ability help bubbles
 * (docs/PENDING.md, phase B). Pure and read-only: every number comes from the
 * same functions the session simulation uses (`activationChance`,
 * `catchEnergyPerAction`, `actionIntervalSeconds`, `energyCostPerAction`…), so
 * the text a player reads can never drift from the rules.
 *
 * Assumptions, stated so the UI can say "about": the Pokémon acts on its own
 * (no team-scope modifiers), and only effects without a `when` count for the
 * pace and `techChance` modifiers; the `conditional` flags say that a
 * conditional modifier also exists and may change the number.
 */
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { WildStatus } from './config'
import type { DamageClass, TypeSlug } from './data-types'
import type { Effect, ModStat, When } from './effect-types'
import { getTechnique } from './moves'
import type { OwnedPokemon } from './state'
import { activationChance, type PointsStages } from './session'
import { actionIntervalSeconds, catchEnergyPerAction, computeStats, energyCostPerAction, masteryMultiplier, techniqueMultiplier } from './stats'

/** Per-action numbers of a Pokémon that every category shares. */
export interface ActionPace {
  /** Seconds between two actions (Speed, plus unconditional `pace` effects). */
  intervalSeconds: number
  /** Actions in one 25-minute block (= one wave). */
  actionsPerWave: number
  /** Energy one action costs. */
  energyCostPerAction: number
  /** Max Energy (HP stat) and how many actions a full bar pays for. */
  maxEnergy: number
  actionsOnFullEnergy: number
  /** A conditional `pace` effect exists (it can make the Pokémon faster in some sessions). */
  conditional: boolean
}

export interface DamageOutlook {
  kind: 'damage'
  type: TypeSlug
  power: number
  damageClass: DamageClass
  /** Same type as the Pokémon (counts ×1.5 against the wild). */
  stab: boolean
  /** Capture Energy produced by one action with this move (Attack and Power). */
  energyPerAction: number
  /** Chance that an action uses this move: 1 / (damage moves equipped, counting this one). */
  share: number
  /** Capture Energy this move adds in one 25-minute block (before effects). */
  energyPerWave: number
  pace: ActionPace
}

export interface ActivableOutlook {
  kind: 'activable'
  type: TypeSlug
  baseChance: number
  /** Special Defense multiplier and Mastery multiplier of this Pokémon. */
  techniqueMult: number
  masteryMult: number
  /** Product of the unconditional `techChance` effects (1 = none). */
  techChanceMult: number
  conditionalTechChance: boolean
  /** Per-action chance, capped at `actions.maxActivationChance`. */
  chancePerAction: number
  capped: boolean
  limitPerSession: number | null
  limitPerWeek: number | null
  /** Expected activations in one 25-minute block, limit applied. */
  expectedPerWave: number
  /** Chance that it fires at least once in a 25-minute block. */
  atLeastOncePerWave: number
  /** It puts a wild to sleep or paralyses it (`wildStatus`). */
  inflicts: WildStatus | null
  pace: ActionPace
}

/** An effect that rolls a chance, with what it does when it hits. */
export interface PassiveRoll {
  kind: 'statusOnAction' | 'counterMiss' | 'counterStatus'
  chance: number
  status?: WildStatus
  /** statusOnAction: charges per session. */
  limit?: number
  /** counterMiss: protects the whole team, not just the holder. */
  team?: boolean
  /** statusOnAction: chance of at least one in a 25-minute block. */
  atLeastOncePerWave?: number
}

export interface PassiveOutlook {
  kind: 'passive'
  /** At least one effect has no condition: it is on whenever the Pokémon acts. */
  always: boolean
  /** The distinct conditions of the conditional effects (an effect with a condition only works while it holds). */
  whens: When[]
  rolls: PassiveRoll[]
  pace: ActionPace
}

export type TechniqueOutlook = DamageOutlook | ActivableOutlook | PassiveOutlook

/** Product of the self-scope `stat` effects that have no `when`; `conditional` when others have one. */
function unconditionalMult(effects: readonly Effect[], stat: ModStat): { mult: number; conditional: boolean } {
  let mult = 1
  let conditional = false
  for (const e of effects) {
    if (e.kind !== 'statMod' || e.stat !== stat || e.scope === 'team') continue
    if (e.when) conditional = true
    else mult *= e.mult
  }
  return { mult, conditional }
}

/** The effects of a Pokémon's ability and equipped passive techniques. */
function ownEffects(p: OwnedPokemon, ctx: EngineContext): Effect[] {
  const out: Effect[] = []
  const ab = p.ability ? ctx.abilities[p.ability] : undefined
  if (ab) out.push(...ab.effects)
  for (const m of p.equippedMoves) {
    const t = getTechnique(m, ctx)
    if (t?.kind === 'passive' && t.def) out.push(...t.def.effects)
  }
  return out
}

/** Pace numbers of a Pokémon (shared by all three categories). */
export function actionPace(p: OwnedPokemon, ctx: EngineContext = defaultContext()): ActionPace {
  const cfg = ctx.config
  const stats = computeStats(p, ctx)
  const pace = unconditionalMult(ownEffects(p, ctx), 'pace')
  const intervalSeconds = actionIntervalSeconds(stats.speed, cfg) / Math.max(0.01, pace.mult)
  const cost = energyCostPerAction(p.level, cfg)
  return {
    intervalSeconds,
    actionsPerWave: (cfg.session.waveMinutes * 60) / intervalSeconds,
    energyCostPerAction: cost,
    maxEnergy: stats.hp,
    actionsOnFullEnergy: cost > 0 ? stats.hp / cost : 0,
    conditional: pace.conditional,
  }
}

function passiveOutlook(effects: readonly Effect[], pace: ActionPace): PassiveOutlook {
  const whens: When[] = []
  const seen = new Set<string>()
  let always = effects.length === 0
  const rolls: PassiveRoll[] = []
  for (const e of effects) {
    if (e.when) {
      const k = JSON.stringify(e.when)
      if (!seen.has(k)) {
        seen.add(k)
        whens.push(e.when)
      }
    } else always = true
    if (e.kind === 'statusOnAction') {
      rolls.push({ kind: 'statusOnAction', chance: e.chance, status: e.status, limit: e.limit, atLeastOncePerWave: 1 - Math.pow(1 - e.chance, pace.actionsPerWave) })
    } else if (e.kind === 'counterMiss') rolls.push({ kind: 'counterMiss', chance: e.chance, team: e.scope === 'team' })
    else if (e.kind === 'counterStatus') rolls.push({ kind: 'counterStatus', chance: e.chance, status: e.status })
  }
  return { kind: 'passive', always, whens, rolls, pace }
}

/** Outlook of the Pokémon's ability as a passive (null without ability). */
export function abilityOutlook(p: OwnedPokemon, ctx: EngineContext = defaultContext()): PassiveOutlook | null {
  const def = p.ability ? ctx.abilities[p.ability] : undefined
  return def ? passiveOutlook(def.effects, actionPace(p, ctx)) : null
}

/**
 * Outlook of one technique for this Pokémon (equipped or not: Mastery comes
 * from its record). Null when the move does not exist in the game.
 */
export function techniqueOutlook(p: OwnedPokemon, slug: string, ctx: EngineContext = defaultContext()): TechniqueOutlook | null {
  const cfg = ctx.config
  const t = getTechnique(slug, ctx)
  if (!t) return null
  const pace = actionPace(p, ctx)
  const stats = computeStats(p, ctx)
  if (t.kind === 'damage') {
    const others = p.equippedMoves.filter((m) => m !== slug && getTechnique(m, ctx)?.kind === 'damage').length
    const share = 1 / (others + 1)
    // Catch Energy always uses Attack (see `completeSession`), whatever the move's class.
    const energyPerAction = catchEnergyPerAction(stats.attack, t.power, cfg)
    return {
      kind: 'damage',
      type: t.type,
      power: t.power,
      damageClass: t.damageClass,
      stab: getSpecies(p.speciesSlug, ctx).types.includes(t.type),
      energyPerAction,
      share,
      energyPerWave: energyPerAction * pace.actionsPerWave * share,
      pace,
    }
  }
  if (t.kind === 'passive') return passiveOutlook(t.def?.effects ?? [], pace)
  const def = t.def
  const baseChance = def?.baseChance ?? 0
  const mastery = p.moveMasteryMinutes[slug] ?? 0
  const tc = unconditionalMult(ownEffects(p, ctx), 'techChance')
  const techMult = techniqueMultiplier(stats.specialDefense, cfg)
  const masteryMult = masteryMultiplier(mastery, cfg)
  const chancePerAction = activationChance(baseChance, stats.specialDefense, mastery, tc.mult, cfg)
  const limit = def?.limitPerSession ?? null
  const unlimited = pace.actionsPerWave * chancePerAction
  const inflicts = (def?.effects ?? []).find((e): e is Extract<Effect, { kind: 'wildStatus' }> => e.kind === 'wildStatus')?.status ?? null
  return {
    kind: 'activable',
    type: t.type,
    baseChance,
    techniqueMult: techMult,
    masteryMult,
    techChanceMult: tc.mult,
    conditionalTechChance: tc.conditional,
    chancePerAction,
    capped: baseChance * techMult * masteryMult * tc.mult > cfg.actions.maxActivationChance,
    limitPerSession: limit,
    limitPerWeek: def?.limitPerWeek ?? null,
    expectedPerWave: limit === null ? unlimited : Math.min(limit, unlimited),
    atLeastOncePerWave: 1 - Math.pow(1 - chancePerAction, pace.actionsPerWave),
    inflicts,
    pace,
  }
}

// ---------------------------------------------------------------------------
// How the session points add up
// ---------------------------------------------------------------------------

export type PointsStepKind = 'base' | 'condition' | 'bond' | 'focus' | 'grit' | 'focusAdj' | 'mods' | 'burst' | 'lastAction' | 'daily'

export interface PointsStep {
  kind: PointsStepKind
  /** Points this step added (negative: took away). Whole numbers that add up to `total`. */
  delta: number
  /** Running total after the step, rounded. The last step's total is the points shown. */
  total: number
  /** Average multiplier of the step (null for the base). The Focus step's factor is the Focus itself. */
  factor: number | null
}

/** Sum of the stages of several members (the team's breakdown), or null when one of them has no log. */
export function sumPointsStages(list: readonly (PointsStages | undefined)[]): PointsStages | null {
  const acc: PointsStages = { base: 0, afterCondition: 0, afterBond: 0, afterFocus: 0, afterGrit: 0, afterFocusAdj: 0, afterMods: 0, afterBurst: 0, raw: 0 }
  for (const g of list) {
    if (!g) return null
    for (const k of Object.keys(acc) as (keyof PointsStages)[]) acc[k] += g[k]
  }
  return acc
}

/**
 * The step list of a points total: base, then each multiplier in the order
 * the engine applies it, then the daily reduction. Steps that changed nothing
 * (multiplier exactly 1) are left out. Deltas come from rounded running
 * totals, so they add up to `finalPoints` exactly.
 */
export function pointsBreakdown(stages: PointsStages, rewardFactor: number, finalPoints: number): PointsStep[] {
  const order: [PointsStepKind, number][] = [
    ['condition', stages.afterCondition],
    ['bond', stages.afterBond],
    ['focus', stages.afterFocus],
    ['grit', stages.afterGrit],
    ['focusAdj', stages.afterFocusAdj],
    ['mods', stages.afterMods],
    ['burst', stages.afterBurst],
    ['lastAction', stages.raw],
  ]
  const steps: PointsStep[] = [{ kind: 'base', delta: Math.round(stages.base), total: Math.round(stages.base), factor: null }]
  let prevExact = stages.base
  let prevTotal = Math.round(stages.base)
  for (const [kind, after] of order) {
    const factor = prevExact > 0 ? after / prevExact : 1
    prevExact = after
    if (Math.abs(factor - 1) < 1e-12) continue
    const total = Math.round(after)
    steps.push({ kind, delta: total - prevTotal, total, factor })
    prevTotal = total
  }
  if (Math.abs(rewardFactor - 1) > 1e-12 || finalPoints !== prevTotal) {
    steps.push({ kind: 'daily', delta: finalPoints - prevTotal, total: finalPoints, factor: rewardFactor })
  }
  return steps
}
