import { describe, expect, it } from 'vitest'
import { DEFAULT_AUDIO_SETTINGS, focusMusicAudible, focusMusicPatch, sanitizeAudioSettings, type AudioSettings } from './settings'

const base: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS }
const apply = (s: AudioSettings, patch: Partial<AudioSettings>) => sanitizeAudioSettings({ ...s, ...patch }, s)

describe('focus music mute', () => {
  it('is audible with the defaults', () => {
    expect(focusMusicAudible(base)).toBe(true)
  })

  it('anything that silences the focus track makes it inaudible', () => {
    expect(focusMusicAudible({ ...base, musicDuringFocus: false })).toBe(false)
    expect(focusMusicAudible({ ...base, muted: true })).toBe(false)
    expect(focusMusicAudible({ ...base, enabled: false })).toBe(false)
    expect(focusMusicAudible({ ...base, master: 0 })).toBe(false)
    expect(focusMusicAudible({ ...base, music: 0 })).toBe(false)
    expect(focusMusicAudible({ ...base, focusMusicLevel: 0 })).toBe(false)
  })

  it('muting only turns off music during focus: volumes and sound effects stay', () => {
    const muted = apply(base, focusMusicPatch(base, false))
    expect(focusMusicAudible(muted)).toBe(false)
    expect(muted).toEqual({ ...base, musicDuringFocus: false })
    expect(muted.muted).toBe(false)
    expect(muted.sfx).toBe(base.sfx)
  })

  it('unmuting restores the focus music, lifting a global mute or zero volumes too', () => {
    const silent: AudioSettings = { ...base, musicDuringFocus: false, muted: true, enabled: false, master: 0, music: 0, focusMusicLevel: 0 }
    const back = apply(silent, focusMusicPatch(silent, true))
    expect(focusMusicAudible(back)).toBe(true)
    expect(back).toMatchObject({ master: base.master, music: base.music, focusMusicLevel: base.focusMusicLevel })
  })

  it('unmuting keeps the volumes the player chose', () => {
    const chosen: AudioSettings = { ...base, musicDuringFocus: false, master: 0.5, music: 0.2, focusMusicLevel: 0.9 }
    const back = apply(chosen, focusMusicPatch(chosen, true))
    expect(back).toMatchObject({ master: 0.5, music: 0.2, focusMusicLevel: 0.9, musicDuringFocus: true })
  })

  it('mute then unmute is a round trip', () => {
    const there = apply(base, focusMusicPatch(base, false))
    expect(apply(there, focusMusicPatch(there, true))).toEqual(base)
  })
})
