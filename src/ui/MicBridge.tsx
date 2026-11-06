import { useEffect } from 'react'
import { clearMicTallies, startMic, stopMic } from './lib/mic/monitor'
import { useGame } from './store/game'
import { usePrefs } from './store/prefs'
import { usePhase } from './store/selectors'

/**
 * No UI: runs the microphone monitor (opt-in) only while a session counts
 * down. Pausing, finishing or cancelling releases the device; the record of
 * the session stays until it is claimed or cancelled.
 */
export function MicBridge() {
  const enabled = usePrefs((s) => s.micEnabled)
  const loaded = useGame((s) => s.loaded)
  const sessionId = useGame((s) => s.player?.activeSession?.id ?? null)
  const phase = usePhase()
  const listen = enabled && sessionId !== null && phase === 'focus'

  useEffect(() => {
    if (listen && sessionId) void startMic(sessionId)
    else stopMic()
  }, [listen, sessionId])

  // Drop the records of sessions that no longer exist (claimed, cancelled, other tab).
  useEffect(() => {
    if (!loaded) return
    clearMicTallies(sessionId)
  }, [loaded, sessionId])

  useEffect(() => () => stopMic(), [])
  return null
}
