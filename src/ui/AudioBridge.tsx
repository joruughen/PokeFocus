import { useEffect } from 'react'
import { audio, type SfxName, type TrackId } from '../audio'
import { AudioProvider } from '../audio/useAudio'
import { useRoute } from './router'
import { useGame } from './store/game'
import { usePrefs } from './store/prefs'
import { usePhase } from './store/selectors'

/**
 * Wires the audio module into the app (docs/ui-foundation.md §Audio):
 * - mirrors the persisted audio settings and unlocks audio on the first gesture;
 * - picks the music track from the screen and the core-loop phase (crossfades in the engine);
 * - plays a subtle click on buttons/links, `toggle` on switches and pressed keys.
 *   Opt out per element with `data-sfx="none"`, or name another sound with `data-sfx="<SfxName>"`.
 */
export function AudioBridge({ children }: { children: React.ReactNode }) {
  const settings = usePrefs((s) => s.audio)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('button, a[href], [role="radio"], [role="switch"], [role="option"]')
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return
      const named = el.closest('[data-sfx]')?.getAttribute('data-sfx')
      if (named === 'none') return
      if (named) audio.sfx(named as SfxName)
      else if (el.getAttribute('role') === 'switch' || el.hasAttribute('aria-pressed')) audio.sfx('toggle', { volume: 0.7 })
      else audio.sfx('uiClick', { volume: 0.6 })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  return <AudioProvider settings={settings}>{children}</AudioProvider>
}

/** Chooses the music for the current screen. Mount once below the player check. */
export function MusicDirector() {
  const phase = usePhase()
  const route = useRoute()
  const hasPlayer = useGame((s) => s.player !== null)
  let track: TrackId = 'home'
  if (phase === 'focus' || phase === 'paused') track = 'focus'
  else if (route === 'home' && (phase === 'claim' || phase === 'late' || phase === 'results')) track = 'results'
  else if (route === 'home' && phase === 'waves') track = 'encounter'
  else if (!hasPlayer) track = 'home'
  useEffect(() => {
    audio.music.play(track)
  }, [track])
  return null
}
