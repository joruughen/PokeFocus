import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { audio } from '../audio'
import { setHintsSuppressed } from './hints'
import { chime, electLeader, isLeaderTab, notify } from './lib/notify'
import { chimeUnlessOtherTabRings, dropBellClaim, resyncSessionEnd, syncSessionEndToAudio } from './lib/sound'
import { onTick } from './store/clock'
import { phaseOf, timerOf, useGame } from './store/game'
import { now, usePrefs } from './store/prefs'

const breaksNotified = new Set<string>()

/**
 * Background duties, no UI:
 * - suppress hints while a focus session runs;
 * - when the timer reaches 0, the leader tab notifies once (persisted flag),
 *   plays the `sessionEnd` bells (unless this tab, or another live tab, already
 *   has them on the audio clock: one sound across tabs) and changes the tab title;
 * - when a pomodoro break ends, the same signals (once per break);
 * - when the audio context starts running (first gesture after a reload, the
 *   "tap to turn sound on" chip), put the end bell on the audio clock so it
 *   rings on time in a hidden tab (a late claim would lower the reward).
 */
export function SessionWatcher() {
  const { t } = useTranslation()
  useEffect(() => {
    electLeader()
    const check = () => {
      const s = useGame.getState()
      const tNow = now()
      const phase = phaseOf(s, tNow)
      setHintsSuppressed(phase === 'focus' || phase === 'paused')
      const timer = timerOf(s)
      if ((phase === 'claim' || phase === 'late') && timer && !timer.notified && isLeaderTab()) {
        void s.markNotified()
        void chimeUnlessOtherTabRings(timer.sessionId)
        notify(t('notify.doneTitle'), t('notify.doneBody'))
        if (document.hidden) document.title = t('notify.tabTitle')
      }
      const b = s.breakTimer
      if (b && tNow >= b.endsAt && !breaksNotified.has(b.forSession) && isLeaderTab()) {
        breaksNotified.add(b.forSession)
        chime()
        notify(t('break.doneTitle'), t('break.doneBody'))
        if (document.hidden) document.title = t('break.tabTitle')
      }
    }
    check()
    // Dev clock rate/jump: the end bell was scheduled with the old rate, so re-time it.
    const offClock = usePrefs.subscribe((s, prev) => {
      if (s.dev.anchor !== prev.dev.anchor) resyncSessionEnd()
    })
    const offTick = onTick(check)
    let audioState = audio.getSnapshot().state
    const offAudio = audio.subscribe(() => {
      const st = audio.getSnapshot().state
      if (st === 'running' && audioState !== 'running') syncSessionEndToAudio(isLeaderTab())
      else if (st !== 'running' && audioState === 'running') dropBellClaim()
      audioState = st
    })
    return () => {
      offAudio()
      offClock()
      offTick()
    }
  }, [t])
  return null
}
