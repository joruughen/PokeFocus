/**
 * Content versions tied to a live event (docs/server.md «Contenido atado a un evento»).
 *
 * - `start` version: takes effect when the event starts (`effectiveAt = max(startsAt, now)`) and follows its dates while it is scheduled.
 * - `end` version (optional): a copy of what was in force just before the start, scheduled at the event's end.
 *
 * Only a PUBLISHED version carries the link. Cancelling one (archiving the event before it starts, or the admin's unschedule)
 * sends it back to a draft and clears the link. Every helper takes the caller's transaction (PGlite has one connection) and writes
 * the audit row of what it changes.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { ContentPatch } from '../../src/engine/content'
import type { AdminEventLinkedContent, AdminLinkedEvent } from '../../src/game/protocol'
import { audit, type AuditActor } from '../admin/audit'
import type { Db, Tx } from '../db/client'
import { contentVersions, liveEvents } from '../db/schema'
import { patchHash } from './service'

type Reader = Pick<Db, 'select'>
type VersionRow = typeof contentVersions.$inferSelect
type EventRow = typeof liveEvents.$inferSelect

export const linkedEventOf = (e: EventRow): AdminLinkedEvent => ({
  id: e.id,
  slug: e.slug,
  name: e.name,
  status: e.status,
  startsAt: e.startsAt.getTime(),
  endsAt: e.endsAt.getTime(),
})

/** The events some versions are tied to, by id. */
export async function linkedEvents(ex: Reader, rows: Pick<VersionRow, 'linkedEventId'>[]): Promise<Map<string, AdminLinkedEvent>> {
  const ids = [...new Set(rows.map((r) => r.linkedEventId).filter((x): x is string => !!x))]
  const out = new Map<string, AdminLinkedEvent>()
  if (ids.length === 0) return out
  for (const e of await ex.select().from(liveEvents).where(inArray(liveEvents.id, ids))) out.set(e.id, linkedEventOf(e))
  return out
}

/** When a `start` version of an event takes effect: its start, or now when the event is already running. */
export const startEffectiveAt = (startsAtMs: number, now: number): number => Math.max(startsAtMs, now)

/**
 * The patch in force at `at` without counting what is tied to `eventId` (the content a `end` version restores):
 * the latest published version with `effectiveAt <= at`, or the base (`{}`, no parent) when there is none.
 */
export async function contentBeforeEvent(ex: Reader, eventId: string, at: number): Promise<{ id: number | null; patch: ContentPatch }> {
  const [row] = await ex
    .select({ id: contentVersions.id, patch: contentVersions.patch })
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.status, 'published'),
        lte(contentVersions.effectiveAt, new Date(at)),
        or(isNull(contentVersions.linkedEventId), ne(contentVersions.linkedEventId, eventId)),
      ),
    )
    .orderBy(desc(contentVersions.effectiveAt), desc(contentVersions.id))
    .limit(1)
  return row ? { id: row.id, patch: row.patch } : { id: null, patch: {} }
}

/**
 * Which scheduled `end` versions have an out-of-date copy: another published version (not tied to the same event) takes effect
 * between the event's start and the end version's time, or the content in force before the start is no longer the copied one.
 * The end version still fires; this is only the warning the admin sees.
 */
export async function staleReverts(ex: Reader, rows: VersionRow[], now: number): Promise<Set<number>> {
  const out = new Set<number>()
  for (const r of rows) {
    if (r.linkedRole !== 'end' || !r.linkedEventId || r.status !== 'published' || !r.effectiveAt || r.effectiveAt.getTime() <= now) continue
    const eventId = r.linkedEventId
    const [first] = await ex
      .select({ at: sql<Date | null>`min(${contentVersions.effectiveAt})` })
      .from(contentVersions)
      .where(and(eq(contentVersions.status, 'published'), eq(contentVersions.linkedEventId, eventId), eq(contentVersions.linkedRole, 'start')))
    let startAt = first?.at ? new Date(first.at).getTime() : null
    if (startAt === null) {
      const [ev] = await ex.select({ startsAt: liveEvents.startsAt }).from(liveEvents).where(eq(liveEvents.id, eventId))
      startAt = ev?.startsAt.getTime() ?? now
    }
    const others = and(eq(contentVersions.status, 'published'), or(isNull(contentVersions.linkedEventId), ne(contentVersions.linkedEventId, eventId)))
    const [inside] = await ex
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .where(and(others, gt(contentVersions.effectiveAt, new Date(startAt)), lte(contentVersions.effectiveAt, r.effectiveAt)))
      .limit(1)
    if (inside) {
      out.add(r.id)
      continue
    }
    const before = await contentBeforeEvent(ex, eventId, startAt)
    if (patchHash(before.patch) !== (r.hash ?? patchHash(r.patch))) out.add(r.id)
  }
  return out
}

/** The versions tied to an event for its editor. */
export async function linkedContentOf(ex: Reader, eventId: string, activeVersionId: number | null, now: number): Promise<AdminEventLinkedContent[]> {
  const rows = await ex.select().from(contentVersions).where(and(eq(contentVersions.linkedEventId, eventId), eq(contentVersions.status, 'published'))).orderBy(asc(contentVersions.effectiveAt), asc(contentVersions.id))
  const stale = await staleReverts(ex, rows, now)
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    role: r.linkedRole ?? 'start',
    effectiveAt: r.effectiveAt!.getTime(),
    active: r.id === activeVersionId,
    scheduled: r.effectiveAt!.getTime() > now,
    revertStale: stale.has(r.id),
  }))
}

/** Scheduled versions (not in force yet) tied to the event, locked. */
const scheduledOf = (tx: Tx, eventId: string, now: number) =>
  tx
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.linkedEventId, eventId), eq(contentVersions.status, 'published'), gt(contentVersions.effectiveAt, new Date(now))))
    .orderBy(asc(contentVersions.id))
    .for('update')

/**
 * The event's dates changed: its scheduled versions follow (`start` → the new start, now if it already started; `end` → the new end).
 * Returns the ids that moved. Versions already in force are not touched.
 */
export async function moveLinked(tx: Tx, c: AuditActor, ev: EventRow, now: number): Promise<number[]> {
  const moved: number[] = []
  for (const v of await scheduledOf(tx, ev.id, now)) {
    const target = v.linkedRole === 'end' ? ev.endsAt.getTime() : startEffectiveAt(ev.startsAt.getTime(), now)
    if (target === v.effectiveAt!.getTime()) continue
    await tx.update(contentVersions).set({ effectiveAt: new Date(target) }).where(eq(contentVersions.id, v.id))
    await audit(tx, c, {
      action: 'content.reschedule',
      targetType: 'content_version',
      targetId: String(v.id),
      before: { effectiveAt: v.effectiveAt!.getTime() },
      after: { effectiveAt: target, eventId: ev.id, eventSlug: ev.slug, role: v.linkedRole },
      note: 'event dates changed',
    })
    moved.push(v.id)
  }
  return moved
}

/** Send one scheduled version back to a draft, clearing its event link. */
export async function toDraft(tx: Tx, c: AuditActor, v: VersionRow, note?: string): Promise<void> {
  await tx
    .update(contentVersions)
    .set({ status: 'draft', effectiveAt: null, publishedBy: null, publishedAt: null, linkedEventId: null, linkedRole: null, revertOfVersionId: null })
    .where(eq(contentVersions.id, v.id))
  await audit(tx, c, {
    action: 'content.unschedule',
    targetType: 'content_version',
    targetId: String(v.id),
    before: {
      status: 'published',
      effectiveAt: v.effectiveAt!.getTime(),
      publishedBy: v.publishedBy,
      ...(v.linkedEventId && { linkedEventId: v.linkedEventId, linkedRole: v.linkedRole }),
    },
    after: { status: 'draft', hash: v.hash },
    ...(note && { note }),
  })
}

/** The event will not happen (archived before it started): every scheduled version tied to it goes back to a draft. */
export async function cancelLinked(tx: Tx, c: AuditActor, eventId: string, now: number): Promise<number[]> {
  const rows = await scheduledOf(tx, eventId, now)
  for (const v of rows) await toDraft(tx, c, v, 'event archived before it started')
  return rows.map((v) => v.id)
}

/** The `start` version is cancelled by hand: its scheduled `end` copies make no sense any more and go back to drafts too. */
export async function cancelReverts(tx: Tx, c: AuditActor, startVersionId: number, now: number): Promise<number[]> {
  const rows = await tx
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.revertOfVersionId, startVersionId), eq(contentVersions.status, 'published'), gt(contentVersions.effectiveAt, new Date(now))))
    .orderBy(asc(contentVersions.id))
    .for('update')
  for (const v of rows) await toDraft(tx, c, v, 'its event version was cancelled')
  return rows.map((v) => v.id)
}
