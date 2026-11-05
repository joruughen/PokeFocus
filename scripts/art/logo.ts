/**
 * PokeFocus logo: Poké-Ball-with-clock emblem + hand-built pixel wordmark.
 *
 * Fills are CSS variables so the UI can theme the logo:
 *   --logo-primary (ball top, "Poke")   default #e3463b
 *   --logo-accent  (ball outline/band)   default #2b3566
 *   --logo-text    ("Focus")             default #2b3566
 *   --logo-paper   (ball bottom, face)  default #ffffff
 */
import type { Fill, Sprite } from './lib.ts';

export const LOGO_DEFAULTS = { primary: '#e3463b', accent: '#2b3566', paper: '#ffffff' };

export const LOGO_PALETTE: Record<string, Fill> = {
  P: { svg: `var(--logo-primary, ${LOGO_DEFAULTS.primary})`, png: LOGO_DEFAULTS.primary },
  A: { svg: `var(--logo-accent, ${LOGO_DEFAULTS.accent})`, png: LOGO_DEFAULTS.accent },
  T: { svg: `var(--logo-text, ${LOGO_DEFAULTS.accent})`, png: LOGO_DEFAULTS.accent },
  W: { svg: `var(--logo-paper, ${LOGO_DEFAULTS.paper})`, png: LOGO_DEFAULTS.paper },
};

/** 16×16 emblem: ball top P, band/outline A, clock face W with hands at 12 and 3. */
// prettier-ignore
export const MARK_16: string[] = [
  '.....AAAAAA.....',
  '...AAPPPPPPAA...',
  '..APPPPPPPPPPA..',
  '.APWWPPPPPPPPPA.',
  '.APWPPAAAAPPPPA.',
  'APPPPAWAWWAPPPPA',
  'APPPAWWAWWWAPPPA',
  'AAAAAWWAAAWAAAAA',
  'AAAAAWWWWWWAAAAA',
  'AWWWAWWWWWWAWWWA',
  'AWWWWAWWWWAWWWWA',
  '.AWWWWAAAAWWWWA.',
  '.AWWWWWWWWWWWWA.',
  '..AWWWWWWWWWWA..',
  '...AAWWWWWWAA...',
  '.....AAAAAA.....',
];

/** 32×32 emblem with tick marks and a highlight arc. */
// prettier-ignore
export const MARK_32: string[] = [
  '............AAAAAAAA............',
  '.........AAAPPPPPPPPAAA.........',
  '........AAPPPPPPPPPPPPAA........',
  '......AAPPPPPPPPPPPPPPPPAA......',
  '.....AAPPPWPPPPPPPPPPPPPPAA.....',
  '....AAPPWWWWPPPPPPPPPPPPPPAA....',
  '...AAPPWWWPPPPPPPPPPPPPPPPPAA...',
  '...APPWWWPPPPPPPPPPPPPPPPPPPA...',
  '..APPWWWPPPPPAAAAAAPPPPPPPPPPA..',
  '.AAPPWWPPPPAAAAAAAAAAPPPPPPPPAA.',
  '.APPWWPPPPAAAWWAAWWAAAPPPPPPPPA.',
  '.APPWWPPPAAAWWWAAWWWAAAPPPPPPPA.',
  'AAPWWPPPPAAWWWWAAWWWWAAPPPPPPPAA',
  'AAPPPPPPAAWWWWWAAWWWWWAAPPPPPPAA',
  'AAAAAAAAAAWWWWWAAWWWWWAAAAAAAAAA',
  'AAAAAAAAAAAAWWWAAWWWAAAAAAAAAAAA',
  'AAAAAAAAAAAAWWWWWAWWAAAAAAAAAAAA',
  'AAAAAAAAAAWWWWWWWAAWWWAAAAAAAAAA',
  'AAWWWWWWAAWWWWWWWWAAWWAAWWWWWWAA',
  'AAWWWWWWWAAWWWWWWWWWWAAWWWWWWWAA',
  '.AWWWWWWWAAAWWWAAWWWAAAWWWWWWWA.',
  '.AWWWWWWWWAAAWWAAWWAAAWWWWWWWWA.',
  '.AAWWWWWWWWAAAAAAAAAAWWWWWWWWAA.',
  '..AWWWWWWWWWWAAAAAAWWWWWWWWWWA..',
  '...AWWWWWWWWWWWWWWWWWWWWWWWWA...',
  '...AAWWWWWWWWWWWWWWWWWWWWWWAA...',
  '....AAWWWWWWWWWWWWWWWWWWWWAA....',
  '.....AAWWWWWWWWWWWWWWWWWWAA.....',
  '......AAWWWWWWWWWWWWWWWWAA......',
  '........AAWWWWWWWWWWWWAA........',
  '.........AAAWWWWWWWWAAA.........',
  '............AAAAAAAA............',
];

// ------------------------------------------------------------ pixel font
// Caps are 10 px tall, lowercase x-height is 7 px; 2 px vertical strokes.
// '#' = ink. All glyphs share the 10-row box (rows 0–9, baseline = row 9).

// prettier-ignore
const GLYPHS: Record<string, string[]> = {
  P: [
    '######.',
    '#######',
    '##...##',
    '##...##',
    '#######',
    '######.',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
  ],
  F: [
    '######',
    '######',
    '##....',
    '##....',
    '#####.',
    '#####.',
    '##....',
    '##....',
    '##....',
    '##....',
  ],
  o: [
    '......',
    '......',
    '......',
    '.####.',
    '######',
    '##..##',
    '##..##',
    '##..##',
    '######',
    '.####.',
  ],
  k: [
    '##....',
    '##....',
    '##....',
    '##..##',
    '##.##.',
    '####..',
    '#####.',
    '##.##.',
    '##..##',
    '##..##',
  ],
  e: [
    '......',
    '......',
    '......',
    '.####.',
    '##..##',
    '######',
    '######',
    '##....',
    '##..##',
    '.####.',
  ],
  c: [
    '......',
    '......',
    '......',
    '.####.',
    '######',
    '##....',
    '##....',
    '##....',
    '######',
    '.####.',
  ],
  u: [
    '......',
    '......',
    '......',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '######',
    '.#####',
  ],
  s: [
    '......',
    '......',
    '......',
    '.#####',
    '##....',
    '#####.',
    '.#####',
    '....##',
    '#####.',
    '#####.',
  ],
};

/** Render text in the pixel font with one ink char, 1 px tracking. */
export function word(text: string, ink: string): string[] {
  const rows = Array.from({ length: 10 }, () => '');
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for '${ch}'`);
    g.forEach((r, y) => (rows[y] += (i ? '.' : '') + r.replace(/#/g, ink)));
  });
  return rows;
}

/** Place `src` into a w×h canvas at (x, y). */
function place(dst: string[][], src: string[], x: number, y: number): void {
  src.forEach((r, dy) => [...r].forEach((c, dx) => c !== '.' && (dst[y + dy]![x + dx] = c)));
}

function wordmarkRows(): string[] {
  const poke = word('Poke', 'P');
  const focus = word('Focus', 'T');
  return poke.map((r, y) => `${r}.${focus[y]}`);
}

export function logoRows(): string[] {
  const wm = wordmarkRows();
  const w = 16 + 4 + wm[0]!.length, h = 16;
  const px = Array.from({ length: h }, () => Array(w).fill('.'));
  place(px, MARK_16, 0, 0);
  place(px, wm, 20, 3);
  return px.map((r) => r.join(''));
}

export const logoSprites = (): Sprite[] => [
  { name: 'logo', palette: LOGO_PALETTE, rows: logoRows() },
  { name: 'logo-wordmark', palette: LOGO_PALETTE, rows: wordmarkRows() },
  { name: 'logo-mark', palette: LOGO_PALETTE, rows: MARK_32 },
  { name: 'logo-mark-16', palette: LOGO_PALETTE, rows: MARK_16 },
  { name: 'logo-mark-32', palette: LOGO_PALETTE, rows: MARK_32 },
];
