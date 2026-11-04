/**
 * Locale hygiene: ES and EN have the same keys, and every literal `t('…')`
 * key used in src/ui exists (plural keys count via their `_one`/`_other`).
 * Every registered hint has a title and a body in both languages.
 */
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

type Tree = { [k: string]: string | Tree | string[] }

function flatten(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    if (Array.isArray(v)) return v.map((_, i) => `${key}.${i}`)
    return typeof v === 'string' ? [key] : flatten(v, key)
  })
}

const esKeys = new Set(flatten(es as Tree))
const enKeys = new Set(flatten(en as Tree))

function has(keys: Set<string>, key: string): boolean {
  return keys.has(key) || keys.has(`${key}_one`) || keys.has(`${key}_other`)
}

/** Source of every UI module (Vite raw import, works in vitest without Node types). */
const sources = import.meta.glob<string>(['../ui/**/*.ts', '../ui/**/*.tsx', '!../ui/**/*.test.ts'], { query: '?raw', import: 'default', eager: true })

describe('locales', () => {
  it('ES and EN define the same keys', () => {
    const onlyEs = [...esKeys].filter((k) => !enKeys.has(k))
    const onlyEn = [...enKeys].filter((k) => !esKeys.has(k))
    expect({ onlyEs, onlyEn }).toEqual({ onlyEs: [], onlyEn: [] })
  })

  it('every literal t() key used in src/ui exists', () => {
    const missing: string[] = []
    const re = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    for (const [f, src] of Object.entries(sources)) {
      for (const m of src.matchAll(re)) {
        const key = m[1]!
        if (!has(esKeys, key) || !has(enKeys, key)) missing.push(`${key} (${f})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every registered hint has copy', async () => {
    // Registry modules only call registerHints (no DOM needed).
    await import('../ui/hints/registry')
    const { allHints } = await import('../ui/hints/engine')
    const missing = allHints().flatMap((h) =>
      ['title', 'body'].filter((part) => !esKeys.has(`hints.${h.id}.${part}`) || !enKeys.has(`hints.${h.id}.${part}`)).map((p) => `${h.id}.${p}`),
    )
    expect(missing).toEqual([])
  })
})
