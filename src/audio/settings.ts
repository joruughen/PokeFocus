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

/**
 * Can the focus track be heard? False when anything silences it: the master
 * switch, the mute, a zero volume, or the "music during focus" option.
 */
export function focusMusicAudible(s: AudioSettings): boolean {
  return s.enabled && !s.muted && s.master > 0 && s.music > 0 && s.focusMusicLevel > 0 && s.musicDuringFocus
}

/**
 * Settings patch for the session's mute button. Muting only turns off "music
 * during focus", so volumes stay as they are and sound effects (the end-of-session
 * chime) keep playing. Unmuting makes the focus music audible again: it also lifts
 * a global mute or a zero volume, which would otherwise leave the button doing nothing.
 */
export function focusMusicPatch(s: AudioSettings, audible: boolean): Partial<AudioSettings> {
  if (!audible) return { musicDuringFocus: false }
  const d = DEFAULT_AUDIO_SETTINGS
  return {
    enabled: true,
    muted: false,
    musicDuringFocus: true,
    master: s.master > 0 ? s.master : d.master,
    music: s.music > 0 ? s.music : d.music,
    focusMusicLevel: s.focusMusicLevel > 0 ? s.focusMusicLevel : d.focusMusicLevel,
  }
}
