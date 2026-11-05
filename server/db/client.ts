/**
 * Database connection: PostgreSQL (postgres-js) when DATABASE_URL is set,
 * embedded PGlite otherwise (dev, tests). Same Drizzle schema for both;
 * migrations in ./migrations are applied on startup.
 */
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

export type Schema = typeof schema
export type Db = PgDatabase<PgQueryResultHKT, Schema>
/** A transaction handle (same query API as `Db`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface Database {
  db: Db
  driver: 'pglite' | 'postgres'
  close(): Promise<void>
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url))

export interface DbOptions {
  databaseUrl?: string
  /** PGlite directory, or `memory://` (tests). */
  pgliteDir?: string
}

export async function openDatabase(opts: DbOptions): Promise<Database> {
  if (opts.databaseUrl) {
    const { default: postgres } = await import('postgres')
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const { migrate } = await import('drizzle-orm/postgres-js/migrator')
    const client = postgres(opts.databaseUrl, { max: 10, onnotice: () => {} })
    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    return { db: db as unknown as Db, driver: 'postgres', close: () => client.end({ timeout: 5 }) }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  const dir = opts.pgliteDir ?? 'memory://'
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true })
  const client = await PGlite.create(dir)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { db: db as unknown as Db, driver: 'pglite', close: () => client.close() }
}

/** Postgres unique_violation (23505), whatever the driver wrapped it in. */
export function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 5; i++) {
    if (typeof cur === 'object' && (cur as { code?: unknown }).code === '23505') return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}
