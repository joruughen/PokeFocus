/**
 * GET /api/announcements — public (no session): the scheduled maintenance
 * windows that have not ended yet, oldest start first. Informational only: the
 * server never blocks requests during a window. Written via /api/admin.
 */
import { Hono } from 'hono'
import { asc, gt } from 'drizzle-orm'
import type { AdminMaintenanceItem, AnnouncementsResponse, MaintenanceNotice } from '../../src/game/protocol'
import { maintenanceWindows } from '../db/schema'
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

export function announcementRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const now = deps.clock()
    const rows = await activeMaintenance(deps, now)
    const body: AnnouncementsResponse = { maintenance: rows.map(toMaintenanceNotice), serverNow: now }
    // The banner must reflect a newly scheduled (or cancelled) window right away.
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  return app
}
