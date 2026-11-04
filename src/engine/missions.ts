/**
 * Missions (GDD §13): 3 daily + 3 weekly missions drawn from the pool in
 * `custom-missions.json` (deterministic per player and local day/week), plus
 * Pokédex milestones. Progress is recorded by the reducers that produce the
 * events (applySessionResult, throwBall, evolvePokemon); rewards are claimed
 * with `claimMission`.
 */
import { defaultContext, type EngineContext } from './context'
import type { LocalizedText, TypeSlug } from './data-types'
import { isLegendarySpecies } from './individual'
import { createRng, weightedPick, type Rng } from './rng'
import { err, ok, type PlayerState, type Result } from './state'
import { addDays, dayKeyOf, startOfLocalDay, weekKeyOf } from './time'

// ---------------------------------------------------------------------------
// Content (custom-missions.json)
// ---------------------------------------------------------------------------

export type MissionPeriod = 'daily' | 'weekly'
export type MissionKind =
  | 'sessions'
  | 'studyMinutes'
  | 'longSession'
  | 'studyDays'
  | 'techniques'
  | 'catch'
  | 'catchType'
  | 'catchFirstThrow'
  | 'studyBall'
  | 'evolve'

export const MISSION_KINDS: readonly MissionKind[] = [
  'sessions',
  'studyMinutes',
  'longSession',
  'studyDays',
  'techniques',
  'catch',
  'catchType',
  'catchFirstThrow',
  'studyBall',
  'evolve',
]

/** One reward tier: used when the trainer level (at generation) is ≥ `minTrainerLevel`. */
export interface MissionRewardDef {
  minTrainerLevel?: number
  items?: Record<string, number>
  dust?: number
  /** Type candies of the mission's type (catchType missions). */
  typeCandies?: number
  /** `count` items drawn from `pool` (resolved when the mission is generated). */
  randomItem?: { pool: string[]; count: number }
}

export interface MissionDef {
  id: string
  period: MissionPeriod
  kind: MissionKind
  target: number
  /** longSession: minimum session minutes. */
  minMinutes?: number
  /** catchType: a type slug, or 'random' (weighted by how often each type appears in the wild). */
  type?: TypeSlug | 'random'
  weight?: number
  /** Only offered from this trainer level. */
  minTrainerLevel?: number
  title: LocalizedText
  description: LocalizedText
  rewards: MissionRewardDef[]
}

export interface PokedexMilestoneDef {
  id: string
  /** Species caught needed. */
  species: number
  title: LocalizedText
  description: LocalizedText
  rewards: MissionRewardDef[]
}

export interface MissionsContent {
  dailyCount: number
  weeklyCount: number
  /** Mission-only items the engine does not use yet (names for the UI). */
  placeholderItems: Record<string, { names: LocalizedText; description?: LocalizedText }>
  pool: MissionDef[]
  pokedex: PokedexMilestoneDef[]
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Resolved reward (what claiming gives). */
export interface MissionReward {
  items: Record<string, number>
  dust: number
  typeCandies: Partial<Record<TypeSlug, number>>
}

export interface MissionSlot {
  /** `d:<dayKey>:<i>` / `w:<weekKey>:<i>`. */
  id: string
  defId: string
  target: number
  progress: number
  /** catchType: the drawn type. */
  type: TypeSlug | null
  reward: MissionReward
  claimed: boolean
  /** studyDays: distinct local days counted. */
  days?: string[]
}

export interface MissionsState {
  daily: { key: string; slots: MissionSlot[] }
  weekly: { key: string; slots: MissionSlot[] }
  /** Pokédex milestone ids already claimed. */
  pokedexClaimed: string[]
}

/** Events that move mission progress (produced inside the reducers). */
export type MissionEvent =
  | { kind: 'session'; minutes: number; dayKey: string; techniques: number }
  | { kind: 'catch'; types: readonly TypeSlug[]; ball: string; firstThrow: boolean }
  | { kind: 'evolve' }

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function seedOf(state: PlayerState): string {
  return `missions|${state.profile.createdAt}`
}

function emptyReward(): MissionReward {
  return { items: {}, dust: 0, typeCandies: {} }
}

function rewardTier(tiers: readonly MissionRewardDef[], trainerLevel: number): MissionRewardDef | null {
  let best: MissionRewardDef | null = null
  for (const t of tiers) if (trainerLevel >= (t.minTrainerLevel ?? 1)) best = t
  return best
}

/** Resolve a reward tier into a concrete reward (random items drawn with `rng`). */
export function resolveReward(tiers: readonly MissionRewardDef[], trainerLevel: number, type: TypeSlug | null, rng: Rng): MissionReward {
  const t = rewardTier(tiers, trainerLevel)
  const r = emptyReward()
  if (!t) return r
  for (const [k, n] of Object.entries(t.items ?? {})) r.items[k] = (r.items[k] ?? 0) + n
  r.dust = t.dust ?? 0
  if (t.typeCandies && type) r.typeCandies[type] = t.typeCandies
  if (t.randomItem && t.randomItem.pool.length > 0) {
    for (let i = 0; i < t.randomItem.count; i++) {
      const k = t.randomItem.pool[Math.floor(rng.next() * t.randomItem.pool.length)] as string
      r.items[k] = (r.items[k] ?? 0) + 1
    }
  }
  return r
}

/** Weight of each type for `type: 'random'`: Σ captureRate of the non-legendary species with that type. */
function typeWeights(ctx: EngineContext): [TypeSlug, number][] {
  const w = new Map<TypeSlug, number>()
  for (const sp of ctx.data.species) {
    if (isLegendarySpecies(sp)) continue
    for (const t of sp.types) w.set(t, (w.get(t) ?? 0) + sp.captureRate)
  }
  return [...w.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

function generateSlots(state: PlayerState, period: MissionPeriod, key: string, ctx: EngineContext): MissionSlot[] {
  const content = ctx.missions
  const count = period === 'daily' ? content.dailyCount : content.weeklyCount
  const rng = createRng(`${seedOf(state)}|${period}|${key}`)
  let pool = content.pool.filter((d) => d.period === period && state.trainer.level >= (d.minTrainerLevel ?? 1))
  const slots: MissionSlot[] = []
  const prefix = period === 'daily' ? 'd' : 'w'
  for (let i = 0; i < count && pool.length > 0; i++) {
    const def = weightedPick(rng, pool, (d) => d.weight ?? 1) ?? (pool[0] as MissionDef)
    pool = pool.filter((d) => d !== def)
    let type: TypeSlug | null = null
    if (def.kind === 'catchType') {
      if (def.type && def.type !== 'random') type = def.type
      else type = weightedPick(rng, typeWeights(ctx), (e) => e[1])?.[0] ?? 'normal'
    }
    slots.push({
      id: `${prefix}:${key}:${i}`,
      defId: def.id,
      target: def.target,
      progress: 0,
      type,
      reward: resolveReward(def.rewards, state.trainer.level, type, rng),
      claimed: false,
      ...(def.kind === 'studyDays' ? { days: [] } : {}),
    })
  }
  return slots
}

/** Period keys at `now`: local day and local week (Monday). */
export function missionKeys(state: PlayerState, now: number): { daily: string; weekly: string } {
  const tz = state.profile.timezone
  return { daily: dayKeyOf(now, tz), weekly: weekKeyOf(now, tz) }
}

/**
 * Bring the missions to `now`: draws new daily/weekly missions when the local
 * day/week changed (unclaimed missions of past periods are dropped).
 * Returns the same state object if nothing changed.
 */
export function refreshMissions(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): PlayerState {
  const keys = missionKeys(state, now)
  const cur = state.missions
  if (cur && cur.daily.key === keys.daily && cur.weekly.key === keys.weekly) return state
  const missions: MissionsState = {
    daily: cur && cur.daily.key === keys.daily ? cur.daily : { key: keys.daily, slots: generateSlots(state, 'daily', keys.daily, ctx) },
    weekly: cur && cur.weekly.key === keys.weekly ? cur.weekly : { key: keys.weekly, slots: generateSlots(state, 'weekly', keys.weekly, ctx) },
    pokedexClaimed: cur?.pokedexClaimed ?? [],
  }
  return { ...state, missions }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function defOf(id: string, ctx: EngineContext): MissionDef | undefined {
  return ctx.missions.pool.find((d) => d.id === id)
}

function advance(slot: MissionSlot, def: MissionDef, e: MissionEvent): MissionSlot {
  if (slot.claimed || slot.progress >= slot.target) return slot
  let inc = 0
  let days = slot.days
  switch (def.kind) {
    case 'sessions':
      if (e.kind === 'session') inc = 1
      break
    case 'studyMinutes':
      if (e.kind === 'session') inc = e.minutes
      break
    case 'longSession':
      if (e.kind === 'session' && e.minutes >= (def.minMinutes ?? 0)) inc = 1
      break
    case 'studyDays':
      if (e.kind === 'session' && !(slot.days ?? []).includes(e.dayKey)) {
        days = [...(slot.days ?? []), e.dayKey]
        inc = 1
      }
      break
    case 'techniques':
      if (e.kind === 'session') inc = e.techniques
      break
    case 'catch':
      if (e.kind === 'catch') inc = 1
      break
    case 'catchType':
      if (e.kind === 'catch' && slot.type && e.types.includes(slot.type)) inc = 1
      break
    case 'catchFirstThrow':
      if (e.kind === 'catch' && e.firstThrow && e.ball !== 'study-ball') inc = 1
      break
    case 'studyBall':
      if (e.kind === 'catch' && e.ball === 'study-ball') inc = 1
      break
    case 'evolve':
      if (e.kind === 'evolve') inc = 1
      break
  }
  if (inc <= 0) return slot
  return { ...slot, progress: Math.min(slot.target, slot.progress + inc), ...(days ? { days } : {}) }
}

/**
 * Record a mission event at `at` (rotating the missions first). Called by the
 * engine reducers; exported for tools and tests.
 */
export function recordMissionEvent(state: PlayerState, event: MissionEvent, at: number, ctx: EngineContext = defaultContext()): PlayerState {
  const s = refreshMissions(state, at, ctx)
  const m = s.missions as MissionsState
  const upd = (slots: MissionSlot[]) =>
    slots.map((slot) => {
      const def = defOf(slot.defId, ctx)
      return def ? advance(slot, def, event) : slot
    })
  return { ...s, missions: { ...m, daily: { ...m.daily, slots: upd(m.daily.slots) }, weekly: { ...m.weekly, slots: upd(m.weekly.slots) } } }
}

// ---------------------------------------------------------------------------
// View & claim
// ---------------------------------------------------------------------------

export interface MissionView {
  id: string
  defId: string
  period: MissionPeriod | 'pokedex'
  kind: MissionKind | 'pokedex'
  /** Texts with {n}, {minutes} and {type} already filled in. */
  title: LocalizedText
  description: LocalizedText
  /** Raw values used in the texts. */
  params: { n: number; minutes: number | null; type: TypeSlug | null }
  progress: number
  target: number
  completed: boolean
  claimed: boolean
  reward: MissionReward
}

export interface MissionsView {
  daily: { key: string; endsAt: number; missions: MissionView[] }
  weekly: { key: string; endsAt: number; missions: MissionView[] }
  pokedex: MissionView[]
  /** Completed and not yet claimed (badge). */
  claimable: number
}

function fill(text: LocalizedText, params: MissionView['params'], ctx: EngineContext): LocalizedText {
  const typeInfo = params.type ? ctx.data.types.types.find((t) => t.slug === params.type) : undefined
  const f = (s: string, lang: keyof LocalizedText) =>
    s
      .replaceAll('{n}', String(params.n))
      .replaceAll('{minutes}', String(params.minutes ?? ''))
      .replaceAll('{type}', typeInfo ? typeInfo.names[lang] : (params.type ?? ''))
  return { es: f(text.es, 'es'), en: f(text.en, 'en') }
}

function slotView(slot: MissionSlot, period: MissionPeriod, ctx: EngineContext): MissionView | null {
  const def = defOf(slot.defId, ctx)
  if (!def) return null
  const params = { n: slot.target, minutes: def.minMinutes ?? null, type: slot.type }
  return {
    id: slot.id,
    defId: slot.defId,
    period,
    kind: def.kind,
    title: fill(def.title, params, ctx),
    description: fill(def.description, params, ctx),
    params,
    progress: slot.progress,
    target: slot.target,
    completed: slot.progress >= slot.target,
    claimed: slot.claimed,
    reward: slot.reward,
  }
}

function pokedexReward(state: PlayerState, m: PokedexMilestoneDef): MissionReward {
  return resolveReward(m.rewards, state.trainer.level, null, createRng(`${seedOf(state)}|${m.id}`))
}

function pokedexView(state: PlayerState, claimed: readonly string[], ctx: EngineContext): MissionView[] {
  const caught = state.pokedex.caught.length
  return ctx.missions.pokedex.map((m) => {
    const params = { n: m.species, minutes: null, type: null }
    return {
      id: m.id,
      defId: m.id,
      period: 'pokedex' as const,
      kind: 'pokedex' as const,
      title: fill(m.title, params, ctx),
      description: fill(m.description, params, ctx),
      params,
      progress: Math.min(caught, m.species),
      target: m.species,
      completed: caught >= m.species,
      claimed: claimed.includes(m.id),
      reward: pokedexReward(state, m),
    }
  })
}

/** Missions at `now` (rotated if the stored ones are from a past day/week; pure). */
export function missionsView(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): MissionsView {
  const s = refreshMissions(state, now, ctx)
  const m = s.missions as MissionsState
  const tz = s.profile.timezone
  const daily = m.daily.slots.map((x) => slotView(x, 'daily', ctx)).filter((x): x is MissionView => x !== null)
  const weekly = m.weekly.slots.map((x) => slotView(x, 'weekly', ctx)).filter((x): x is MissionView => x !== null)
  const pokedex = pokedexView(s, m.pokedexClaimed, ctx)
  const claimable = [...daily, ...weekly, ...pokedex].filter((x) => x.completed && !x.claimed).length
  return {
    daily: { key: m.daily.key, endsAt: startOfLocalDay(addDays(m.daily.key, 1), tz), missions: daily },
    weekly: { key: m.weekly.key, endsAt: startOfLocalDay(addDays(m.weekly.key, 7), tz), missions: weekly },
    pokedex,
    claimable,
  }
}

export type ClaimMissionError = 'unknown_mission' | 'not_completed' | 'already_claimed'

/** Add a reward to the player (items, dust, type candies). */
export function grantReward(state: PlayerState, r: MissionReward): PlayerState {
  const inventory = { ...state.inventory }
  for (const [k, n] of Object.entries(r.items)) inventory[k] = (inventory[k] ?? 0) + n
  const types = { ...state.candies.types }
  for (const [t, n] of Object.entries(r.typeCandies) as [TypeSlug, number][]) types[t] = (types[t] ?? 0) + n
  return { ...state, inventory, dust: state.dust + r.dust, candies: { ...state.candies, types } }
}

/**
 * Claim a completed mission of the current day/week, or a reached Pokédex
 * milestone. Missions of past periods are gone ('unknown_mission').
 */
export function claimMission(
  state: PlayerState,
  missionId: string,
  now: number,
  ctx: EngineContext = defaultContext(),
): Result<{ state: PlayerState; reward: MissionReward }, ClaimMissionError> {
  const s = refreshMissions(state, now, ctx)
  const m = s.missions as MissionsState
  const dex = ctx.missions.pokedex.find((x) => x.id === missionId)
  if (dex) {
    if (m.pokedexClaimed.includes(dex.id)) return err('already_claimed')
    if (s.pokedex.caught.length < dex.species) return err('not_completed')
    const reward = pokedexReward(s, dex)
    return ok({ state: grantReward({ ...s, missions: { ...m, pokedexClaimed: [...m.pokedexClaimed, dex.id] } }, reward), reward })
  }
  for (const period of ['daily', 'weekly'] as const) {
    const group = m[period]
    const slot = group.slots.find((x) => x.id === missionId)
    if (!slot) continue
    if (slot.claimed) return err('already_claimed')
    if (slot.progress < slot.target) return err('not_completed')
    const slots = group.slots.map((x) => (x.id === missionId ? { ...x, claimed: true } : x))
    const next = { ...s, missions: { ...m, [period]: { ...group, slots } } }
    return ok({ state: grantReward(next, slot.reward), reward: slot.reward })
  }
  return err('unknown_mission')
}

/** Claim every completed mission and milestone at `now` (convenience for "claim all"). */
export function claimAllMissions(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): { state: PlayerState; rewards: { id: string; reward: MissionReward }[] } {
  let s = state
  const rewards: { id: string; reward: MissionReward }[] = []
  const v = missionsView(s, now, ctx)
  for (const x of [...v.daily.missions, ...v.weekly.missions, ...v.pokedex]) {
    if (!x.completed || x.claimed) continue
    const r = claimMission(s, x.id, now, ctx)
    if (r.ok) {
      s = r.value.state
      rewards.push({ id: x.id, reward: r.value.reward })
    }
  }
  return { state: s, rewards }
}
