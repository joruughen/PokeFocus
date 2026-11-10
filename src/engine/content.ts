/**
 * Live content (docs/admin-plan.md §1): the layers that sit on top of the
 * shipped data, resolved into the options of `createEngineContext`.
 *
 *   1. base       — src/data/game/*.json (bundled);
 *   2. admin patch — a full `ContentPatch` over the base (not a delta over the previous version);
 *   3. events      — the overlays of the active events, applied in (startsAt, id) order.
 *
 * Pure: no I/O, no clock, no hashing (the server hashes with node:crypto and
 * passes the hash in). An empty patch with no events resolves to `{}`, so the
 * context is exactly the base one (`contentHash: 'base'`, no spawn entries, no events).
 */
import { baseContent, type ContextOptions } from './context'
import type { GameConfigOverrides } from './config'
import type { GameData, LocalizedText } from './data-types'
import type { AbilityDef, TechniqueDef } from './effect-types'
import type { MissionDef, MissionsContent, PokedexMilestoneDef } from './missions'

/** Weather tags a species can be limited to ('clear' = known weather that is neither rain, sun nor snow). */
export type SpawnWeather = 'rain' | 'sun' | 'snow' | 'clear'

/** Per-species spawn rules set by the admin. Every field is optional; absent = no restriction. */
export interface SpeciesSpawn {
  enabled?: boolean
  weightMult?: number
  /** Local-hour windows `[from, to)` (0–24; `from > to` wraps midnight). */
  hours?: [number, number][]
  weather?: SpawnWeather[]
  minTrainerLevel?: number
}

export interface SpeciesPatch {
  captureRate?: number
  spawn?: SpeciesSpawn
}

export interface MovePatch {
  power?: number | null
  accuracy?: number | null
}

/** A mission-only item name (same shape as `MissionsContent.placeholderItems` values). */
export interface ContentItem {
  names: LocalizedText
  description?: LocalizedText
}

export interface MissionsPatch {
  dailyCount?: number
  weeklyCount?: number
  /** Replaces the whole pool. */
  pool?: MissionDef[]
  /** Replaces the whole list. */
  pokedex?: PokedexMilestoneDef[]
  /** Merged by slug over the base ones. */
  placeholderItems?: Record<string, ContentItem>
}

/** The admin override (`content_versions.patch`). Only modifies existing entries. */
export interface ContentPatch {
  /** Only whitelisted paths (validated in src/game/content, not here). */
  config?: GameConfigOverrides
  species?: Record<string, SpeciesPatch>
  moves?: Record<string, MovePatch>
  /** Replacement by slug. */
  techniques?: Record<string, TechniqueDef>
  /** Replacement by slug. */
  abilities?: Record<string, AbilityDef>
  missions?: MissionsPatch
}

/** An event mission: a fixed list per event, never drawn (wired in E7). */
export type EventMissionDef = Omit<MissionDef, 'period'> & { period: 'event' }

/**
 * A live event overlay (`live_events.overlay` + its dates). Only this closed set
 * of keys is allowed: events cannot change arbitrary config.
 */
export interface EventOverlay {
  id: string
  slug: string
  /** Epoch ms, inclusive. */
  startsAt: number
  /** Epoch ms, exclusive. */
  endsAt: number
  featured: { species: string; weightMult: number }[]
  shiny?: { chance: number; scope: 'all' | 'featured' }
  legendaryChanceMult?: number
  drops: { item: string; perWaveChance: number; max: number }[]
  missions: EventMissionDef[]
  /** The event's own items. */
  items?: Record<string, ContentItem>
}

/** An event active when the context was resolved (`EngineContext.events`). */
export type ActiveEvent = EventOverlay

export const EVENT_OVERLAY_KEYS = [
  'id',
  'slug',
  'startsAt',
  'endsAt',
  'featured',
  'shiny',
  'legendaryChanceMult',
  'drops',
  'missions',
  'items',
] as const satisfies readonly (keyof EventOverlay)[]

export const CONTENT_PATCH_KEYS = ['config', 'species', 'moves', 'techniques', 'abilities', 'missions'] as const satisfies readonly (keyof ContentPatch)[]

/**
 * Resolved spawn rule of one species (`EngineContext.spawn`). `weightMult` is
 * the admin multiplier × every active event's featured multiplier. The rest
 * comes from the admin patch only (`enabled: false` wins over featuring).
 */
export interface ResolvedSpawn {
  weightMult: number
  enabled: boolean
  hours?: [number, number][]
  weather?: SpawnWeather[]
  minTrainerLevel?: number
}

export interface ResolveContentOptions {
  /** Content hash computed by the caller (server). Default: 'base' when nothing changes, else 'unhashed'. */
  hash?: string
}

function sortedEvents(events: readonly EventOverlay[]): EventOverlay[] {
  return [...events].sort((a, b) => a.startsAt - b.startsAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function nonEmpty<T extends object>(o: T | undefined): o is T {
  return !!o && Object.keys(o).length > 0
}

/**
 * Resolve base → admin patch → active events into `createEngineContext` options.
 * `events` are the events active now (sorted here by `(startsAt, id)`);
 * `allEventItems` are the items of every published event, past ones included,
 * so the inventory keeps their names after the event ends. Unknown slugs and
 * unknown keys are ignored and reported in `warnings` (→ `ctx.warnings`).
 */
export function resolveContent(
  patch: ContentPatch,
  events: readonly EventOverlay[],
  allEventItems: Record<string, ContentItem>,
  opts: ResolveContentOptions = {},
): ContextOptions {
  const out: ContextOptions = {}
  const warnings: string[] = []
  const known = new Set<string>(CONTENT_PATCH_KEYS)
  for (const k of Object.keys(patch)) if (!known.has(k)) warnings.push(`patch: unknown key ${k} (ignored)`)
  const base = baseContent()

  // Config: deep-merged over the base config by createEngineContext.
  if (nonEmpty(patch.config)) out.config = patch.config

  // Data: species capture rate, move power/accuracy (copies; the base is never mutated).
  const speciesSlugs = new Set(base.data.species.map((s) => s.slug))
  const sp = patch.species ?? {}
  for (const slug of Object.keys(sp)) if (!speciesSlugs.has(slug)) warnings.push(`patch: unknown species ${slug}`)
  const mv = patch.moves ?? {}
  const moveSlugs = new Set(base.data.moves.map((m) => m.slug))
  for (const slug of Object.keys(mv)) if (!moveSlugs.has(slug)) warnings.push(`patch: unknown move ${slug}`)
  const rateChanged = Object.entries(sp).some(([slug, p]) => speciesSlugs.has(slug) && p.captureRate !== undefined)
  const movesChanged = Object.entries(mv).some(([slug, p]) => moveSlugs.has(slug) && (p.power !== undefined || p.accuracy !== undefined))
  if (rateChanged || movesChanged) {
    const data: GameData = { ...base.data }
    if (rateChanged) {
      data.species = base.data.species.map((s) => {
        const r = sp[s.slug]?.captureRate
        return r === undefined ? s : { ...s, captureRate: r }
      })
    }
    if (movesChanged) {
      data.moves = base.data.moves.map((m) => {
        const p = mv[m.slug]
        if (!p || (p.power === undefined && p.accuracy === undefined)) return m
        return { ...m, ...(p.power !== undefined && { power: p.power }), ...(p.accuracy !== undefined && { accuracy: p.accuracy }) }
      })
    }
    out.data = data
  }

  // Techniques and abilities: replacement by slug of existing entries.
  if (nonEmpty(patch.techniques)) {
    for (const slug of Object.keys(patch.techniques)) if (!(slug in base.techniques)) warnings.push(`patch: unknown technique ${slug}`)
    out.techniques = { ...base.techniques, ...patch.techniques }
  }
  if (nonEmpty(patch.abilities)) {
    for (const slug of Object.keys(patch.abilities)) if (!(slug in base.abilities)) warnings.push(`patch: unknown ability ${slug}`)
    out.abilities = { ...base.abilities, ...patch.abilities }
  }

  // Events: closed key set, (startsAt, id) order.
  const active = sortedEvents(events)
  const overlayKeys = new Set<string>(EVENT_OVERLAY_KEYS)
  for (const ev of active) {
    for (const k of Object.keys(ev)) if (!overlayKeys.has(k)) warnings.push(`event ${ev.id}: unknown key ${k} (ignored)`)
  }

  // Missions: patch fields, then item names (base < patch < all published events < active events).
  const eventItems: Record<string, ContentItem> = { ...allEventItems }
  for (const ev of active) Object.assign(eventItems, ev.items ?? {})
  const mp = patch.missions ?? {}
  if (nonEmpty(mp) || nonEmpty(eventItems)) {
    const missions: MissionsContent = { ...base.missions, placeholderItems: { ...base.missions.placeholderItems, ...mp.placeholderItems, ...eventItems } }
    if (mp.dailyCount !== undefined) missions.dailyCount = mp.dailyCount
    if (mp.weeklyCount !== undefined) missions.weeklyCount = mp.weeklyCount
    if (mp.pool !== undefined) missions.pool = mp.pool
    if (mp.pokedex !== undefined) missions.pokedex = mp.pokedex
    out.missions = missions
  }

  // Spawn: admin rules, then × each active event's featured multiplier.
  const spawn = new Map<string, ResolvedSpawn>()
  for (const [slug, p] of Object.entries(sp)) {
    const s = p.spawn
    if (!s || !nonEmpty(s)) continue
    spawn.set(slug, {
      weightMult: s.weightMult ?? 1,
      enabled: s.enabled ?? true,
      ...(s.hours !== undefined && { hours: s.hours }),
      ...(s.weather !== undefined && { weather: s.weather }),
      ...(s.minTrainerLevel !== undefined && { minTrainerLevel: s.minTrainerLevel }),
    })
  }
  for (const ev of active) {
    for (const f of ev.featured ?? []) {
      if (!speciesSlugs.has(f.species)) warnings.push(`event ${ev.id}: unknown featured species ${f.species}`)
      const cur = spawn.get(f.species) ?? { weightMult: 1, enabled: true }
      spawn.set(f.species, { ...cur, weightMult: cur.weightMult * f.weightMult })
    }
  }
  if (spawn.size > 0) out.spawn = Object.fromEntries(spawn)
  if (active.length > 0) out.events = active
  if (warnings.length > 0) out.warnings = warnings

  const changed = Object.keys(out).length > 0
  if (opts.hash !== undefined) out.contentHash = opts.hash
  else if (changed) out.contentHash = 'unhashed'
  return out
}
