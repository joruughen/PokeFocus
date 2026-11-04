/**
 * Profe Pika — the PokeFocus mascot (48×48).
 *
 * IDLE is the canonical hand-edited grid. Every other pose is IDLE plus
 * char-grid patches, so head, glasses and proportions stay identical.
 *
 * Patch chars: '_' = keep the pixel underneath, '.' = clear to transparent,
 * anything else = palette char (see MASCOT_PALETTE in palette.ts).
 * Stamp chars: like patches, but '.' also means keep (for overlay sprites).
 */
import { outlined, type Sprite } from './lib.ts';
import { MASCOT_PALETTE } from './palette.ts';

export type Grid = string[];

// prettier-ignore
export const IDLE: Grid = [
  '................................................',
  '...oKKo.................................oKKo....',
  '...oKKKo...............................oKKKo....',
  '....oKKKoo...........................ooKKKo.....',
  '....oKKKKKo.........................oKKKKKo.....',
  '.....oKKKKYo.......................oLKKKKo......',
  '.....oKKKYYYo.....................oLLYKKKo......',
  '......oKYYYYYo...................oLLYYyKo.......',
  '.......oyYYYYYo.................oLLYYYyo........',
  '.......oyYYYYYYoo.............ooLLYYYydo........',
  '........oyYYYYYYYo.ooooooooo.oLLYYYYYyo.........',
  '........oyyYYYYYoooLLYYYYYYYoooYYYYYydo......o..',
  '.........oyYYYooLLYYYYYYYYYYYYYooYYydo......oyo.',
  '..........oyYoLLYYYYYYYYYYYYYYYYYoYyo......oLyo.',
  '..........oyoLLYYYYYYYYYYYYYYYYYYYodo.....oLLyo.',
  '...........oLLYYYYYYYYYYYYYYYYYYYYYo.....oLLYyo.',
  '..........oLLYYYYYYYYYYYYYYYYYYYYYYyo...oLLYYyo.',
  '..........oLYYYGGGGGYYYYYYYGGGGGYYYYo..oLLYYYyo.',
  '.........oLLYYGGYYlGGYYYYYGGYYlGGYYYyooLLYYYYyo.',
  '.........oLYYGGYYoYlGGYYYGGYYoYlGGYYyoLLYYYYYYo.',
  '.........oLYYGYYoWoYYGGGGGYYoWoYYGYYyoLYYYYYYYyo',
  '.........oLYYGYYoooYYGYYYGYYoooYYGYYyoYYYYYYYYyo',
  '.........oLYYGYYoooYYGYYYGYYoooYYGYYyoYYYYYYYYyo',
  '.........oyYYGGYYoYYGGYYYGGYYoYYGGYYyoYYYYYYYYyo',
  '.........oyYYYGGYYYGGYYoYYGGYYYGGYYydoYYYYYYYYyo',
  '..........oyPRRGGGGGYYYYYYYGGGGGPRRyoYYYYYYYYYyo',
  '..........oRRRRRYYYYYmYYYYmYYYYRRRRRoYYYYYYYYyyo',
  '...........orrrrYYYYYYmmmmYYYYYrrrroLLYYYYyyyydo',
  '............oyyyYYYYYYYYYYYYYYYyydoYYYYYyyyydoo.',
  '.............oyyyyyYYYYYYYYYyyyydoYYYYYyydooo...',
  '..............ooyyyyyyyyyyyyyydooYYYYYydoo......',
  '................oooyyyyyyyydooo.oYYYYYyo........',
  '..................oooooooooooyyyyLYYYYYo........',
  '..................oLYYYYYYYYyoyyyYYYYYYYo.......',
  '................oLYYYYYYYYYYYYyoyYYYYyyyyo......',
  '................oLYYYoYYYYoYYYyoyYYYyyyydo......',
  '................oLYYYyoYYoYYYyyoyYYydoooo.......',
  '...............oLyYYYyoYYoYYyyyooBBBo...........',
  '...............oLyooooYYYYooooyooBBBo...........',
  '...............oLYYYYYYYYYYYYyyooBBBBo..........',
  '...............oLYYYYYYYYYYYYYydobbbbo..........',
  '...............oLyyyyyyyyyyyyyydobbbbbo.........',
  '................oyyyyyyyyyyyyydo.ooooo..........',
  '...............oLYYYyooooooLYYYyo...............',
  '...............oyyyydo....oyyyydo...............',
  '................ooooo......ooooo................',
  '................................................',
  '................................................',
];

// ------------------------------------------------------------ composition

function edit(base: Grid, fn: (px: string[][]) => void): Grid {
  const px = base.map((r) => [...r]);
  fn(px);
  return px.map((r) => r.join(''));
}

/** Overwrite a block; '_' keeps, '.' clears. */
function patch(px: string[][], x: number, y: number, rows: Grid): void {
  rows.forEach((r, dy) =>
    [...r].forEach((c, dx) => {
      const yy = y + dy, xx = x + dx;
      if (c === '_' || yy < 0 || yy >= px.length || xx < 0 || xx >= px[0]!.length) return;
      px[yy]![xx] = c;
    }),
  );
}

/** Overlay a sprite; both '.' and '_' keep what is underneath. */
function stamp(px: string[][], x: number, y: number, rows: Grid): void {
  patch(px, x, y, rows.map((r) => r.replace(/\./g, '_')));
}

/** Mirror a patch horizontally (for symmetric limbs). */
const mirror = (rows: Grid): Grid => rows.map((r) => [...r].reverse().join(''));

// ------------------------------------------------------------ shared parts

/** Torso rows 35–38 with both front arms removed (x15..31). */
const TORSO_PLAIN: Grid = [
  '_oLYYYYYYYYYYYYyo',
  '_oLYYYYYYYYYYYyyo',
  'oLYYYYYYYYYYYYyyo',
  'oLYYYYYYYYYYYYyyo',
];

/** IDLE's folded right arm (viewer's right), x24..31 rows 35–38. */
const ARM_FRONT_R: Grid = [
  '__o_____',
  '_o______',
  '_o______',
  '__oooo__',
];

/** Raised left arm for cheering (x4..18, rows 24–36). */
const ARM_UP_L: Grid = [
  '_ooo___________',
  'oLYYo__________',
  'oLYYYo_________',
  'oYYYYo_________',
  '_oYYYYo________',
  '__oyYYYo_______',
  '___oyYYYo______',
  '____oyYYYo_____',
  '_____oyYYYo____',
  '______oyYYYoo__',
  '_______oyYYYYL_',
  '________oyyyYL_',
  '_________ooooo_',
];

/** Arm stretched out to the viewer's left, finger up (x5..17, rows 32–37). */
const ARM_POINT_L: Grid = [
  '_ooo_________',
  'oLYoooooooooo',
  'oYYYLLLLLLLLL',
  'oYYYYYYYYYYYY',
  'oyyyyyyyyyyyY',
  '_ooooooooooo_',
];

/** Paw raised to the chin (x20..31, rows 28–35). */
const ARM_CHIN_R: Grid = [
  '_ooooo______',
  'oLLYYYo_____',
  'oLYYYYyo____',
  '_oyYYYYyo___',
  '__ooyYYYyo__',
  '____oyYYYyo_',
  '_____oyYYyo_',
  '______oyyyo_',
];

/** Graduation cap sitting between the ears (x15..32, rows 4–11). */
const CAP: Grid = [
  '_______oooo_______',
  '____oooccccooo____',
  '_ooocccccCCCCCooo_',
  'oCCCCCCCCCCCCCCCQo',
  '_ooooCCCCCCCCooooQ',
  '____oCCCCCCCCo___Q',
  '___ocCCCCCCCCCo__q',
  '___oooooooooooo___',
];

const SPARKLE_BIG: Grid = ['..Q..', '..Q..', 'QQWQQ', '..Q..', '..Q..'];
const SPARKLE_SMALL: Grid = ['.Q.', 'QWQ', '.Q.'];

// ------------------------------------------------------------ poses

export const POINT: Grid = edit(IDLE, (px) => {
  patch(px, 15, 35, TORSO_PLAIN);
  patch(px, 24, 35, ARM_FRONT_R);
  patch(px, 5, 32, ARM_POINT_L);
  // talking: open mouth
  patch(px, 21, 26, ['mmmmmm', 'YmTTmY']);
});

export const CHEER: Grid = edit(IDLE, (px) => {
  patch(px, 15, 35, TORSO_PLAIN);
  patch(px, 4, 24, ARM_UP_L);
  patch(px, 47 - 4 - 14, 24, mirror(ARM_UP_L));
  // happy closed eyes ^ ^
  for (const ex of [16, 28]) patch(px, ex, 19, ['YYY', 'YoY', 'oYo', 'YYY', 'YYY']);
  // big open mouth with tongue
  patch(px, 21, 26, ['mmmmmm', 'YmTTmY', '__mm__']);
  patch(px, 15, 4, CAP);
  stamp(px, 0, 10, outlined(SPARKLE_BIG));
  stamp(px, 35, 0, outlined(SPARKLE_SMALL));
  stamp(px, 1, 40, outlined(SPARKLE_SMALL));
  stamp(px, 41, 38, outlined(SPARKLE_SMALL));
});

export const THINK: Grid = edit(IDLE, (px) => {
  patch(px, 15, 35, TORSO_PLAIN);
  // keep the left folded arm from IDLE
  patch(px, 17, 35, ['____o', '____yo', 'y___yo', 'yoooo']);
  patch(px, 20, 28, ARM_CHIN_R);
  // eyes glance up
  for (const ex of [16, 28]) patch(px, ex, 19, ['oWo', 'ooo', 'ooo', '.o.'.replace(/\./g, 'Y'), 'YYY']);
  // pursed mouth
  patch(px, 21, 26, ['YYYYYY', 'YYmmYY']);
  // big glint across both lenses
  patch(px, 17, 18, ['lW', '_lW', '__l']);
  patch(px, 29, 18, ['lW', '_lW', '__l']);
  // glint sparkle off the frame
  stamp(px, 31, 12, outlined(SPARKLE_SMALL));
  // thought dots
  stamp(px, 2, 12, outlined(['W']));
  stamp(px, 1, 7, outlined(['WW', 'WW']));
});

/** Open book, 44×10, used by the sleep pose. */
// prettier-ignore
const BOOK: Grid = [
  '..oooooooooooooooooo....oooooooooooooooooo..',
  '.oppppppppppppppppppoooopppppppppppppppppppo.',
  '.opsssssssssssssspppsoospppsssssssssssssspo.',
  '.opppppppppppppppppppsosppppppppppppppppppo.',
  '.opssssssssssssspppppsospppppsssssssssssspo.',
  '.oppppppppppppppppppppoppppppppppppppppppppo.',
  'oNNNNNNNNNNNNNNNNNNNNoNNNNNNNNNNNNNNNNNNNNNo',
  'onnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnno',
  '.oooooooooooooooooooooooooooooooooooooooooo.',
];

const ZZZ: Grid = ['ZZZZZ', '...Z.', '..Z..', '.Z...', 'ZZZZZ'];
const ZZ: Grid = ['ZZZZ', '..Z.', '.Z..', 'ZZZZ'];

export const SLEEP: Grid = edit(IDLE, (px) => {
  // move the whole IDLE figure down; the book hides the body
  const src = IDLE.map((r) => [...r]);
  const dy = 9;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) px[y]![x] = y - dy >= 0 ? src[y - dy]![x]! : '.';
  // closed eyes
  for (const ex of [16, 28]) patch(px, ex, 19 + dy, ['YYY', 'YYY', 'ooo', 'yyy', 'YYY']);
  // small sleepy mouth
  patch(px, 21, 26 + dy, ['YYYYYY', 'YYmmYY']);
  // paws on the book
  stamp(px, 6, 34, ['.ooo.', 'oLYYo', 'oYYyo']);
  stamp(px, 37, 34, ['.ooo.', 'oLYYo', 'oYYyo']);
  stamp(px, 2, 37, BOOK);
  patch(px, 0, 46, ['.'.repeat(48), '.'.repeat(48)]);
  stamp(px, 29, 6, outlined(ZZ));
  stamp(px, 35, 0, outlined(ZZZ));
});

export const MASCOT_POSES: Record<string, Grid> = {
  idle: IDLE,
  point: POINT,
  cheer: CHEER,
  think: THINK,
  sleep: SLEEP,
};

export const mascotSprites = (): Sprite[] =>
  Object.entries(MASCOT_POSES).map(([pose, rows]) => ({ name: `mascot-${pose}`, palette: MASCOT_PALETTE, rows }));
