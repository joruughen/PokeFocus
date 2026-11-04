/**
 * Generative music: track definitions + a pure bar generator. Each bar picks a
 * chord from a per-track progression (re-chosen every 4-bar phrase), voices it
 * with smooth voice leading, and writes bass / pad / arpeggio / melody / drum
 * events from a seeded RNG, so a track never repeats exactly but always stays
 * in one key. No Web Audio here — the player turns events into sound.
 */
import { createRng, type Rng } from './rng'
import {
  SCALES,
  diatonicChord,
  foldIntoRange,
  nearestPc,
  pitchClass,
  scaleDegree,
  scaleNotesInRange,
  voiceLead,
} from './theory'

export type TrackId = 'focus' | 'home' | 'encounter' | 'results'
export const TRACK_IDS: readonly TrackId[] = ['focus', 'home', 'encounter', 'results']

export type InstrumentId = 'pad' | 'bass' | 'lead' | 'pluck' | 'bell' | 'kick' | 'snare' | 'hat' | 'crackle'

export interface NoteEvent {
  inst: InstrumentId
  /** Position in beats from the bar start (already swung). */
  beat: number
  /** Length in beats. */
  dur: number
  /** MIDI pitch (ignored by drums / crackle). */
  midi: number
  /** Velocity 0–1. */
  vel: number
}

export interface TrackDef {
  id: TrackId
  /** Human description (shown in AudioLab). */
  label: string
  bpm: number
  beatsPerBar: number
  /** 0 = straight; ~0.15–0.3 = lazy swing on off-beat eighths. */
  swing: number
  /** Tonic MIDI note (octave irrelevant). */
  root: number
  scale: readonly number[]
  /** Scale used for melodies (must be a subset of `scale` pitch classes). */
  melodyScale: readonly number[]
  /** 3 = triads, 4 = sevenths. */
  chordSize: number
  /** Progressions as 0-based scale degrees, one chord per bar. */
  progressions: readonly (readonly number[])[]
  ranges: { pad: [number, number]; bass: [number, number]; lead: [number, number]; arp: [number, number] }
  /** Pad low-pass cutoff (Hz). */
  padCutoff: number
  /** Reverb send 0–1. */
  reverb: number
  /** Vinyl hiss/crackle bed on by default. */
  hiss: boolean
  /** Track-level gain (0–1) to balance tracks against each other. */
  gain: number
  /** Writes the non-harmonic layers for one bar. */
  write: (b: BarContext) => NoteEvent[]
}

export interface BarContext {
  def: TrackDef
  rng: Rng
  /** Absolute bar index since the track started. */
  bar: number
  /** Bar within the 4-bar phrase (0–3). */
  phraseBar: number
  /** Scale degree of this bar's chord. */
  degree: number
  /** Voiced chord (ascending MIDI). */
  voicing: number[]
  /** Chord pitch classes. */
  chordPcs: number[]
  /** Root of the chord folded into the bass range. */
  bassRoot: number
  /** Next bar's chord root pitch class (for approach notes). */
  nextRootPc: number
  /** Melody state carried across bars. */
  melody: MelodyState
}

export interface MelodyState {
  last: number
  /** Rhythm motif of the current phrase: [beat, dur] pairs. */
  motif: Array<[number, number]>
  /** Pitch-contour steps of the motif (scale steps). */
  contour: number[]
}

// --- shared writers -------------------------------------------------------------

function swingAt(def: TrackDef, beat: number): number {
  if (def.swing <= 0) return beat
  const eighth = beat * 2
  const whole = Math.round(eighth)
  if (Math.abs(eighth - whole) < 1e-6 && whole % 2 === 1) return beat + def.swing * 0.5
  return beat
}

function ev(def: TrackDef, inst: InstrumentId, beat: number, dur: number, midi: number, vel: number): NoteEvent {
  return { inst, beat: swingAt(def, beat), dur, midi, vel }
}

/** Make a rhythm motif inside one bar on a grid of `grid` beats. */
function makeMotif(rng: Rng, beats: number, grid: number, minNotes: number, maxNotes: number): Array<[number, number]> {
  const slots = Math.round(beats / grid)
  const count = rng.int(minNotes, maxNotes)
  const chosen = new Set<number>()
  // Favour strong positions for the first note.
  chosen.add(rng.chance(0.6) ? 0 : rng.int(0, Math.min(2, slots - 1)))
  let guard = 0
  while (chosen.size < Math.min(count, slots) && guard++ < 100) chosen.add(rng.int(0, slots - 1))
  const starts = [...chosen].sort((a, b) => a - b)
  return starts.map((s, i) => {
    const next = starts[i + 1] ?? slots
    const room = next - s
    const len = Math.max(1, rng.chance(0.3) ? room : Math.min(room, rng.int(1, 2)))
    return [s * grid, len * grid] as [number, number]
  })
}

function makeContour(rng: Rng, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(rng.weighted([-2, -1, 0, 1, 2, 3], [1, 3, 1, 3, 1.2, 0.4]))
  return out
}

/**
 * Melody notes for one bar following the phrase motif. Notes on strong beats
 * snap to chord tones; others walk the melody scale stepwise.
 */
function writeMelody(b: BarContext, inst: InstrumentId, vel: number, varyChance = 0.35): NoteEvent[] {
  const { def, rng, melody } = b
  const [lo, hi] = def.ranges.lead
  const pool = scaleNotesInRange(def.root, def.melodyScale, lo, hi)
  if (pool.length === 0) return []
  const out: NoteEvent[] = []
  let idx = pool.reduce((best, m, i) => (Math.abs(m - melody.last) < Math.abs((pool[best] as number) - melody.last) ? i : best), 0)
  melody.motif.forEach(([beat, dur], i) => {
    let step = melody.contour[i % melody.contour.length] ?? 0
    if (rng.chance(varyChance)) step += rng.pick([-1, 1])
    idx = Math.max(0, Math.min(pool.length - 1, idx + step))
    let m = pool[idx] as number
    const strong = Math.abs(beat - Math.round(beat)) < 1e-6 && Math.round(beat) % 2 === 0
    if (strong && !b.chordPcs.includes(pitchClass(m))) {
      // Snap to the nearest chord tone that is also in the melody scale.
      const cands = pool.filter((p) => b.chordPcs.includes(pitchClass(p)))
      if (cands.length) {
        m = cands.reduce((a, c) => (Math.abs(c - m) < Math.abs(a - m) ? c : a))
        idx = pool.indexOf(m)
      }
    }
    out.push(ev(def, inst, beat, dur, m, vel * rng.range(0.8, 1)))
    melody.last = m
  })
  // Drift back toward the middle of the range so the line doesn't stick to an edge.
  const mid = (lo + hi) / 2
  if (Math.abs(melody.last - mid) > 7) melody.last += melody.last > mid ? -5 : 5
  return out
}

function arpeggio(b: BarContext, pattern: readonly number[], grid: number, vel: number, inst: InstrumentId = 'pluck'): NoteEvent[] {
  const { def, rng } = b
  const [lo, hi] = def.ranges.arp
  const tones = [...b.voicing, ...b.voicing.map((m) => m + 12)].map((m) => foldIntoRange(m, lo, hi))
  const uniq = [...new Set(tones)].sort((a, c) => a - c)
  const out: NoteEvent[] = []
  const steps = Math.round(def.beatsPerBar / grid)
  for (let i = 0; i < steps; i++) {
    const pi = pattern[i % pattern.length] as number
    const m = uniq[Math.min(uniq.length - 1, pi)] as number
    const accent = i % (1 / grid) === 0 ? 1 : 0.75
    if (rng.chance(0.07)) continue // tiny gaps keep it breathing
    out.push(ev(def, inst, i * grid, grid * 0.9, m, vel * accent * rng.range(0.85, 1)))
  }
  return out
}

function crackles(b: BarContext, max: number): NoteEvent[] {
  const n = b.rng.int(0, max)
  const out: NoteEvent[] = []
  for (let i = 0; i < n; i++) out.push({ inst: 'crackle', beat: b.rng.range(0, b.def.beatsPerBar), dur: 0.02, midi: 0, vel: b.rng.range(0.3, 1) })
  return out
}

// --- tracks ---------------------------------------------------------------------

/** F major, 72 BPM: maj7/m7 pads, slow bass, sparse bell motifs, vinyl hiss. */
const focus: TrackDef = {
  id: 'focus',
  label: 'Focus — calm lo-fi pads in F major, 72 BPM',
  bpm: 72,
  beatsPerBar: 4,
  swing: 0.18,
  root: 65, // F
  scale: SCALES.major,
  melodyScale: SCALES.majorPentatonic,
  chordSize: 4,
  progressions: [
    [0, 5, 1, 4], // Imaj7 vi7 ii7 V7
    [3, 2, 1, 0], // IVmaj7 iii7 ii7 Imaj7
    [1, 4, 0, 5], // ii7 V7 Imaj7 vi7
    [0, 3, 5, 4], // Imaj7 IVmaj7 vi7 V7
    [3, 4, 2, 5], // IV V iii vi
  ],
  ranges: { pad: [53, 72], bass: [36, 50], lead: [69, 86], arp: [65, 84] },
  padCutoff: 950,
  reverb: 0.45,
  hiss: true,
  gain: 0.9,
  write: (b) => {
    const { def, rng } = b
    const out: NoteEvent[] = []
    out.push(ev(def, 'bass', 0, 2.5, b.bassRoot, 0.7))
    if (rng.chance(0.55)) {
      const fifth = foldIntoRange(b.bassRoot + 7, def.ranges.bass[0], def.ranges.bass[1])
      out.push(ev(def, 'bass', 2.5, 1.3, rng.chance(0.6) ? fifth : b.bassRoot, 0.5))
    }
    // Sparse melody: most bars have a short motif, some are silent.
    if (b.phraseBar !== 3 ? rng.chance(0.55) : rng.chance(0.25)) out.push(...writeMelody(b, 'bell', 0.55, 0.4))
    // Occasional soft arpeggiated colour in the high register.
    if (rng.chance(0.2)) out.push(...arpeggio(b, [0, 2, 1, 3, 2, 4, 3, 5], 0.5, 0.25, 'bell').filter(() => rng.chance(0.5)))
    out.push(...crackles(b, 4))
    return out
  },
}

/** G major, 94 BPM: cozy plucked arpeggios, walking bass, sing-song pulse lead, soft kit. */
const home: TrackDef = {
  id: 'home',
  label: 'Home — cozy town theme in G major, 94 BPM',
  bpm: 94,
  beatsPerBar: 4,
  swing: 0.22,
  root: 67, // G
  scale: SCALES.major,
  melodyScale: SCALES.major,
  chordSize: 3,
  progressions: [
    [0, 3, 4, 0], // I IV V I
    [0, 5, 3, 4], // I vi IV V
    [3, 4, 2, 5], // IV V iii vi
    [1, 4, 0, 0], // ii V I I
    [0, 2, 3, 4], // I iii IV V
  ],
  ranges: { pad: [55, 74], bass: [38, 52], lead: [67, 86], arp: [60, 79] },
  padCutoff: 1300,
  reverb: 0.3,
  hiss: false,
  gain: 0.8,
  write: (b) => {
    const { def, rng } = b
    const out: NoteEvent[] = []
    const [blo, bhi] = def.ranges.bass
    const fifth = foldIntoRange(b.bassRoot + 7, blo, bhi)
    const approach = foldIntoRange(nearestPc(b.nextRootPc, b.bassRoot) + rng.pick([-1, 1, 2]), blo, bhi)
    out.push(ev(def, 'bass', 0, 0.9, b.bassRoot, 0.7))
    const octave = b.bassRoot + 12 <= bhi ? b.bassRoot + 12 : b.bassRoot
    out.push(ev(def, 'bass', 1, 0.9, rng.chance(0.5) ? octave : fifth, 0.5))
    out.push(ev(def, 'bass', 2, 0.9, fifth, 0.6))
    // Approach the next root diatonically when it differs.
    const ap = def.scale.map((i) => pitchClass(def.root + i)).includes(pitchClass(approach)) ? approach : fifth
    out.push(ev(def, 'bass', 3, 0.9, ap, 0.5))
    out.push(...arpeggio(b, rng.pick([[0, 1, 2, 1, 3, 1, 2, 1], [0, 2, 1, 2, 3, 2, 1, 2], [0, 1, 2, 3, 4, 3, 2, 1]]), 0.5, 0.45))
    if (b.phraseBar < 3 || rng.chance(0.4)) out.push(...writeMelody(b, 'lead', 0.6, 0.3))
    // Soft kit.
    out.push(ev(def, 'kick', 0, 0.2, 0, 0.5), ev(def, 'kick', 2.5, 0.2, 0, 0.35))
    out.push(ev(def, 'snare', 1, 0.2, 0, 0.25), ev(def, 'snare', 3, 0.2, 0, 0.25))
    for (let i = 0; i < 8; i++) if (rng.chance(0.85)) out.push(ev(def, 'hat', i * 0.5, 0.1, 0, i % 2 ? 0.35 : 0.2))
    return out
  },
}

/** A natural minor, 124 BPM: driving octave bass, eighth-note arps, light kit — curious tension, not aggression. */
const encounter: TrackDef = {
  id: 'encounter',
  label: 'Encounter — light tension in A minor, 124 BPM',
  bpm: 124,
  beatsPerBar: 4,
  swing: 0,
  root: 69, // A
  scale: SCALES.minor,
  melodyScale: SCALES.minor,
  chordSize: 3,
  progressions: [
    [0, 5, 6, 0], // i VI VII i
    [0, 3, 6, 2], // i iv VII III
    [0, 5, 2, 6], // i VI III VII
    [5, 6, 0, 0], // VI VII i i
    [0, 6, 5, 6], // i VII VI VII
  ],
  ranges: { pad: [57, 76], bass: [33, 48], lead: [69, 88], arp: [64, 84] },
  padCutoff: 1100,
  reverb: 0.22,
  hiss: false,
  gain: 0.75,
  write: (b) => {
    const { def, rng } = b
    const out: NoteEvent[] = []
    const up = b.bassRoot + 12 // octave "pump"
    for (let i = 0; i < 8; i++) out.push(ev(def, 'bass', i * 0.5, 0.4, i % 2 && rng.chance(0.7) ? up : b.bassRoot, i % 2 ? 0.45 : 0.6))
    out.push(...arpeggio(b, rng.pick([[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 4, 2, 1, 3, 4, 3], [2, 1, 0, 1, 2, 3, 4, 3]]), 0.5, 0.38))
    if (b.bar % 2 === 0 || rng.chance(0.35)) out.push(...writeMelody(b, 'lead', 0.55, 0.3))
    out.push(ev(def, 'kick', 0, 0.2, 0, 0.6), ev(def, 'kick', 2, 0.2, 0, 0.55))
    if (rng.chance(0.4)) out.push(ev(def, 'kick', 2.75, 0.2, 0, 0.35))
    out.push(ev(def, 'snare', 1, 0.2, 0, 0.35), ev(def, 'snare', 3, 0.2, 0, 0.35))
    for (let i = 0; i < 8; i++) out.push(ev(def, 'hat', i * 0.5, 0.1, 0, i % 2 ? 0.4 : 0.22))
    return out
  },
}

/** C major, 112 BPM: rising bell arpeggios, bright pulse motif, light kit — a happy bed for the results screen. */
const results: TrackDef = {
  id: 'results',
  label: 'Results — celebratory bed in C major, 112 BPM',
  bpm: 112,
  beatsPerBar: 4,
  swing: 0.1,
  root: 60, // C
  scale: SCALES.major,
  melodyScale: SCALES.majorPentatonic,
  chordSize: 3,
  progressions: [
    [0, 3, 4, 0], // I IV V I
    [5, 3, 4, 0], // vi IV V I
    [3, 4, 2, 5], // IV V iii vi
    [0, 4, 5, 3], // I V vi IV
  ],
  ranges: { pad: [55, 74], bass: [36, 50], lead: [72, 88], arp: [67, 88] },
  padCutoff: 1500,
  reverb: 0.35,
  hiss: false,
  gain: 0.75,
  write: (b) => {
    const { def, rng } = b
    const out: NoteEvent[] = []
    out.push(ev(def, 'bass', 0, 1.8, b.bassRoot, 0.65), ev(def, 'bass', 2, 1.8, foldIntoRange(b.bassRoot + 7, def.ranges.bass[0], def.ranges.bass[1]), 0.5))
    out.push(...arpeggio(b, [0, 1, 2, 3, 4, 5, 4, 3], 0.5, 0.35, 'bell'))
    if (b.phraseBar % 2 === 0 || rng.chance(0.3)) out.push(...writeMelody(b, 'lead', 0.55, 0.25))
    out.push(ev(def, 'kick', 0, 0.2, 0, 0.5), ev(def, 'kick', 2, 0.2, 0, 0.45))
    out.push(ev(def, 'snare', 1, 0.2, 0, 0.25), ev(def, 'snare', 3, 0.2, 0, 0.25))
    for (let i = 0; i < 8; i++) out.push(ev(def, 'hat', i * 0.5, 0.1, 0, i % 2 ? 0.3 : 0.18))
    return out
  },
}

export const TRACKS: Record<TrackId, TrackDef> = { focus, home, encounter, results }

// --- generator ------------------------------------------------------------------

export interface GeneratedBar {
  bar: number
  degree: number
  voicing: number[]
  events: NoteEvent[]
}

/** Stateful, deterministic (per seed) bar generator for one track. */
export class TrackGenerator {
  readonly def: TrackDef
  private readonly rng: Rng
  private bar = 0
  private progression: readonly number[]
  private prevVoicing: number[] | null = null
  private readonly melody: MelodyState

  constructor(def: TrackDef, seed: string | number = Date.now()) {
    this.def = def
    this.rng = createRng(`${def.id}:${seed}`)
    this.progression = this.rng.pick(def.progressions)
    const [lo, hi] = def.ranges.lead
    this.melody = { last: Math.round((lo + hi) / 2), motif: [], contour: [] }
  }

  private degreeAt(bar: number): number {
    return this.progression[bar % this.progression.length] as number
  }

  next(): GeneratedBar {
    const def = this.def
    const rng = this.rng
    const bar = this.bar++
    const phraseBar = bar % 4
    if (phraseBar === 0) {
      // New phrase: maybe a new progression (keep the first one for at least 2 phrases), new motif.
      if (bar > 0 && rng.chance(bar >= 8 ? 0.5 : 0.2)) this.progression = rng.pick(def.progressions)
      const [minN, maxN] = def.id === 'focus' ? [2, 4] : [3, 6]
      this.melody.motif = makeMotif(rng, def.beatsPerBar, 0.5, minN, maxN)
      this.melody.contour = makeContour(rng, this.melody.motif.length)
    } else if (phraseBar === 2 && rng.chance(0.5)) {
      // "B" bar: vary the contour (rhythm stays, so the phrase still hangs together).
      this.melody.contour = makeContour(rng, this.melody.motif.length)
    }
    const degree = this.degreeAt(phraseBar)
    const nextDegree = this.degreeAt(phraseBar + 1)
    let chord = diatonicChord(def.root, def.scale, degree, def.chordSize)
    // Colour (always diatonic): sevenths may swap their 5th for a major 9th;
    // triads occasionally gain their diatonic 7th. Minor 9ths are never added.
    const ninth = scaleDegree(def.root, def.scale, degree + 8)
    const ninthOk = pitchClass(ninth - (chord[0] as number)) === 2
    if (def.chordSize >= 4 && ninthOk && rng.chance(0.3)) chord = [chord[0] as number, chord[1] as number, chord[3] as number, ninth]
    else if (def.chordSize === 3 && rng.chance(0.15)) chord = diatonicChord(def.root, def.scale, degree, 4)
    const pcs = [...new Set(chord.map(pitchClass))]
    const [plo, phi] = def.ranges.pad
    const voicing = voiceLead(pcs, this.prevVoicing, plo, phi)
    this.prevVoicing = voicing
    const rootPc = pitchClass(chord[0] as number)
    const [blo, bhi] = def.ranges.bass
    const bassRoot = foldIntoRange(blo + ((rootPc - pitchClass(blo) + 12) % 12), blo, bhi)
    const nextRootPc = pitchClass(diatonicChord(def.root, def.scale, nextDegree, 1)[0] as number)

    const ctx: BarContext = { def, rng, bar, phraseBar, degree, voicing, chordPcs: pcs, bassRoot, nextRootPc, melody: this.melody }
    const events: NoteEvent[] = []
    const padVel = def.id === 'focus' ? 0.55 : 0.35
    // Pads: whole-bar chord; in busier tracks sometimes re-strike on beat 3.
    if (def.id !== 'focus' && rng.chance(0.3)) {
      for (const m of voicing) events.push({ inst: 'pad', beat: 0, dur: 2, midi: m, vel: padVel }, { inst: 'pad', beat: 2, dur: 2, midi: m, vel: padVel * 0.85 })
    } else {
      for (const m of voicing) events.push({ inst: 'pad', beat: 0, dur: def.beatsPerBar, midi: m, vel: padVel * rng.range(0.85, 1) })
    }
    events.push(...def.write(ctx))
    events.sort((a, b) => a.beat - b.beat)
    return { bar, degree, voicing, events }
  }
}
