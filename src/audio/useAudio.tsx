/**
 * React bindings for the audio engine (the only non-UI file importing React).
 */
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { audio, applyAudioSettings, installAudioUnlock, soundLocked, type AudioSettings, type AudioSnapshot, type SfxName, type SfxOptions, type TrackId } from './index'

export interface UseAudio extends AudioSnapshot {
  init: () => Promise<void>
  sfx: (name: SfxName, opts?: SfxOptions) => void
  playMusic: (track: TrackId) => void
  stopMusic: (fadeMs?: number) => void
  setSettings: (patch: Partial<AudioSettings>) => void
  setDucking: (on: boolean) => void
}

/** Reactive view of the audio engine + stable action callbacks. */
export function useAudio(): UseAudio {
  const snap = useSyncExternalStore(audio.subscribe, audio.getSnapshot, audio.getSnapshot)
  const actions = useMemo(
    () => ({
      init: () => audio.init(),
      sfx: (name: SfxName, opts?: SfxOptions) => {
        audio.sfx(name, opts)
      },
      playMusic: (track: TrackId) => audio.music.play(track),
      stopMusic: (fadeMs?: number) => audio.music.stop(fadeMs),
      setSettings: (patch: Partial<AudioSettings>) => applyAudioSettings(patch),
      setDucking: (on: boolean) => audio.setDucking(on),
    }),
    [],
  )
  return { ...snap, ...actions }
}

const lockedNow = () => soundLocked(audio.getSnapshot())

/**
 * True while sound effects are on but the AudioContext is not running (e.g.
 * after a reload, until the next gesture). Re-renders only when it flips; the
 * engine emits on every context `statechange`, so any click that resumes the
 * context (not only a dedicated button) clears it.
 */
export function useSoundLocked(): boolean {
  return useSyncExternalStore(audio.subscribe, lockedNow, lockedNow)
}

/**
 * Tiny provider: installs the first-gesture unlock and mirrors `settings`
 * (e.g. from the persisted prefs store) into the engine.
 */
export function AudioProvider({ settings, children }: { settings?: Partial<AudioSettings>; children?: ReactNode }) {
  useEffect(() => installAudioUnlock(), [])
  const key = settings ? JSON.stringify(settings) : ''
  useEffect(() => {
    if (settings) applyAudioSettings(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <>{children}</>
}
