/**
 * GET /api/live-events — public (docs/admin-plan.md §4): the live events players can see.
 *
 *   → { active[], upcoming[], past[], nextCursor, serverNow }
 *
 * `active`: `startsAt <= now < endsAt`. `upcoming`: starting within 60 days. `past`: ended within the
 * last 90 days, most recent first, 20 per page (`?before=<endsAt ms>` of the last one gives the next
 * page; `nextCursor` is null on the last page). Only `published` events: drafts and archived events are
 * never returned, and nothing but the public fields is (no authors, no validation). Game time: the
 * server clock (x-dev-now with DEV_TOOLS). `Cache-Control: no-cache`: clients refetch on the SSE
 * `content` event, which fires when an event starts or ends.
 */
import { Hono } from 'hono'
import { and, asc, desc, eq, gt, lt, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { LiveEventPublic, LiveEventsResponse } from '../../src/game/protocol'
import { imageOf } from '../content/events'
import { liveEvents, uploads } from '../db/schema'
import { ApiError, gameTime, type AppEnv, type Deps } from '../http'

export const UPCOMING_DAYS = 60
export const PAST_DAYS = 90
export const PAST_PAGE = 20
const DAY = 86_400_000

const query = z.object({ before: z.coerce.number().int().min(0).max(8_640_000_000_000_000).optional() })

type Row = { ev: typeof liveEvents.$inferSelect; up: typeof uploads.$inferSelect | null }

export function toLiveEventPublic(r: typeof liveEvents.$inferSelect, up: typeof uploads.$inferSelect | null): LiveEventPublic {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    image: imageOf(up),
    startsAt: r.startsAt.getTime(),
    endsAt: r.endsAt.getTime(),
    announceRev: r.announceRev,
    featured: r.overlay.featured,
    ...(r.overlay.shiny && { shiny: r.overlay.shiny }),
    ...(r.overlay.legendaryChanceMult !== undefined && { legendaryChanceMult: r.overlay.legendaryChanceMult }),
    drops: r.overlay.drops,
    missions: r.overlay.missions,
    ...(r.overlay.items && { items: r.overlay.items }),
  }
}

export function liveEventRoutes(deps: Deps) {
  const { db } = deps
  const app = new Hono<AppEnv>()
  const pub = (r: Row) => toLiveEventPublic(r.ev, r.up)

  app.get('/', async (c) => {
    const q = query.safeParse(c.req.query())
    if (!q.success) throw new ApiError(400, 'invalid_query')
    const now = gameTime(deps, c)
    const at = new Date(now)
    const from = () => db.select({ ev: liveEvents, up: uploads }).from(liveEvents).leftJoin(uploads, eq(uploads.id, liveEvents.imageId))
    const coming = await from()
      .where(and(eq(liveEvents.status, 'published'), gt(liveEvents.endsAt, at), lte(liveEvents.startsAt, new Date(now + UPCOMING_DAYS * DAY))))
      .orderBy(asc(liveEvents.startsAt), asc(liveEvents.id))
    const pastRows = await from()
      .where(
        and(
          eq(liveEvents.status, 'published'),
          lte(liveEvents.endsAt, at),
          gt(liveEvents.endsAt, new Date(now - PAST_DAYS * DAY)),
          q.data.before !== undefined ? lt(liveEvents.endsAt, new Date(q.data.before)) : undefined,
        ),
      )
      .orderBy(desc(liveEvents.endsAt), desc(liveEvents.id))
      .limit(PAST_PAGE + 1)
    const page = pastRows.slice(0, PAST_PAGE)
    const body: LiveEventsResponse = {
      active: coming.filter((r) => r.ev.startsAt <= at).map(pub),
      upcoming: coming.filter((r) => r.ev.startsAt > at).map(pub),
      past: page.map(pub),
      nextCursor: pastRows.length > PAST_PAGE ? page[page.length - 1]!.ev.endsAt.getTime() : null,
      serverNow: now,
    }
    c.header('Cache-Control', 'no-cache')
    return c.json(body)
  })

  return app
}
