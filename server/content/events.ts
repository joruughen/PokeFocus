/**
 * Live events in the content resolution (docs/admin-plan.md §1, §2): the rows of
 * `live_events` become `EventOverlay`s for the ContentService. Only `published` rows
 * are live; `archived` ones are returned as `retired` (never active, items still named).
 * Drafts never leave the table.
 */
import { inArray } from 'drizzle-orm'
import type { EventOverlay } from '../../src/engine/content'
import type { Db, Tx } from '../db/client'
import { liveEvents, type uploads } from '../db/schema'
import type { LiveEventImage } from '../../src/game/protocol'
import { mediaUrl } from '../uploads'
import type { EventSource, PublishedEvent } from './service'

type Row = typeof liveEvents.$inferSelect

/** The full overlay of a row: id, slug and dates come from the columns, the rest from `overlay`. */
export function overlayOf(row: Pick<Row, 'id' | 'slug' | 'startsAt' | 'endsAt' | 'overlay'>): EventOverlay {
  return { ...row.overlay, id: row.id, slug: row.slug, startsAt: row.startsAt.getTime(), endsAt: row.endsAt.getTime() }
}

/** `EventSource` of the ContentService: reads through the executor it is given (the caller's transaction when inside one). */
export const loadLiveEvents: EventSource = async (ex: Db | Tx): Promise<PublishedEvent[]> => {
  const rows = await ex.select().from(liveEvents).where(inArray(liveEvents.status, ['published', 'archived']))
  return rows.map((r) => ({ overlay: overlayOf(r), revision: r.revision, ...(r.status === 'archived' && { retired: true }) }))
}

/** The image of an event as pages reference it (null when it has none). */
export function imageOf(up: Pick<typeof uploads.$inferSelect, 'sha256' | 'width' | 'height'> | null | undefined): LiveEventImage | null {
  return up ? { url: mediaUrl(up.sha256), thumbUrl: mediaUrl(up.sha256, true), width: up.width, height: up.height } : null
}
