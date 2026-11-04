/**
 * 12×12 UI icons. `c` is `currentColor` so the UI can tint them; `h`/`d`
 * are lighter/darker shades of that same tint (stacked translucent layers);
 * `o` is a fixed dark outline that reads on both light and dark surfaces.
 */
import type { Fill, Sprite } from './lib.ts';

const CUR = { svg: 'currentColor', png: '#888888' };

export const ICON_PALETTE: Record<string, Fill> = {
  o: '#1c1a24', // outline
  c: CUR, // main tint
  h: [CUR, '#ffffff73'], // tint highlight
  d: [CUR, '#00000059'], // tint shade
  w: '#ffffff', // white
  s: '#b9bdd0', // pale grey (pages, glass)
  Q: '#f2b035', // gold (tassel)
  q: '#c07a1a', // gold shade
};

/** Default tints used for PNG previews / contact sheet only. */
export const ICON_TINTS: Record<string, string> = {
  'stat-energy': '#f6c945',
  'stat-pace': '#4fc3f7',
  'stat-output': '#7bd389',
  'stat-catch': '#e8483f',
  'stat-technique': '#b48cff',
  'stat-grit': '#8da2c0',
  'icon-study-ball': '#e8483f',
  'icon-dust': '#c9a2ff',
  'icon-candy': '#5aa9ff',
  'icon-leader': '#f6c945',
  'icon-timer': '#4fc3f7',
  'icon-bond': '#ff6fa5',
  'icon-shiny': '#ffd84a',
  'icon-sleep': '#8fb4ff',
  'icon-paralysis': '#f6c945',
};

// prettier-ignore
export const ICONS: Record<string, string[]> = {
  // Energía — battery with a bolt
  'stat-energy': [
    '....oooo....',
    '....occo....',
    '..oooooooo..',
    '..ohccccco..',
    '..ohccwwco..',
    '..ohcwwcco..',
    '..ohwwwwco..',
    '..occwwcco..',
    '..ocwwccco..',
    '..ocwcccdo..',
    '..oddddddo..',
    '..oooooooo..',
  ],
  // Ritmo — running shoe with speed lines
  'stat-pace': [
    '............',
    '.....oooo...',
    'oo..ohccco..',
    '....ochwco..',
    '.oo.occwcoo.',
    '...oohcccdco',
    '..ohhcccccco',
    '.ohccccccccd',
    '.odddddddddo',
    '.owwwwwwwwwo',
    '..oooooooooo',
    '............',
  ],
  // Rendimiento — rising bars with a spark on top
  'stat-output': [
    '.........w..',
    '........oooo',
    '........ohco',
    '........ohco',
    '....ooooohco',
    '....ohcoohco',
    '....ohcoohco',
    'ooooohcoohco',
    'ohcoohcoohco',
    'ohcoohcoohco',
    'oddooddooddo',
    'oooooooooooo',
  ],
  // Captura — ball with a catch burst
  'stat-catch': [
    '.c........c.',
    '..c......c..',
    '....oooo....',
    '...ohccco...',
    '..ohccccco..',
    'c.ooowwooo.c',
    '..owwoowwo..',
    '..owwwwwwo..',
    '...owwwwo...',
    '....oooo....',
    '..c......c..',
    '.c........c.',
  ],
  // Técnica — open book with a sparkle
  'stat-technique': [
    '.....oo.....',
    '....ohco....',
    '.c...oo...c.',
    '............',
    '.oooo..oooo.',
    'owwwwoowwwwo',
    'owsswoowsswo',
    'owwwwoowwwwo',
    'owsswoowsswo',
    'ohccccccccdo',
    'oddddddddddo',
    '.oooooooooo.',
  ],
  // Aguante — beveled shield
  'stat-grit': [
    'oooooooooooo',
    'ohhcccdddddo',
    'ohccccdddddo',
    'ohcccwdddddo',
    'ohccwwwddddo',
    'ohcccwdddddo',
    'ohccccdddddo',
    '.ohcccddddo.',
    '..occcddo...',
    '...occdo....',
    '....oo......',
    '............',
  ],

  // Ball de Estudio — ball wearing a graduation cap
  'icon-study-ball': [
    '...oooooo...',
    '.oooooooooo.',
    '...oooooo.Q.',
    '..ohccccco.Q',
    '.ohcccccccoq',
    '.occcccccdo.',
    '.oooowwoooo.',
    '.owwwoowwwo.',
    '.owwwwwwwwo.',
    '..owwwwwwo..',
    '...oooooo...',
    '............',
  ],
  // Polvo de Estudio — hourglass with sparkles
  'icon-dust': [
    '............',
    '..oooooooo..',
    '...owccco...',
    '...occcco...',
    '....occo..c.',
    '.....oo..cwc',
    '....owco..c.',
    '...owwcwo...',
    '...occcco...',
    '..oooooooo..',
    '.c..........',
    '............',
  ],
  // Caramelo — wrapped candy
  'icon-candy': [
    '............',
    '............',
    '....oooo....',
    'o..ohccco..o',
    'ohoohwccooho',
    'ohhccwcccdho',
    'ohhcccwccdho',
    'ohooccwcdoho',
    'o..oddddo..o',
    '....oooo....',
    '............',
    '............',
  ],
  // Líder — crown
  'icon-leader': [
    '............',
    '.o...oo...o.',
    'oco.ohco.oco',
    'occooccoocco',
    'ohccccccccdo',
    'ohccccccccdo',
    'ocwccwwccwdo',
    'occccccccddo',
    'oddddddddddo',
    'oooooooooooo',
    '............',
    '............',
  ],
  // Temporizador — stopwatch at 3 o'clock
  'icon-timer': [
    '....oooo....',
    '....ohco....',
    '...oooooo...',
    '..ohccccdo..',
    '.ohcwwwwcdo.',
    '.ocwwowwwdo.',
    '.ocwwowwwdo.',
    '.ocwwooowdo.',
    '.ocwwwwwwdo.',
    '.occwwwwddo.',
    '..oddddddo..',
    '...oooooo...',
  ],
  // Vínculo — heart
  'icon-bond': [
    '............',
    '..ooo..ooo..',
    '.ohwcooccco.',
    'ohwcccccccco',
    'ohccccccccdo',
    'occccccccddo',
    '.occcccccdo.',
    '..occcccdo..',
    '...occcdo...',
    '....ocdo....',
    '.....oo.....',
    '............',
  ],
  // Variocolor — sparkle
  'icon-shiny': [
    '....o.......',
    '...oco...o..',
    '...oco..oco.',
    '..ohwco..o..',
    'oohcwcdoo...',
    'ocwwwwwco...',
    'oohcwcdoo...',
    '..ohwco..o..',
    '...oco..oco.',
    '...oco...o..',
    '....o.......',
    '............',
  ],
  // Dormido — Zz
  'icon-sleep': [
    '.......oooo.',
    '......ohccco',
    '.......oocco',
    '......occoo.',
    '......occcdo',
    '.ooooo.oooo.',
    'ohcccco.....',
    '.ooocco.....',
    '..occo......',
    '.occoo......',
    'occccdo.....',
    '.ooooo......',
  ],
  // Paralizado — bolt
  'icon-paralysis': [
    '......oooo..',
    '.....ohcco..',
    '....ohcco...',
    '...ohccoooo.',
    '..ohcccccco.',
    '.oooocccco..',
    '....occdo...',
    '...occdo....',
    '...ocdo.....',
    '..ocdo......',
    '..ooo.......',
    '............',
  ],
};

export const iconSprites = (): Sprite[] =>
  Object.entries(ICONS).map(([name, rows]) => ({ name, palette: ICON_PALETTE, rows }));
