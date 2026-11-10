/**
 * Pure edits and filters of the species and move tables: how a field change lands in the patch (a value equal to the
 * base, or to "no rule", removes the override) and which rows a filter keeps.
 */
import type { ContentPatch, SpawnWeather, SpeciesSpawn } from '../../../../engine/content'
import type { Move, Species, TypeSlug } from '../../../../engine/data-types'
import { getPath, pruneEmpty, setPath } from './patch'

export const WEATHERS: readonly SpawnWeather[] = ['rain', 'sun', 'snow', 'clear']

type SpeciesField = 'captureRate' | 'spawn.enabled' | 'spawn.weightMult' | 'spawn.minTrainerLevel' | 'spawn.weather' | 'spawn.hours'

/** What a species row shows: the override when there is one, else the neutral default of the rule. */
export interface SpeciesRow {
  captureRate: number
  enabled: boolean
  weightMult: number
  minTrainerLevel: number
  weather: SpawnWeather[]
  hours: [number, number][]
  modified: boolean
}

export function speciesRow(patch: ContentPatch, s: Pick<Species, 'slug' | 'captureRate'>): SpeciesRow {
  const p = patch.species?.[s.slug]
  const sp: SpeciesSpawn = p?.spawn ?? {}
  return {
    captureRate: p?.captureRate ?? s.captureRate,
    enabled: sp.enabled ?? true,
    weightMult: sp.weightMult ?? 1,
    minTrainerLevel: sp.minTrainerLevel ?? 1,
    weather: sp.weather ?? [],
    hours: sp.hours ?? [],
    modified: p !== undefined && Object.keys(p).length > 0,
  }
}

/** Neutral value of each spawn field: setting it back removes the override. */
const NEUTRAL: Record<SpeciesField, (s: Pick<Species, 'captureRate'>) => unknown> = {
  captureRate: (s) => s.captureRate,
  'spawn.enabled': () => true,
  'spawn.weightMult': () => 1,
  'spawn.minTrainerLevel': () => 1,
  'spawn.weather': () => [],
  'spawn.hours': () => [],
}

/** Set one species field. Neutral values (the base capture rate, enabled, ×1, level 1, no weather/hours) delete the override. */
export function setSpeciesField(patch: ContentPatch, s: Pick<Species, 'slug' | 'captureRate'>, field: SpeciesField, value: unknown): ContentPatch {
  const neutral = NEUTRAL[field](s)
  const isNeutral = Array.isArray(value) ? value.length === 0 : value === neutral
  return pruneEmpty(setPath(patch as object, `species.${s.slug}.${field}`, isNeutral ? undefined : value) as ContentPatch)
}

/** Remove every override of a species. */
export function resetSpecies(patch: ContentPatch, slug: string): ContentPatch {
  return pruneEmpty(setPath(patch as object, `species.${slug}`, undefined) as ContentPatch)
}

export function setMoveField(patch: ContentPatch, m: Pick<Move, 'slug' | 'power' | 'accuracy'>, field: 'power' | 'accuracy', value: number): ContentPatch {
  return pruneEmpty(setPath(patch as object, `moves.${m.slug}.${field}`, value === m[field] ? undefined : value) as ContentPatch)
}

export function moveOverride(patch: ContentPatch, slug: string, field: 'power' | 'accuracy'): number | null | undefined {
  return getPath(patch.moves, `${slug}.${field}`) as number | null | undefined
}

export interface SpeciesFilter {
  query: string
  type: TypeSlug | 'all'
  stage: 0 | 1 | 2 | 3
  onlyModified: boolean
}

/** Species that pass the filter, in dex order. `name` resolves the display name in the UI language. */
export function filterSpecies(species: readonly Species[], patch: ContentPatch, f: SpeciesFilter, name: (slug: string) => string): Species[] {
  const q = f.query.trim().toLowerCase()
  return species.filter(
    (s) =>
      (f.type === 'all' || s.types.includes(f.type)) &&
      (f.stage === 0 || s.stage === f.stage) &&
      (!f.onlyModified || patch.species?.[s.slug] !== undefined) &&
      (q === '' || s.slug.includes(q) || name(s.slug).toLowerCase().includes(q) || String(s.id) === q),
  )
}

export function filterMoves(moves: readonly Move[], patch: ContentPatch, query: string, onlyModified: boolean, name: (slug: string) => string): Move[] {
  const q = query.trim().toLowerCase()
  return moves.filter(
    (m) => (!onlyModified || patch.moves?.[m.slug] !== undefined) && (q === '' || m.slug.includes(q) || name(m.slug).toLowerCase().includes(q)),
  )
}

// --- Advanced (raw JSON) sections ---------------------------------------------

export type RawSection = 'techniques' | 'abilities' | 'missions'
export const RAW_SECTIONS: readonly RawSection[] = ['techniques', 'abilities', 'missions']

export type RawParse = { ok: true; value: Record<string, unknown> } | { ok: false; reason: 'syntax' | 'object' }

/** Parse the text of a raw section: it must be a JSON object (the server's schema does the rest). */
export function parseRaw(text: string): RawParse {
  let v: unknown
  try {
    v = JSON.parse(text.trim() === '' ? '{}' : text)
  } catch {
    return { ok: false, reason: 'syntax' }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, reason: 'object' }
  return { ok: true, value: v as Record<string, unknown> }
}

/** Replace a whole section; an empty object removes it. */
export function setRawSection(patch: ContentPatch, key: RawSection, value: Record<string, unknown>): ContentPatch {
  const next: Record<string, unknown> = { ...patch }
  if (Object.keys(value).length === 0) delete next[key]
  else next[key] = value
  return next as ContentPatch
}

export const rawText = (patch: ContentPatch, key: RawSection): string => (patch[key] === undefined ? '{}' : JSON.stringify(patch[key], null, 2))
