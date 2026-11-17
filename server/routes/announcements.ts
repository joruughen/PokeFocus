/**
 * GET /api/announcements — public (no session): the scheduled maintenance
 * windows that have not ended yet, oldest start first. Informational only: the
 * server never blocks requests during a window. Written via /api/admin.
 */
import { Hono } from 'hono'
import { and, asc, desc, eq, gt, isNotNull, lte } from 'drizzle-orm'
import { PLAYER_NOTE_WINDOW_MS, type AdminMaintenanceItem, type AnnouncementsResponse, type ContentNoteNotice, type MaintenanceNotice } from '../../src/game/protocol'
import { contentVersions, maintenanceWindows } from '../db/schema'
import type { AppEnv, Deps } from '../http'

type MaintenanceRow = typeof maintenanceWindows.$inferSelect

export const toMaintenanceNotice = (r: MaintenanceRow): MaintenanceNotice => ({
  id: r.id,
  startsAt: r.startsAt.getTime(),
  endsAt: r.endsAt.getTime(),
  note: r.note,
})

export const toMaintenanceItem = (r: MaintenanceRow): AdminMaintenanceItem => ({
  ...toMaintenanceNotice(r),
  createdAt: r.createdAt.getTime(),
})

/** Windows that have not ended yet (upcoming or running), oldest start first. */
export const activeMaintenance = (deps: Deps, now: number) =>
  deps.db
    .select()
    .from(maintenanceWindows)
    .where(gt(maintenanceWindows.endsAt, new Date(now)))
    .orderBy(asc(maintenanceWindows.startsAt), asc(maintenanceWindows.createdAt))

/**
 * The note of the latest published version that is in force (`effectiveAt <= now`) and has one, if it took
 * effect within `PLAYER_NOTE_WINDOW_MS`. A version scheduled for later is invisible until its time.
 */
export async function latestContentNote(deps: Deps, now: number): Promise<ContentNoteNotice | null> {
  const [r] = await deps.db
    .select({ id: contentVersions.id, at: contentVersions.effectiveAt, note: contentVersions.playerNote })
    .from(contentVersions)
    .where(and(eq(contentVersions.status, 'published'), isNotNull(contentVersions.playerNote), lte(contentVersions.effectiveAt, new Date(now)), gt(contentVersions.effectiveAt, new Date(now - PLAYER_NOTE_WINDOW_MS))))
    .orderBy(desc(contentVersions.effectiveAt), desc(contentVersions.id))
    .limit(1)
  return r && r.at && r.note ? { versionId: r.id, effectiveAt: r.at.getTime(), note: r.note } : null
}

export function announcementRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const now = deps.clock()
    const rows = await activeMaintenance(deps, now)
    const body: AnnouncementsResponse = { maintenance: rows.map(toMaintenanceNotice), contentNote: await latestContentNote(deps, now), serverNow: now }
    // The banner must reflect a newly scheduled (or cancelled) window right away.
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  return app
}
