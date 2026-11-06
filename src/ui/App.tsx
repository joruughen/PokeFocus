import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DevPanel } from './dev/DevPanel'
import { AppShell } from './AppShell'
import { AudioBridge, MusicDirector } from './AudioBridge'
import { TooltipProvider, ToastViewport } from './components'
import { HintLayer } from './hints'
import { AuthScreen } from './screens/auth/AuthScreen'
import { FirstRun } from './screens/FirstRun'
import { Splash } from './screens/Splash'
import { SessionWatcher } from './SessionWatcher'
import { MicBridge } from './MicBridge'
import { startAnnouncements } from './store/announcements'
import { useAuth } from './store/auth'
import { useGame } from './store/game'
import { devEnabled, usePrefs } from './store/prefs'

// Ask the server who we are once per page load (the session is an HttpOnly cookie).
let booted = false
function boot() {
  if (booted) return
  booted = true
  void useAuth.getState().refresh()
  startAnnouncements()
}

/**
 * Gate: 'loading' → splash; signed out → login/register; signed in → wait for
 * the game doc → first run (no player yet) or the app.
 */
export default function App() {
  const { t } = useTranslation()
  boot()
  const status = useAuth((s) => s.status)
  const loaded = useGame((s) => s.loaded)
  const hasPlayer = useGame((s) => s.player !== null)
  const ready = status === 'authed' && loaded
  usePrefs((s) => s.dev.panelOpen) // re-render when the dev panel is toggled
  // Finishing the first run unmounts the button that had keyboard focus (focus falls to <body>): put it on <main> (QA R-07).
  const sawFirstRun = useRef(false)
  useEffect(() => {
    if (ready && !hasPlayer) sawFirstRun.current = true
    else if (ready && hasPlayer && sawFirstRun.current) {
      sawFirstRun.current = false
      document.getElementById('main')?.focus({ preventScroll: true })
    }
  }, [ready, hasPlayer])
  return (
    <AudioBridge>
    <TooltipProvider delay={250}>
      <ToastViewport>
        {/* The app routes on the hash, so the skip link must not touch it: it moves focus to <main> instead. */}
        <a
          href="#main"
          onClick={(e) => {
            e.preventDefault()
            document.getElementById('main')?.focus()
          }}
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:bg-volt-400 focus:px-3 focus:py-2 focus:text-ink">
          {t('common.skipToContent')}
        </a>
        {status === 'loading' ? <Splash /> : status === 'anon' ? <AuthScreen /> : !loaded ? <Splash game /> : hasPlayer ? <AppShell /> : <FirstRun />}
        {ready && hasPlayer && <SessionWatcher />}
        {ready && hasPlayer && <MicBridge />}
        {ready && <HintLayer />}
        {ready && devEnabled() && <DevPanel />}
      </ToastViewport>
    </TooltipProvider>
    <MusicDirector />
    </AudioBridge>
  )
}
