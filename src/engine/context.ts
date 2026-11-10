/**
 * EngineContext: everything the rules read (config + data + effect definitions),
 * indexed once. Every public function takes an optional `ctx` as its last
 * argument and falls back to `defaultContext()` (the shipped data). The
 * simulator can build its own with `createEngineContext({ config: {...} })`.
 */
import { gameData as shippedData } from '../data/index'
import abilitiesJson from '../data/game/custom-abilities.json'
import techniquesJson from '../data/game/custom-techniques.json'
import missionsJson from '../data/game/custom-missions.json'
import { buildConfig, type GameConfig, type GameConfigOverrides } from './config'
import type { ActiveEvent, ResolvedSpawn } from './content'
import type { GameData, Move, Nature, Species, TypeChart } from './data-types'
import { EFFECT_KINDS, type AbilityDef, type TechniqueDef } from './effect-types'
import { MISSION_KINDS } from './mission-kinds'
import type { MissionsContent } from './missions'

export interface EngineContext {
  config: GameConfig
  data: GameData
  techniques: Record<string, TechniqueDef>
  abilities: Record<string, AbilityDef>
  /** Mission pool and Pokédex milestones (custom-missions.json). */
  missions: MissionsContent
  speciesBySlug: Map<string, Species>
  speciesById: Map<number, Species>
  movesBySlug: Map<string, Move>
  naturesBySlug: Map<string, Nature>
  chart: TypeChart
  /** Problems found while loading effect definitions (unknown kinds, etc.) or resolving live content. */
  warnings: string[]
  /** Hash of the resolved live content (docs/admin-plan.md §1); 'base' = shipped data, no patch. */
  contentHash: string
  /** Per-species spawn rules (admin patch × featured species of active events). Empty = none. */
  spawn: Map<string, ResolvedSpawn>
  /** Live events active when the content was resolved, in (startsAt, id) order. */
  events: ActiveEvent[]
}

export interface ContextOptions {
  config?: GameConfigOverrides
  data?: GameData
  techniques?: Record<string, TechniqueDef>
  abilities?: Record<string, AbilityDef>
  missions?: MissionsContent
  /** Live content (see `resolveContent` in content.ts). */
  contentHash?: string
  spawn?: Record<string, ResolvedSpawn>
  events?: ActiveEvent[]
  /** Extra warnings (from `resolveContent`), prepended to the context's. */
  warnings?: string[]
}

/** The shipped content (data + effect definitions + missions), before any live patch. */
export function baseContent(): Required<Pick<ContextOptions, 'data' | 'techniques' | 'abilities' | 'missions'>> {
  return {
    data: shippedData,
    techniques: stripNotes<TechniqueDef>(techniquesJson as Record<string, unknown>),
    abilities: stripNotes<AbilityDef>(abilitiesJson as Record<string, unknown>),
    missions: missionsJson as unknown as MissionsContent,
  }
}

function stripNotes<T>(obj: Record<string, unknown>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('_')) out[k] = v as T
  return out
}

export function createEngineContext(opts: ContextOptions = {}): EngineContext {
  const data = opts.data ?? shippedData
  const techniques = opts.techniques ?? stripNotes<TechniqueDef>(techniquesJson as Record<string, unknown>)
  const abilities = opts.abilities ?? stripNotes<AbilityDef>(abilitiesJson as Record<string, unknown>)
  const warnings: string[] = [...(opts.warnings ?? [])]
  const known = new Set<string>(EFFECT_KINDS)
  const movesBySlug = new Map(data.moves.map((m) => [m.slug, m]))
  for (const [slug, t] of Object.entries(techniques)) {
    if (!movesBySlug.has(slug)) warnings.push(`technique ${slug}: no such move`)
    if (t.category === 'activable' && !(t.baseChance && t.baseChance > 0)) warnings.push(`technique ${slug}: activable without baseChance`)
    for (const e of t.effects) if (!known.has(e.kind)) warnings.push(`technique ${slug}: unknown effect kind ${e.kind}`)
  }
  for (const [slug, a] of Object.entries(abilities)) {
    for (const e of a.effects) if (!known.has(e.kind)) warnings.push(`ability ${slug}: unknown effect kind ${e.kind}`)
  }
  const missions = opts.missions ?? (missionsJson as unknown as MissionsContent)
  const kinds = new Set<string>(MISSION_KINDS)
  for (const d of missions.pool) if (!kinds.has(d.kind)) warnings.push(`mission ${d.id}: unknown kind ${d.kind}`)
  const speciesBySlug = new Map(data.species.map((s) => [s.slug, s]))
  const spawn = new Map(Object.entries(opts.spawn ?? {}))
  for (const slug of spawn.keys()) if (!speciesBySlug.has(slug)) warnings.push(`spawn ${slug}: no such species`)
  return {
    config: buildConfig(opts.config),
    data,
    techniques,
    abilities,
    missions,
    speciesBySlug,
    speciesById: new Map(data.species.map((s) => [s.id, s])),
    movesBySlug,
    naturesBySlug: new Map(data.natures.map((n) => [n.slug, n])),
    chart: data.types.chart,
    warnings,
    contentHash: opts.contentHash ?? 'base',
    spawn,
    events: opts.events ?? [],
  }
}

let cached: EngineContext | null = null
let active: EngineContext | null = null

/** The context built from the shipped data and config only (memoized), whatever the active one is. */
export function baseContext(): EngineContext {
  if (!cached) cached = createEngineContext()
  return cached
}

/**
 * Set the context `defaultContext()` returns (the live content resolved by the
 * server or the client store); `null` goes back to the base one. Tests that set
 * it must reset it (`afterEach(() => setDefaultContext(null))`).
 */
export function setDefaultContext(ctx: EngineContext | null): void {
  active = ctx
}

/** The active context (see `setDefaultContext`), or the base one. */
export function defaultContext(): EngineContext {
  return active ?? baseContext()
}

export function getSpecies(slug: string, ctx: EngineContext = defaultContext()): Species {
  const s = ctx.speciesBySlug.get(slug)
  if (!s) throw new Error(`Unknown species: ${slug}`)
  return s
}

export function getSpeciesById(id: number, ctx: EngineContext = defaultContext()): Species {
  const s = ctx.speciesById.get(id)
  if (!s) throw new Error(`Unknown species id: ${id}`)
  return s
}
