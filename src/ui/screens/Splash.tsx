import { useTranslation } from 'react-i18next'
import { Button, Logo, Mascot } from '../components'
import { errorText } from '../lib/errors'
import { useAuth } from '../store/auth'
import { useGame } from '../store/game'

/**
 * Shown while we ask the server who we are (`game = false`) or load the
 * player's save (`game = true`). If the server can't be reached it says so and
 * offers a retry instead of spinning forever.
 */
export function Splash({ game = false }: { game?: boolean }) {
  const { t } = useTranslation()
  const bootError = useAuth((s) => s.bootError)
  const gameError = useGame((s) => s.error)
  const gameLoading = useGame((s) => s.loading)
  const error = game ? (gameLoading ? null : gameError) : bootError
  const retry = () => (game ? void useGame.getState().load() : void useAuth.getState().refresh())
  return (
    <main id="main" tabIndex={-1} className="grid min-h-dvh place-items-center bg-dusk-950 px-4 outline-none">
      <div className="flex flex-col items-center gap-6 text-center">
        <Logo height={48} />
        <Mascot pose={error ? 'think' : 'sleep'} size={96} />
        {error ? (
          <div role="alert" className="flex max-w-[44ch] flex-col items-center gap-4">
            <p className="text-lg text-mist-100">{game ? t('auth.splash.gameError') : t('auth.splash.offline')}</p>
            <p className="text-sm text-mist-400">{errorText(error)}</p>
            <Button icon="reroll" onClick={retry}>
              {t('auth.splash.retry')}
            </Button>
          </div>
        ) : (
          <p role="status" className="font-display text-lg text-mist-300">
            {game ? t('auth.splash.loadingGame') : t('common.loading')}
          </p>
        )}
      </div>
    </main>
  )
}
