/**
 * /api/admin/uploads — event images (docs/admin-plan.md §3, delivery E8).
 *
 *   GET    /uploads        admin   stored images, newest first, with how many events use each
 *   POST   /uploads        admin   raw body, Content-Type image/png|jpeg|webp, at most 3 MB → 201 { upload, reused: false }
 *                                  (200 { reused: true } when the same image is already stored)
 *   DELETE /uploads/:id    admin   → 204; 409 `in_use` while any event references it
 *
 * The request body is the image itself (not JSON, not multipart: a cross-site `<form>` cannot send it) and
 * app.ts lets only this route skip the JSON content-type check; the Origin check still applies. The bytes
 * are never stored: server/uploads.ts validates them by magic number and re-encodes them with sharp
 * (webp, 16:9, no metadata), and the file is named by the hash of the result. 3 MB body limit (413),
 * 415 `unsupported_type`, 422 `invalid_image` | `image_too_small` | `image_too_large` | `animated_image`,
 * 409 `uploads_full` past 500 MB in total. Every mutation is audited in the same transaction.
 */
import { Hono } from 'hono'
import { count, desc, eq, sql } from 'drizzle-orm'
import { audit } from '../../admin/audit'
import { imageOf } from '../../content/events'
import { isUniqueViolation, type Db } from '../../db/client'
import { liveEvents, uploads } from '../../db/schema'
import { ApiError, UUID_RE, type AppEnv, type Deps } from '../../http'
import { RULES } from '../../rate-limit'
import { ImageError, mediaUrl, processImage, removeImage, storeImage, UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, UPLOADS_TOTAL_LIMIT_BYTES } from '../../uploads'
import type { AdminUpload, AdminUploadResponse, AdminUploadsResponse } from '../../../src/game/protocol'
import type { Limit, Staff } from './players'

export const UPLOAD_LIST_LIMIT = 200

type Row = typeof uploads.$inferSelect

export const toAdminUpload = (r: Row, inUse: number): AdminUpload => ({
  id: r.id,
  sha256: r.sha256,
  bytes: r.bytes,
  thumbBytes: r.thumbBytes,
  ...imageOf(r)!,
  url: mediaUrl(r.sha256),
  thumbUrl: mediaUrl(r.sha256, true),
  createdAt: r.createdAt.getTime(),
  inUse,
})

const inUseOf = async (ex: Pick<Db, 'select'>, id: string): Promise<number> => {
  const [r] = await ex.select({ n: count() }).from(liveEvents).where(eq(liveEvents.imageId, id))
  return r?.n ?? 0
}

export function uploadsAdminRoutes(deps: Deps, staff: Staff, limit: Limit) {
  const { db, env } = deps
  const app = new Hono<AppEnv>()

  app.get('/', staff('admin'), async (c) => {
    const rows = await db.select().from(uploads).orderBy(desc(uploads.createdAt)).limit(UPLOAD_LIST_LIMIT)
    const used = await db.select({ id: liveEvents.imageId, n: count() }).from(liveEvents).groupBy(liveEvents.imageId)
    const uses = new Map(used.map((u) => [u.id, u.n]))
    const [tot] = await db.select({ n: sql<number>`coalesce(sum(${uploads.bytes} + ${uploads.thumbBytes}), 0)::float8` }).from(uploads)
    const body: AdminUploadsResponse = {
      items: rows.map((r) => toAdminUpload(r, uses.get(r.id) ?? 0)),
      totalBytes: tot?.n ?? 0,
      limitBytes: UPLOADS_TOTAL_LIMIT_BYTES,
    }
    return c.json(body)
  })

  app.post('/', staff('admin'), async (c) => {
    limit(c, `admin:upload:${c.get('user').id}`, RULES.adminUpload)
    const declared = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(declared)) throw new ApiError(415, 'unsupported_type')
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0) throw new ApiError(400, 'empty_body')
    if (bytes.length > UPLOAD_MAX_BYTES) throw new ApiError(413, 'body_too_large')
    let img
    try {
      img = await processImage(bytes, declared)
    } catch (e) {
      if (e instanceof ImageError) throw new ApiError(e.status, e.code)
      throw e
    }
    const insert = () =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select().from(uploads).where(eq(uploads.sha256, img.sha256))
        if (existing) {
          // Heals a lost or wiped volume: the files are addressed by their hash, writing them again is harmless.
          await storeImage(env.uploadsDir, img)
          return { row: existing, reused: true }
        }
        const [tot] = await tx.select({ n: sql<number>`coalesce(sum(${uploads.bytes} + ${uploads.thumbBytes}), 0)::float8` }).from(uploads)
        if ((tot?.n ?? 0) + img.main.length + img.thumb.length > UPLOADS_TOTAL_LIMIT_BYTES) throw new ApiError(409, 'uploads_full')
        // Files first: a row must never point to missing files (an orphan file after a rollback is harmless).
        const { path } = await storeImage(env.uploadsDir, img)
        const [row] = await tx
          .insert(uploads)
          .values({ sha256: img.sha256, bytes: img.main.length, thumbBytes: img.thumb.length, width: img.width, height: img.height, path, createdBy: c.get('user').id })
          .returning()
        await audit(tx, c, { action: 'upload.create', targetType: 'upload', targetId: row!.id, after: { sha256: img.sha256, bytes: img.main.length, width: img.width, height: img.height } })
        return { row: row!, reused: false }
      })
    let out
    try {
      out = await insert()
    } catch (e) {
      // Two identical uploads at once: the loser finds the winner's row.
      if (!isUniqueViolation(e)) throw e
      out = await insert()
    }
    const body: AdminUploadResponse = { upload: toAdminUpload(out.row, await inUseOf(db, out.row.id)), reused: out.reused }
    return c.json(body, out.reused ? 200 : 201)
  })

  app.delete('/:id', staff('admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    limit(c, `admin:upload:${c.get('user').id}`, RULES.adminUpload)
    const sha = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(uploads).where(eq(uploads.id, id)).for('update')
      if (!row) throw new ApiError(404, 'not_found')
      if ((await inUseOf(tx, id)) > 0) throw new ApiError(409, 'in_use')
      await tx.delete(uploads).where(eq(uploads.id, id))
      await audit(tx, c, { action: 'upload.delete', targetType: 'upload', targetId: id, before: { sha256: row.sha256, bytes: row.bytes, width: row.width, height: row.height } })
      return row.sha256
    })
    await removeImage(env.uploadsDir, sha)
    return c.body(null, 204)
  })

  return app
}
