/** Image sanitizing (server/uploads.ts): images are generated in the test with sharp; nothing is read from disk. */
import { crc32, deflateSync } from 'node:zlib'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { ImageError, mediaPath, processImage, removeImage, sniffImage, storeImage, IMAGE_MAX, MAX_INPUT_PIXELS } from './uploads'

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()
const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 30, b: 200 } } }).jpeg().toBuffer()

async function rejection(input: Uint8Array, type: string): Promise<[number, string]> {
  try {
    await processImage(input, type)
  } catch (e) {
    if (e instanceof ImageError) return [e.status, e.code]
    throw e
  }
  throw new Error('expected a rejection')
}

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('sniffImage', () => {
  it('recognizes png, jpeg and webp by their magic numbers and nothing else', async () => {
    expect(sniffImage(await png(8, 8))).toBe('image/png')
    expect(sniffImage(await jpeg(8, 8))).toBe('image/jpeg')
    expect(sniffImage(await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).webp().toBuffer())).toBe('image/webp')
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImage(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull()
    expect(sniffImage(Buffer.from('GIF89a\x01\x00\x01\x00'))).toBeNull()
    expect(sniffImage(Buffer.from('....ftypheic....'))).toBeNull()
    expect(sniffImage(new Uint8Array(0))).toBeNull()
  })
})

describe('processImage', () => {
  it('re-encodes a PNG into a 16:9 webp (1600x900 at most) with a 480 px card version and a hash name', async () => {
    const out = await processImage(await png(2400, 1350), 'image/png')
    expect(out).toMatchObject({ width: IMAGE_MAX.width, height: IMAGE_MAX.height })
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(sniffImage(out.main)).toBe('image/webp')
    const main = await sharp(out.main).metadata()
    expect([main.format, main.width, main.height]).toEqual(['webp', 1600, 900])
    const thumb = await sharp(out.thumb).metadata()
    expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 480, 270])
  })

  it('is deterministic: the same picture hashes the same', async () => {
    const a = await processImage(await jpeg(800, 450), 'image/jpeg')
    const b = await processImage(await jpeg(800, 450), 'image/jpeg')
    expect(a.sha256).toBe(b.sha256)
  })

  it('crops to 16:9 (centred) and never enlarges', async () => {
    const tall = await processImage(await png(600, 900), 'image/png')
    expect([tall.width, tall.height]).toEqual([600, 338])
    const wide = await processImage(await png(2000, 500), 'image/png')
    expect([wide.width, wide.height]).toEqual([889, 500])
    const small = await processImage(await png(320, 180), 'image/png')
    expect([small.width, small.height]).toEqual([320, 180])
    expect((await sharp(small.thumb).metadata()).width).toBe(320)
  })

  it('strips EXIF and every other metadata', async () => {
    const withExif = await sharp({ create: { width: 640, height: 360, channels: 3, background: 'green' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-owner', ImageDescription: 'GPS home' } })
      .toBuffer()
    expect((await sharp(withExif).metadata()).exif).toBeDefined()
    const out = await processImage(withExif, 'image/jpeg')
    for (const buf of [out.main, out.thumb]) {
      const m = await sharp(buf).metadata()
      expect(m.exif).toBeUndefined()
      expect(m.icc).toBeUndefined()
      expect(m.xmp).toBeUndefined()
      expect(buf.includes(Buffer.from('secret-owner'))).toBe(false)
    }
  })

  it('applies the EXIF orientation before cropping', async () => {
    // 800x450 stored sideways (orientation 6 = rotate 90): it displays as 450x800.
    const sideways = await sharp({ create: { width: 800, height: 450, channels: 3, background: 'blue' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const out = await processImage(sideways, 'image/jpeg')
    expect([out.width, out.height]).toEqual([450, 253])
  })

  it('rejects SVG, HTML and GIF whatever Content-Type they claim (415)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><script>alert(1)</script></svg>')
    const html = Buffer.from('<!doctype html><html><script>alert(1)</script></html>')
    const gif = await sharp({ create: { width: 400, height: 300, channels: 3, background: 'red' } }).gif().toBuffer()
    for (const type of ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'text/html', 'image/gif']) {
      expect(await rejection(svg, type), `svg as ${type}`).toEqual([415, 'unsupported_type'])
      expect(await rejection(html, type), `html as ${type}`).toEqual([415, 'unsupported_type'])
      expect(await rejection(gif, type), `gif as ${type}`).toEqual([415, 'unsupported_type'])
    }
  })

  it('rejects a Content-Type that disagrees with the bytes, and types outside the three', async () => {
    expect(await rejection(await png(640, 360), 'image/jpeg')).toEqual([415, 'unsupported_type'])
    expect(await rejection(await jpeg(640, 360), 'image/png')).toEqual([415, 'unsupported_type'])
    expect(await rejection(await png(640, 360), 'application/octet-stream')).toEqual([415, 'unsupported_type'])
  })

  it('rejects an image below 320x180 (422) and a corrupt or truncated one (422)', async () => {
    expect(await rejection(await png(319, 400), 'image/png')).toEqual([422, 'image_too_small'])
    expect(await rejection(await png(640, 179), 'image/png')).toEqual([422, 'image_too_small'])
    const good = await png(640, 360)
    expect(await rejection(good.subarray(0, 40), 'image/png')).toEqual([422, 'invalid_image'])
    expect(await rejection(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not really a jpeg at all')]), 'image/jpeg')).toEqual([422, 'invalid_image'])
  })

  it('rejects a decompression bomb by its header, before decoding (422)', async () => {
    // A PNG that only claims 9000x9000 (81 MP): the check must not need the pixel data.
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(9000, 0)
    ihdr.writeUInt32BE(9000, 4)
    ihdr.set([8, 2, 0, 0, 0], 8)
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length)
      const body = Buffer.concat([Buffer.from(type), data])
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(body))
      return Buffer.concat([len, body, crc])
    }
    const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(16))), chunk('IEND', Buffer.alloc(0))])
    expect(9000 * 9000).toBeGreaterThan(MAX_INPUT_PIXELS)
    expect(await rejection(bomb, 'image/png')).toEqual([422, 'image_too_large'])
  })

  it('rejects an animated image (422)', async () => {
    const frames = Buffer.concat([Buffer.alloc(400 * 180 * 3, 40), Buffer.alloc(400 * 180 * 3, 220)])
    const animated = await sharp(frames, { raw: { width: 400, height: 360, channels: 3, pageHeight: 180 } }).webp({ delay: [100, 100], loop: 0 }).toBuffer()
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2)
    expect(await rejection(animated, 'image/webp')).toEqual([422, 'animated_image'])
  })
})

describe('storage on disk', () => {
  it('writes <sha>.webp and <sha>-480.webp under events/, and removes them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-uploads-'))
    dirs.push(dir)
    const img = await processImage(await png(640, 360), 'image/png')
    const { path } = await storeImage(dir, img)
    expect(path).toBe(`events/${img.sha256}.webp`)
    expect(readdirSync(join(dir, 'events')).sort()).toEqual([`${img.sha256}-480.webp`, `${img.sha256}.webp`])
    await storeImage(dir, img) // idempotent
    expect(readdirSync(join(dir, 'events'))).toHaveLength(2)
    await removeImage(dir, img.sha256)
    expect(readdirSync(join(dir, 'events'))).toEqual([])
  })

  it('mediaPath only resolves exact hash names (no traversal, no other extensions)', () => {
    const sha = 'a'.repeat(64)
    expect(mediaPath('/data/uploads', `${sha}.webp`)).toMatch(/events\/a{64}\.webp$/)
    expect(mediaPath('/data/uploads', `${sha}-480.webp`)).toMatch(/events\/a{64}-480\.webp$/)
    for (const bad of [`../${sha}.webp`, `${sha}.png`, `${sha}.svg`, `${sha}.webp/..`, `${sha.slice(1)}.webp`, `${sha.toUpperCase()}.webp`, '..%2f..%2fetc%2fpasswd', `${sha}-960.webp`]) {
      expect(mediaPath('/data/uploads', bad), bad).toBeNull()
    }
  })
})
