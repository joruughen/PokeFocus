/**
 * Set the role of an account (player | support | admin).
 *   npm run admin:role -- <email> <role>
 * Uses the same database as the server (DATABASE_URL, or PGLITE_DIR; reads `.env`).
 * The embedded PGlite directory cannot be opened by two processes: stop the server
 * first, or use ADMIN_EMAILS. The change is written to the audit log as actor 'cli'.
 */
import { existsSync } from 'node:fs'
import { openDatabase } from '../server/db/client'
import { setRoleByEmail, USER_ROLES } from '../server/admin/roles'
import { loadEnv } from '../server/env'
import type { UserRole } from '../src/game/protocol'

if (existsSync('.env')) process.loadEnvFile('.env')

const [email, role] = process.argv.slice(2)
if (!email || !role || !(USER_ROLES as readonly string[]).includes(role)) {
  console.error(`usage: npm run admin:role -- <email> <${USER_ROLES.join('|')}>`)
  process.exit(2)
}

const env = loadEnv()
const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir })
let code = 0
try {
  const r = await setRoleByEmail(database.db, email, role as UserRole, 'cli')
  if (!r.ok) {
    console.error(`no account with email ${email}`)
    code = 1
  } else if (r.changed) console.log(`${email}: ${r.before} -> ${role}`)
  else console.log(`${email}: already ${role}`)
} finally {
  await database.close()
}
process.exit(code)
