/**
 * Import-graph guard: the engine (non-test modules under src/engine) must have
 * no RUNTIME import cycle.
 *
 * A cycle that only works because every cross-module value is used inside
 * functions, never at module load, is a trap: one module-level use (a `const`
 * built from an import, a `class extends`) breaks it depending on which module
 * is imported first. Type-only imports/exports are erased and do not count.
 *
 * The graph is built by statically parsing import / export-from statements
 * (Vite `?raw` glob, same trick as src/i18n/locales.test.ts). What counts:
 *  - `import type …` / `export type …` are erased, so they are ignored;
 *  - `import { type X, y }` still imports `y` at runtime, so it counts;
 *  - `import { type X }` (every specifier marked `type`) is NOT erased under
 *    `verbatimModuleSyntax` (it stays as `import {} from`), so it counts too:
 *    write `import type { X }` instead;
 *  - side-effect imports (`import './x'`) count; dynamic `import()` does not
 *    (it is lazy, evaluated after load).
 * If this test fails, move the shared constants/types the lower module needs
 * into a dependency-free leaf module (see mission-kinds.ts) and import them
 * from there.
 */
// tsconfig.server.json (which also type-checks src/engine) has no vite/client types.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'

/** Source of every non-test engine module, keyed `./name.ts`. */
const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts', '!./test-helpers.ts'], { query: '?raw', import: 'default', eager: true })

type Graph = Map<string, string[]>

const ROOT = 'file:///src/engine/'

const CLAUSE = String.raw`(\*(?:\s+as\s+[\w$]+)?|[\w$]+\s*,\s*\{[^}]*\}|[\w$]+\s*,\s*\*\s+as\s+[\w$]+|[\w$]+|\{[^}]*\})`
/** `import|export [type] <clause> from '<spec>'` (multi-line clauses included). */
const FROM_RE = new RegExp(String.raw`^[ \t]*(import|export)\s+(type\s+)?${CLAUSE}\s*from\s*['"]([^'"]+)['"]`, 'gm')
/** `import './x'` */
const SIDE_EFFECT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** Raw relative specifiers a module loads at runtime (type-only ones dropped). */
function runtimeSpecifiers(source: string): string[] {
  const src = stripComments(source)
  const specs: string[] = []
  for (const m of src.matchAll(FROM_RE)) {
    const [, , typeKeyword, , spec] = m
    if (typeKeyword) continue // import type … / export type …
    if (spec && spec.startsWith('.')) specs.push(spec)
  }
  for (const m of src.matchAll(SIDE_EFFECT_RE)) {
    const spec = m[1]
    if (spec && spec.startsWith('.')) specs.push(spec)
  }
  return specs
}

/** Graph of module -> modules it loads at runtime. Keys are `./name.ts`, like the glob. */
function buildGraph(files: Record<string, string>): Graph {
  const keyOf = (path: string) => `./${path.slice(ROOT.length)}`
  const known = new Set(Object.keys(files))
  const graph: Graph = new Map()
  for (const [file, source] of Object.entries(files)) {
    const deps = new Set<string>()
    for (const spec of runtimeSpecifiers(source)) {
      const base = new URL(spec, new URL(file.slice(2), ROOT)).href
      if (!base.startsWith(ROOT)) continue // leaves src/engine (data, json…)
      const bare = keyOf(base.replace(/\.ts$/, ''))
      const target = [`${bare}.ts`, `${bare}/index.ts`].find((k) => known.has(k))
      if (target) deps.add(target)
    }
    graph.set(file, [...deps])
  }
  return graph
}

/** First cycle found (as a closed path `a -> b -> a`), or null. */
function findCycle(graph: Graph): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (node: string): string[] | null => {
    state.set(node, 'visiting')
    stack.push(node)
    for (const dep of graph.get(node) ?? []) {
      if (state.get(dep) === 'visiting') return [...stack.slice(stack.indexOf(dep)), dep]
      if (!state.has(dep)) {
        const cycle = visit(dep)
        if (cycle) return cycle
      }
    }
    stack.pop()
    state.set(node, 'done')
    return null
  }
  for (const node of [...graph.keys()].sort()) {
    if (!state.has(node)) {
      const cycle = visit(node)
      if (cycle) return cycle
    }
  }
  return null
}

const fmt = (cycle: string[] | null) => (cycle ? cycle.map((f) => f.replace(/^\.\//, '')).join(' -> ') : 'none')

describe('engine import graph', () => {
  it('sees the real engine modules (the glob is not vacuous)', () => {
    const graph = buildGraph(sources)
    for (const f of ['./context.ts', './missions.ts', './individual.ts', './session.ts', './index.ts']) {
      expect(graph.has(f), `${f} missing from the glob`).toBe(true)
    }
    expect([...graph.values()].flat().length).toBeGreaterThan(50)
    expect(graph.has('./test-helpers.ts')).toBe(false)
    expect([...graph.keys()].some((f) => f.endsWith('.test.ts'))).toBe(false)
  })

  it('has no runtime import cycle', () => {
    const cycle = findCycle(buildGraph(sources))
    expect(cycle, `runtime import cycle: ${fmt(cycle)}`).toBeNull()
  })
})

describe('cycle detector', () => {
  // The import lines context.ts / missions.ts / individual.ts had before MISSION_KINDS moved to mission-kinds.ts.
  const OLD = {
    './context.ts': `import { buildConfig, type GameConfig } from './config'\nimport { MISSION_KINDS, type MissionsContent } from './missions'\n`,
    './missions.ts': `import { defaultContext, type EngineContext } from './context'\nimport { isLegendarySpecies } from './individual'\n`,
    './individual.ts': `import { defaultContext, getSpecies, type EngineContext } from './context'\n`,
    './config.ts': `import type { StatKey } from './data-types'\n`,
  }

  it('FAILS on the old context -> missions -> individual -> context graph', () => {
    const cycle = findCycle(buildGraph(OLD))
    expect(cycle).not.toBeNull()
    expect(fmt(cycle)).toBe('context.ts -> missions.ts -> context.ts')
    // and without the direct missions -> context edge it is still found through individual.ts
    const viaIndividual = findCycle(buildGraph({ ...OLD, './missions.ts': `import { isLegendarySpecies } from './individual'\n` }))
    expect(fmt(viaIndividual)).toBe('context.ts -> missions.ts -> individual.ts -> context.ts')
  })

  it('passes on the fixed shape (leaf module + type-only import)', () => {
    const fixed = {
      ...OLD,
      './context.ts': `import { MISSION_KINDS } from './mission-kinds'\nimport type { MissionsContent } from './missions'\n`,
      './mission-kinds.ts': `export const MISSION_KINDS = ['a'] as const\n`,
      './missions.ts': `${OLD['./missions.ts']}export { MISSION_KINDS, type MissionKind } from './mission-kinds'\n`,
    }
    expect(findCycle(buildGraph(fixed))).toBeNull()
  })

  it('ignores type-only imports/exports but counts value specifiers next to `type` ones', () => {
    const a = (src: string) => buildGraph({ './a.ts': src, './b.ts': `import { y } from './a'\n` }).get('./a.ts')
    expect(a(`import type { X } from './b'`)).toEqual([])
    expect(a(`import type X from './b'`)).toEqual([])
    expect(a(`export type { X } from './b'`)).toEqual([])
    expect(a(`export type * from './b'`)).toEqual([])
    expect(a(`// import { x } from './b'\n/* import { x } from './b' */`)).toEqual([])
    expect(a(`import { type X, y } from './b'`)).toEqual(['./b.ts'])
    expect(a(`import { type X } from './b'`)).toEqual(['./b.ts']) // kept as `import {} from` by verbatimModuleSyntax
    expect(a(`import X from './b'`)).toEqual(['./b.ts'])
    expect(a(`import * as ns from './b'`)).toEqual(['./b.ts'])
    expect(a(`import X, { y } from './b'`)).toEqual(['./b.ts'])
    expect(a(`export * from './b'`)).toEqual(['./b.ts'])
    expect(a(`export * as ns from './b'`)).toEqual(['./b.ts'])
    expect(a(`export { y, type Y } from './b'`)).toEqual(['./b.ts'])
    expect(a(`import './b'`)).toEqual(['./b.ts'])
    expect(a(`import {\n  type X,\n  y,\n} from './b'`)).toEqual(['./b.ts'])
    expect(a(`import { z } from '../data/index'\nimport j from './missing.json'`)).toEqual([])
  })

  it('detects a plain A -> B -> C -> A loop and reports a self-import', () => {
    const loop = { './a.ts': `import { b } from './b'`, './b.ts': `import { c } from './c'`, './c.ts': `import { a } from './a'` }
    expect(fmt(findCycle(buildGraph(loop)))).toBe('a.ts -> b.ts -> c.ts -> a.ts')
    expect(fmt(findCycle(buildGraph({ './a.ts': `import { a } from './a'` })))).toBe('a.ts -> a.ts')
  })
})
