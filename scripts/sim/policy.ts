/**
 * Box-side policies of the simulated player: team choice, loadouts, candies,
 * evolutions and releases. Only the engine's public API is used.
 */
import {
  actionIntervalSeconds,
  addDays,
  basePointsPerAction,
  bondMultiplier,
  candyDustCost,
  computeStats,
  conditionTypes,
  defaultEquipped,
  effectiveFocus,
  energyAt,
  energyCostPerAction,
  equipMoves,
  equippableMoves,
  evolutionOptions,
  evolvePokemon,
  getSpecies,
  getTechnique,
  levelCap,
  MINUTE_MS,
  passiveEffects,
  pokemonConditionMult,
  projectStreak,
  releasePokemon,
  selfStatMult,
  setTeam,
  toLocal,
  useCandy,
  type ConditionEnv,
  type EngineContext,
  type OwnedPokemon,
  type PlayerState,
  type Rng,
  type SoundProfile,
  type WeatherInput,
  type WhenContext,
} from '../../src/engine/index.ts'
import type { Tally } from './types.ts'

/** The fixed timezone of every simulated player: UTC−5 (e.g. Lima), as a minute offset. */
export const TZ = -300

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Mirror of the environment the engine builds in `completeSession` for a session starting at `startTs`. */
export function buildEnv(
  state: PlayerState,
  startTs: number,
  minutes: number,
  weather: WeatherInput | null,
  sound: SoundProfile | null,
  pausedSeconds: number,
  bugCount: number,
): ConditionEnv {
  const local = toLocal(startTs, state.profile.timezone)
  const today = state.days[local.dayKey]
  const streak = projectStreak(state.streak, local.dayKey, false)
  return {
    minutes,
    localHour: local.hour,
    weekday: local.weekday,
    startMinuteOfDay: local.minuteOfDay,
    weather,
    soundProfile: sound,
    pausedSeconds,
    friendOverlap: null,
    sessionsEarlierToday: today?.sessions ?? 0,
    minutesSincePreviousEnd: state.lastSessionEndedAt === null ? null : (startTs - state.lastSessionEndedAt) / MINUTE_MS,
    streakDays: streak.current,
    missedDaysBeforeToday: streak.missedDaysBeforeToday,
    yesterdayFirstStartMinute: state.days[addDays(local.dayKey, -1)]?.firstStartMinute ?? null,
    bugCount,
  }
}

// ---------------------------------------------------------------------------
// Value estimates
// ---------------------------------------------------------------------------

/**
 * Expected Team Points of one Pokémon in a session, given its energy now:
 * min(actions the clock allows, actions its energy affords) × points per action.
 * Includes the type condition, Bond and its own passive modifiers (not heals).
 */
export function expectedSessionPoints(state: PlayerState, p: OwnedPokemon, env: ConditionEnv, now: number, ctx: EngineContext, focus?: number): number {
  const cfg = ctx.config
  focus ??= cfg.focus.baseValue
  const stats = computeStats(p, ctx)
  const energy = energyAt(state, p, now, ctx)
  const wc: WhenContext = {
    sessionMinutes: env.minutes,
    localHour: env.localHour,
    weather: env.weather,
    weekend: env.weekday === 0 || env.weekday === 6,
    noPauses: env.pausedSeconds <= 0,
    isLeader: false,
    energyFraction: stats.hp > 0 ? energy / stats.hp : 0,
    targetLegendary: false,
  }
  const passives = passiveEffects(p, ctx)
  const pace = selfStatMult(passives, 'pace', wc, cfg)
  const pointsMult = selfStatMult(passives, 'points', wc, cfg)
  const costMult = selfStatMult(passives, 'energyCost', wc, cfg)
  const interval = actionIntervalSeconds(stats.speed, cfg) / Math.max(0.01, pace)
  const possible = (env.minutes * 60) / interval
  const cost = energyCostPerAction(p.level, cfg) * costMult
  const n = Math.min(possible, energy / Math.max(1e-6, cost))
  const cond = pokemonConditionMult(conditionTypes(p, now, ctx), env, cfg).mult
  const perAction = basePointsPerAction(stats.specialAttack, cfg) * cond * bondMultiplier(p.bondMinutes, cfg) * effectiveFocus(focus, stats.defense, cfg) * pointsMult
  return n * perAction
}

type Individual = Pick<OwnedPokemon, 'speciesSlug' | 'ivs' | 'nature'>

/** Points a Pokémon could make in a 100-minute day at `level` (energy-limited), with a flat ×1.1 condition. */
export function dailyPotential(p: Individual, level: number, ctx: EngineContext): number {
  const cfg = ctx.config
  const stats = computeStats({ ...p, level }, ctx)
  const possible = 6000 / actionIntervalSeconds(stats.speed, cfg)
  const afford = stats.hp / energyCostPerAction(level, cfg)
  return Math.min(possible, afford) * basePointsPerAction(stats.specialAttack, cfg) * 1.1
}

/** Best potential among the forms it can reach by evolving (level, friendship, owned stones). */
export function formPotential(state: PlayerState, p: Individual, cap: number, ctx: EngineContext, depth = 0): number {
  let best = dailyPotential(p, cap, ctx)
  if (depth > 3) return best
  const sp = getSpecies(p.speciesSlug, ctx)
  for (const e of sp.evolutions) {
    if (e.trigger === 'trade' || e.trigger === 'other') continue
    if (e.trigger === 'level' && (e.minLevel ?? 1) > cap) continue
    if (e.trigger === 'item' && (state.inventory[e.item ?? ''] ?? 0) <= 0) continue
    const to = ctx.speciesById.get(e.to)
    if (!to) continue
    best = Math.max(best, formPotential(state, { ...p, speciesSlug: to.slug }, cap, ctx, depth + 1))
  }
  return best
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

function hasStatusTechnique(p: OwnedPokemon, ctx: EngineContext): boolean {
  return p.equippedMoves.some((m) => {
    const t = getTechnique(m, ctx)
    return t?.kind === 'activable' && t.def?.effects.some((e) => e.kind === 'wildStatus') === true
  })
}

/**
 * Greedy team: the 6 Pokémon with the highest expected points given their
 * energy left (sleepers score 0 unless they are stars, which wakes them), with
 * the highest Energy×Grit awake member as leader. While an escaped legendary
 * roams, members with a status technique get a +12 % bonus.
 */
export function pickTeam(state: PlayerState, env: ConditionEnv, now: number, ctx: EngineContext): string[] {
  const roaming = state.roaming.length > 0
  const all = Object.values(state.pokemon).map((p) => {
    let awake = expectedSessionPoints(state, p, env, now, ctx)
    if (roaming && hasStatusTechnique(p, ctx)) awake *= 1.12
    const energy = energyAt(state, p, now, ctx)
    return { p, awake, energy, score: p.asleepNextSession ? 0 : awake }
  })
  // Stars that are asleep take a slot so that they wake up for the next session.
  const rank = [...all].sort((a, b) => b.awake - a.awake)
  const stars = new Set(rank.slice(0, 4).filter((x) => x.p.asleepNextSession).map((x) => x.p.uid))
  const scored = all.map((x) => (stars.has(x.p.uid) ? { ...x, score: x.awake * 0.6 } : x))
  scored.sort((a, b) => b.score + 1e-3 * b.energy - (a.score + 1e-3 * a.energy))
  const top = scored.slice(0, 6)
  let leader = top[0]
  let leaderScore = -1
  for (const x of top) {
    if (x.p.asleepNextSession || x.energy <= 0) continue
    const st = computeStats(x.p, ctx)
    const s = st.defense * st.hp
    if (s > leaderScore) {
      leaderScore = s
      leader = x
    }
  }
  const uids = top.map((x) => x.p.uid)
  if (!leader) return uids
  return [leader.p.uid, ...uids.filter((u) => u !== leader.p.uid)]
}

/** Apply the team and make every member use the engine's default loadout. */
export function applyTeam(state: PlayerState, uids: string[], now: number, ctx: EngineContext): PlayerState {
  const same = uids.length === state.team.length && uids.every((u, i) => state.team[i] === u)
  let s = state
  if (!same) {
    const r = setTeam(s, uids, now, ctx)
    if (r.ok) s = r.value
  }
  return ensureLoadouts(s, s.team, ctx)
}

export function ensureLoadouts(state: PlayerState, uids: string[], ctx: EngineContext): PlayerState {
  let s = state
  for (const u of uids) {
    const p = s.pokemon[u]
    if (!p) continue
    const want = defaultEquipped(p.speciesSlug, equippableMoves(p, ctx), p.level, ctx)
    if (want.length === p.equippedMoves.length && want.every((m, i) => p.equippedMoves[i] === m)) continue
    const r = equipMoves(s, u, want, ctx)
    if (r.ok) s = r.value
  }
  return s
}

// ---------------------------------------------------------------------------
// Candies and dust
// ---------------------------------------------------------------------------

/** Team plus the two best bench Pokémon whose potential beats the weakest team member. */
export function candyPool(state: PlayerState, ctx: EngineContext): string[] {
  const cap = levelCap(state, ctx)
  const pot = (p: OwnedPokemon) => formPotential(state, p, cap, ctx)
  const team = state.team.filter((u) => state.pokemon[u])
  const weakest = Math.min(...team.map((u) => pot(state.pokemon[u] as OwnedPokemon)))
  const bench = Object.values(state.pokemon)
    .filter((p) => !state.team.includes(p.uid))
    .map((p) => ({ p, v: pot(p) }))
    .filter((x) => x.v > weakest * 1.05)
    .sort((a, b) => b.v - a.v)
    .slice(0, 2)
  return [...team, ...bench.map((x) => x.p.uid)]
}

/** Spend candies one at a time on the lowest-level pool member that can take one. */
export function spendCandies(state: PlayerState, ctx: EngineContext, tally: Tally, reserveForEvolution = false): PlayerState {
  let s = state
  const cap = levelCap(s, ctx)
  const pool = candyPool(s, ctx)
  const blocked = new Set<string>()
  // Experiment (`reserveForEvolution`): lines with a member that only lacks candies to evolve keep their candies.
  const reserved = new Set<string>()
  if (reserveForEvolution) {
    for (const u of pool) {
      const p = s.pokemon[u]
      if (p && evolutionOptions(s, p, 0, ctx).some((o) => o.blockedBy === 'not_enough_candies')) reserved.add(String(getSpecies(p.speciesSlug, ctx).evolutionChainId))
    }
  }
  for (let guard = 0; guard < 400; guard++) {
    let best: OwnedPokemon | null = null
    for (const u of pool) {
      if (blocked.has(u)) continue
      const p = s.pokemon[u]
      if (!p) continue
      const chainKey = String(getSpecies(p.speciesSlug, ctx).evolutionChainId)
      if (reserved.has(chainKey)) continue
      const have = s.candies.chains[chainKey] ?? 0
      if (p.level >= cap || have < 1 || s.dust < candyDustCost(p.level, ctx)) continue
      if (!best || p.level < best.level) best = p
    }
    if (!best) break
    const before = best.exp
    const r = useCandy(s, best.uid, { kind: 'species' }, 1, ctx)
    if (!r.ok) {
      blocked.add(best.uid)
      continue
    }
    s = r.value.state
    tally.candiesSpent += 1
    tally.dustSpent += r.value.dustSpent
    tally.candyExpGained += (s.pokemon[best.uid]?.exp ?? before) - before
  }
  return s
}

// ---------------------------------------------------------------------------
// Evolution and releases
// ---------------------------------------------------------------------------

/** Evolve everything that can evolve right now (the best option by potential; stones only if owned). */
export function evolveAll(state: PlayerState, now: number, rng: Rng, ctx: EngineContext, tally: Tally): PlayerState {
  let s = state
  const cap = levelCap(s, ctx)
  for (const uid of Object.keys(s.pokemon)) {
    for (let step = 0; step < 3; step++) {
      const p = s.pokemon[uid]
      if (!p) break
      const sp = getSpecies(p.speciesSlug, ctx)
      if (sp.evolutions.length === 0) break
      const open = evolutionOptions(s, p, now, ctx).filter((o) => o.blockedBy === null)
      if (open.length === 0) break
      open.sort((a, b) => formPotential(s, { ...p, speciesSlug: b.to }, cap, ctx) - formPotential(s, { ...p, speciesSlug: a.to }, cap, ctx))
      const r = evolvePokemon(s, uid, (open[0] as { to: string }).to, now, rng, ctx)
      if (!r.ok) break
      s = r.value.state
      tally.evolutions++
    }
  }
  return s
}

function ivQuality(p: OwnedPokemon, ctx: EngineContext): number {
  const iv = p.ivs
  const nat = ctx.naturesBySlug.get(p.nature)
  let q = (3 * iv.specialAttack + 2 * iv.hp + 2 * iv.speed + iv.attack + iv.specialDefense + iv.defense) / 31
  if (nat?.increased === 'specialAttack') q += 1.5
  if (nat?.decreased === 'specialAttack') q -= 1.5
  return q + p.level * 0.05
}

/** Keep the best `keep` of each species (3 for base forms, 2 otherwise), all shinies, legendaries, team and pool. */
export function releaseDuplicates(state: PlayerState, protect: ReadonlySet<string>, ctx: EngineContext, tally: Tally): PlayerState {
  const bySpecies = new Map<string, OwnedPokemon[]>()
  for (const p of Object.values(state.pokemon)) {
    if (protect.has(p.uid) || state.team.includes(p.uid) || p.isShiny) continue
    const arr = bySpecies.get(p.speciesSlug) ?? []
    arr.push(p)
    bySpecies.set(p.speciesSlug, arr)
  }
  let s = state
  for (const [slug, list] of bySpecies) {
    const sp = getSpecies(slug, ctx)
    if (sp.isLegendary || sp.isMythical) continue
    const keepers = sp.stage === 1 ? 3 : 2
    // The team and protected members count toward the quota.
    const already = Object.values(s.pokemon).filter((p) => p.speciesSlug === slug && (protect.has(p.uid) || s.team.includes(p.uid) || p.isShiny)).length
    const room = Math.max(0, keepers - already)
    const sorted = [...list].sort((a, b) => ivQuality(b, ctx) - ivQuality(a, ctx))
    for (const p of sorted.slice(room)) {
      const before = s.candies.chains[String(sp.evolutionChainId)] ?? 0
      const r = releasePokemon(s, p.uid, ctx)
      if (!r.ok) continue
      s = r.value
      tally.released++
      tally.candiesFromRelease += (s.candies.chains[String(sp.evolutionChainId)] ?? 0) - before
    }
  }
  return s
}

/** Number of sleeping Pokémon not in the team (engine quirk: Rest sleep only clears when the member is in a session team). */
export function sleepersInBox(state: PlayerState): number {
  return Object.values(state.pokemon).filter((p) => p.asleepNextSession && !state.team.includes(p.uid)).length
}
