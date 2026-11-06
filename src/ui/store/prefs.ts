/**
 * UI preferences (persisted): language, tips, audio, seen hints, the
 * getting-started checklist and the
 * developer settings (time acceleration, fixed RNG seed, simulated Focus label).
 * Game data lives in `game.ts`; this store never touches `PlayerState`.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings, type AudioSettings } from '../../audio'
import type { FocusLabel } from '../../engine'
import i18n, { detectLocale, type Locale } from '../../i18n'
import { jsonStorage, STORAGE_KEYS } from './persistence'

/** Virtual clock anchor: `virtual + (realNow - real) * rate`. */
export interface ClockAnchor {
  real: number
  virtual: number
  rate: number
}

export interface DevSettings {
  /** Panel visible (also forced on by `?dev` in the URL). */
  panelOpen: boolean
  /** 1 = real time; 60 = one study minute per real second. */
  rate: number
  anchor: ClockAnchor | null
  /** Simulated screenshot label for the next claims; null = no screen permission. */
  focusLabel: FocusLabel | null
  /** Fixed RNG seed (reproducible runs); null = random. */
  seed: string | null
  rngCounter: number
}

/** Getting-started steps that can't be read from the save (the others are derived). */
export type Milestone = 'equip' | 'candy' | 'evolve' | 'mission'

export interface PrefsState {
  locale: Locale
  tipsEnabled: boolean
  /** Audio settings (pushed to the audio engine by AudioProvider). */
  audio: AudioSettings
  /** Getting-started milestones reached (epoch ms). */
  milestones: Partial<Record<Milestone, number>>
  checklistDismissed: boolean
  /** Last time zone change (real ms), for the 30-day lock. */
  tzChangedAt: number | null
  /** Hint id → epoch ms (real time) when it was seen or dismissed. */
  seenHints: Record<string, number>
  /** Opt-in: analyse the microphone during sessions (sound profile, GDD §4.3). */
  micEnabled: boolean
  dev: DevSettings
  setLocale: (l: Locale) => void
  setTipsEnabled: (on: boolean) => void
  setAudio: (patch: Partial<AudioSettings>) => void
  markMilestone: (m: Milestone) => void
  setChecklistDismissed: (v: boolean) => void
  setTzChangedAt: (t: number | null) => void
  setMicEnabled: (on: boolean) => void
  markHintSeen: (id: string) => void
  resetHints: () => void
  setDev: (patch: Partial<DevSettings>) => void
  /** Change the time rate keeping the virtual "now" continuous. */
  setRate: (rate: number) => void
  /** Jump the virtual clock forward (ms of game time). */
  advanceClock: (ms: number) => void
  /** Back to real time (only safe with no active session). */
  resetClock: () => void
  nextSeed: () => string | null
}

const DEFAULT_DEV: DevSettings = {
  panelOpen: false,
  rate: 1,
  anchor: null,
  focusLabel: 'studying',
  seed: null,
  rngCounter: 0,
}

/**
 * Server clock skew (ms): `serverNow - Date.now()` measured on the last game
 * response (see game.ts). The server decides when a session ends, so "real"
 * time in the UI is the browser clock corrected by this offset; the countdown
 * then matches the server even if the device clock is a bit off. Not persisted.
 */
let serverOffset = 0

/** Record the skew from a server response (ignored while the dev clock is active). */
export function setServerOffset(ms: number): void {
  if (Number.isFinite(ms)) serverOffset = ms
}

export function getServerOffset(): number {
  return serverOffset
}

function virtualFrom(anchor: ClockAnchor | null, realNow: number): number {
  return anchor ? anchor.virtual + (realNow - anchor.real) * anchor.rate : realNow + serverOffset
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      locale: detectLocale(),
      tipsEnabled: true,
      audio: { ...DEFAULT_AUDIO_SETTINGS },
      milestones: {},
      checklistDismissed: false,
      tzChangedAt: null,
      seenHints: {},
      micEnabled: false,
      dev: DEFAULT_DEV,
      setLocale: (locale) => {
        void i18n.changeLanguage(locale)
        set({ locale })
      },
      setTipsEnabled: (tipsEnabled) => set({ tipsEnabled }),
      setAudio: (patch) => set((s) => ({ audio: sanitizeAudioSettings({ ...s.audio, ...patch }, s.audio) })),
      markMilestone: (m) => set((s) => (s.milestones[m] ? s : { milestones: { ...s.milestones, [m]: Date.now() } })),
      setChecklistDismissed: (checklistDismissed) => set({ checklistDismissed }),
      setTzChangedAt: (tzChangedAt) => set({ tzChangedAt }),
      setMicEnabled: (micEnabled) => set({ micEnabled }),
      markHintSeen: (id) => set((s) => ({ seenHints: { ...s.seenHints, [id]: Date.now() } })),
      resetHints: () => set({ seenHints: {}, tipsEnabled: true }),
      setDev: (patch) => set((s) => ({ dev: { ...s.dev, ...patch } })),
      setRate: (rate) =>
        set((s) => {
          const real = Date.now()
          const virtual = virtualFrom(s.dev.anchor, real)
          const anchor = rate === 1 && Math.abs(virtual - (real + serverOffset)) < 1000 ? null : { real, virtual, rate }
          return { dev: { ...s.dev, rate, anchor } }
        }),
      advanceClock: (ms) =>
        set((s) => {
          const real = Date.now()
          const virtual = virtualFrom(s.dev.anchor, real) + ms
          return { dev: { ...s.dev, anchor: { real, virtual, rate: s.dev.rate } } }
        }),
      resetClock: () => set((s) => ({ dev: { ...s.dev, anchor: null, rate: 1 } })),
      nextSeed: () => {
        const { seed, rngCounter } = get().dev
        if (seed === null) return null
        set((s) => ({ dev: { ...s.dev, rngCounter: s.dev.rngCounter + 1 } }))
        return `${seed}:${rngCounter}`
      },
    }),
    {
      name: STORAGE_KEYS.prefs,
      storage: jsonStorage,
      version: 1,
      partialize: ({ locale, tipsEnabled, audio, milestones, checklistDismissed, tzChangedAt, seenHints, micEnabled, dev }) => ({
        locale,
        tipsEnabled,
        audio,
        milestones,
        checklistDismissed,
        tzChangedAt,
        seenHints,
        micEnabled,
        dev,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrefsState> & { sound?: boolean; micHeadphones?: unknown; micCalibrationOffered?: unknown }
        // Part A saved `sound: boolean`; it becomes the audio mute.
        const audio = sanitizeAudioSettings(p.audio ?? (p.sound === false ? { muted: true } : {}))
        // Dropped mic options (headphones declaration, "calibration offered") are ignored.
        const { sound: _legacy, micHeadphones: _hp, micCalibrationOffered: _offered, ...rest } = p
        void _legacy
        void _hp
        void _offered
        return { ...current, ...rest, audio, milestones: p.milestones ?? {}, micEnabled: p.micEnabled === true, dev: { ...DEFAULT_DEV, ...(p.dev ?? {}) } }
      },
    },
  ),
)

/** Current game time in epoch ms (server-corrected real time unless the dev clock is active). */
export function now(): number {
  return virtualFrom(usePrefs.getState().dev.anchor, Date.now())
}

/** True when `?dev` is in the URL or the panel was opened from Settings. */
export function devEnabled(): boolean {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev')) return true
  return usePrefs.getState().dev.panelOpen
}
