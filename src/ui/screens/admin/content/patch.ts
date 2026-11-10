/**
 * Pure helpers of the draft editor: immutable edits of a `ContentPatch` by dotted path, the base value of
 * every editable path, number parsing/formatting from `limits.ts` bounds and the per-field «big change» badge.
 *
 * A patch is a FULL override of the base (not a delta over the previous version): a path that is absent means
 * "the base value", and setting a field back to its base value removes it from the patch.
 */
import { baseContext } from '../../../../engine/context'
import type { ContentPatch } from '../../../../engine/content'
import {
  BIG_CHANGE_FACTOR,
  BIG_CHANGE_FACTOR_PROB,
  CONFIG_LIMITS,
  CONFIG_LIST_LIMITS,
  CONFIG_TABLE_LIMITS,
  LIMIT_GROUPS,
  type ConfigLimit,
  type ConfigListLimit,
  type ConfigTableLimit,
  type LimitGroup,
  type LimitKind,
  type NumberBounds,
} from '../../../../game/content/limits'

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const k of path.split('.')) {
    if (!isPlain(cur)) return undefined
    cur = cur[k]
  }
  return cur
}

/** Stable JSON (key order does not matter) for equality of patch values. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (!isPlain(v)) return JSON.stringify(v) ?? 'null'
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
    .join(',')}}`
}

export const sameJson = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b)

/**
 * A copy of `obj` with `path` set to `value`; `undefined` deletes it and prunes the objects left empty.
 * Never mutates its input.
 */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.')
  const go = (node: unknown, i: number): unknown => {
    const cur = isPlain(node) ? node : {}
    const key = parts[i]!
    const next = { ...cur }
    if (i === parts.length - 1) {
      if (value === undefined) delete next[key]
      else next[key] = value
    } else {
      const child = go(cur[key], i + 1)
      if (isPlain(child) && Object.keys(child).length === 0) delete next[key]
      else next[key] = child
    }
    return next
  }
  return go(obj, 0) as T
}

// --- Base values -------------------------------------------------------------

/** Base (bundled) value of a `config.*` path, or undefined. */
export function baseConfigValue(path: string): unknown {
  return getPath(baseContext().config, path)
}

/** Value in force in the draft: the patch's override, else the base. */
export function effectiveConfigValue(patch: ContentPatch, path: string): unknown {
  const v = getPath(patch.config, path)
  return v === undefined ? baseConfigValue(path) : v
}

/** Set a config path; a value equal to the base removes the override. */
export function setConfigValue(patch: ContentPatch, path: string, value: unknown): ContentPatch {
  const base = baseConfigValue(path)
  const next = value === undefined || sameJson(value, base) ? undefined : value
  const out = setPath(patch as object, `config.${path}`, next) as ContentPatch
  return pruneEmpty(out)
}

/** Drop `config: {}` and similar empty top-level sections (the server stores whatever it is given). */
export function pruneEmpty(patch: ContentPatch): ContentPatch {
  const out: Record<string, unknown> = { ...patch }
  for (const [k, v] of Object.entries(out)) if (isPlain(v) && Object.keys(v).length === 0) delete out[k]
  return out as ContentPatch
}

export function isOverridden(patch: ContentPatch, path: string): boolean {
  const v = getPath(patch.config, path)
  return v !== undefined && !sameJson(v, baseConfigValue(path))
}

// --- Numbers -------------------------------------------------------------------

const round = (n: number, digits = 6): number => Number(n.toFixed(digits))

/** Probabilities are edited as percentages (0.01 = 1 %); everything else as is. */
export const scaleOf = (kind: LimitKind): number => (kind === 'prob' ? 100 : 1)

export function toDisplay(kind: LimitKind, value: number): number {
  return kind === 'prob' ? round(value * 100, 4) : value
}

export function fromDisplay(kind: LimitKind, shown: number): number {
  return kind === 'prob' ? round(shown / 100, 6) : shown
}

/** Bounds as the form shows them (probabilities in %). */
export function displayBounds(b: NumberBounds): { min: number; max: number; step: number } {
  return { min: toDisplay(b.kind, b.min), max: toDisplay(b.kind, b.max), step: b.kind === 'prob' ? round(b.step * 100, 4) : b.step }
}

export type NumberProblem = 'empty' | 'invalid' | 'range' | 'integer'

export type ParsedNumber = { ok: true; value: number } | { ok: false; problem: NumberProblem }

/** Parse what was typed in a field (in display units) against the bounds; `value` is back in storage units. */
export function parseNumber(text: string, b: NumberBounds): ParsedNumber {
  const raw = text.trim().replace(',', '.')
  if (raw === '') return { ok: false, problem: 'empty' }
  const shown = Number(raw)
  if (!Number.isFinite(shown)) return { ok: false, problem: 'invalid' }
  const value = fromDisplay(b.kind, shown)
  if (b.kind === 'int' && !Number.isInteger(value)) return { ok: false, problem: 'integer' }
  if (value < b.min - 1e-9 || value > b.max + 1e-9) return { ok: false, problem: 'range' }
  return { ok: true, value }
}

/** A number the way the form and the diff print it (probabilities as %, no float noise). */
export function formatNumber(kind: LimitKind, value: number, lng = 'en'): string {
  const shown = toDisplay(kind, value)
  const text = new Intl.NumberFormat(lng, { maximumFractionDigits: 4 }).format(shown)
  return kind === 'prob' ? `${text}%` : text
}

/** Relative change vs the base as a signed percentage, or null when it cannot be told (base 0 / equal). */
export function changePercent(base: number, value: number): number | null {
  if (base === 0 || base === value) return null
  return ((value - base) / Math.abs(base)) * 100
}

/** The big-change guard of validate.ts: ×3 (probabilities ×5) away from the base, or down to 0. Returns the factor that applies, else null. */
export function bigChangeFactor(kind: LimitKind, base: unknown, value: unknown): number | null {
  if (typeof base !== 'number' || typeof value !== 'number') return null
  if (base === value || base < 0 || value < 0 || base === 0) return null
  const factor = kind === 'prob' ? BIG_CHANGE_FACTOR_PROB : BIG_CHANGE_FACTOR
  if (value === 0) return factor
  return Math.max(value / base, base / value) > factor ? factor : null
}

// --- Form model (generated from limits.ts) -----------------------------------

export interface GroupModel {
  group: LimitGroup
  scalars: ConfigLimit[]
  lists: ConfigListLimit[]
  tables: ConfigTableLimit[]
}

/** The form: every limit grouped, in the order of limits.ts. Groups with nothing are left out. */
export function configGroups(): GroupModel[] {
  return LIMIT_GROUPS.map((group) => ({
    group,
    scalars: CONFIG_LIMITS.filter((l) => l.group === group),
    lists: CONFIG_LIST_LIMITS.filter((l) => l.group === group),
    tables: CONFIG_TABLE_LIMITS.filter((l) => l.group === group),
  })).filter((g) => g.scalars.length + g.lists.length + g.tables.length > 0)
}

/** Group of a dotted issue/diff path under `config.`, or null when it is not an editable config path. */
export function groupOfPath(path: string): LimitGroup | null {
  if (!path.startsWith('config.')) return null
  const p = path.slice('config.'.length)
  const hit =
    CONFIG_LIMITS.find((l) => l.path === p || p.startsWith(`${l.path}.`)) ??
    CONFIG_LIST_LIMITS.find((l) => l.path === p || p.startsWith(`${l.path}.`)) ??
    CONFIG_TABLE_LIMITS.find((l) => l.path === p || p.startsWith(`${l.path}.`))
  return hit?.group ?? null
}

/** Count of config overrides per group (a badge on each group header). */
export function overridesByGroup(patch: ContentPatch): Map<LimitGroup, number> {
  const out = new Map<LimitGroup, number>()
  const add = (g: LimitGroup) => out.set(g, (out.get(g) ?? 0) + 1)
  for (const l of CONFIG_LIMITS) if (isOverridden(patch, l.path)) add(l.group)
  for (const l of [...CONFIG_LIST_LIMITS, ...CONFIG_TABLE_LIMITS]) if (isOverridden(patch, l.path)) add(l.group)
  return out
}

// --- Section routing for «go to field» ------------------------------------------

export type EditorSection = 'params' | 'species' | 'moves' | 'advanced' | 'review' | 'preview'

/** Which editor section owns the field a validation/diff path points at. */
export function sectionOfPath(path: string): EditorSection {
  if (path.startsWith('config.')) return 'params'
  if (path.startsWith('species.')) return 'species'
  if (path.startsWith('moves.')) return 'moves'
  if (path.startsWith('techniques') || path.startsWith('abilities') || path.startsWith('missions')) return 'advanced'
  return 'review'
}

/** DOM id of a field (used by «go to field»). */
export const fieldId = (path: string): string => `ce-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`
