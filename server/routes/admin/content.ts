/**
 * /api/admin/content — live content administration (docs/admin-plan.md §4, delivery E5).
 *
 *   GET    /live                       support+   hash in force, active version, next scheduled, active events
 *   GET    /versions?status=           support+   versions (draft|published|archived), newest first, with authors and dates
 *   GET    /versions/:id               support+   patch, last validation and the diff against the active patch
 *   POST   /drafts                     admin      { from?: 'active'|'empty', fromVersionId?, title?, note? } → 201
 *   PUT    /drafts/:id                 admin      { patch?, title?, note? }: saved even with errors (the validation is stored)
 *   DELETE /drafts/:id                 admin      → 204
 *   POST   /drafts/:id/validate        admin      full validation (with the engine smoke test) + diff; stores the result
 *   POST   /drafts/:id/publish         admin + sudo   { effectiveAt?, confirm?, note? }: now, or scheduled when in the future
 *   POST   /versions/:id/rollback      admin + sudo   { confirm?, note? }: a NEW version copying that patch, in force now
 *   POST   /versions/:id/unschedule    admin + sudo   cancels a scheduled version that is not in force yet: it goes back to a draft (409 not_scheduled otherwise)
 *   GET    /spawn-preview              admin      ?versionId&eventId&hour&weather&trainerLevel → species the wild pool offers (eventId: with that live event resolved on top, drafts too)
 *   POST   /drafts/:id/simulate        admin      { profiles?, seeds?, weeks? } → 202: balance simulation active vs draft in a worker (E10; one at a time, 409 busy)
 *   GET    /sim-runs?versionId=        support+   simulation runs, newest first (no reports)
 *   GET    /sim-runs/:id               support+   one run with its report (progress while running)
 *
 * Drafts (and the publish result) carry `sim: { recent, last }`: publishing without a recent
 * simulation of the current patch is allowed (a warning in the editor, `simRunId: null` in the audit).
 *
 * Writes go through the ContentService (`publishDraft` / `publish`, in the route's transaction;
 * `refresh()` after the commit reloads it and broadcasts the new hash). Publishing and rollback
 * validate again with the smoke test: errors block (422 `validation_failed`), warnings that
 * require confirmation need `confirm: true` (409 `confirm_required`). Every mutation is audited
 * in the same transaction. Drafts are never served by /api/content (the service only reads
 * `status = 'published'`). Contract: src/game/protocol.ts «Admin: live content».
 */
import { Hono } from 'hono'
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createEngineContext, resolveContent, type ContentPatch } from '../../../src/engine'
import { contentPatchSchema, diffPatches, spawnPreview, validateContentPatch } from '../../../src/game/content'
import type {
  AdminContentAuthor,
  AdminContentLiveResponse,
  AdminContentStatus,
  AdminContentValidateResponse,
  AdminContentValidation,
  AdminContentVersion,
  AdminContentVersionResponse,
  AdminContentVersionsResponse,
  AdminContentVersionSummary,
  AdminSimCheck,
  AdminSimRun,
  AdminSimRunResponse,
  AdminSimRunsResponse,
  AdminSimRunSummary,
  AdminSpawnPreview,
} from '../../../src/game/protocol'
import { ADMIN_SIM_MAX_PLAYER_WEEKS, ADMIN_SIM_MAX_SEEDS, ADMIN_SIM_MAX_WEEKS, ADMIN_SIM_PROFILES, ADMIN_SIM_RECENT_MS } from '../../../src/game/protocol'
import { audit } from '../../admin/audit'
import { patchHash, type ResolvedContent } from '../../content/service'
import type { SimInput } from '../../content/simCompare'
import type { Db, Tx } from '../../db/client'
import { overlayOf } from '../../content/events'
import { contentSimRuns, contentVersions, liveEvents, users } from '../../db/schema'
import { ApiError, readBody, requireElevated, UUID_RE, type AppEnv, type Ctx, type Deps } from '../../http'
import { RULES } from '../../rate-limit'
import type { Limit, Staff } from './players'

export const MAX_OPEN_DRAFTS = 20
export const VERSIONS_LIMIT = 100
/** A scheduled publication can be at most this far ahead. */
export const MAX_SCHEDULE_MS = 60 * 86_400_000

const titleField = z.string().trim().max(80)
const noteField = z.string().trim().max(400)
const createBody = z.object({
  from: z.enum(['active', 'empty']).optional(),
  fromVersionId: z.number().int().positive().optional(),
  title: titleField.optional(),
  note: noteField.optional(),
})
const updateBody = z
  .object({ patch: z.record(z.string(), z.unknown()).optional(), title: titleField.nullable().optional(), note: noteField.nullable().optional() })
  .refine((b) => b.patch !== undefined || b.title !== undefined || b.note !== undefined, { message: 'empty' })
const publishBody = z.object({ effectiveAt: z.number().int().positive().optional(), confirm: z.boolean().optional(), note: noteField.optional() })
const rollbackBody = z.object({ confirm: z.boolean().optional(), note: noteField.optional() })
const listQuery = z.object({ status: z.enum(['draft', 'published', 'archived']).optional() })
const previewQuery = z.object({
  versionId: z.coerce.number().int().positive().optional(),
  /** Preview with this live event (any status, drafts included) resolved on top of the content. */
  eventId: z.string().regex(UUID_RE).optional(),
  hour: z.coerce.number().int().min(0).max(23).default(12),
  weather: z.enum(['rain', 'sun', 'snow', 'clear', 'unknown']).default('clear'),
  trainerLevel: z.coerce.number().int().min(1).max(100).default(1),
})

export const SIM_RUNS_LIMIT = 50
const simulateBody = z
  .object({
    profiles: z
      .array(z.enum(ADMIN_SIM_PROFILES as [string, ...string[]]))
      .min(1)
      .max(ADMIN_SIM_PROFILES.length)
      .default(['casual', 'constant', 'marathoner']),
    seeds: z.number().int().min(1).max(ADMIN_SIM_MAX_SEEDS).default(4),
    weeks: z.number().int().min(1).max(ADMIN_SIM_MAX_WEEKS).default(4),
  })
  .strict()
const simListQuery = z.object({ versionId: z.coerce.number().int().positive().optional() })

type Row = typeof contentVersions.$inferSelect
type SimRow = typeof contentSimRuns.$inferSelect
type Reader = Pick<Db, 'select'>

export function contentAdminRoutes(deps: Deps, staff: Staff, limit: Limit) {
  const { db, content } = deps
  const app = new Hono<AppEnv>()

  const idParam = (c: Ctx): number => {
    const raw = c.req.param('id') ?? ''
    if (!/^\d{1,9}$/.test(raw)) throw new ApiError(404, 'not_found')
    return Number(raw)
  }
  const writeLimit = (c: Ctx) => limit(c, `admin:content:write:${c.get('user').id}`, RULES.adminContentWrite)
  const computeLimit = (c: Ctx) => limit(c, `admin:content:compute:${c.get('user').id}`, RULES.adminContentCompute)
  const publishLimit = (c: Ctx) => limit(c, `admin:content:publish:${c.get('user').id}`, RULES.adminContentPublish)

  /** Validation of a patch against the content in force now (mission ids, live events, known items). */
  const validateAgainst = (patch: unknown, active: ResolvedContent, smoke: boolean, now: number): AdminContentValidation => {
    const r = validateContentPatch(patch, { previous: active.patch, events: active.events, allEventItems: active.eventItems, smoke })
    return { ok: r.ok, errors: r.errors, warnings: r.warnings, requiresConfirm: r.requiresConfirm, smoke, at: now }
  }

  const authors = async (ex: Reader, rows: Row[]): Promise<Map<string, AdminContentAuthor>> => {
    const ids = [...new Set(rows.flatMap((r) => [r.createdBy, r.publishedBy]).filter((x): x is string => !!x))]
    const out = new Map<string, AdminContentAuthor>()
    if (ids.length === 0) return out
    for (const u of await ex.select({ id: users.id, trainerName: users.trainerName }).from(users).where(inArray(users.id, ids))) out.set(u.id, u)
    return out
  }

  const summarize = (r: Row, who: Map<string, AdminContentAuthor>, activeId: number | null, now: number): AdminContentVersionSummary => {
    const v = r.validation as AdminContentValidation | null
    return {
      id: r.id,
      status: r.status,
      title: r.title,
      note: r.note,
      parentId: r.parentId,
      hash: r.hash,
      effectiveAt: r.effectiveAt?.getTime() ?? null,
      createdBy: (r.createdBy && who.get(r.createdBy)) || null,
      createdAt: r.createdAt.getTime(),
      publishedBy: (r.publishedBy && who.get(r.publishedBy)) || null,
      publishedAt: r.publishedAt?.getTime() ?? null,
      active: r.id === activeId,
      scheduled: r.status === 'published' && r.effectiveAt !== null && r.effectiveAt.getTime() > now,
      validation: v ? { ok: v.ok, errors: v.errors.length, warnings: v.warnings.length, requiresConfirm: v.requiresConfirm, smoke: v.smoke } : null,
    }
  }

  // --- Simulation runs (E10) ------------------------------------------------------------------

  const simAuthors = async (rows: SimRow[]): Promise<Map<string, AdminContentAuthor>> => {
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))]
    const out = new Map<string, AdminContentAuthor>()
    if (ids.length === 0) return out
    for (const u of await db.select({ id: users.id, trainerName: users.trainerName }).from(users).where(inArray(users.id, ids))) out.set(u.id, u)
    return out
  }

  const simSummary = (r: SimRow, who: Map<string, AdminContentAuthor>): AdminSimRunSummary => ({
    id: r.id,
    versionId: r.versionId,
    draftHash: r.draftHash,
    activeVersionId: r.activeVersionId,
    activeHash: r.activeHash,
    status: r.status,
    params: r.params,
    error: r.error,
    createdBy: (r.createdBy && who.get(r.createdBy)) || null,
    createdAt: r.createdAt.getTime(),
    finishedAt: r.finishedAt?.getTime() ?? null,
    progress: r.status === 'running' ? deps.sim.progress(r.id) : null,
  })

  /** Latest run of a version and whether a finished run of `hash` is recent. */
  const simCheck = async (versionId: number, hash: string | null, now: number): Promise<AdminSimCheck & { recentId: number | null }> => {
    await deps.sim.recover()
    const rows = await db.select().from(contentSimRuns).where(eq(contentSimRuns.versionId, versionId)).orderBy(desc(contentSimRuns.id)).limit(20)
    const recent = rows.find((r) => r.status === 'done' && r.draftHash === hash && r.finishedAt && now - r.finishedAt.getTime() <= ADMIN_SIM_RECENT_MS)
    const last = rows[0]
    return { recent: !!recent, recentId: recent?.id ?? null, last: last ? simSummary(last, await simAuthors([last])) : null }
  }

  /** The version and its diff against the active patch (a draft, or `withSim`: its simulation state). */
  const versionBody = async (id: number, now: number, withSim = false): Promise<AdminContentVersionResponse> => {
    const [row] = await db.select().from(contentVersions).where(eq(contentVersions.id, id))
    if (!row) throw new ApiError(404, 'not_found')
    const active = await content.current(now)
    const who = await authors(db, [row])
    const version: AdminContentVersion = {
      ...summarize(row, who, active.versionId, now),
      patch: row.patch,
      baseHash: row.baseHash,
      validationDetail: (row.validation as AdminContentValidation | null) ?? null,
    }
    const body: AdminContentVersionResponse = { version, diff: row.id === active.versionId ? [] : diffPatches(active.patch, row.patch), serverNow: now }
    if (withSim || row.status === 'draft') {
      const { recent, last } = await simCheck(row.id, row.hash, now)
      body.sim = { recent, last }
    }
    return body
  }

  const lockRow = async (tx: Tx, id: number): Promise<Row> => {
    const [row] = await tx.select().from(contentVersions).where(eq(contentVersions.id, id)).for('update')
    if (!row) throw new ApiError(404, 'not_found')
    return row
  }
  const lockDraft = async (tx: Tx, id: number): Promise<Row> => {
    const row = await lockRow(tx, id)
    if (row.status !== 'draft') throw new ApiError(409, 'not_draft')
    return row
  }

  /** Errors block, warnings that need confirmation need `confirm: true`. */
  const gate = (v: AdminContentValidation, confirm: boolean | undefined) => {
    if (!v.ok) throw new ApiError(422, 'validation_failed', { errors: v.errors, warnings: v.warnings, requiresConfirm: v.requiresConfirm })
    if (v.requiresConfirm && !confirm) throw new ApiError(409, 'confirm_required', { warnings: v.warnings.filter((w) => w.requiresConfirm), requiresConfirm: true })
  }

  // --- Reads -------------------------------------------------------------------------------

  app.get('/live', staff('support'), async (c) => {
    const now = deps.clock()
    const active = await content.current(now)
    const [next] = await db
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.status, 'published'), gt(contentVersions.effectiveAt, new Date(now))))
      .orderBy(asc(contentVersions.effectiveAt), asc(contentVersions.id))
      .limit(1)
    const ids = [active.versionId].filter((x): x is number => x !== null)
    const [cur] = ids.length ? await db.select().from(contentVersions).where(eq(contentVersions.id, ids[0]!)) : []
    const who = await authors(db, [cur, next].filter((r): r is Row => !!r))
    const body: AdminContentLiveResponse = {
      hash: active.hash,
      baseHash: active.baseHash,
      active: cur ? summarize(cur, who, active.versionId, now) : null,
      patch: active.patch,
      scheduled: next ? summarize(next, who, active.versionId, now) : null,
      events: active.events.map((e) => ({ id: e.id, slug: e.slug, startsAt: e.startsAt, endsAt: e.endsAt })),
      serverNow: now,
    }
    return c.json(body)
  })

  app.get('/versions', staff('support'), async (c) => {
    const q = listQuery.safeParse(c.req.query())
    if (!q.success) throw new ApiError(400, 'invalid_query')
    const now = deps.clock()
    const rows = await db
      .select()
      .from(contentVersions)
      .where(q.data.status ? eq(contentVersions.status, q.data.status as AdminContentStatus) : undefined)
      .orderBy(desc(contentVersions.id))
      .limit(VERSIONS_LIMIT)
    const active = await content.current(now)
    const who = await authors(db, rows)
    const body: AdminContentVersionsResponse = { items: rows.map((r) => summarize(r, who, active.versionId, now)), serverNow: now }
    return c.json(body)
  })

  app.get('/versions/:id', staff('support'), async (c) => c.json(await versionBody(idParam(c), deps.clock())))

  // --- Drafts ------------------------------------------------------------------------------

  app.post('/drafts', staff('admin'), async (c) => {
    const body = await readBody(c, createBody)
    writeLimit(c)
    const now = deps.clock()
    const id = await db.transaction(async (tx) => {
      const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(contentVersions).where(eq(contentVersions.status, 'draft'))
      if ((open?.n ?? 0) >= MAX_OPEN_DRAFTS) throw new ApiError(409, 'too_many_drafts')
      const active = await content.current(now, tx)
      let patch: ContentPatch = {}
      let parentId: number | null = null
      if (body.fromVersionId !== undefined) {
        const [src] = await tx.select().from(contentVersions).where(eq(contentVersions.id, body.fromVersionId))
        if (!src) throw new ApiError(404, 'not_found')
        patch = src.patch
        parentId = src.id
      } else if ((body.from ?? 'active') === 'active') {
        patch = active.patch
        parentId = active.versionId
      }
      const validation = validateAgainst(patch, active, false, now)
      const [row] = await tx
        .insert(contentVersions)
        .values({
          status: 'draft',
          patch,
          baseHash: content.baseHash,
          hash: patchHash(patch),
          parentId,
          title: body.title || null,
          note: body.note || null,
          validation,
          createdBy: c.get('user').id,
          createdAt: new Date(now),
        })
        .returning({ id: contentVersions.id })
      await audit(tx, c, { action: 'content.draft.create', targetType: 'content_version', targetId: String(row!.id), after: { parentId, hash: patchHash(patch), title: body.title || null } })
      return row!.id
    })
    return c.json(await versionBody(id, now), 201)
  })

  app.put('/drafts/:id', staff('admin'), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, updateBody)
    writeLimit(c)
    const now = deps.clock()
    await db.transaction(async (tx) => {
      const row = await lockDraft(tx, id)
      const set: Partial<typeof contentVersions.$inferInsert> = {}
      if (body.title !== undefined) set.title = body.title || null
      if (body.note !== undefined) set.note = body.note || null
      if (body.patch !== undefined) {
        const active = await content.current(now, tx)
        set.patch = body.patch as ContentPatch
        set.hash = patchHash(body.patch as ContentPatch)
        set.baseHash = content.baseHash
        set.validation = validateAgainst(body.patch, active, false, now)
      }
      await tx.update(contentVersions).set(set).where(eq(contentVersions.id, id))
      await audit(tx, c, {
        action: 'content.draft.update',
        targetType: 'content_version',
        targetId: String(id),
        before: { hash: row.hash, title: row.title, note: row.note },
        after: { hash: set.hash ?? row.hash, title: set.title === undefined ? row.title : set.title, note: set.note === undefined ? row.note : set.note, ...(body.patch !== undefined && { changedPaths: diffPatches(row.patch, body.patch).length }) },
      })
    })
    return c.json(await versionBody(id, now))
  })

  app.delete('/drafts/:id', staff('admin'), async (c) => {
    const id = idParam(c)
    writeLimit(c)
    await db.transaction(async (tx) => {
      const row = await lockDraft(tx, id)
      await tx.delete(contentVersions).where(eq(contentVersions.id, id))
      await audit(tx, c, { action: 'content.draft.delete', targetType: 'content_version', targetId: String(id), before: { hash: row.hash, title: row.title, parentId: row.parentId } })
    })
    return c.body(null, 204)
  })

  app.post('/drafts/:id/validate', staff('admin'), async (c) => {
    const id = idParam(c)
    computeLimit(c)
    const now = deps.clock()
    const [row] = await db.select().from(contentVersions).where(eq(contentVersions.id, id))
    if (!row) throw new ApiError(404, 'not_found')
    if (row.status !== 'draft') throw new ApiError(409, 'not_draft')
    const active = await content.current(now)
    const validation = validateAgainst(row.patch, active, true, now)
    // Derived data, not a content change: stored without an audit row (only while it is still a draft).
    await db.update(contentVersions).set({ validation }).where(and(eq(contentVersions.id, id), eq(contentVersions.status, 'draft')))
    const body: AdminContentValidateResponse = { validation, diff: diffPatches(active.patch, row.patch), serverNow: now }
    return c.json(body)
  })

  // --- Publish, schedule, rollback -----------------------------------------------------------

  app.post('/drafts/:id/publish', staff('admin'), requireElevated(deps), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, publishBody)
    publishLimit(c)
    const now = deps.clock()
    if (body.effectiveAt !== undefined && (body.effectiveAt <= now || body.effectiveAt > now + MAX_SCHEDULE_MS)) throw new ApiError(400, 'invalid_effective_at')
    // «Mandatory» simulation = a warning, not a block (docs/admin-plan.md, Riesgos «Balance»): the
    // editor shows `sim.recent: false` before publishing and the audit row records it. Read before
    // the transaction (PGlite: one connection); the hash check makes a later patch edit count as unsimulated.
    const [pre] = await db.select({ hash: contentVersions.hash }).from(contentVersions).where(eq(contentVersions.id, id))
    const simulated = pre ? (await simCheck(id, pre.hash, now)).recentId : null
    await db.transaction(async (tx) => {
      const row = await lockDraft(tx, id)
      const active = await content.current(now, tx)
      const validation = validateAgainst(row.patch, active, true, now)
      gate(validation, body.confirm)
      const pub = await content.publishDraft(tx, id, { effectiveAt: body.effectiveAt ?? now, userId: c.get('user').id, validation })
      if (!pub) throw new ApiError(409, 'not_draft')
      if (body.note) await tx.update(contentVersions).set({ note: body.note }).where(eq(contentVersions.id, id))
      await audit(tx, c, {
        action: body.effectiveAt !== undefined ? 'content.schedule' : 'content.publish',
        targetType: 'content_version',
        targetId: String(id),
        before: { status: 'draft' },
        after: { status: 'published', hash: pub.hash, effectiveAt: body.effectiveAt ?? now, changedPaths: diffPatches(active.patch, row.patch).length, warnings: validation.warnings.length, confirmed: !!body.confirm, simRunId: row.hash === pre?.hash ? simulated : null },
        ...(body.note && { note: body.note }),
      })
    })
    await content.refresh()
    return c.json(await versionBody(id, now, true))
  })

  app.post('/versions/:id/rollback', staff('admin'), requireElevated(deps), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, rollbackBody)
    publishLimit(c)
    const now = deps.clock()
    const newId = await db.transaction(async (tx) => {
      const src = await lockRow(tx, id)
      // Only a version that was in force (published, not scheduled for later) can be restored.
      if (src.status === 'draft' || !src.effectiveAt || src.effectiveAt.getTime() > now) throw new ApiError(409, 'not_published')
      const active = await content.current(now, tx)
      const validation = validateAgainst(src.patch, active, true, now)
      gate(validation, body.confirm)
      const pub = await content.publish(
        { patch: src.patch, effectiveAt: now, parentId: src.id, title: `Rollback to #${src.id}`, note: body.note ?? null, userId: c.get('user').id, validation },
        tx,
      )
      await audit(tx, c, {
        action: 'content.rollback',
        targetType: 'content_version',
        targetId: String(pub.id),
        before: { activeVersionId: active.versionId, activeHash: active.hash },
        after: { from: src.id, hash: pub.hash, changedPaths: diffPatches(active.patch, src.patch).length, confirmed: !!body.confirm },
        ...(body.note && { note: body.note }),
      })
      return pub.id
    })
    await content.refresh()
    return c.json(await versionBody(newId, now), 201)
  })

  app.post('/versions/:id/unschedule', staff('admin'), requireElevated(deps), async (c) => {
    const id = idParam(c)
    publishLimit(c)
    const now = deps.clock()
    await db.transaction(async (tx) => {
      const row = await lockRow(tx, id)
      // Only a version still waiting for its time. Once it is in force it is immutable: roll back instead.
      if (row.status !== 'published' || !row.effectiveAt || row.effectiveAt.getTime() <= now) throw new ApiError(409, 'not_scheduled')
      const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(contentVersions).where(eq(contentVersions.status, 'draft'))
      if ((open?.n ?? 0) >= MAX_OPEN_DRAFTS) throw new ApiError(409, 'too_many_drafts')
      await tx.update(contentVersions).set({ status: 'draft', effectiveAt: null, publishedBy: null, publishedAt: null }).where(eq(contentVersions.id, id))
      await audit(tx, c, {
        action: 'content.unschedule',
        targetType: 'content_version',
        targetId: String(id),
        before: { status: 'published', effectiveAt: row.effectiveAt.getTime(), publishedBy: row.publishedBy },
        after: { status: 'draft', hash: row.hash },
      })
    })
    // Reloads the schedule and announces the hash again if the cancelled version was the next one.
    await content.refresh()
    return c.json(await versionBody(id, now, true))
  })

  // --- Simulation (E10) ----------------------------------------------------------------------

  app.post('/drafts/:id/simulate', staff('admin'), async (c) => {
    const id = idParam(c)
    const body = await readBody(c, simulateBody)
    if (body.profiles.length * body.seeds * body.weeks > ADMIN_SIM_MAX_PLAYER_WEEKS) throw new ApiError(400, 'sim_too_big', { max: ADMIN_SIM_MAX_PLAYER_WEEKS })
    const profiles = [...new Set(body.profiles)] as AdminSimRun['params']['profiles']
    const params: AdminSimRun['params'] = { profiles, seeds: body.seeds, weeks: body.weeks }
    computeLimit(c)
    const now = deps.clock()
    await deps.sim.recover()
    deps.sim.reserve() // 409 busy while another run is in progress
    let input: SimInput
    let runId: number
    try {
      const [row] = await db.select().from(contentVersions).where(eq(contentVersions.id, id))
      if (!row) throw new ApiError(404, 'not_found')
      if (row.status !== 'draft') throw new ApiError(409, 'not_draft')
      const active = await content.current(now)
      const validation = validateAgainst(row.patch, active, false, now)
      if (!validation.ok) throw new ApiError(422, 'validation_failed', { errors: validation.errors, warnings: validation.warnings, requiresConfirm: validation.requiresConfirm })
      const draftHash = row.hash ?? patchHash(row.patch)
      const activeHash = active.versionId === null ? 'base' : patchHash(active.patch)
      input = {
        params,
        active: { patch: active.patch, hash: activeHash, versionId: active.versionId },
        proposed: { patch: row.patch, hash: draftHash, versionId: row.id },
        eventItems: active.eventItems,
      }
      runId = await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(contentSimRuns)
          .values({ versionId: id, draftHash, activeVersionId: active.versionId, activeHash, status: 'running', params, createdBy: c.get('user').id, createdAt: new Date(now) })
          .returning({ id: contentSimRuns.id })
        await audit(tx, c, { action: 'content.simulate', targetType: 'content_version', targetId: String(id), after: { simRunId: run!.id, draftHash, activeHash, ...params } })
        return run!.id
      })
    } catch (e) {
      deps.sim.release()
      throw e
    }
    void deps.sim.launch(runId, input)
    const [row] = await db.select().from(contentSimRuns).where(eq(contentSimRuns.id, runId))
    const body2: AdminSimRunResponse = { run: { ...simSummary(row!, await simAuthors([row!])), report: null }, serverNow: now }
    return c.json(body2, 202)
  })

  app.get('/sim-runs', staff('support'), async (c) => {
    const q = simListQuery.safeParse(c.req.query())
    if (!q.success) throw new ApiError(400, 'invalid_query')
    await deps.sim.recover()
    const rows = await db
      .select()
      .from(contentSimRuns)
      .where(q.data.versionId !== undefined ? eq(contentSimRuns.versionId, q.data.versionId) : undefined)
      .orderBy(desc(contentSimRuns.id))
      .limit(SIM_RUNS_LIMIT)
    const who = await simAuthors(rows)
    const body: AdminSimRunsResponse = { items: rows.map((r) => simSummary(r, who)), busy: deps.sim.current !== null, serverNow: deps.clock() }
    return c.json(body)
  })

  app.get('/sim-runs/:id', staff('support'), async (c) => {
    const id = idParam(c)
    await deps.sim.recover()
    const [row] = await db.select().from(contentSimRuns).where(eq(contentSimRuns.id, id))
    if (!row) throw new ApiError(404, 'not_found')
    const body: AdminSimRunResponse = { run: { ...simSummary(row, await simAuthors([row])), report: row.result ?? null }, serverNow: deps.clock() }
    return c.json(body)
  })

  // --- Spawn preview -------------------------------------------------------------------------

  app.get('/spawn-preview', staff('admin'), async (c) => {
    const q = previewQuery.safeParse(c.req.query())
    if (!q.success) throw new ApiError(400, 'invalid_query')
    computeLimit(c)
    const now = deps.clock()
    const active = await content.current(now)
    let ctx = active.ctx
    let hash = active.hash
    let versionId: number | null = active.versionId
    let patch = active.patch
    if (q.data.versionId !== undefined && q.data.versionId !== active.versionId) {
      const [row] = await db.select().from(contentVersions).where(eq(contentVersions.id, q.data.versionId))
      if (!row) throw new ApiError(404, 'not_found')
      const shape = contentPatchSchema.safeParse(row.patch)
      if (!shape.success) throw new ApiError(422, 'invalid_patch')
      try {
        ctx = createEngineContext(resolveContent(row.patch, active.events, active.eventItems, { hash: row.hash ?? 'preview' }))
      } catch {
        throw new ApiError(422, 'invalid_patch')
      }
      hash = row.hash ?? 'preview'
      versionId = row.id
      patch = row.patch
    }
    if (q.data.eventId !== undefined) {
      const [ev] = await db.select().from(liveEvents).where(eq(liveEvents.id, q.data.eventId))
      if (!ev) throw new ApiError(404, 'not_found')
      try {
        const events = [...active.events.filter((e) => e.id !== ev.id), overlayOf(ev)]
        ctx = createEngineContext(resolveContent(patch, events, active.eventItems, { hash: `preview-${ev.id}` }))
      } catch {
        throw new ApiError(422, 'invalid_patch')
      }
      hash = `preview-${ev.id}`
    }
    const body: AdminSpawnPreview = { versionId, hash, hour: q.data.hour, weather: q.data.weather, trainerLevel: q.data.trainerLevel, ...spawnPreview(ctx, q.data) }
    return c.json(body)
  })

  return app
}
