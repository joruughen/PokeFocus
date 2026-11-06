/**
 * PokeFocus audio: fully synthesized chiptune sfx + generative music.
 *
 *   import { audio } from '../audio'
 *   audio.init()                 // on first gesture (or use installAudioUnlock)
 *   audio.sfx('claim')
 *   audio.music.play('focus')
 *
 * React bits live in `./useAudio` (`useAudio`, `AudioProvider`) and `./AudioLab`.
 */
import { AudioEngine, installAudioUnlock as installUnlock } from './engine'
import type { AudioSettings } from './settings'

export { AudioEngine, soundLocked } from './engine'
export type { AudioSnapshot, MusicControls, SfxOptions } from './engine'
export { DEFAULT_AUDIO_SETTINGS, focusMusicAudible, focusMusicPatch, sanitizeAudioSettings } from './settings'
export type { AudioSettings } from './settings'
export { SFX, SFX_NAMES } from './presets'
export type { SfxName } from './presets'
export { TRACKS, TRACK_IDS } from './tracks'
export type { TrackId } from './tracks'
export type { SfxHandle } from './synth'

/** The app-wide audio engine singleton. */
export const audio = new AudioEngine()

/** Push persisted settings (partial or full, untrusted input is clamped). */
export function applyAudioSettings(settings: Partial<AudioSettings>): void {
  audio.applySettings(settings)
}

/** Call `audio.init()` on the first pointer/key gesture. Returns cleanup. */
export function installAudioUnlock(): () => void {
  return installUnlock(audio)
}
