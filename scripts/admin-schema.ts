/**
 * Regenerate the admin import JSON Schemas (`docs/admin-json/*.schema.json`) and the table of ranges inside
 * `docs/admin-json.md` from the zod schemas and `limits.ts`. A test fails when they are stale.
 *   npm run admin:schema
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ADMIN_SCHEMA_FILES, adminJsonSchemas, adminSchemaText } from '../src/game/content'
import { withLimitsBlock } from './lib/adminDocs'

const dir = new URL('../docs/admin-json/', import.meta.url)
mkdirSync(dir, { recursive: true })
const schemas = adminJsonSchemas()
for (const file of ADMIN_SCHEMA_FILES) {
  writeFileSync(new URL(file, dir), adminSchemaText(schemas[file]))
  console.log(`docs/admin-json/${file}`)
}
const docUrl = new URL('../docs/admin-json.md', import.meta.url)
try {
  writeFileSync(docUrl, withLimitsBlock(readFileSync(docUrl, 'utf8')))
  console.log('docs/admin-json.md (rangos)')
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
}
