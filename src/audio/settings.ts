/**
 * Persistable audio preferences. Store an `AudioSettings` object in the UI's
 * persisted prefs and push it with `applyAudioSettings(settings)`.
 */

export interface AudioSettings {
  /** Master switch: when false nothing is synthesized at all. */
  enabled: boolean
  /** Temporary mute (keeps volumes untouched). */
  muted: boolean
  /** Master volume 0–1. */
  master: number
  /** Music volume 0–1. */
  music: number
  /** Sound-effect volume 0–1. */
  sfx: number
  /** Play the `focus` track during sessions (some people prefer silence). */
  musicDuringFocus: boolean
  /** Extra level for the focus track relative to `music` (0–1). "On but low" by default. */
  focusMusicLevel: number
  /** Keep focus music playing while the tab is hidden. Other tracks always pause when hidden. */
  backgroundMusic: boolean
  /** Lower music while fanfares / jingles play. */
  ducking: boolean
  /** Vinyl hiss + crackle bed on the focus track. */
  vinylHiss: boolean
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  enabled: true,
  muted: false,
  master: 0.8,
  music: 0.35,
  sfx: 0.6,
  musicDuringFocus: true,
  focusMusicLevel: 0.6,
  backgroundMusic: true,
  ducking: true,
  vinylHiss: true,
})

const clamp01 = (x: unknown, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback
const bool = (x: unknown, fallback: boolean): boolean => (typeof x === 'boolean' ? x : fallback)

/** Merge untrusted (e.g. persisted) input over a base, clamping every field. */
export function sanitizeAudioSettings(input: unknown, base: AudioSettings = DEFAULT_AUDIO_SETTINGS): AudioSettings {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof AudioSettings, unknown>>
  return {
    enabled: bool(p.enabled, base.enabled),
    muted: bool(p.muted, base.muted),
    master: clamp01(p.master, base.master),
    music: clamp01(p.music, base.music),
    sfx: clamp01(p.sfx, base.sfx),
    musicDuringFocus: bool(p.musicDuringFocus, base.musicDuringFocus),
    focusMusicLevel: clamp01(p.focusMusicLevel, base.focusMusicLevel),
    backgroundMusic: bool(p.backgroundMusic, base.backgroundMusic),
    ducking: bool(p.ducking, base.ducking),
    vinylHiss: bool(p.vinylHiss, base.vinylHiss),
  }
}
