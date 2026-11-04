/**
 * Build all PokeFocus pixel art into public/art/.
 *
 *   npx tsx scripts/art/build.ts
 *
 * Emits crisp SVGs (one <rect> per horizontal run), PNGs at 4× and 8×,
 * favicons and a contact sheet. No dependencies beyond Node.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blit, encodePNG, fillRect, newImage, render, size, toSVG, validate, type Sprite } from './lib.ts';
import { mascotSprites } from './mascot.ts';
import { logoSprites, MARK_16, MARK_32, LOGO_PALETTE } from './logo.ts';
import { iconSprites, ICON_TINTS } from './icons.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'art');
const PNG_OUT = join(OUT, 'png');
mkdirSync(PNG_OUT, { recursive: true });

const TITLES: Record<string, string> = {
  'mascot-idle': 'Profe Pika',
  'mascot-point': 'Profe Pika señalando',
  'mascot-cheer': 'Profe Pika celebrando',
  'mascot-think': 'Profe Pika pensando',
  'mascot-sleep': 'Profe Pika durmiendo sobre un libro',
  logo: 'PokeFocus',
};

const mascots = mascotSprites();
const logos = logoSprites();
const icons = iconSprites();

mascots.forEach((s) => validate(s, 48, 48));
logos.forEach((s) => validate(s));
icons.forEach((s) => validate(s, 12, 12));

const written: string[] = [];
const write = (name: string, data: string | Buffer) => {
  writeFileSync(join(OUT, name), data);
  written.push(name);
};
const tintOf = (s: Sprite) => ICON_TINTS[s.name];

for (const s of [...mascots, ...logos, ...icons]) {
  write(`${s.name}.svg`, toSVG(s, { title: TITLES[s.name] }));
  for (const k of [4, 8]) write(`png/${s.name}@${k}x.png`, encodePNG(render(s, k, undefined, tintOf(s))));
}

// Favicons from the emblem.
const fav16: Sprite = { name: 'favicon', palette: LOGO_PALETTE, rows: MARK_16 };
const fav32: Sprite = { name: 'favicon-hi', palette: LOGO_PALETTE, rows: MARK_32 };
write('favicon.svg', toSVG(fav16, { title: 'PokeFocus' }));
write('favicon-32.png', encodePNG(render(fav16, 2)));
{
  // Apple touch icon: opaque, 32×32 emblem at 5× (160px) centred on 180px.
  const img = newImage(180, 180, '#fdf3d7');
  blit(img, fav32, 10, 10, 5);
  write('favicon-180.png', encodePNG(img));
}

// Contact sheet: everything at 4× on a neutral background, one row per group.
{
  const S = 4, PAD = 16, BG = '#c9ccd1';
  const groups = [mascots, logos.filter((s) => s.name !== 'logo-mark'), icons];
  const rowW = (g: Sprite[]) => g.reduce((a, s) => a + size(s).w * S + PAD, PAD);
  const rowH = (g: Sprite[]) => Math.max(...g.map((s) => size(s).h * S)) + PAD;
  const W = Math.max(...groups.map(rowW));
  const H = groups.reduce((a, g) => a + rowH(g), PAD) + 24 * S + PAD; // + mascot-on-dark strip
  const img = newImage(W, H, BG);
  let y = PAD;
  for (const g of groups) {
    let x = PAD;
    for (const s of g) {
      blit(img, s, x, y, S, tintOf(s));
      x += size(s).w * S + PAD;
    }
    y += rowH(g);
  }
  // Mascots at 2× on light and dark surfaces, to check readability.
  fillRect(img, 0, y, W / 2, 24 * S + PAD, '#f4efe4');
  fillRect(img, W / 2, y, W - W / 2, 24 * S + PAD, '#1f2229');
  mascots.forEach((s, i) => {
    blit(img, s, PAD + i * (96 + 8), y + 8, 2);
    blit(img, s, W / 2 + PAD + i * (96 + 8), y + 8, 2);
  });
  write('_contact-sheet.png', encodePNG(img));
}

console.log(`wrote ${written.length} files to ${OUT}`);
