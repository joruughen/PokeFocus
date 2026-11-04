/** Shared palettes. Every hex used by PokeFocus art lives here. */
import type { Fill } from './lib.ts';

export const OUTLINE = '#2a1b14';

/** Profe Pika. */
export const MASCOT_PALETTE: Record<string, Fill> = {
  o: OUTLINE, // outline
  L: '#fff3a0', // yellow highlight
  Y: '#f9d23c', // yellow base
  y: '#e3a92a', // yellow shade
  d: '#b9761d', // yellow deep shade
  K: '#2a1b14', // ear tip
  k: '#55443a', // ear tip highlight
  R: '#e8463a', // cheek
  r: '#b52a2a', // cheek shade
  P: '#ff9a7a', // cheek highlight
  B: '#9a5a26', // brown (stripes, tail base)
  b: '#6a3816', // brown shade
  W: '#ffffff', // white (eye shine, glint)
  m: '#7a2a1c', // mouth
  T: '#f0788a', // tongue
  G: '#30406e', // glasses frame
  g: '#5a6fa8', // frame highlight
  l: '#cfe9ff', // lens glare
  C: '#2b2b3d', // cap
  c: '#4a4a66', // cap highlight
  Q: '#f2b035', // tassel
  q: '#c07a1a', // tassel shade
  N: '#3f78d6', // book cover
  n: '#26509e', // book cover shade
  p: '#f6efdc', // pages
  s: '#d6c9a6', // page shade
  Z: '#8fb4ff', // zzz
};
