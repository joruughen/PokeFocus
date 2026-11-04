/**
 * Music theory helpers: notes, scales, diatonic chords and voice leading.
 * Pure functions; all pitches are MIDI note numbers (60 = C4, 69 = A4 = 440 Hz).
 */

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>

export type ScaleName = keyof typeof SCALES

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

/** "C4", "F#3", "Bb5" → MIDI. Throws on malformed input. */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim())
  if (!m) throw new Error(`Bad note name: ${name}`)
  const letter = (m[1] as string).toUpperCase()
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  const octave = Number(m[3])
  return (NOTE_INDEX[letter] as number) + acc + (octave + 1) * 12
}

/** Note name → frequency in Hz. */
export function hz(name: string): number {
  return midiToFreq(noteToMidi(name))
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12
}

/** Semitone ratio, e.g. semis(12) = 2. */
export function semis(n: number): number {
  return Math.pow(2, n / 12)
}

/** Pitch-class set of a scale rooted at `root` (any octave). */
export function scalePitchClasses(root: number, scale: readonly number[]): number[] {
  return scale.map((i) => pitchClass(root + i))
}

export function inScale(midi: number, root: number, scale: readonly number[]): boolean {
  return scalePitchClasses(root, scale).includes(pitchClass(midi))
}

/**
 * MIDI note for a (possibly negative or > length) scale degree, 0-based.
 * degree 0 = root, 7 in a heptatonic scale = root an octave up.
 */
export function scaleDegree(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length
  const oct = Math.floor(degree / n)
  const idx = ((degree % n) + n) % n
  return root + (scale[idx] as number) + 12 * oct
}

/** All scale notes in [lo, hi] (inclusive), ascending. */
export function scaleNotesInRange(root: number, scale: readonly number[], lo: number, hi: number): number[] {
  const pcs = scalePitchClasses(root, scale)
  const out: number[] = []
  for (let m = Math.ceil(lo); m <= hi; m++) if (pcs.includes(pitchClass(m))) out.push(m)
  return out
}

/**
 * Diatonic chord built by stacking thirds on a 0-based scale degree.
 * Returns MIDI notes in root position starting at the degree's pitch near `root`.
 * size 3 = triad, 4 = seventh, 5 = ninth.
 */
export function diatonicChord(root: number, scale: readonly number[], degree: number, size = 3): number[] {
  const out: number[] = []
  for (let i = 0; i < size; i++) out.push(scaleDegree(root, scale, degree + 2 * i))
  return out
}

/**
 * Voice a set of pitch classes inside [lo, hi] so that the total movement from
 * `prev` is minimal (classic smooth voice leading). With no `prev`, returns a
 * close voicing centred in the range. Output is sorted ascending and contains
 * every pitch class exactly once (when the range allows it).
 */
export function voiceLead(chordPcs: readonly number[], prev: readonly number[] | null, lo: number, hi: number): number[] {
  const pcs = [...new Set(chordPcs.map(pitchClass))]
  // Candidate pitches per pitch class within range.
  const options = pcs.map((pc) => {
    const list: number[] = []
    for (let m = lo; m <= hi; m++) if (pitchClass(m) === pc) list.push(m)
    return list
  })
  if (options.some((o) => o.length === 0)) {
    // Range too narrow: fall back to a close voicing from lo.
    return pcs.map((pc) => lo + ((pc - pitchClass(lo) + 12) % 12)).sort((a, b) => a - b)
  }
  const centre = (lo + hi) / 2
  const target = prev && prev.length > 0 ? [...prev].sort((a, b) => a - b) : null
  let best: number[] = []
  let bestCost = Infinity
  const pick: number[] = []
  const walk = (i: number): void => {
    if (i === options.length) {
      const v = [...pick].sort((a, b) => a - b)
      const span = (v[v.length - 1] as number) - (v[0] as number)
      if (span > 19) return // keep voicings compact (≤ a 10th + octave)
      let cost: number
      if (target) {
        cost = 0
        for (let k = 0; k < v.length; k++) {
          const t = target[Math.min(k, target.length - 1)] as number
          cost += Math.abs((v[k] as number) - t)
        }
      } else {
        const mean = v.reduce((a, b) => a + b, 0) / v.length
        cost = Math.abs(mean - centre) + span * 0.25
      }
      // Avoid minor-second clusters between adjacent voices (muddy on pads).
      for (let k = 1; k < v.length; k++) if ((v[k] as number) - (v[k - 1] as number) === 1) cost += 3
      if (cost < bestCost) {
        bestCost = cost
        best = v
      }
      return
    }
    for (const m of options[i] as number[]) {
      pick.push(m)
      walk(i + 1)
      pick.pop()
    }
  }
  walk(0)
  return best
}

/** Nearest MIDI note with pitch class `pc` to `near`. */
export function nearestPc(pc: number, near: number): number {
  const base = near - pitchClass(near) + pitchClass(pc)
  const cands = [base - 12, base, base + 12]
  return cands.reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a))
}

/** Clamp a MIDI note into [lo, hi] by octave shifts. */
export function foldIntoRange(midi: number, lo: number, hi: number): number {
  let m = midi
  while (m < lo) m += 12
  while (m > hi) m -= 12
  return m
}
