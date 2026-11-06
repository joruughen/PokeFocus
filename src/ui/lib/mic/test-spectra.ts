/**
 * Synthetic analyser frames for the mic tests (not used by the app): a noisy
 * mic (hiss with per-bin random power, like a real FFT of noise, plus steady
 * mains-hum harmonics), with optional voice, music or broadband noise on top.
 */
import type { RawFrame } from './pipeline'

export const SR = 48_000
export const BINS = 1024 // fftSize 2048
export const BIN_HZ = SR / (2 * BINS)

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const lin = (db: number) => Math.pow(10, db / 10)

/** A steady tone at `hz` spread over its neighbouring bins (window main lobe). */
function addTone(p: Float64Array, hz: number, db: number): void {
  const c = hz / BIN_HZ
  for (let i = Math.max(0, Math.floor(c) - 2); i <= Math.min(BINS - 1, Math.ceil(c) + 2); i++) {
    const d = Math.abs(i - c)
    if (d < 2.5) p[i]! += lin(db - 6 * d * d)
  }
}

export interface MicNoise {
  /** Hiss level per bin (mean), dB. */
  hissDb?: number
  /** Level of the 2nd mains harmonic, dB (higher ones drop 1.5 dB each); null = no hum. */
  humDb?: number | null
  /** Mains frequency. */
  mains?: 50 | 60
}

/** Power per bin of the mic's own noise for one frame. */
export function micNoise(r: () => number, { hissDb = -95, humDb = -72, mains = 50 }: MicNoise = {}): Float64Array {
  const p = new Float64Array(BINS)
  const h = lin(hissDb)
  for (let i = 0; i < BINS; i++) p[i] = h * -Math.log(1 - r() * 0.999999)
  if (humDb !== null) for (let k = 2; k * mains < 1500; k++) addTone(p, k * mains, humDb - (k - 2) * 1.5)
  return p
}

/** Voiced speech frame: harmonics of a moving pitch shaped by two moving formants (index = frame number). */
export function addVoice(p: Float64Array, frame: number, levelDb = -50): void {
  const f0 = 130 + 35 * Math.sin(frame * 0.9)
  const f1 = 650 + 200 * Math.sin(frame * 1.7)
  const f2 = 1700 + 500 * Math.sin(frame * 1.1 + 1)
  for (let k = 1; k * f0 < 3400; k++) {
    const f = k * f0
    const env = Math.max(levelDb - Math.abs(f - f1) / 40, levelDb - 5 - Math.abs(f - f2) / 60)
    addTone(p, f, Math.max(env, levelDb - 45))
  }
}

/** A steady A-major chord with 12 harmonics per note. */
export function addMusic(p: Float64Array, levelDb = -52): void {
  for (const f0 of [220, 277.18, 329.63]) for (let k = 1; k <= 12; k++) addTone(p, k * f0, levelDb - 2 * k)
}

/** Broadband noise (fan, traffic) at `db` per bin. */
export function addBroadband(p: Float64Array, r: () => number, db: number): void {
  const l = lin(db)
  for (let i = 0; i < BINS; i++) p[i]! += l * -Math.log(1 - r() * 0.999999)
}

/** Analyser-like frame from bin powers; the time-domain level is tied to the total power. */
export function toFrame(p: Float64Array): RawFrame {
  const spectrumDb = new Float32Array(BINS)
  let total = 0
  for (let i = 0; i < BINS; i++) {
    spectrumDb[i] = 10 * Math.log10(p[i]! + 1e-20)
    total += p[i]!
  }
  return { spectrumDb, rmsDb: Math.max(-100, 10 * Math.log10(total + 1e-20) + 10), sampleRate: SR }
}

export type Scene = 'silence' | 'voice' | 'music' | 'loudNoise'

/** `n` frames of a scene over the noisy mic. Voice pauses one frame in four. */
export function sceneFrames(scene: Scene, n: number, seed: number, noise: MicNoise = {}): RawFrame[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => {
    const p = micNoise(r, noise)
    if (scene === 'voice' && i % 4 !== 3) addVoice(p, i + seed, -50 - (i % 3) * 3)
    if (scene === 'music') addMusic(p, -52 + ((i % 2) - 0.5) * 0.6)
    if (scene === 'loudNoise') addBroadband(p, r, -80)
    return toFrame(p)
  })
}
