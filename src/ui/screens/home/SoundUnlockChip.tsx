import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { audio } from '../../../audio'
import { useSoundLocked } from '../../../audio/useAudio'
import { Button } from '../../components'
import { usePhase } from '../../store/selectors'

/**
 * "Tap to turn sound on" (QA R-01). After a reload the browser keeps the
 * audio context suspended until the next gesture, so the end-of-session bell
 * would be silent and a player studying in another tab could miss the end and
 * claim late (lower reward). While a session counts down, or a pomodoro break
 * runs, and sound is on in Settings but the context is not running, this chip
 * offers the gesture. The click resumes audio inside the gesture;
 * SessionWatcher then puts the bell back on the audio clock. Any other click
 * that resumes the context hides it too (the engine emits on `statechange`).
 *
 * Accessibility: a real button; a polite status says once why it appeared and
 * once that sound is back; if the button had focus when it goes away, focus
 * moves to `focusAfterId` instead of being lost.
 */
export function SoundUnlockChip({ focusAfterId, className }: { focusAfterId?: string; className?: string }) {
  const locked = useSoundLocked()
  const phase = usePhase()
  const show = locked && (phase === 'focus' || phase === 'break')
  return <SoundUnlockChipView show={show} onUnlock={() => void audio.init().catch(() => undefined)} focusAfterId={focusAfterId} className={className} />
}

/** Presentational part (rendered in tests without a browser). */
export function SoundUnlockChipView({ show, onUnlock, focusAfterId, className }: { show: boolean; onUnlock: () => void; focusAfterId?: string; className?: string }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLButtonElement>(null)
  /** Set by a click: whether the button had focus then (to hand focus on when it goes away). */
  const clicked = useRef<{ focused: boolean } | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const wasShown = useRef(show)
  // Fill the live region only after it exists, so the first message is announced.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  // The chip just went away after being shown: say so once (only if the player used it), keep focus.
  useEffect(() => {
    if (wasShown.current && !show) {
      const c = clicked.current
      clicked.current = null
      if (c) {
        setUnlocked(true)
        if (c.focused && focusAfterId) document.getElementById(focusAfterId)?.focus()
      }
    }
    if (show) setUnlocked(false)
    wasShown.current = show
  }, [show, focusAfterId])

  const status = !ready ? '' : show ? t('focus.soundLockedNote') : unlocked ? t('focus.soundOn') : ''
  return (
    <>
      {show && (
        <Button
          ref={ref}
          size="sm"
          variant="secondary"
          icon="volumeOff"
          className={className}
          onClick={() => {
            clicked.current = { focused: document.activeElement === ref.current }
            onUnlock() // synchronously, inside the gesture
          }}
        >
          {t('focus.soundLocked')}
        </Button>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </span>
    </>
  )
}
