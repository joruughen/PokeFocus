/**
 * Pure merge logic used by `scripts/build-data.ts` (kept free of I/O so it can be unit tested).
 *
 * Rules:
 *  - `data/overrides/<name>.json` is merged into `data/generated/<name>.json`.
 *  - Where the generated data is an array of records with a `slug` (species, moves, abilities,
 *    natures, items, and the `types` array of types.json), the override is an object keyed by slug:
 *    `{ "pikachu": { "baseStats": { "speed": 100 } } }`.
 *  - Objects are deep-merged field by field; the override wins. Arrays, strings, numbers and
 *    `null` in an override replace the generated value.
 *  - An override slug that does not exist in the generated data is an ERROR.
 *  - Every `_note` field in an override is a human comment and is stripped from the output.
 *  - `custom-*.json` override files are not merged: they pass through unchanged.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export const NOTE_KEY = '_note'
export const CUSTOM_PREFIX = 'custom-'

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for a non-empty array whose elements are all objects with a string `slug`. */
export function isSlugRecordArray(value: unknown): value is JsonObject[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isPlainObject(item) && typeof item.slug === 'string')
  )
}

export function isCustomFile(fileName: string): boolean {
  return fileName.startsWith(CUSTOM_PREFIX)
}

/** Deep copy of `value` without any `_note` keys. */
export function stripNotes(value: Json): Json {
  if (Array.isArray(value)) return value.map(stripNotes)
  if (isPlainObject(value)) {
    const out: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
      if (key !== NOTE_KEY) out[key] = stripNotes(child)
    }
    return out
  }
  return value
}

/** Deep-merge `override` onto `base`. Override wins; arrays and scalars are replaced. Inputs are not mutated. */
export function deepMerge(base: Json, override: Json): Json {
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: JsonObject = { ...base }
    for (const [key, value] of Object.entries(override)) {
      if (key === NOTE_KEY) continue
      const existing = base[key]
      out[key] = existing === undefined ? stripNotes(value) : deepMerge(existing, value)
    }
    return out
  }
  return stripNotes(override)
}

/** Merge an object keyed by slug into an array of slug records. Unknown slugs are reported in `errors`. */
export function mergeRecords(
  records: JsonObject[],
  overrides: Json,
  where: string,
  errors: string[],
): JsonObject[] {
  if (!isPlainObject(overrides)) {
    errors.push(`${where}: override must be an object keyed by slug`)
    return records
  }
  const known = new Set(records.map((record) => record.slug as string))
  for (const slug of Object.keys(overrides)) {
    if (slug === NOTE_KEY) continue
    if (!known.has(slug)) errors.push(`${where}: override "${slug}" does not exist in generated data`)
    else if (!isPlainObject(overrides[slug])) errors.push(`${where}: override "${slug}" must be an object`)
  }
  return records.map((record) => {
    const patch = overrides[record.slug as string]
    return patch !== undefined && isPlainObject(patch) ? (deepMerge(record, patch) as JsonObject) : record
  })
}

/** Merge one override file into one generated file. */
export function mergeFile(fileName: string, generated: Json, override: Json, errors: string[]): Json {
  if (isSlugRecordArray(generated)) return mergeRecords(generated, override, fileName, errors)
  if (isPlainObject(generated)) {
    if (!isPlainObject(override)) {
      errors.push(`${fileName}: override must be an object`)
      return generated
    }
    const out: JsonObject = { ...generated }
    for (const [key, value] of Object.entries(override)) {
      if (key === NOTE_KEY) continue
      const existing = generated[key]
      if (existing === undefined) out[key] = stripNotes(value)
      else if (isSlugRecordArray(existing)) out[key] = mergeRecords(existing, value, `${fileName}#${key}`, errors)
      else out[key] = deepMerge(existing, value)
    }
    return out
  }
  errors.push(`${fileName}: generated data cannot be merged (expected an array of records or an object)`)
  return generated
}

export interface MergeResult {
  /** File name -> merged content, for every generated file and every custom-*.json file. */
  output: Record<string, Json>
  /** Human-readable problems. If non-empty, the caller must not write anything. */
  errors: string[]
}

/**
 * @param generated contents of `data/generated/*.json`, keyed by file name
 * @param overrides contents of `data/overrides/*.json`, keyed by file name
 */
export function mergeGameData(
  generated: Record<string, Json>,
  overrides: Record<string, Json>,
): MergeResult {
  const errors: string[] = []
  const output: Record<string, Json> = {}

  for (const [fileName, data] of Object.entries(generated)) {
    const override = overrides[fileName]
    output[fileName] = override === undefined ? data : mergeFile(fileName, data, override, errors)
  }

  for (const [fileName, override] of Object.entries(overrides)) {
    if (isCustomFile(fileName)) output[fileName] = override
    else if (!(fileName in generated)) {
      errors.push(
        `${fileName}: no generated counterpart (name it custom-*.json to add your own content)`,
      )
    }
  }

  return { output, errors }
}
