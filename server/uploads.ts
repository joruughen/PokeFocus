/**
 * Event images (docs/admin-plan.md §3): validate, re-encode and store.
 *
 * Nothing the admin uploads is ever stored or served as is. The bytes are checked by their
 * magic numbers (PNG, JPEG or WebP; no SVG, GIF, HEIC or HTML), decoded with sharp
 * (`limitInputPixels`: no decompression bombs) and encoded again: the output is always a
 * 16:9 WebP without EXIF/ICC (1600×900 at most, 320×180 at least, plus a 480 px card version).
 * The file name is the sha256 of the stored image; the original name is never used.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024
/** Total size of every stored image (main + card version). */
export const UPLOADS_TOTAL_LIMIT_BYTES = 500 * 1024 * 1024
export const MAX_INPUT_PIXELS = 40_000_000
export const IMAGE_MAX = { width: 1600, height: 900 } as const
export const IMAGE_MIN = { width: 320, height: 180 } as const
export const THUMB_WIDTH = 480
export const WEBP_QUALITY = 82
export const UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type UploadMime = (typeof UPLOAD_MIME_TYPES)[number]

/** Public name of a stored image: `<sha256>.webp` or `<sha256>-480.webp`. */
export const MEDIA_FILE_RE = /^[a-f0-9]{64}(-480)?\.webp$/
export const mediaUrl = (sha256: string, thumb = false): string => `/media/events/${sha256}${thumb ? '-480' : ''}.webp`

// Small, predictable footprint: no libvips cache and one decoder thread at a time.
sharp.cache(false)
sharp.concurrency(1)

export class ImageError extends Error {
  readonly status: 415 | 422
  readonly code: 'unsupported_type' | 'invalid_image' | 'image_too_small' | 'image_too_large' | 'animated_image'
  constructor(status: 415 | 422, code: ImageError['code']) {
    super(code)
    this.status = status
    this.code = code
  }
}

/** The format the first bytes say, or null (SVG, GIF, HEIC, HTML… all end up null). */
export function sniffImage(b: Uint8Array): UploadMime | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v)
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

export interface ProcessedImage {
  sha256: string
  main: Buffer
  thumb: Buffer
  width: number
  height: number
}

/**
 * Validate and re-encode an upload. `declared` is the request's Content-Type: it must be one of
 * the three and agree with the magic bytes. Throws ImageError (415 / 422).
 */
export async function processImage(input: Uint8Array, declared: string): Promise<ProcessedImage> {
  const mime = sniffImage(input)
  if (!mime || !(UPLOAD_MIME_TYPES as readonly string[]).includes(declared) || mime !== declared) throw new ImageError(415, 'unsupported_type')
  try {
    const src = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    const meta = await src.metadata()
    if ((meta.pages ?? 1) > 1) throw new ImageError(422, 'animated_image')
    // EXIF orientations 5–8 swap the axes; the pipeline below auto-rotates.
    const swap = (meta.orientation ?? 1) >= 5
    const w = (swap ? meta.height : meta.width) ?? 0
    const h = (swap ? meta.width : meta.height) ?? 0
    if (w < 1 || h < 1) throw new ImageError(422, 'invalid_image')
    if (w * h > MAX_INPUT_PIXELS) throw new ImageError(422, 'image_too_large')
    if (w < IMAGE_MIN.width || h < IMAGE_MIN.height) throw new ImageError(422, 'image_too_small')
    // Largest centred 16:9 crop, never enlarged: 1600×900 at most.
    const cropW = w * 9 > h * 16 ? Math.round((h * 16) / 9) : w
    const outW = Math.min(IMAGE_MAX.width, cropW)
    const outH = Math.round((outW * 9) / 16)
    const thumbW = Math.min(THUMB_WIDTH, outW)
    const thumbH = Math.round((thumbW * 9) / 16)
    const pipe = src.rotate() // applies EXIF orientation; no metadata is carried to the output
    const encode = (width: number, height: number) =>
      pipe.clone().resize(width, height, { fit: 'cover', position: 'centre' }).webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer()
    const main = await encode(outW, outH)
    const thumb = await encode(thumbW, thumbH)
    return { sha256: createHash('sha256').update(main).digest('hex'), main, thumb, width: outW, height: outH }
  } catch (e) {
    if (e instanceof ImageError) throw e
    const m = e instanceof Error ? e.message : ''
    throw new ImageError(422, /pixel limit/i.test(m) ? 'image_too_large' : 'invalid_image')
  }
}

/** Directory of the event images inside UPLOADS_DIR. */
export const eventsDir = (uploadsDir: string): string => join(resolve(uploadsDir), 'events')

/** Absolute path of a media file, or null unless `file` is exactly `<sha256>(-480)?.webp` (no traversal). */
export function mediaPath(uploadsDir: string, file: string): string | null {
  return MEDIA_FILE_RE.test(file) ? join(eventsDir(uploadsDir), file) : null
}

async function writeAtomic(path: string, data: Buffer): Promise<void> {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await writeFile(tmp, data, { mode: 0o644 })
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true })
  }
}

/** Write both files (idempotent: the content is addressed by its hash). */
export async function storeImage(uploadsDir: string, img: ProcessedImage): Promise<{ path: string }> {
  const dir = eventsDir(uploadsDir)
  await mkdir(dir, { recursive: true })
  await writeAtomic(join(dir, `${img.sha256}.webp`), img.main)
  await writeAtomic(join(dir, `${img.sha256}-480.webp`), img.thumb)
  return { path: `events/${img.sha256}.webp` }
}

export async function removeImage(uploadsDir: string, sha256: string): Promise<void> {
  const dir = eventsDir(uploadsDir)
  await rm(join(dir, `${sha256}.webp`), { force: true })
  await rm(join(dir, `${sha256}-480.webp`), { force: true })
}

/** The file's bytes, or null when it does not exist. */
export async function readMedia(uploadsDir: string, file: string): Promise<Buffer | null> {
  const p = mediaPath(uploadsDir, file)
  if (!p) return null
  try {
    return await readFile(p)
  } catch {
    return null
  }
}
