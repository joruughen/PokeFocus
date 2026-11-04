/**
 * Merges `data/generated/*.json` with `data/overrides/*.json` and writes the result to
 * `src/data/game/*.json`, which is what the app imports.
 *
 *   npm run build:data
 *
 * See `scripts/lib/merge.ts` for the merge rules. Nothing is written if any override is invalid.
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCustomFile, mergeGameData, type Json } from './lib/merge.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENERATED_DIR = path.join(ROOT, 'data', 'generated')
const OVERRIDES_DIR = path.join(ROOT, 'data', 'overrides')
const OUT_DIR = path.join(ROOT, 'src', 'data', 'game')

async function jsonFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function readJsonDir(dir: string, errors: string[]): Promise<Record<string, Json>> {
  const out: Record<string, Json> = {}
  for (const name of await jsonFiles(dir)) {
    try {
      out[name] = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Json
    } catch (err) {
      errors.push(`${path.relative(ROOT, path.join(dir, name))}: invalid JSON (${(err as Error).message})`)
    }
  }
  return out
}

async function main(): Promise<void> {
  const errors: string[] = []
  const generated = await readJsonDir(GENERATED_DIR, errors)
  const overrides = await readJsonDir(OVERRIDES_DIR, errors)

  if (Object.keys(generated).length === 0 && errors.length === 0) {
    errors.push('data/generated/ has no JSON files; run `npm run import:pokeapi` first')
  }

  const result = mergeGameData(generated, overrides)
  errors.push(...result.errors)

  if (errors.length > 0) {
    console.error(`build-data failed with ${errors.length} error(s):`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })
  for (const [name, data] of Object.entries(result.output)) {
    const target = path.join(OUT_DIR, name)
    if (isCustomFile(name)) await copyFile(path.join(OVERRIDES_DIR, name), target) // copied as-is
    else if (!(name in overrides)) await copyFile(path.join(GENERATED_DIR, name), target) // nothing to merge
    else await writeFile(target, JSON.stringify(data, null, 2) + '\n')
  }

  const merged = Object.keys(result.output).filter((n) => n in overrides && !isCustomFile(n))
  const custom = Object.keys(result.output).filter(isCustomFile)
  console.log(`Wrote ${Object.keys(result.output).length} file(s) to src/data/game/`)
  console.log(`  merged with overrides: ${merged.length ? merged.join(', ') : 'none'}`)
  console.log(`  custom (copied as-is): ${custom.length ? custom.join(', ') : 'none'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
