import { useTranslation } from 'react-i18next'
import { DevPanel } from './dev/DevPanel'
import { AppShell } from './AppShell'
import { AudioBridge, MusicDirector } from './AudioBridge'
import { TooltipProvider, ToastViewport } from './components'
import { HintLayer } from './hints'
import { FirstRun } from './screens/FirstRun'
import { SessionWatcher } from './SessionWatcher'
import { useGame } from './store/game'
import { devEnabled, usePrefs } from './store/prefs'

export default function App() {
  const { t } = useTranslation()
  const hasPlayer = useGame((s) => s.player !== null)
  usePrefs((s) => s.dev.panelOpen) // re-render when the dev panel is toggled
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
        {hasPlayer ? <AppShell /> : <FirstRun />}
        {hasPlayer && <SessionWatcher />}
        <HintLayer />
        {devEnabled() && <DevPanel />}
      </ToastViewport>
    </TooltipProvider>
    <MusicDirector />
    </AudioBridge>
  )
}
