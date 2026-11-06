import { describe, expect, it } from 'vitest'
import { STORAGE_KEYS, storageBackend } from './persistence'
import { usePrefs } from './prefs'

describe('prefs persistence: dropped fields', () => {
  it('has no time-zone stamp any more (the 30-day lock is in the server document)', () => {
    const s = usePrefs.getState() as unknown as Record<string, unknown>
    expect('tzChangedAt' in s).toBe(false)
    expect('setTzChangedAt' in s).toBe(false)
    expect(Object.keys(STORAGE_KEYS)).toEqual(['prefs'])
  })

  it('an old saved prefs object with tzChangedAt (and other dropped options) still loads, and is not saved back', async () => {
    storageBackend.setItem(
      STORAGE_KEYS.prefs,
      JSON.stringify({
        state: { locale: 'en', tipsEnabled: false, tzChangedAt: 1_700_000_000_000, sound: false, micHeadphones: true, micCalibrationOffered: true, micEnabled: true },
        version: 1,
      }),
    )
    await usePrefs.persist.rehydrate()
    const s = usePrefs.getState() as unknown as Record<string, unknown>
    expect(s.locale).toBe('en')
    expect(s.tipsEnabled).toBe(false)
    expect(s.micEnabled).toBe(true)
    expect((s.audio as { muted: boolean }).muted).toBe(true) // legacy `sound: false` becomes the mute
    for (const k of ['tzChangedAt', 'sound', 'micHeadphones', 'micCalibrationOffered']) expect(k in s, k).toBe(false)

    usePrefs.getState().setTipsEnabled(true) // any write persists the store again
    const saved = JSON.parse(storageBackend.getItem(STORAGE_KEYS.prefs) as string) as { state: Record<string, unknown> }
    expect(saved.state.tipsEnabled).toBe(true)
    expect('tzChangedAt' in saved.state).toBe(false)
  })

  it('loads with nothing saved', async () => {
    storageBackend.removeItem(STORAGE_KEYS.prefs)
    await expect(usePrefs.persist.rehydrate()).resolves.not.toThrow()
    expect(usePrefs.getState().milestones).toEqual({})
  })
})
