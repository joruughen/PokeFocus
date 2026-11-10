/**
 * Hash of the shipped game data (`src/data/game/*.json`), written by `npm run build:data`
 * to `src/data/game/meta.json` as `{ baseHash }` (docs/admin-plan.md §1, layer 1).
 * The server prefixes live content hashes with it, and a client whose bundle has
 * another baseHash knows it is stale. Hashing lives here (Node), never in the engine.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const META_FILE = 'meta.json'

/** JSON with object keys sorted recursively and no whitespace (undefined fields dropped, as JSON.stringify does). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) out[k] = (v as Record<string, unknown>)[k]
    return out
  })
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** sha256 of the canonical JSON of `{ [fileName]: content }`. */
export function computeBaseHash(files: Record<string, unknown>): string {
  return sha256(canonicalJson(files))
}

/** Reads every game data file in `dir` (all `*.json` but meta.json), keyed by file name. */
export async function readGameDataFiles(dir: string): Promise<Record<string, unknown>> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && n !== META_FILE).sort()
  const out: Record<string, unknown> = {}
  for (const name of names) out[name] = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
  return out
}

export async function baseHashOfDir(dir: string): Promise<string> {
  return computeBaseHash(await readGameDataFiles(dir))
}
