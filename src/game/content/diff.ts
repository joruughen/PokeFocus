/**
 * Patch diff (docs/admin-plan.md §4): which paths of a draft differ from the
 * active patch, with before/after. Pure; shared with the admin client.
 *
 * A patch is a full override of the base, so "absent" means "the base value":
 * `before` / `after` fall back to the base value when it is known (config
 * paths, species `captureRate`, move `power`/`accuracy`), else null.
 */
import { baseContext } from '../../engine/context'
import type { AdminContentDiffEntry } from '../protocol'

/** Techniques and abilities are replaced whole by slug: one entry per slug, not per field. */
const UNIT_PATH = /^(techniques|abilities)\.[^.]+$/

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function flatten(v: unknown, path: string, out: Map<string, unknown>): void {
  if (path !== '' && (!isPlain(v) || UNIT_PATH.test(path))) {
    out.set(path, v)
    return
  }
  if (!isPlain(v)) return
  for (const [k, child] of Object.entries(v)) if (child !== undefined) flatten(child, path === '' ? k : `${path}.${k}`, out)
}

/** Leaf paths of a patch (arrays and unit definitions are leaves). */
export function flattenPatch(patch: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>()
  flatten(patch, '', out)
  return out
}

function baseValue(path: string): unknown {
  const base = baseContext()
  const parts = path.split('.')
  if (parts[0] === 'config') {
    let cur: unknown = base.config
    for (const k of parts.slice(1)) {
      if (!isPlain(cur)) return null
      cur = cur[k]
    }
    return cur === undefined ? null : cur
  }
  if (parts.length === 3 && parts[0] === 'species' && parts[2] === 'captureRate') return base.speciesBySlug.get(parts[1]!)?.captureRate ?? null
  if (parts.length === 3 && parts[0] === 'moves' && (parts[2] === 'power' || parts[2] === 'accuracy')) {
    const m = base.movesBySlug.get(parts[1]!)
    return m ? (m[parts[2]] ?? null) : null
  }
  return null
}

/** Stable JSON for equality (key order does not matter). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (!isPlain(v)) return JSON.stringify(v) ?? 'null'
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
    .join(',')}}`
}

/** Paths whose value differs between `active` and `next`, sorted by path. */
export function diffPatches(active: unknown, next: unknown): AdminContentDiffEntry[] {
  const a = flattenPatch(active)
  const b = flattenPatch(next)
  const out: AdminContentDiffEntry[] = []
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const inA = a.has(path)
    const inB = b.has(path)
    if (inA && inB) {
      if (stable(a.get(path)) !== stable(b.get(path))) out.push({ path, kind: 'changed', before: a.get(path), after: b.get(path) })
    } else if (inB) out.push({ path, kind: 'added', before: baseValue(path), after: b.get(path) })
    else out.push({ path, kind: 'removed', before: a.get(path), after: baseValue(path) })
  }
  return out
}
