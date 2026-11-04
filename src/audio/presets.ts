/**
 * Named sound-effect presets. Everything is synthesized; melodies are original
 * (built from plain major/minor arpeggios and scale steps, not copied from any
 * game). Pure data — safe to import in tests.
 */
import { hz } from './theory'
import type { Envelope, SfxPreset, SfxVoice } from './synth'

// --- envelope shorthands -------------------------------------------------------

const blip = (decay: number, attack = 0.002): Envelope => ({ attack, decay, sustain: 0, hold: 0, release: 0 })
const note = (hold: number, release = 0.08, attack = 0.005, sustain = 0.7, decay = 0.04): Envelope => ({
  attack,
  decay,
  sustain,
  hold,
  release,
})
const bellEnv = (decay: number): Envelope => ({ attack: 0.003, decay, sustain: 0, hold: 0, release: 0 })

type Pitch = string | number
const f = (p: Pitch): number => (typeof p === 'number' ? p : hz(p))

interface SeqTemplate extends Omit<SfxVoice, 'freq' | 'start' | 'env'> {
  /** Fraction of the note length that is held before release (0–1). */
  legato?: number
  release?: number
  attack?: number
  sustain?: number
}

/**
 * Turn `[pitch, startBeat, lengthBeats]` triples into voices at `bpm`.
 * Used for the jingles/fanfares.
 */
function seq(notes: ReadonlyArray<readonly [Pitch, number, number]>, bpm: number, t: SeqTemplate, offset = 0): SfxVoice[] {
  const beat = 60 / bpm
  const { legato = 0.8, release = 0.08, attack = 0.005, sustain = 0.7, ...rest } = t
  return notes.map(([p, b, len]) => ({
    ...rest,
    freq: f(p),
    start: offset + b * beat,
    env: note(Math.max(0.01, len * beat * legato - attack - 0.04), release, attack, sustain),
  }))
}

/** A bell partial stack (fundamental + octave + twelfth) for chimes. */
function bell(p: Pitch, start: number, decay: number, gain: number, pan = 0): SfxVoice[] {
  const fr = f(p)
  return [
    { wave: 'sine', freq: fr, start, env: bellEnv(decay), gain, pan },
    { wave: 'sine', freq: fr * 2, start, env: bellEnv(decay * 0.55), gain: gain * 0.35, pan },
    { wave: 'triangle', freq: fr * 3, start, env: bellEnv(decay * 0.25), gain: gain * 0.12, pan },
  ]
}

const softSquare = (duty = 0.25, cutoff = 3200): Pick<SfxVoice, 'wave' | 'duty' | 'filter'> => ({
  wave: 'square',
  duty,
  filter: { type: 'lowpass', freq: cutoff, q: 0.5 },
})

// --- presets ------------------------------------------------------------------

export const SFX = {
  // UI ------------------------------------------------------------------------
  uiClick: {
    kind: 'ui',
    variance: 35,
    cooldownMs: 30,
    maxInstances: 3,
    gain: 0.5,
    voices: [{ ...softSquare(0.25, 3000), freq: 1100, freqEnd: 760, env: blip(0.045), gain: 0.35 }],
  },
  uiHover: {
    kind: 'ui',
    variance: 50,
    cooldownMs: 70,
    maxInstances: 2,
    gain: 0.35,
    voices: [{ wave: 'triangle', freq: 1500, freqEnd: 1650, env: blip(0.025), gain: 0.25 }],
  },
  uiOpen: {
    kind: 'ui',
    variance: 20,
    cooldownMs: 80,
    gain: 0.5,
    voices: [
      { wave: 'triangle', freq: f('E5'), arp: { semis: [0, 7], step: 0.045 }, env: blip(0.13), gain: 0.45 },
      { ...softSquare(0.125, 2600), freq: f('E5'), arp: { semis: [0, 7], step: 0.045 }, env: blip(0.1), gain: 0.18 },
    ],
  },
  uiClose: {
    kind: 'ui',
    variance: 20,
    cooldownMs: 80,
    gain: 0.5,
    voices: [
      { wave: 'triangle', freq: f('B5'), arp: { semis: [0, -7], step: 0.045 }, env: blip(0.12), gain: 0.45 },
      { ...softSquare(0.125, 2400), freq: f('B5'), arp: { semis: [0, -7], step: 0.045 }, env: blip(0.09), gain: 0.16 },
    ],
  },
  toggle: {
    kind: 'ui',
    variance: 25,
    cooldownMs: 50,
    gain: 0.5,
    voices: [
      { ...softSquare(0.5, 2800), freq: f('C6'), env: blip(0.03), gain: 0.25 },
      { ...softSquare(0.5, 2800), freq: f('G6'), start: 0.04, env: blip(0.04), gain: 0.22 },
    ],
  },

  // Sessions ------------------------------------------------------------------
  /** Rising C-major arpeggio with a soft bass root: "let's go". */
  sessionStart: {
    kind: 'game',
    gain: 0.6,
    cooldownMs: 400,
    voices: [
      ...seq(
        [
          ['C5', 0, 0.5],
          ['E5', 0.5, 0.5],
          ['G5', 1, 0.5],
          ['C6', 1.5, 1.5],
        ],
        200,
        { ...softSquare(0.25, 3400), gain: 0.28, legato: 0.9, release: 0.25, sustain: 0.55 },
      ),
      { wave: 'triangle', freq: f('C4'), env: note(0.45, 0.35, 0.01, 0.6, 0.1), gain: 0.4 },
      ...bell('E6', 0.45, 0.6, 0.12, 0.3),
    ],
  },
  /** Gentle 3-note bell chime (G5 → C6 → E6) with long tails; audible in a background tab, never alarming. */
  sessionEnd: {
    kind: 'fanfare',
    duck: true,
    gain: 0.9,
    cooldownMs: 1500,
    maxInstances: 1,
    voices: [
      ...bell('G5', 0, 1.1, 0.32, -0.15),
      ...bell('C6', 0.26, 1.2, 0.3, 0.1),
      ...bell('E6', 0.52, 1.7, 0.3, 0),
      { wave: 'triangle', freq: f('C4'), start: 0.52, env: { attack: 0.08, decay: 0.3, sustain: 0.5, hold: 0.4, release: 1.0 }, gain: 0.22 },
    ],
  },
  claim: {
    kind: 'game',
    variance: 15,
    cooldownMs: 120,
    gain: 0.55,
    voices: [
      { ...softSquare(0.25, 3600), freq: f('G5'), arp: { semis: [0, 7, 12], step: 0.06 }, env: note(0.12, 0.18, 0.003, 0.6), gain: 0.3 },
      { wave: 'triangle', freq: f('G5'), arp: { semis: [0, 7, 12], step: 0.06 }, env: note(0.12, 0.22, 0.003, 0.6), gain: 0.3 },
      ...bell('D7', 0.16, 0.35, 0.08, 0.2),
    ],
  },
  /** For counting-up numbers: tiny high tick, heavily rate-limited. Pass `pitch` to rise as the count grows. */
  pointsTick: {
    kind: 'ui',
    variance: 10,
    cooldownMs: 45,
    maxInstances: 2,
    gain: 0.4,
    voices: [{ ...softSquare(0.125, 4000), freq: f('A6'), env: blip(0.025), gain: 0.22 }],
  },

  // Encounters ------------------------------------------------------------------
  /** Rustling grass (filtered noise flutter) + a short two-note sting. */
  waveAppear: {
    kind: 'game',
    cooldownMs: 600,
    gain: 0.6,
    voices: [
      ...[0, 0.07, 0.13, 0.21, 0.28].map(
        (start, i): SfxVoice => ({
          wave: 'noise',
          freq: 0,
          rate: 0.7 + i * 0.05,
          start,
          env: { attack: 0.01, decay: 0.09, sustain: 0, hold: 0, release: 0 },
          gain: 0.22 - i * 0.02,
          filter: { type: 'bandpass', freq: 2600 + (i % 2) * 1400, q: 1.4 },
          pan: i % 2 ? 0.35 : -0.35,
        }),
      ),
      ...seq(
        [
          ['A4', 0, 0.5],
          ['E5', 0.5, 1.5],
        ],
        180,
        { ...softSquare(0.25, 2600), gain: 0.22, release: 0.2, sustain: 0.5, vibrato: { rate: 6, depth: 12, delay: 0.1 } },
        0.36,
      ),
    ],
  },
  /** Alert "!" — quick upward slide into a held fifth. */
  wildAppear: {
    kind: 'game',
    cooldownMs: 300,
    gain: 0.6,
    voices: [
      { ...softSquare(0.25, 3000), freq: f('D5'), freqEnd: f('A5'), slide: 0.06, env: note(0.18, 0.15, 0.004, 0.6), gain: 0.28 },
      { wave: 'triangle', freq: f('D4'), env: note(0.15, 0.15, 0.004, 0.6), gain: 0.3 },
      { wave: 'triangle', freq: f('A5'), start: 0.06, env: note(0.12, 0.2, 0.004, 0.5), gain: 0.18 },
    ],
  },
  /** Sparkle: scattered high E-major bell pings + airy shimmer. */
  shinyAppear: {
    kind: 'game',
    duck: true,
    cooldownMs: 800,
    gain: 0.6,
    voices: [
      ...bell('E7', 0, 0.3, 0.14, -0.5),
      ...bell('B6', 0.06, 0.3, 0.14, 0.4),
      ...bell('G#7', 0.12, 0.3, 0.12, -0.2),
      ...bell('E7', 0.2, 0.35, 0.12, 0.5),
      ...bell('B7', 0.28, 0.5, 0.1, 0),
      { wave: 'noise', freq: 0, env: { attack: 0.05, decay: 0.5, sustain: 0, hold: 0, release: 0 }, gain: 0.06, filter: { type: 'highpass', freq: 7000, q: 0.5 } },
    ],
  },

  // Capture -------------------------------------------------------------------
  /** Whoosh: band-passed noise sweeping up + faint rising tone. */
  ballThrow: {
    kind: 'game',
    variance: 40,
    cooldownMs: 200,
    gain: 0.6,
    voices: [
      { wave: 'noise', freq: 0, env: { attack: 0.08, decay: 0.22, sustain: 0, hold: 0, release: 0 }, gain: 0.65, filter: { type: 'bandpass', freq: 500, freqEnd: 3200, q: 2 }, pan: -0.3, panEnd: 0.3 },
      { wave: 'triangle', freq: 300, freqEnd: 900, env: { attack: 0.05, decay: 0.2, sustain: 0, hold: 0, release: 0 }, gain: 0.12 },
    ],
  },
  /** Three wobble clicks at 0 s, 0.35 s and 0.7 s (sync the ball animation to these). */
  ballShake: {
    kind: 'game',
    variance: 20,
    cooldownMs: 500,
    maxInstances: 1,
    gain: 0.6,
    voices: [0, 0.35, 0.7].flatMap((start, i): SfxVoice[] => [
      { wave: 'triangle', freq: 260 - i * 15, freqEnd: 170, start, env: blip(0.09), gain: 0.45, pan: i % 2 ? 0.2 : -0.2 },
      { wave: 'noise', freq: 0, start, env: blip(0.02), gain: 0.18, filter: { type: 'highpass', freq: 2200, q: 0.7 } },
      { ...softSquare(0.5, 2000), freq: 520, start: start + 0.03, env: blip(0.02), gain: 0.1 },
    ]),
  },
  /** "Caught!" — original C-major jingle (E–G–C–D–C) over a soft I chord, with a lock click. */
  catchSuccess: {
    kind: 'fanfare',
    duck: true,
    cooldownMs: 800,
    maxInstances: 1,
    gain: 0.6,
    voices: [
      { wave: 'noise', freq: 0, env: blip(0.025), gain: 0.25, filter: { type: 'highpass', freq: 1800 } },
      { ...softSquare(0.5, 1800), freq: 300, freqEnd: 200, env: blip(0.05), gain: 0.15 },
      ...seq(
        [
          ['E5', 1, 0.5],
          ['G5', 1.5, 0.5],
          ['C6', 2, 0.5],
          ['D6', 2.5, 0.5],
          ['C6', 3, 2],
        ],
        240,
        { ...softSquare(0.25, 3400), gain: 0.26, legato: 0.85, release: 0.25, sustain: 0.6, vibrato: { rate: 5.5, depth: 10, delay: 0.25 } },
      ),
      ...seq(
        [
          ['G4', 1, 2],
          ['E4', 1, 2],
          ['G4', 3, 2],
          ['E4', 3, 2],
          ['C4', 3, 2],
        ],
        240,
        { wave: 'triangle', gain: 0.18, legato: 0.9, release: 0.3, sustain: 0.6 },
      ),
      ...bell('G6', 0.75, 0.45, 0.08, 0.3),
    ],
  },
  /** Ball pops open: noisy pop + upward blip + small sad drop. */
  catchFail: {
    kind: 'game',
    cooldownMs: 400,
    gain: 0.6,
    voices: [
      { wave: 'noise', freq: 0, env: blip(0.07), gain: 0.35, filter: { type: 'bandpass', freq: 1300, q: 0.9 } },
      { ...softSquare(0.25, 2800), freq: 300, freqEnd: 1300, slide: 0.07, env: blip(0.09), gain: 0.22 },
      { wave: 'triangle', freq: f('E5'), freqEnd: f('B4'), start: 0.12, env: note(0.12, 0.15, 0.005, 0.6), gain: 0.25 },
    ],
  },
  counterHit: {
    kind: 'game',
    variance: 40,
    cooldownMs: 120,
    gain: 0.7,
    voices: [
      { wave: 'sine', freq: 150, freqEnd: 48, env: blip(0.2), gain: 0.7 },
      { wave: 'noise', freq: 0, rate: 0.5, env: blip(0.06), gain: 0.3, filter: { type: 'lowpass', freq: 900 } },
    ],
  },
  counterMiss: {
    kind: 'game',
    variance: 40,
    cooldownMs: 120,
    gain: 0.5,
    voices: [
      { wave: 'noise', freq: 0, env: { attack: 0.03, decay: 0.12, sustain: 0, hold: 0, release: 0 }, gain: 0.25, filter: { type: 'highpass', freq: 2500, freqEnd: 5000 }, pan: 0.3, panEnd: -0.3 },
      { wave: 'triangle', freq: 520, freqEnd: 340, env: blip(0.12), gain: 0.14 },
    ],
  },
  /** Scamper away: quick patter rising in pitch, fading and panning off to the right. */
  flee: {
    kind: 'game',
    cooldownMs: 500,
    gain: 0.55,
    voices: [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36].flatMap((start, i): SfxVoice[] => [
      { ...softSquare(0.25, 2600), freq: 520 + i * 70, env: blip(0.035), start, gain: 0.24 * (1 - i * 0.12), pan: i * 0.13 },
      { wave: 'noise', freq: 0, rate: 0.8, env: blip(0.02), start: start + 0.03, gain: 0.12 * (1 - i * 0.12), filter: { type: 'bandpass', freq: 3000, q: 1 }, pan: i * 0.13 },
    ]),
  },

  // Progress ------------------------------------------------------------------
  /** Short original fanfare: C–E–G–E–G → high C over a C-major bed. */
  levelUp: {
    kind: 'fanfare',
    duck: true,
    cooldownMs: 800,
    maxInstances: 1,
    gain: 0.6,
    voices: [
      ...seq(
        [
          ['C5', 0, 0.5],
          ['E5', 0.5, 0.5],
          ['G5', 1, 0.5],
          ['E5', 1.5, 0.5],
          ['G5', 2, 0.5],
          ['C6', 2.5, 2],
        ],
        260,
        { ...softSquare(0.25, 3400), gain: 0.26, legato: 0.85, release: 0.25, sustain: 0.6, vibrato: { rate: 6, depth: 10, delay: 0.2 } },
      ),
      ...seq(
        [
          ['C4', 2.5, 2],
          ['E4', 2.5, 2],
          ['G4', 2.5, 2],
        ],
        260,
        { wave: 'triangle', gain: 0.16, legato: 0.9, release: 0.3, sustain: 0.6 },
      ),
      { wave: 'triangle', freq: f('C3'), start: 0, env: note(0.9, 0.3, 0.01, 0.5), gain: 0.25 },
    ],
  },
  /** Shimmering riser: two voices a fifth apart sliding up with vibrato, plus rising airy noise. */
  evolveStart: {
    kind: 'game',
    cooldownMs: 1500,
    maxInstances: 1,
    gain: 0.55,
    voices: [
      { wave: 'triangle', freq: 220, freqEnd: 880, env: { attack: 1.0, decay: 0.1, sustain: 0.8, hold: 0.1, release: 0.25 }, gain: 0.3, vibrato: { rate: 7, depth: 25 } },
      { wave: 'triangle', freq: 330, freqEnd: 1320, env: { attack: 1.1, decay: 0.1, sustain: 0.8, hold: 0.0, release: 0.25 }, gain: 0.16, vibrato: { rate: 9, depth: 30 }, pan: 0.3 },
      { ...softSquare(0.125, 2200), freq: 110, freqEnd: 440, env: { attack: 1.0, decay: 0.1, sustain: 0.7, hold: 0.1, release: 0.2 }, gain: 0.08, pan: -0.3 },
      { wave: 'noise', freq: 0, env: { attack: 1.1, decay: 0.1, sustain: 0.6, hold: 0, release: 0.2 }, gain: 0.08, filter: { type: 'bandpass', freq: 1500, freqEnd: 8000, q: 1.2 } },
    ],
  },
  /** Bloom: quick Cmaj9 arpeggio resolving into a sustained bell chord. */
  evolveDone: {
    kind: 'fanfare',
    duck: true,
    cooldownMs: 1500,
    maxInstances: 1,
    gain: 0.6,
    voices: [
      ...seq(
        [
          ['C5', 0, 0.5],
          ['E5', 0.5, 0.5],
          ['G5', 1, 0.5],
          ['B5', 1.5, 0.5],
          ['D6', 2, 0.5],
          ['E6', 2.5, 2.5],
        ],
        300,
        { ...softSquare(0.25, 3200), gain: 0.22, legato: 0.85, release: 0.35, sustain: 0.6 },
      ),
      ...bell('C5', 0.5, 1.4, 0.18, -0.3),
      ...bell('G5', 0.5, 1.4, 0.14, 0.3),
      ...bell('E6', 0.55, 1.5, 0.12, 0),
      { wave: 'triangle', freq: f('C3'), start: 0.5, env: note(0.4, 0.8, 0.02, 0.6), gain: 0.25 },
    ],
  },
  newMove: {
    kind: 'game',
    cooldownMs: 400,
    gain: 0.55,
    voices: [
      ...seq(
        [
          ['G5', 0, 0.5],
          ['A5', 0.5, 0.5],
          ['D6', 1, 1.5],
        ],
        240,
        { ...softSquare(0.25, 3200), gain: 0.25, release: 0.2, sustain: 0.6 },
      ),
      ...bell('D7', 0.25, 0.35, 0.08, 0.3),
    ],
  },
  /** Soft rising blip for the mascot's tips. */
  hintPop: {
    kind: 'ui',
    variance: 30,
    cooldownMs: 250,
    gain: 0.45,
    voices: [
      { wave: 'sine', freq: 660, freqEnd: 990, slide: 0.05, env: blip(0.09), gain: 0.35 },
      { wave: 'triangle', freq: 1320, start: 0.07, env: blip(0.06), gain: 0.12 },
    ],
  },
  /** Low, rounded "nope" (E4 → C4), not a buzzer. */
  error: {
    kind: 'ui',
    cooldownMs: 250,
    gain: 0.55,
    voices: [
      ...seq(
        [
          ['E4', 0, 0.5],
          ['C4', 0.5, 1],
        ],
        320,
        { ...softSquare(0.25, 1400), gain: 0.25, release: 0.1, sustain: 0.6 },
      ),
      ...seq(
        [
          ['E3', 0, 0.5],
          ['C3', 0.5, 1],
        ],
        320,
        { wave: 'triangle', gain: 0.3, release: 0.1, sustain: 0.6 },
      ),
    ],
  },
  /** Sleepy descending "yawn" with a slow vibrato. */
  exhausted: {
    kind: 'game',
    cooldownMs: 800,
    gain: 0.55,
    voices: [
      { wave: 'triangle', freq: f('G4'), freqEnd: f('C4'), env: { attack: 0.05, decay: 0.2, sustain: 0.7, hold: 0.5, release: 0.35 }, gain: 0.35, vibrato: { rate: 3, depth: 25, delay: 0.2 } },
      { wave: 'sine', freq: f('D5'), freqEnd: f('G4'), start: 0.05, env: { attack: 0.08, decay: 0.2, sustain: 0.5, hold: 0.4, release: 0.3 }, gain: 0.12 },
      { wave: 'noise', freq: 0, rate: 0.3, env: { attack: 0.3, decay: 0.6, sustain: 0, hold: 0, release: 0 }, gain: 0.05, filter: { type: 'lowpass', freq: 900 } },
    ],
  },
  /** Soft F-major add9 shimmer rising upward. */
  heal: {
    kind: 'game',
    cooldownMs: 500,
    gain: 0.55,
    voices: [
      ...['F5', 'A5', 'C6', 'G6', 'A6'].flatMap((p, i) => bell(p, i * 0.07, 0.5, 0.14, (i % 2 ? 1 : -1) * 0.25)),
      { wave: 'triangle', freq: f('F4'), env: { attack: 0.1, decay: 0.2, sustain: 0.5, hold: 0.25, release: 0.4 }, gain: 0.2 },
    ],
  },
  /** Bigger original fanfare: triplet pickup → I–IV–V–I with bass, harmony and a soft crash. */
  leagueUp: {
    kind: 'fanfare',
    duck: true,
    cooldownMs: 2500,
    maxInstances: 1,
    gain: 0.6,
    voices: [
      ...seq(
        [
          ['G4', 0, 1 / 3],
          ['C5', 1 / 3, 1 / 3],
          ['E5', 2 / 3, 1 / 3],
          ['G5', 1, 1],
          ['F5', 2, 0.5],
          ['A5', 2.5, 0.5],
          ['G5', 3, 1 / 3],
          ['D6', 10 / 3, 2 / 3],
          ['C6', 4, 2],
        ],
        140,
        { ...softSquare(0.25, 3400), gain: 0.24, legato: 0.88, release: 0.3, sustain: 0.65, vibrato: { rate: 5.5, depth: 12, delay: 0.25 } },
      ),
      ...seq(
        [
          ['E4', 1, 1],
          ['G4', 1, 1],
          ['F4', 2, 1],
          ['A4', 2, 1],
          ['D4', 3, 1],
          ['B4', 3, 1],
          ['E4', 4, 2],
          ['G4', 4, 2],
        ],
        140,
        { ...softSquare(0.5, 1800), gain: 0.1, legato: 0.9, release: 0.3, sustain: 0.6 },
      ),
      ...seq(
        [
          ['C3', 1, 1],
          ['F2', 2, 1],
          ['G2', 3, 1],
          ['C3', 4, 2],
        ],
        140,
        { wave: 'triangle', gain: 0.32, legato: 0.85, release: 0.25, sustain: 0.7 },
      ),
      { wave: 'noise', freq: 0, start: (4 * 60) / 140, env: blip(0.7, 0.005), gain: 0.07, filter: { type: 'highpass', freq: 5000, q: 0.5 } },
      ...bell('C7', (4 * 60) / 140, 0.6, 0.06, 0.4),
    ],
  },
} as const satisfies Record<string, SfxPreset>

export type SfxName = keyof typeof SFX

export const SFX_NAMES = Object.keys(SFX) as SfxName[]

export function getPreset(name: SfxName): SfxPreset {
  return SFX[name]
}
