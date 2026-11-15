/**
 * Validate an admin import JSON with the server's own validation (no server, no database).
 *   npm run admin:validate -- <archivo.json> [--no-smoke]
 *   npm run admin:validate -- --list <species|items|moves|techniques|abilities|types|mission-kinds|config>
 * Exit code: 0 valid, 1 errors, 2 usage or unreadable file. Format: docs/admin-json.md.
 */
import { readFileSync } from 'node:fs'
import { LIST_KINDS, listLines, validateText, type ListKind } from './lib/adminValidate'

const args = process.argv.slice(2)
const usage = `uso: npm run admin:validate -- <archivo.json> [--no-smoke]
     npm run admin:validate -- --list <${LIST_KINDS.join('|')}>`

const listAt = args.indexOf('--list')
if (listAt >= 0) {
  const kind = args[listAt + 1]
  if (!kind || !(LIST_KINDS as readonly string[]).includes(kind)) {
    console.error(usage)
    process.exit(2)
  }
  console.log(listLines(kind as ListKind).join('\n'))
  process.exit(0)
}

const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error(usage)
  process.exit(2)
}
let text: string
try {
  text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8')
} catch {
  console.error(`No se puede leer el archivo «${file}».`)
  process.exit(2)
}

const report = validateText(text, { smoke: !args.includes('--no-smoke') })
for (const line of report.lines) (report.code === 0 ? console.log : console.error)(line)
process.exit(report.code)
