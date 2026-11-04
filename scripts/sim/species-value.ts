/**
 * "Valor de estudio" of every species (GDD §20.1, layer 3): what one Pokémon of
 * a species produces in the constant profile when it is the whole team — 4 × 25
 * min a day, energy-limited — at a given level, average IVs (15), neutral
 * nature and the engine's default loadout (level-up moves only).
 *
 * Every species sees the same days (weather, labels, pauses, sound) so the
 * comparison is paired. Abilities are averaged with their draw probabilities.
 */
import {
  applySessionResult,
  completeBreak,
  completeSession,
  createIndividual,
  createNewPlayer,
  createRng,
  deepMerge,
  definedAbilities,
  effectiveBase,
  expForLevel,
  getSpecies,
  MINUTE_MS,
  startSession,
  statValue,
  toOwnedPokemon,
  type BaseStats,
  type EngineContext,
  type GameConfig,
  type PlayerState,
  type Species,
} from '../../src/engine/index.ts'
import { localToUtc } from './run.ts'
import { TZ } from './policy.ts'
import { planProfile } from './profiles.ts'
import { mean } from './util.ts'

export const AVG_IV = 15

export interface SpeciesValue {
  slug: string
  level: number
  /** Points of the first session of the day (full energy). */
  ptsFresh: number
  /** Mean points per 25-min session over the 4 sessions of the day. */
  ptsSession: number
  /** Points per day (4 sessions, energy-limited). */
  ptsDay: number
  /** Actions per day. */
  actionsDay: number
  /** Share of days in which the Pokémon ran out of energy. */
  exhaustedShare: number
  /** Points per action averaged over the day (shows Rendimiento × conditions). */
  ptsPerAction: number
}

const IVS: BaseStats = { hp: AVG_IV, attack: AVG_IV, defense: AVG_IV, specialAttack: AVG_IV, specialDefense: AVG_IV, speed: AVG_IV }

function abilityWeights(sp: Species, ctx: EngineContext): { ability: string | null; w: number }[] {
  const defined = definedAbilities(sp, ctx)
  if (defined.length === 0) return [{ ability: null, w: 1 }]
  const normal = defined.filter((a) => !a.isHidden)
  const hidden = defined.filter((a) => a.isHidden)
  if (normal.length === 0) return hidden.map((a) => ({ ability: a.slug, w: 1 / hidden.length }))
  const hw = hidden.length > 0 ? ctx.config.progression.hiddenAbilityChance : 0
  return [...normal.map((a) => ({ ability: a.slug, w: (1 - hw) / normal.length })), ...hidden.map((a) => ({ ability: a.slug, w: hw / hidden.length }))]
}

function simulateOne(ctx: EngineContext, slug: string, level: number, ability: string | null, weeks: number, seedTag: string) {
  const plan = planProfile('constant', weeks, 'species-value')
  const rng = createRng(`sv|${seedTag}|${slug}|${level}|${ability}`)
  const t0 = localToUtc(-600)
  const base = createNewPlayer({ trainerName: 'sv', locale: 'es', starterSlug: 'charmander', now: t0, timezone: TZ }, rng, ctx)
  if (!base.ok) throw new Error(base.error)
  const core = createIndividual(slug, level, rng, { nature: 'hardy' }, ctx)
  const owned = toOwnedPokemon({ ...core, ivs: IVS, nature: 'hardy', ability, extraMoves: [] }, 'p1', t0, 'poke-ball', ctx)
  let state: PlayerState = { ...base.value, pokemon: { p1: owned }, team: ['p1'], pokedex: { seen: [slug], caught: [slug] }, inventory: {} }
  const dayPts = new Map<number, number>()
  const firstPts = new Map<number, number>()
  const dayActions = new Map<number, number>()
  const dayExh = new Map<number, boolean>()
  let nSessions = 0
  for (const ps of plan.sessions) {
    const day = Math.floor(ps.startMin / 1440)
    if (day >= plan.days) continue
    const startTs = localToUtc(ps.startMin)
    const weather = plan.weather[day] ?? null
    const st = startSession(state, { plannedMinutes: ps.minutes, startedAt: startTs }, ctx)
    if (!st.ok) throw new Error(st.error)
    const endedAt = startTs + ps.minutes * MINUTE_MS + ps.pausedSeconds * 1000
    const claimedAt = endedAt + ps.claimDelayMin * MINUTE_MS
    const c = completeSession(
      st.value.state,
      st.value.session,
      { endedAt, claimedAt, pausedSeconds: ps.pausedSeconds, focusInputs: { screenshotLabels: [ps.label], missedCaptures: 0 }, soundProfile: ps.sound, weather },
      rng,
      ctx,
    )
    if (!c.ok) throw new Error(c.error)
    const m = c.value.members[0]
    const pts = c.value.totalPoints
    dayPts.set(day, (dayPts.get(day) ?? 0) + pts)
    if (!firstPts.has(day)) firstPts.set(day, pts)
    dayActions.set(day, (dayActions.get(day) ?? 0) + (m?.actions ?? 0))
    if (m && m.exhaustedAtMinute !== null) dayExh.set(day, true)
    nSessions++
    const ap = applySessionResult(st.value.state, c.value, ctx)
    if (!ap.ok) throw new Error(ap.error)
    state = ap.value.state
    // Keep the individual frozen: no EXP, Bond, Mastery or sleep carried over (energy is kept).
    const p = state.pokemon.p1
    if (p) state = { ...state, pokemon: { p1: { ...p, exp: expForLevel(level, ctx), level, bondMinutes: 0, moveMasteryMinutes: {}, asleepNextSession: false } }, encounter: null }
    if (ps.breakAfter) state = completeBreak(state, claimedAt + 7 * MINUTE_MS, ctx)
  }
  const days = [...dayPts.keys()]
  return {
    ptsFresh: mean(days.map((d) => firstPts.get(d) ?? 0)),
    ptsDay: mean(days.map((d) => dayPts.get(d) ?? 0)),
    actionsDay: mean(days.map((d) => dayActions.get(d) ?? 0)),
    exhaustedShare: days.filter((d) => dayExh.get(d)).length / Math.max(1, days.length),
    nSessions,
  }
}

/**
 * League wave caps change how many dice the encounters draw, which would
 * desynchronise the technique dice between a species and its patched self.
 * Freezing everybody in Base league makes the comparison exact.
 */
const neutralCache = new WeakMap<EngineContext, EngineContext>()
function neutralLeague(ctx: EngineContext): EngineContext {
  let n = neutralCache.get(ctx)
  if (!n) {
    const big = 1e15
    const config = deepMerge(ctx.config, { leagues: { weeklyThresholds: { base: 0, super: big, ultra: big, master: big } } }) as GameConfig
    n = { ...ctx, config }
    neutralCache.set(ctx, n)
  }
  return n
}

export function speciesValue(rawCtx: EngineContext, slug: string, level: number, weeks = 5, seedTag = 'a'): SpeciesValue {
  const ctx = neutralLeague(rawCtx)
  const sp = getSpecies(slug, ctx)
  const variants = abilityWeights(sp, ctx).map((v) => ({ ...v, r: simulateOne(ctx, slug, level, v.ability, weeks, seedTag) }))
  const w = (f: (r: (typeof variants)[number]['r']) => number) => variants.reduce((a, v) => a + v.w * f(v.r), 0)
  const ptsDay = w((r) => r.ptsDay)
  const actionsDay = w((r) => r.actionsDay)
  return {
    slug,
    level,
    ptsFresh: w((r) => r.ptsFresh),
    ptsSession: ptsDay / 4,
    ptsDay,
    actionsDay,
    exhaustedShare: w((r) => r.exhaustedShare),
    ptsPerAction: actionsDay > 0 ? ptsDay / actionsDay : 0,
  }
}

export function allSpeciesValues(ctx: EngineContext, levels: number[], weeks = 5, onProgress?: (done: number, total: number) => void): SpeciesValue[] {
  const out: SpeciesValue[] = []
  const total = ctx.data.species.length * levels.length
  let done = 0
  for (const sp of ctx.data.species) {
    for (const lv of levels) {
      out.push(speciesValue(ctx, sp.slug, lv, weeks))
      onProgress?.(++done, total)
    }
  }
  return out
}

/** Points-per-action core of a species at a level (the part the SpAtk base controls). */
export function perActionCore(ctx: EngineContext, spAtkBase: number, level: number): number {
  const eff = effectiveBase('specialAttack', spAtkBase, ctx.config)
  const stat = statValue('specialAttack', eff, AVG_IV, level, 1)
  return ctx.config.actions.pointsBase + stat / ctx.config.actions.pointsSpAtkDivisor
}
