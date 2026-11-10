/**
 * Missions (GDD §13): 3 daily + 3 weekly missions drawn from the pool in
 * `custom-missions.json` (deterministic per player and local day/week), plus
 * Pokédex milestones. Progress is recorded by the reducers that produce the
 * events (applySessionResult, throwBall, evolvePokemon); rewards are claimed
 * with `claimMission`. Live events add their own fixed missions (group
 * `event`, ids `e:<eventId>:<defId>`), kept until `endsAt + EVENT_MISSION_GRACE_MS`.
 */
import { defaultContext, type EngineContext } from './context'
import type { LocalizedText, TypeSlug } from './data-types'
import { isLegendarySpecies } from './individual'
import type { EventMissionDef } from './content'
import type { MissionKind } from './mission-kinds'
import { createRng, weightedPick, type Rng } from './rng'
import { err, ok, type PlayerState, type Result } from './state'
import { addDays, dayKeyOf, startOfLocalDay, weekKeyOf } from './time'

// ---------------------------------------------------------------------------
// Content (custom-missions.json)
// ---------------------------------------------------------------------------

/** `event`: the fixed missions of a live event (`EventOverlay.missions`), never drawn from the pool. */
export type MissionPeriod = 'daily' | 'weekly' | 'event'
/** The periods drawn from the pool. */
export type DrawnPeriod = 'daily' | 'weekly'
// `MissionKind` / `MISSION_KINDS` live in './mission-kinds' (a leaf module) so
// context.ts can import them without a runtime cycle; re-exported here to keep
// the public API unchanged.
export { MISSION_KINDS, type MissionKind } from './mission-kinds'

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

/** What an event mission slot keeps of its def (the event may end, or change, before it is claimed). */
export type EventMissionInfo = Pick<MissionDef, 'kind' | 'minMinutes' | 'title' | 'description'>

export interface EventMissionSlot extends MissionSlot {
  def: EventMissionInfo
}

/** The missions of one live event (`MissionsState.event[eventId]`). */
export interface EventMissionsGroup {
  slug: string
  startsAt: number
  endsAt: number
  slots: EventMissionSlot[]
}

/** Event missions stay visible and claimable this long after the event ends. */
export const EVENT_MISSION_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export interface MissionsState {
  daily: { key: string; slots: MissionSlot[] }
  weekly: { key: string; slots: MissionSlot[] }
  /** Pokédex milestone ids already claimed. */
  pokedexClaimed: string[]
  /** Live event missions by event id (absent = none ever). */
  event?: Record<string, EventMissionsGroup>
}

/** Events that move mission progress (produced inside the reducers). */
export type MissionEvent =
  /** `cancelled`: a long session cancelled and kept (GDD §3.4) — its minutes count, but it is not a completed session. */
  | { kind: 'session'; minutes: number; dayKey: string; techniques: number; cancelled?: boolean }
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

function generateSlots(state: PlayerState, period: DrawnPeriod, key: string, ctx: EngineContext): MissionSlot[] {
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

/** Slot id of an event mission. */
export function eventMissionId(eventId: string, defId: string): string {
  return `e:${eventId}:${defId}`
}

/** Event mission slot of `def` (catchType 'random' and random rewards drawn from a per-event RNG). */
function eventSlot(state: PlayerState, eventId: string, def: EventMissionDef, ctx: EngineContext): EventMissionSlot {
  const rng = createRng(`${seedOf(state)}|event|${eventId}|${def.id}`)
  let type: TypeSlug | null = null
  if (def.kind === 'catchType') type = def.type && def.type !== 'random' ? def.type : (weightedPick(rng, typeWeights(ctx), (e) => e[1])?.[0] ?? 'normal')
  return {
    id: eventMissionId(eventId, def.id),
    defId: def.id,
    target: def.target,
    progress: 0,
    type,
    reward: resolveReward(def.rewards, state.trainer.level, type, rng),
    claimed: false,
    ...(def.kind === 'studyDays' ? { days: [] } : {}),
    def: { kind: def.kind, ...(def.minMinutes !== undefined && { minMinutes: def.minMinutes }), title: def.title, description: def.description },
  }
}

/**
 * Event mission groups at `now`: groups past `endsAt + EVENT_MISSION_GRACE_MS`
 * are dropped; each event of `ctx.events` (the events active when the content
 * was resolved, so a pinned session keeps them) gets a slot for every mission
 * the trainer level allows that it does not have yet. Same object if nothing changed.
 */
function refreshEventMissions(
  state: PlayerState,
  cur: Record<string, EventMissionsGroup> | undefined,
  now: number,
  ctx: EngineContext,
): Record<string, EventMissionsGroup> | undefined {
  let out = cur
  const edit = (): Record<string, EventMissionsGroup> => (out === cur ? (out = { ...cur }) : (out as Record<string, EventMissionsGroup>))
  for (const [id, g] of Object.entries(cur ?? {})) if (now >= g.endsAt + EVENT_MISSION_GRACE_MS) delete edit()[id]
  for (const ev of ctx.events) {
    if (now >= ev.endsAt + EVENT_MISSION_GRACE_MS) continue
    const defs = (ev.missions ?? []).filter((d) => state.trainer.level >= (d.minTrainerLevel ?? 1))
    const g = out?.[ev.id]
    const missing = defs.filter((d) => !g?.slots.some((x) => x.defId === d.id))
    if (missing.length === 0) continue
    const slots = [...(g?.slots ?? []), ...missing.map((d) => eventSlot(state, ev.id, d, ctx))]
    edit()[ev.id] = { slug: ev.slug, startsAt: ev.startsAt, endsAt: ev.endsAt, slots }
  }
  if (out !== cur && out && Object.keys(out).length === 0) return undefined
  return out
}

/**
 * Bring the missions to `now`: draws new daily/weekly missions when the local
 * day/week changed (unclaimed missions of past periods are dropped) and
 * updates the live event missions (see `refreshEventMissions`).
 * Returns the same state object if nothing changed.
 */
export function refreshMissions(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): PlayerState {
  const keys = missionKeys(state, now)
  const cur = state.missions
  const event = refreshEventMissions(state, cur?.event, now, ctx)
  if (cur && cur.daily.key === keys.daily && cur.weekly.key === keys.weekly && event === cur.event) return state
  const missions: MissionsState = {
    daily: cur && cur.daily.key === keys.daily ? cur.daily : { key: keys.daily, slots: generateSlots(state, 'daily', keys.daily, ctx) },
    weekly: cur && cur.weekly.key === keys.weekly ? cur.weekly : { key: keys.weekly, slots: generateSlots(state, 'weekly', keys.weekly, ctx) },
    pokedexClaimed: cur?.pokedexClaimed ?? [],
    ...(event ? { event } : {}),
  }
  return { ...state, missions }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function defOf(id: string, ctx: EngineContext): MissionDef | undefined {
  return ctx.missions.pool.find((d) => d.id === id)
}

function advance<S extends MissionSlot>(slot: S, def: EventMissionInfo, e: MissionEvent): S {
  if (slot.claimed || slot.progress >= slot.target) return slot
  let inc = 0
  let days = slot.days
  switch (def.kind) {
    case 'sessions':
      if (e.kind === 'session' && !e.cancelled) inc = 1
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
  const missions: MissionsState = { ...m, daily: { ...m.daily, slots: upd(m.daily.slots) }, weekly: { ...m.weekly, slots: upd(m.weekly.slots) } }
  // Event missions move only while their event is in the context (active at the start of the pinned session).
  if (m.event && ctx.events.length > 0) {
    const groups = { ...m.event }
    for (const ev of ctx.events) {
      const g = groups[ev.id]
      if (g) groups[ev.id] = { ...g, slots: g.slots.map((slot) => advance(slot, slot.def, event)) }
    }
    missions.event = groups
  }
  return { ...s, missions }
}

// ---------------------------------------------------------------------------
// View & claim
// ---------------------------------------------------------------------------

export interface MissionView {
  id: string
  defId: string
  /** Event missions: the event id. */
  eventId?: string
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
  /** Live event missions, one group per event (active ones and those ended less than EVENT_MISSION_GRACE_MS ago), by start. */
  event: { eventId: string; slug: string; startsAt: number; endsAt: number; active: boolean; missions: MissionView[] }[]
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

function slotView(slot: MissionSlot, period: MissionPeriod, ctx: EngineContext, info?: EventMissionInfo, eventId?: string): MissionView | null {
  const def = info ?? defOf(slot.defId, ctx)
  if (!def) return null
  const params = { n: slot.target, minutes: def.minMinutes ?? null, type: slot.type }
  return {
    id: slot.id,
    defId: slot.defId,
    ...(eventId !== undefined && { eventId }),
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
  const event = Object.entries(m.event ?? {})
    .sort(([a, x], [b, y]) => x.startsAt - y.startsAt || (a < b ? -1 : a > b ? 1 : 0))
    .map(([eventId, g]) => ({
      eventId,
      slug: g.slug,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      active: now >= g.startsAt && now < g.endsAt,
      missions: g.slots.map((x) => slotView(x, 'event', ctx, x.def, eventId)).filter((x): x is MissionView => x !== null),
    }))
  const claimable = [...daily, ...weekly, ...pokedex, ...event.flatMap((g) => g.missions)].filter((x) => x.completed && !x.claimed).length
  return {
    daily: { key: m.daily.key, endsAt: startOfLocalDay(addDays(m.daily.key, 1), tz), missions: daily },
    weekly: { key: m.weekly.key, endsAt: startOfLocalDay(addDays(m.weekly.key, 7), tz), missions: weekly },
    pokedex,
    event,
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
 * Claim a completed mission of the current day/week, a reached Pokédex
 * milestone, or a completed event mission (`e:<eventId>:<defId>`, until
 * `endsAt + EVENT_MISSION_GRACE_MS`). Missions of past periods are gone ('unknown_mission').
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
  if (missionId.startsWith('e:') && m.event) {
    for (const [eventId, g] of Object.entries(m.event)) {
      const slot = g.slots.find((x) => x.id === missionId)
      if (!slot) continue
      if (slot.claimed) return err('already_claimed')
      if (slot.progress < slot.target) return err('not_completed')
      const slots = g.slots.map((x) => (x.id === missionId ? { ...x, claimed: true } : x))
      const next = { ...s, missions: { ...m, event: { ...m.event, [eventId]: { ...g, slots } } } }
      return ok({ state: grantReward(next, slot.reward), reward: slot.reward })
    }
  }
  return err('unknown_mission')
}

/** Claim every completed mission and milestone at `now` (convenience for "claim all"). */
export function claimAllMissions(state: PlayerState, now: number, ctx: EngineContext = defaultContext()): { state: PlayerState; rewards: { id: string; reward: MissionReward }[] } {
  let s = state
  const rewards: { id: string; reward: MissionReward }[] = []
  const v = missionsView(s, now, ctx)
  for (const x of [...v.daily.missions, ...v.weekly.missions, ...v.event.flatMap((g) => g.missions), ...v.pokedex]) {
    if (!x.completed || x.claimed) continue
    const r = claimMission(s, x.id, now, ctx)
    if (r.ok) {
      s = r.value.state
      rewards.push({ id: x.id, reward: r.value.reward })
    }
  }
  return { state: s, rewards }
}
