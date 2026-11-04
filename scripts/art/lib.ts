/**
 * PokeFocus pixel-art toolkit.
 *
 * A sprite is a palette (char -> fill) plus a grid of strings, one char per
 * pixel. '.' and ' ' are always transparent. Fills can be a plain hex colour
 * or `{ svg, png }` when the SVG should use a CSS expression
 * (e.g. `currentColor` or `var(--logo-primary, #e8483f)`) while the PNG
 * export needs a concrete colour. An array stacks layers bottom-to-top
 * (e.g. `['currentColor', '#00000059']` = a darker shade of the tint).
 */
import { deflateSync } from 'node:zlib';

export type Fill = string | { svg: string; png: string } | Fill[];

export interface Sprite {
  name: string;
  palette: Record<string, Fill>;
  rows: string[];
}

const TRANSPARENT = new Set(['.', ' ']);

export function size(s: Sprite): { w: number; h: number } {
  return { w: Math.max(...s.rows.map((r) => r.length)), h: s.rows.length };
}

/** Throws on ragged rows or chars missing from the palette. */
export function validate(s: Sprite, expectW?: number, expectH?: number): void {
  const { w, h } = size(s);
  s.rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`${s.name}: row ${y} has ${r.length} px, expected ${w}`);
    for (const c of r) {
      if (!TRANSPARENT.has(c) && !(c in s.palette)) throw new Error(`${s.name}: row ${y} unknown char '${c}'`);
    }
  });
  if (expectW !== undefined && w !== expectW) throw new Error(`${s.name}: width ${w} != ${expectW}`);
  if (expectH !== undefined && h !== expectH) throw new Error(`${s.name}: height ${h} != ${expectH}`);
}

/** Flatten a fill into its layers as [svgFill, pngFill] pairs. */
function layers(f: Fill): Array<[string, string]> {
  if (Array.isArray(f)) return f.flatMap(layers);
  if (typeof f === 'string') return [[f, f]];
  return [[f.svg, f.png]];
}

/** SVG with one <rect> per horizontal run, grouped by fill (layer 0 first, overlays after). */
export function toSVG(s: Sprite, opts: { title?: string } = {}): string {
  const { w, h } = size(s);
  // key: `${layer}|${svgFill}` -> rects; Map keeps insertion order, sorted by layer below.
  const groups = new Map<string, string[]>();
  const order = Object.keys(s.palette);
  for (const c of order) layers(s.palette[c]!).forEach(([f], i) => groups.set(`${i}|${f}`, groups.get(`${i}|${f}`) ?? []));
  s.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      let e = x + 1;
      while (e < row.length && row[e] === c) e++;
      if (!TRANSPARENT.has(c)) {
        layers(s.palette[c]!).forEach(([f], i) => groups.get(`${i}|${f}`)!.push(`<rect x="${x}" y="${y}" width="${e - x}" height="1"/>`));
      }
      x = e;
    }
  });
  const body = [...groups.entries()]
    .filter(([, r]) => r.length)
    .sort(([a], [b]) => Number(a.split('|')[0]) - Number(b.split('|')[0]))
    .map(([k, r]) => `<g fill="${k.slice(k.indexOf('|') + 1)}">${r.join('')}</g>`)
    .join('');
  const title = opts.title ? `<title>${opts.title}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `shape-rendering="crispEdges">${title}${body}</svg>\n`
  );
}

/** Wrap a small sprite with a 1px outline (4-neighbour) in `o`. */
export function outlined(rows: string[]): string[] {
  const h = rows.length + 2, w = (rows[0] ?? '').length + 2;
  const src = ['.'.repeat(w), ...rows.map((r) => `.${r}.`), '.'.repeat(w)];
  const solid = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && !'._'.includes(src[y]![x]!);
  return src.map((r, y) =>
    [...r].map((c, x) => (solid(x, y) ? c : solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1) ? 'o' : '.')).join(''),
  );
}

// ---------------------------------------------------------------- raster

export interface Image {
  w: number;
  h: number;
  data: Uint8Array; // RGBA
}

export function newImage(w: number, h: number, bg?: string): Image {
  const img = { w, h, data: new Uint8Array(w * h * 4) };
  if (bg) fillRect(img, 0, 0, w, h, bg);
  return img;
}

export function hex(c: string): [number, number, number, number] {
  let m = c.replace('#', '');
  if (m.length === 3) m = [...m].map((x) => x + x).join('');
  const n = parseInt(m.slice(0, 6), 16);
  const a = m.length === 8 ? parseInt(m.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** Source-over fill (alpha from #RRGGBBAA is blended). */
export function fillRect(img: Image, x0: number, y0: number, w: number, h: number, color: string): void {
  const [r, g, b, a] = hex(color);
  const sa = a / 255;
  for (let y = Math.max(0, y0); y < Math.min(img.h, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.w, x0 + w); x++) {
      const i = (y * img.w + x) * 4;
      const d = img.data;
      const da = d[i + 3]! / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) continue;
      const mix = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / oa);
      d[i] = mix(r, d[i]!);
      d[i + 1] = mix(g, d[i + 1]!);
      d[i + 2] = mix(b, d[i + 2]!);
      d[i + 3] = Math.round(oa * 255);
    }
  }
}

/** Paint a sprite at integer scale; `tint` is used wherever the SVG says `currentColor`. */
export function blit(img: Image, s: Sprite, ox: number, oy: number, scale: number, tint = '#888888'): void {
  s.rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (TRANSPARENT.has(c)) return;
      for (const [svg, png] of layers(s.palette[c]!)) {
        fillRect(img, ox + x * scale, oy + y * scale, scale, scale, svg === 'currentColor' ? tint : png);
      }
    });
  });
}

export function render(s: Sprite, scale: number, bg?: string, tint?: string): Image {
  const { w, h } = size(s);
  const img = newImage(w * scale, h * scale, bg);
  blit(img, s, 0, 0, scale, tint);
  return img;
}

/** Fit a sprite into an exact square of `px` pixels (nearest-neighbour, centered). */
export function renderFit(s: Sprite, px: number, bg?: string, tint?: string): Image {
  const { w, h } = size(s);
  const scale = Math.max(1, Math.floor(px / Math.max(w, h)));
  const img = newImage(px, px, bg);
  blit(img, s, Math.floor((px - w * scale) / 2), Math.floor((px - h * scale) / 2), scale, tint);
  return img;
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Minimal RGBA8 PNG encoder (filter type 0 on every scanline). */
export function encodePNG(img: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = img.w * 4;
  const raw = Buffer.alloc((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
