/**
 * /api/admin/events — live events administration (docs/admin-plan.md §2, §4, §6; delivery E8).
 *
 *   GET    /events?status=        admin        events (draft|published|archived), newest first
 *   POST   /events                admin        { slug, name, description, startsAt, endsAt, imageId?, overlay } → 201 (a draft)
 *   GET    /events/:id            admin
 *   PUT    /events/:id            admin        partial update. A draft is saved even with semantic errors (the
 *                                              validation is stored); a PUBLISHED event also needs sudo, is validated
 *                                              with the smoke test, bumps `revision` and takes effect at once. New dates move
 *                                              the scheduled content versions tied to it, in the same transaction (`contentMoved`)
 *   DELETE /events/:id            admin        → 204, drafts only
 *   POST   /events/:id/publish    admin + sudo { confirm?, note? }: published; a future `startsAt` = scheduled
 *   POST   /events/:id/archive    admin + sudo { note? }: a published event leaves play (its items keep their names). Before it
 *                                 starts, the scheduled content versions tied to it go back to drafts (`contentCancelled`);
 *                                 once it started they are left alone
 *   POST   /events/:id/announce   admin + sudo { note? }: «Notify players»: bumps `announceRev`, SSE `event_announce` to every
 *                                 connection; published and not ended only (409 `not_published` / `event_ended`); 5 per hour per event
 *   GET    /events/:id/audience   admin        { connections, players } connected right now
 *
 * The overlay (featured species, shiny, legendary multiplier, drops, event missions, own items) is checked by
 * `validateEventOverlay` (src/game/content): the shape on every save (400 `invalid_body` with the fields), the
 * semantics and the engine smoke test when publishing or editing a published event (422 `validation_failed`;
 * warnings that need confirmation: 409 `confirm_required` until `confirm: true`). Writes happen in one transaction
 * together with their audit row (`event.create|update|delete|publish|archive|announce`); afterwards the ContentService
 * reloads and announces the new content hash over SSE. Drafts and archived events never reach the public API or
 * the content resolution as live events. Contract: src/game/protocol.ts «Live events».
 */
import { Hono } from 'hono'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ContentItem, EventOverlay } from '../../../src/engine/content'
import { eventOverlayBodySchema, richLongTextSchema, shortTextSchema, slugSchema, validateEventOverlay } from '../../../src/game/content'
import type { AdminContentAuthor, AdminContentValidation, AdminEvent, AdminEventAnnounceResponse, AdminEventAudienceResponse, AdminEventResponse, AdminEventsResponse, AdminEventStatus } from '../../../src/game/protocol'
import { audit } from '../../admin/audit'
import { imageOf, overlayOf } from '../../content/events'
import { cancelLinked, linkedContentOf, moveLinked } from '../../content/eventLink'
import { isUniqueViolation, type Db, type Tx } from '../../db/client'
import { liveEventRevisions, liveEvents, uploads, users } from '../../db/schema'
import { ApiError, readBody, requireElevated, UUID_RE, type AppEnv, type Ctx, type Deps } from '../../http'
import { RULES } from '../../rate-limit'
import { MAX_SCHEDULE_MS } from './content'
import type { Limit, Staff } from './players'

export const MAX_OPEN_EVENT_DRAFTS = 50
export const EVENTS_LIMIT = 200

const noteField = z.string().trim().max(400)
const epoch = z.number().int().min(0).max(8_640_000_000_000_000)
const imageIdField = z.string().regex(UUID_RE)
const createBody = z.object({
  slug: slugSchema,
  name: shortTextSchema,
  description: richLongTextSchema,
  startsAt: epoch,
  endsAt: epoch,
  imageId: imageIdField.nullable().optional(),
  overlay: eventOverlayBodySchema,
})
const updateBody = z
  .object({
    slug: slugSchema.optional(),
    name: shortTextSchema.optional(),
    description: richLongTextSchema.optional(),
    startsAt: epoch.optional(),
    endsAt: epoch.optional(),
    imageId: imageIdField.nullable().optional(),
    overlay: eventOverlayBodySchema.optional(),
    confirm: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'confirm' && (b as Record<string, unknown>)[k] !== undefined), { message: 'empty' })
const publishBody = z.object({ confirm: z.boolean().optional(), note: noteField.optional() })
const archiveBody = z.object({ note: noteField.optional() })
const announceBody = z.object({ note: noteField.optional() })
const listQuery = z.object({ status: z.enum(['draft', 'published', 'archived']).optional() })

type Row = typeof liveEvents.$inferSelect
type Reader = Pick<Db, 'select'>

/** Everything an audit row or a revision snapshot keeps about an event. */
const snapshot = (r: Row) => ({
  slug: r.slug,
  status: r.status,
  startsAt: r.startsAt.getTime(),
  endsAt: r.endsAt.getTime(),
  name: r.name,
  description: r.description,
  imageId: r.imageId,
  revision: r.revision,
  announceRev: r.announceRev,
  overlay: r.overlay,
})

export function eventsAdminRoutes(deps: Deps, staff: Staff, limit: Limit) {
  const { db, content } = deps
  const app = new Hono<AppEnv>()

  const idParam = (c: Ctx): string => {
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    return id
  }
  const writeLimit = (c: Ctx) => limit(c, `admin:event:write:${c.get('user').id}`, RULES.adminEventWrite)
  const announceLimit = (c: Ctx, eventId: string) => limit(c, `admin:event:announce:${eventId}`, RULES.adminEventAnnounce)
  const publishLimit = (c: Ctx) => limit(c, `admin:event:publish:${c.get('user').id}`, RULES.adminEventPublish)
  /** Sudo for the actions that are only sensitive on a published event. */
  const needSudo = (c: Ctx) => {
    const until = c.get('session').elevatedUntil
    if (!until || until.getTime() <= deps.clock()) throw new ApiError(403, 'elevation_required')
  }

  const authors = async (ex: Reader, rows: Row[]): Promise<Map<string, AdminContentAuthor>> => {
    const ids = [...new Set(rows.flatMap((r) => [r.createdBy, r.publishedBy]).filter((x): x is string => !!x))]
    const out = new Map<string, AdminContentAuthor>()
    if (ids.length === 0) return out
    for (const u of await ex.select({ id: users.id, trainerName: users.trainerName }).from(users).where(inArray(users.id, ids))) out.set(u.id, u)
    return out
  }

  const view = (r: Row, up: typeof uploads.$inferSelect | null, who: Map<string, AdminContentAuthor>, now: number): AdminEvent => ({
    id: r.id,
    slug: r.slug,
    status: r.status,
    startsAt: r.startsAt.getTime(),
    endsAt: r.endsAt.getTime(),
    name: r.name,
    description: r.description,
    imageId: r.imageId,
    image: imageOf(up),
    overlay: r.overlay,
    revision: r.revision,
    announceRev: r.announceRev,
    validation: r.validation ?? null,
    createdBy: (r.createdBy && who.get(r.createdBy)) || null,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
    publishedBy: (r.publishedBy && who.get(r.publishedBy)) || null,
    publishedAt: r.publishedAt?.getTime() ?? null,
    active: r.status === 'published' && r.startsAt.getTime() <= now && now < r.endsAt.getTime(),
    scheduled: r.status === 'published' && r.startsAt.getTime() > now,
  })

  const bodyOf = async (id: string, now: number): Promise<AdminEventResponse> => {
    const [hit] = await db.select({ ev: liveEvents, up: uploads }).from(liveEvents).leftJoin(uploads, eq(uploads.id, liveEvents.imageId)).where(eq(liveEvents.id, id))
    if (!hit) throw new ApiError(404, 'not_found')
    const active = await content.current(now)
    return { event: view(hit.ev, hit.up, await authors(db, [hit.ev]), now), linkedContent: await linkedContentOf(db, id, active.versionId, now), serverNow: now }
  }

  const lock = async (tx: Tx, id: string): Promise<Row> => {
    const [row] = await tx.select().from(liveEvents).where(eq(liveEvents.id, id)).for('update')
    if (!row) throw new ApiError(404, 'not_found')
    return row
  }

  const assertImage = async (ex: Reader, imageId: string | null | undefined) => {
    if (!imageId) return
    const [up] = await ex.select({ id: uploads.id }).from(uploads).where(eq(uploads.id, imageId))
    if (!up) throw new ApiError(422, 'unknown_image')
  }

  const assertDates = (startsAt: number, endsAt: number) => {
    if (endsAt <= startsAt) throw new ApiError(400, 'invalid_dates', { reason: 'order' })
  }

  /** The date rules of publishing (`ended`: ends in the past, `too_far`: starts beyond the schedule limit). */
  const assertPublishedDates = (row: Row, startsAt: number, endsAt: number, now: number) => {
    const untouched = startsAt === row.startsAt.getTime() && endsAt === row.endsAt.getTime()
    if (endsAt <= now && !(untouched && row.endsAt.getTime() <= now)) throw new ApiError(400, 'invalid_dates', { reason: 'ended' })
    if (startsAt > now + MAX_SCHEDULE_MS) throw new ApiError(400, 'invalid_dates', { reason: 'too_far' })
  }

  /** Validation of the event as a whole (overlay + id, slug and dates) against what is live. */
  const validate = async (tx: Tx, ev: EventOverlay, smoke: boolean, now: number, previous?: EventOverlay): Promise<AdminContentValidation> => {
    const active = await content.current(now, tx)
    const others = await tx.select().from(liveEvents).where(and(inArray(liveEvents.status, ['published', 'archived']), ne(liveEvents.id, ev.id)))
    const items: Record<string, ContentItem> = {}
    for (const o of others) Object.assign(items, o.overlay.items ?? {})
    const overlapping = others
      .filter((o) => o.status === 'published' && o.startsAt.getTime() < ev.endsAt && ev.startsAt < o.endsAt.getTime())
      .map(overlayOf)
    const r = validateEventOverlay(ev, { patch: active.patch, allEventItems: items, otherEvents: overlapping, previous, smoke })
    return { ok: r.ok, errors: r.errors, warnings: r.warnings, requiresConfirm: r.requiresConfirm, smoke, at: now }
  }

  const gate = (v: AdminContentValidation, confirm: boolean | undefined) => {
    if (!v.ok) throw new ApiError(422, 'validation_failed', { errors: v.errors, warnings: v.warnings, requiresConfirm: v.requiresConfirm })
    if (v.requiresConfirm && !confirm) throw new ApiError(409, 'confirm_required', { warnings: v.warnings.filter((w) => w.requiresConfirm), requiresConfirm: true })
  }

  /** The slug is unique across every status: a clash is a 409 whichever way it is detected. */
  const slugGuard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, 'slug_taken')
      throw e
    }
  }
  const assertSlugFree = async (tx: Tx, slug: string, exceptId?: string) => {
    const [dup] = await tx.select({ id: liveEvents.id }).from(liveEvents).where(exceptId ? and(eq(liveEvents.slug, slug), ne(liveEvents.id, exceptId)) : eq(liveEvents.slug, slug))
    if (dup) throw new ApiError(409, 'slug_taken')
  }

  // --- Reads -------------------------------------------------------------------------------

  app.get('/', staff('admin'), async (c) => {
    const q = listQuery.safeParse(c.req.query())
    if (!q.success) throw new ApiError(400, 'invalid_query')
    const now = deps.clock()
    const rows = await db
      .select({ ev: liveEvents, up: uploads })
      .from(liveEvents)
      .leftJoin(uploads, eq(uploads.id, liveEvents.imageId))
      .where(q.data.status ? eq(liveEvents.status, q.data.status as AdminEventStatus) : undefined)
      .orderBy(desc(liveEvents.startsAt), desc(liveEvents.createdAt))
      .limit(EVENTS_LIMIT)
    const who = await authors(db, rows.map((r) => r.ev))
    const body: AdminEventsResponse = { items: rows.map((r) => view(r.ev, r.up, who, now)), serverNow: now }
    return c.json(body)
  })

  app.get('/:id', staff('admin'), async (c) => c.json(await bodyOf(idParam(c), deps.clock())))

  // --- Drafts ------------------------------------------------------------------------------

  app.post('/', staff('admin'), async (c) => {
    const body = await readBody(c, createBody)
    writeLimit(c)
    assertDates(body.startsAt, body.endsAt)
    const now = deps.clock()
    const id = await slugGuard(() =>
      db.transaction(async (tx) => {
        const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(liveEvents).where(eq(liveEvents.status, 'draft'))
        if ((open?.n ?? 0) >= MAX_OPEN_EVENT_DRAFTS) throw new ApiError(409, 'too_many_drafts')
        await assertSlugFree(tx, body.slug)
        await assertImage(tx, body.imageId)
        const rowId = crypto.randomUUID()
        const validation = await validate(tx, { ...body.overlay, id: rowId, slug: body.slug, startsAt: body.startsAt, endsAt: body.endsAt }, false, now)
        const [row] = await tx
          .insert(liveEvents)
          .values({
            id: rowId,
            slug: body.slug,
            status: 'draft',
            startsAt: new Date(body.startsAt),
            endsAt: new Date(body.endsAt),
            name: body.name,
            description: body.description,
            imageId: body.imageId ?? null,
            overlay: body.overlay,
            validation,
            createdBy: c.get('user').id,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          })
          .returning()
        await audit(tx, c, { action: 'event.create', targetType: 'live_event', targetId: rowId, after: snapshot(row!) })
        return rowId
      }),
    )
    return c.json(await bodyOf(id, now), 201)
  })

  app.put('/:id', staff('admin'), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, updateBody)
    writeLimit(c)
    const now = deps.clock()
    const { wasPublished, moved } = await slugGuard(() =>
      db.transaction(async (tx) => {
        const row = await lock(tx, id)
        if (row.status === 'archived') throw new ApiError(409, 'not_editable')
        const live = row.status === 'published'
        if (live) {
          needSudo(c)
          publishLimit(c)
          if (body.slug !== undefined && body.slug !== row.slug) throw new ApiError(409, 'slug_locked')
        }
        const next = {
          slug: body.slug ?? row.slug,
          name: body.name ?? row.name,
          description: body.description ?? row.description,
          startsAt: body.startsAt ?? row.startsAt.getTime(),
          endsAt: body.endsAt ?? row.endsAt.getTime(),
          imageId: body.imageId === undefined ? row.imageId : body.imageId,
          overlay: body.overlay ?? row.overlay,
        }
        assertDates(next.startsAt, next.endsAt)
        // Editing a published event keeps the checks of publishing it: it cannot end in the past nor start more than
        // 60 days ahead. An event that is already running (start in the past) or already over (dates untouched,
        // e.g. fixing its text) stays editable.
        if (live) assertPublishedDates(row, next.startsAt, next.endsAt, now)
        if (next.slug !== row.slug) await assertSlugFree(tx, next.slug, id)
        if (next.imageId !== row.imageId) await assertImage(tx, next.imageId)
        const validation = await validate(tx, { ...next.overlay, id, slug: next.slug, startsAt: next.startsAt, endsAt: next.endsAt }, live, now, live ? overlayOf(row) : undefined)
        if (live) gate(validation, body.confirm)
        const revision = live ? row.revision + 1 : row.revision
        const [after] = await tx
          .update(liveEvents)
          .set({
            slug: next.slug,
            name: next.name,
            description: next.description,
            startsAt: new Date(next.startsAt),
            endsAt: new Date(next.endsAt),
            imageId: next.imageId,
            overlay: next.overlay,
            revision,
            validation,
            updatedAt: new Date(now),
          })
          .where(eq(liveEvents.id, id))
          .returning()
        if (live) await tx.insert(liveEventRevisions).values({ eventId: id, revision, snapshot: snapshot(after!), createdBy: c.get('user').id, createdAt: new Date(now) })
        await audit(tx, c, { action: 'event.update', targetType: 'live_event', targetId: id, before: snapshot(row), after: snapshot(after!), ...(live && body.confirm && { note: 'confirmed' }) })
        // The content tied to the event follows its dates (same transaction, with its own audit rows).
        const datesChanged = after!.startsAt.getTime() !== row.startsAt.getTime() || after!.endsAt.getTime() !== row.endsAt.getTime()
        const moved = live && datesChanged ? await moveLinked(tx, c, after!, now) : []
        return { wasPublished: live, moved }
      }),
    )
    if (wasPublished) await content.refresh()
    const res = await bodyOf(id, now)
    if (moved.length > 0) res.contentMoved = moved
    return c.json(res)
  })

  app.delete('/:id', staff('admin'), async (c) => {
    const id = idParam(c)
    writeLimit(c)
    await db.transaction(async (tx) => {
      const row = await lock(tx, id)
      if (row.status !== 'draft') throw new ApiError(409, 'not_draft')
      await tx.delete(liveEvents).where(eq(liveEvents.id, id))
      await audit(tx, c, { action: 'event.delete', targetType: 'live_event', targetId: id, before: snapshot(row) })
    })
    return c.body(null, 204)
  })

  // --- Publish, archive ----------------------------------------------------------------------

  app.post('/:id/publish', staff('admin'), requireElevated(deps), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, publishBody)
    publishLimit(c)
    const now = deps.clock()
    await db.transaction(async (tx) => {
      const row = await lock(tx, id)
      if (row.status !== 'draft') throw new ApiError(409, 'not_draft')
      if (row.endsAt.getTime() <= now) throw new ApiError(400, 'invalid_dates', { reason: 'ended' })
      if (row.startsAt.getTime() > now + MAX_SCHEDULE_MS) throw new ApiError(400, 'invalid_dates', { reason: 'too_far' })
      const validation = await validate(tx, overlayOf(row), true, now)
      gate(validation, body.confirm)
      const [after] = await tx
        .update(liveEvents)
        .set({ status: 'published', validation, publishedBy: c.get('user').id, publishedAt: new Date(now), updatedAt: new Date(now) })
        .where(eq(liveEvents.id, id))
        .returning()
      await tx.insert(liveEventRevisions).values({ eventId: id, revision: row.revision, snapshot: snapshot(after!), createdBy: c.get('user').id, createdAt: new Date(now) })
      await audit(tx, c, {
        action: 'event.publish',
        targetType: 'live_event',
        targetId: id,
        before: { status: 'draft' },
        after: { ...snapshot(after!), scheduled: row.startsAt.getTime() > now, warnings: validation.warnings.length, confirmed: !!body.confirm },
        ...(body.note && { note: body.note }),
      })
    })
    await content.refresh()
    return c.json(await bodyOf(id, now))
  })

  app.post('/:id/archive', staff('admin'), requireElevated(deps), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, archiveBody)
    publishLimit(c)
    const now = deps.clock()
    const cancelled = await db.transaction(async (tx) => {
      const row = await lock(tx, id)
      if (row.status !== 'published') throw new ApiError(409, 'not_published')
      await tx.update(liveEvents).set({ status: 'archived', updatedAt: new Date(now) }).where(eq(liveEvents.id, id))
      // It will never happen: the content scheduled for its start (and its «back» copy) goes back to drafts. Once it has
      // started the versions stay as they are (the start one is in force; the «back» copy still fires at the planned end).
      const cancelled = row.startsAt.getTime() > now ? await cancelLinked(tx, c, id, now) : []
      await audit(tx, c, {
        action: 'event.archive',
        targetType: 'live_event',
        targetId: id,
        before: { status: 'published', revision: row.revision },
        after: { status: 'archived', ...(cancelled.length > 0 && { contentCancelled: cancelled }) },
        ...(body.note && { note: body.note }),
      })
      return cancelled
    })
    await content.refresh()
    const res = await bodyOf(id, now)
    if (cancelled.length > 0) res.contentCancelled = cancelled
    return c.json(res)
  })

  // --- Notify the players ---------------------------------------------------------------------

  /** Who a notice would reach right now (the admin's confirmation says it). */
  app.get('/:id/audience', staff('admin'), async (c) => {
    const id = idParam(c)
    const [row] = await db.select({ id: liveEvents.id }).from(liveEvents).where(eq(liveEvents.id, id))
    if (!row) throw new ApiError(404, 'not_found')
    const body: AdminEventAudienceResponse = deps.bus.audience()
    return c.json(body)
  })

  /**
   * "Notify the players": the announcement window shows again to everybody (those who closed it too), including
   * those who connect later. Only a published event that has not ended. Does not touch `revision` nor the content.
   */
  app.post('/:id/announce', staff('admin'), requireElevated(deps), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, announceBody)
    announceLimit(c, id)
    const now = deps.clock()
    const rev = await db.transaction(async (tx) => {
      const row = await lock(tx, id)
      if (row.status !== 'published') throw new ApiError(409, 'not_published')
      if (row.endsAt.getTime() <= now) throw new ApiError(409, 'event_ended')
      const next = row.announceRev + 1
      await tx.update(liveEvents).set({ announceRev: next }).where(eq(liveEvents.id, id))
      await audit(tx, c, {
        action: 'event.announce',
        targetType: 'live_event',
        targetId: id,
        before: { announceRev: row.announceRev },
        after: { announceRev: next, scheduled: row.startsAt.getTime() > now },
        ...(body.note && { note: body.note }),
      })
      return next
    })
    const notified = deps.bus.audience()
    deps.bus.broadcast({ type: 'event_announce', eventId: id, rev })
    const res: AdminEventAnnounceResponse = { ...(await bodyOf(id, now)), notified }
    return c.json(res)
  })

  return app
}
