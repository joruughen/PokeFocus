/**
 * Encounters (GDD §10) and wild damage (GDD §11.3: classic damage formula per action).
 */
import type { BallSlug, GameConfig, LeagueId } from './config'
import { defaultContext, getSpecies, getSpeciesById, type EngineContext } from './context'
import type { Species, TypeChart, TypeSlug } from './data-types'
import { createIndividual, isLegendarySpecies } from './individual'
import { chance, pick, randInt, weightedPick, type Rng } from './rng'
import type { EnergyContribution, IndividualCore, WaveGenParams, WaveHit, WildPokemon } from './state'
import { computeStats } from './stats'

// --- Type chart --------------------------------------------------------------

/**
 * Effectiveness of an attacking type against one or two defending types
 * (product of the chart entries). `floors` (effectivenessFloor) are applied
 * per defending type: a component equal to `from` becomes `to`.
 */
export function typeEffectiveness(
  attack: TypeSlug,
  defending: readonly TypeSlug[],
  chart: TypeChart,
  floors: readonly { from: number; to: number }[] = [],
): number {
  let m = 1
  for (const d of defending) {
    let c: number = chart[attack][d]
    for (const f of floors) if (c === f.from) c = f.to
    m *= c
  }
  return m
}

// --- Waves -----------------------------------------------------------------------

/** waves = max(1, floor(minutes / 25)). */
export function waveCount(minutes: number, cfg: GameConfig): number {
  return Math.max(1, Math.floor(minutes / cfg.session.waveMinutes))
}

/** Full 25-min blocks in `minutes` (0 before the first one): the waves a cancelled session keeps (GDD §3.4). */
export function fullBlocks(minutes: number, cfg: GameConfig): number {
  return Math.max(0, Math.floor(minutes / cfg.session.waveMinutes))
}

/** Index of the wave that receives energy produced at `seconds` into the session. */
export function blockIndexAt(seconds: number, waves: number, cfg: GameConfig): number {
  return Math.min(waves - 1, Math.floor(seconds / (cfg.session.waveMinutes * 60)))
}

/**
 * Wave size: base + league bonus ± jitter + extra − (session focus < lowFocusThreshold 0.75, i.e. a late claim), min 3,
 * max by league. `leagueWaveBonus` rewards climbing leagues within the week.
 */
export function rollWaveSize(rng: Rng, focus: number, league: LeagueId, extraWild: number, cfg: GameConfig): number {
  const e = cfg.encounters
  let size = e.baseWaveSize + (e.leagueWaveBonus?.[league] ?? 0) + randInt(rng, -e.waveSizeJitter, e.waveSizeJitter) + extraWild
  if (focus < e.lowFocusThreshold) size -= 1
  size = Math.max(e.minWaveSize, size)
  return Math.min(size, e.leagueMaxWaveSize[league])
}

/** Wild level range for a trainer level (last entry with trainerLevel ≤ TL). */
export function wildLevelRange(trainerLevel: number, cfg: GameConfig): { min: number; max: number } {
  const table = cfg.encounters.wildLevelByTrainerLevel
  let row = table[0] ?? { trainerLevel: 1, min: 2, max: 10 }
  for (const r of table) if (trainerLevel >= r.trainerLevel) row = r
  return { min: row.min, max: row.max }
}

const minLevelCache = new WeakMap<EngineContext, Map<number, number>>()

/**
 * Minimum level at which a species can appear in the wild: evolved forms need
 * level ≥ their evolution level (non-level evolutions: previous stage +
 * `nonLevelEvolutionLevelGap`). Base forms: 1.
 */
export function minWildLevel(sp: Species, ctx: EngineContext = defaultContext()): number {
  let cache = minLevelCache.get(ctx)
  if (!cache) minLevelCache.set(ctx, (cache = new Map()))
  const hit = cache.get(sp.id)
  if (hit !== undefined) return hit
  let lvl = 1
  if (sp.evolvesFrom !== null) {
    const pre = getSpeciesById(sp.evolvesFrom, ctx)
    const preMin = minWildLevel(pre, ctx)
    const edge = pre.evolutions.find((e) => e.to === sp.id)
    lvl =
      edge?.trigger === 'level' && edge.minLevel !== undefined
        ? Math.max(preMin, edge.minLevel)
        : preMin + ctx.config.encounters.nonLevelEvolutionLevelGap
  }
  cache.set(sp.id, lvl)
  return lvl
}

/** Lowest ball that guarantees a shiny catch (GDD §11.1); legendaries are never guaranteed. */
export function shinyGuaranteeBall(sp: Species, level: number, isShiny: boolean, cfg: GameConfig): BallSlug | null {
  if (!isShiny || isLegendarySpecies(sp)) return null
  const order: BallSlug[] = ['poke-ball', 'great-ball', 'ultra-ball']
  for (const b of order) {
    const g = cfg.capture.balls[b].shinyGuarantee
    if (sp.stage <= g.maxStage && level <= g.maxLevel) return b
  }
  return null
}

export const BALL_ORDER: readonly BallSlug[] = ['poke-ball', 'great-ball', 'ultra-ball']

/** Does `ball` honour a guarantee that needs `needed` ("the matching ball or better")? */
export function ballCovers(ball: BallSlug, needed: BallSlug | null): boolean {
  return needed !== null && BALL_ORDER.indexOf(ball) >= BALL_ORDER.indexOf(needed)
}

/**
 * Highest level the Study Ball accepts for a trainer level:
 * max(studyBallMaxLevel, wild range min + studyBallLevelMargin).
 */
export function studyBallMaxLevelFor(trainerLevel: number, cfg: GameConfig): number {
  const e = cfg.encounters
  return Math.max(e.studyBallMaxLevel, wildLevelRange(trainerLevel, cfg).min + (e.studyBallLevelMargin ?? 0))
}

/**
 * Study Ball eligibility: base form, not legendary/mythical, level ≤
 * `studyBallMaxLevelFor(trainerLevel)` (trainer level 1 when omitted).
 */
export function isStudyBallEligible(sp: Species, level: number, cfg: GameConfig, trainerLevel = 1): boolean {
  return sp.stage === 1 && !isLegendarySpecies(sp) && level <= studyBallMaxLevelFor(trainerLevel, cfg)
}

/** Same-type attack bonus of the capture damage formula. */
export const STAB_MULT = 1.5

/**
 * Level sync: against a weaker wild the attacker fights at most at
 * `wildLevel · levelSync.ratio + levelSync.gap` (its Attack scales with it).
 */
export function syncedLevel(attackerLevel: number, wildLevel: number, cfg: GameConfig): number {
  const ls = cfg.capture.levelSync
  if (!ls) return attackerLevel
  return Math.max(1, Math.min(attackerLevel, wildLevel * ls.ratio + ls.gap))
}

/** Classic damage core: ((2·L/5 + 2) · Power · A / D / 50 + 2). */
export function classicDamage(level: number, power: number, attack: number, defense: number): number {
  return (((2 * level) / 5 + 2) * power * attack) / Math.max(1, defense) / 50 + 2
}

/**
 * Damage of one hit group on a wild (GDD §11.3): classicDamage(L, Power, A, D)
 * · STAB · effectiveness (with the attacker's floors) · captureDamageScale · units.
 * D = wild Defense (physical) or Sp. Def (special).
 */
export function hitDamage(
  hit: WaveHit,
  wildStats: { defense: number; specialDefense: number },
  wildLevel: number,
  wildTypes: readonly TypeSlug[],
  legendary: boolean,
  ctx: EngineContext = defaultContext(),
): number {
  const D = hit.damageClass === 'special' ? wildStats.specialDefense : wildStats.defense
  const units = legendary ? hit.unitsVsLegendary : hit.units
  if (units <= 0) return 0
  const level = syncedLevel(hit.level, wildLevel, ctx.config)
  const attack = hit.attack * (level / Math.max(1, hit.level))
  return (
    classicDamage(level, hit.power, attack, D) *
    (hit.stab ? STAB_MULT : 1) *
    typeEffectiveness(hit.type, wildTypes, ctx.chart, hit.effectivenessFloors) *
    ctx.config.capture.captureDamageScale *
    units
  )
}

/** Total damage of a wave's hits aimed at the wild in slot `target`. */
export function damageFromHits(
  hits: readonly WaveHit[],
  target: number,
  wild: Pick<IndividualCore, 'speciesSlug' | 'level' | 'ivs' | 'nature'>,
  legendary: boolean,
  ctx: EngineContext = defaultContext(),
): number {
  const stats = computeStats(wild, ctx)
  const types = getSpecies(wild.speciesSlug, ctx).types
  let dmg = 0
  for (const h of hits) if (h.target === target) dmg += hitDamage(h, stats, wild.level, types, legendary, ctx)
  return dmg
}

/** Legacy damage model (encounters saved before WaveHit): Σ energy · effectiveness. */
export function computeDamage(contributions: readonly EnergyContribution[], wildTypes: readonly TypeSlug[], legendary: boolean, chart: TypeChart): number {
  let dmg = 0
  for (const c of contributions) {
    const amount = legendary ? c.amountVsLegendary : c.amount
    dmg += amount * typeEffectiveness(c.type, wildTypes, chart, c.effectivenessFloors)
  }
  return dmg
}

/** Remaining HP fraction after damage, with the 5% floor. */
export function hpFractionAfter(damage: number, maxHp: number, cfg: GameConfig): number {
  return Math.max(cfg.capture.minHpFraction, maxHp > 0 ? 1 - damage / maxHp : 1)
}

export interface RollWildParams {
  waveIndex: number
  gen: WaveGenParams
  activeConditionTypes: readonly TypeSlug[]
  contributions: readonly EnergyContribution[]
  /** Hits of the wave (classic damage model). When given, damage = hits aimed at `slot`. */
  hits?: readonly WaveHit[]
  /** Index this wild takes in the wave (target of `hits`). */
  slot?: number
  /** Force a species (roaming legendaries). */
  forceSpecies?: string
  isRoaming?: boolean
}

function multAt(list: readonly number[], i: number): number {
  return list[Math.min(i, list.length - 1)] ?? 1
}

/** Weight of a non-legendary species for a wave (GDD §10.2). */
export function speciesWeight(sp: Species, p: Omit<RollWildParams, 'contributions'>, ctx: EngineContext = defaultContext()): number {
  const e = ctx.config.encounters
  // Long-session rarity boost: weight = captureRate^(1/boost) flattens the
  // distribution, so low capture rates gain relative weight.
  let w = Math.pow(Math.max(1, sp.captureRate), 1 / multAt(e.longSessionRareBoost, p.waveIndex))
  if (sp.types.some((t) => p.activeConditionTypes.includes(t))) w *= e.conditionTypeWeight
  const sound = p.gen.soundDominant ? e.soundProfileTypes[p.gen.soundDominant] : []
  if (sp.types.some((t) => sound.includes(t))) w *= e.soundProfileWeight
  if (sp.types.some((t) => p.gen.teamTypes.includes(t))) w *= e.teamTypeWeight
  let typeMult = 1
  for (const t of sp.types) typeMult = Math.max(typeMult, p.gen.typeWeightMults[t] ?? 1)
  return w * typeMult
}

/** Roll one wild Pokémon. */
export function rollWild(rng: Rng, p: RollWildParams, ctx: EngineContext = defaultContext()): WildPokemon {
  const cfg = ctx.config
  const e = cfg.encounters
  const all = ctx.data.species
  let sp: Species
  let level: number
  const range = wildLevelRange(p.gen.trainerLevel, cfg)
  const legendaryPool = all.filter(isLegendarySpecies)
  if (p.forceSpecies) {
    sp = getSpecies(p.forceSpecies, ctx)
    level = isLegendarySpecies(sp) ? Math.max(e.legendaryMinLevel, randInt(rng, range.min, range.max)) : randInt(rng, Math.max(range.min, minWildLevel(sp, ctx)), Math.max(range.max, minWildLevel(sp, ctx)))
  } else if (legendaryPool.length > 0 && chance(rng, e.legendaryChance * p.gen.focus * multAt(e.longSessionLegendaryMult, p.waveIndex))) {
    sp = pick(rng, legendaryPool)
    level = Math.max(e.legendaryMinLevel, randInt(rng, range.min, range.max))
  } else {
    level = randInt(rng, range.min, range.max)
    let pool = all.filter((s) => !isLegendarySpecies(s) && minWildLevel(s, ctx) <= level)
    if (pool.length === 0) pool = all.filter((s) => !isLegendarySpecies(s) && s.stage === 1)
    sp = weightedPick(rng, pool, (s) => speciesWeight(s, p, ctx)) ?? (pool[0] as Species)
  }
  const isShiny = chance(rng, e.shinyChance * (0.5 + p.gen.focus))
  const nature = p.gen.syncNature && chance(rng, p.gen.syncNature.chance) ? p.gen.syncNature.nature : undefined
  const core = createIndividual(sp.slug, level, rng, { shiny: isShiny, nature }, ctx)
  const legendary = isLegendarySpecies(sp)
  const maxHp = computeStats(core, ctx).hp
  const damage = p.hits ? damageFromHits(p.hits, p.slot ?? 0, core, legendary, ctx) : computeDamage(p.contributions, sp.types, legendary, ctx.chart)
  return {
    ...core,
    isLegendary: legendary,
    isRoaming: Boolean(p.isRoaming),
    maxHp,
    damage,
    hpFraction: hpFractionAfter(damage, maxHp, cfg),
    status: null,
    studyBallEligible: isStudyBallEligible(sp, level, cfg, p.gen.trainerLevel),
    guaranteedBall: shinyGuaranteeBall(sp, level, isShiny, cfg),
    failedThrows: 0,
    nextThrowBonus: 1,
    outcome: 'pending',
    caughtUid: null,
  }
}
