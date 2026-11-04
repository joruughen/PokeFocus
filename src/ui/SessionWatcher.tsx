import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { setHintsSuppressed } from './hints'
import { chime, electLeader, isLeaderTab, notify } from './lib/notify'
import { sessionEndScheduled } from './lib/sound'
import { onTick } from './store/clock'
import { phaseOf, timerOf, useGame } from './store/game'
import { now } from './store/prefs'

const breaksNotified = new Set<string>()

/**
 * Background duties, no UI:
 * - suppress hints while a focus session runs;
 * - when the timer reaches 0, the leader tab notifies once (persisted flag),
 *   plays the `sessionEnd` bells (unless already scheduled on the audio clock
 *   at start) and changes the tab title;
 * - when a pomodoro break ends, the same signals (once per break).
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
        s.markNotified()
        if (!sessionEndScheduled(timer.sessionId)) chime()
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
    return onTick(check)
  }, [t])
  return null
}
