import { lazy, Suspense, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { DAY_MS, defaultContext, HOUR_MS, trainerExpForLevel, type FocusLabel } from '../../engine'
import { Button, IconButton, PixelIcon, Segmented, toast } from '../components'
import { cx } from '../lib/cx'
import { WEATHER_PRESETS, weatherKind, type WeatherKind } from '../lib/conditions'
import { errorText } from '../lib/errors'
import { refreshWeather } from '../lib/weather'
import { fmtClock } from '../lib/format'

const AudioLab = lazy(() => import('../../audio/AudioLab').then((m) => ({ default: m.AudioLab })))
import { useNow } from '../store/clock'
import { useGame } from '../store/game'
import { devRequested, usePrefs } from '../store/prefs'
import { useServerConfig } from '../store/serverConfig'

// Open/closed state of the panel, shared with the wrench button that lives in the side rail.
let panelOpen = false
const panelListeners = new Set<() => void>()
function setPanelOpen(v: boolean) {
  panelOpen = v
  panelListeners.forEach((l) => l())
}
function usePanelOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      panelListeners.add(l)
      return () => panelListeners.delete(l)
    },
    () => panelOpen,
    () => panelOpen,
  )
}

/**
 * The wrench that opens the dev panel. It lives in the side rail (AppShell) so it never covers
 * page content; below 640px, where the rail is a bottom bar, it floats at the top right.
 */
export function DevToggle() {
  const { t } = useTranslation()
  usePrefs((s) => s.dev.panelOpen) // `?dev` or Settings → Developer tools
  const open = usePanelOpen()
  if (!devRequested() || open) return null
  return (
    <div className="max-sm:fixed max-sm:top-2 max-sm:right-2 max-sm:z-[55] sm:p-4 sm:pt-0">
      <IconButton icon="wrench" label={t('dev.open')} onClick={() => setPanelOpen(true)} />
    </div>
  )
}

const LABELS: (FocusLabel | 'none')[] = ['studying', 'educational', 'chat', 'social', 'game', 'none']

/**
 * Developer panel (`?dev` in the URL, or Settings → Developer tools).
 * Everything here goes through the same store actions as the real UI.
 */
export function DevPanel() {
  const { t, i18n } = useTranslation()
  const open = usePanelOpen()
  const setOpen = setPanelOpen
  const now = useNow()
  const dev = usePrefs((s) => s.dev)
  const setDev = usePrefs((s) => s.setDev)
  const setRate = usePrefs((s) => s.setRate)
  const advance = usePrefs((s) => s.advanceClock)
  const resetClock = usePrefs((s) => s.resetClock)
  const resetHints = usePrefs((s) => s.resetHints)
  const player = useGame((s) => s.player)
  const game = useGame()
  const busy = game.pending > 0
  // The server ignores x-dev-now / x-dev-seed and refuses dev* actions without DEV_TOOLS=1: lock those controls.
  const serverTools = useServerConfig((s) => s.devTools !== false)
  /** Dev actions run on the server (DEV_TOOLS=1 only): say why when it refuses. */
  const run = async (p: Promise<string | null>) => {
    const err = await p
    if (err) toast.add({ title: errorText(err), type: 'danger' })
  }
  const [seed, setSeed] = useState(dev.seed ?? '')
  const tz = player?.profile.timezone ?? 0

  if (!open) return null

  return (
    <aside aria-label={t('dev.title')} className="fixed bottom-4 left-4 z-[55] max-h-[calc(100dvh-2rem)] sm:left-24 xl:left-[16rem] w-80 overflow-y-auto bg-dusk-950 p-4 text-sm shadow-plate">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg">
          <PixelIcon name="wrench" size={20} className="text-volt-400" />
          {t('dev.title')}
        </h2>
        <IconButton icon="close" size="sm" variant="ghost" label={t('dev.close')} onClick={() => setOpen(false)} />
      </header>

      {!serverTools && (
        <p role="status" className="mb-3 border-l-4 border-amber-400 bg-dusk-900 p-3 text-mist-100">
          <strong className="block text-amber-400">{t('dev.serverOffTitle')}</strong>
          {t('dev.serverOffBody')}
        </p>
      )}

      {serverTools && (
        <>
      <Section title={t('dev.clock')}>
        <p className="mb-2 text-mist-300">
          {t('dev.gameTime', { time: fmtClock(now, tz, i18n.language) })}
          {dev.anchor && <span className="text-amber-400"> {t('dev.shifted')}</span>}
        </p>
        <Segmented
          label={t('dev.rate')}
          value={String(dev.rate)}
          onChange={(v) => setRate(Number(v))}
          options={[
            { value: '1', label: '1×' },
            { value: '60', label: t('dev.fast') },
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => advance(HOUR_MS)}>
            +1 h
          </Button>
          <Button size="sm" variant="secondary" onClick={() => advance(DAY_MS)}>
            {t('dev.plusDay')}
          </Button>
          <Button size="sm" variant="ghost" disabled={Boolean(player?.activeSession)} onClick={resetClock}>
            {t('dev.realTime')}
          </Button>
        </div>
      </Section>

      <Section title={t('dev.session')}>
        <Button size="sm" disabled={!player?.activeSession} onClick={() => void game.devFinishNow()}>
          {t('dev.finishNow')}
        </Button>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-mist-300">{t('dev.focusLabel')}</span>
          <select
            value={dev.focusLabel ?? 'none'}
            onChange={(e) => setDev({ focusLabel: e.target.value === 'none' ? null : (e.target.value as FocusLabel) })}
            className="min-h-9 bg-dusk-900 px-2 text-mist-50 shadow-frame"
          >
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {t(`dev.labels.${l}`)}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title={t('dev.weather')}>
        {/* Manual weather override: the server honors it only with DEV_TOOLS=1 (players never pick the weather). */}
        <Segmented<WeatherKind | 'real'>
          label={t('dev.weather')}
          value={player?.profile.weather ? weatherKind(player.profile.weather) : 'real'}
          onChange={(w) => {
            const weather = w === 'real' ? null : WEATHER_PRESETS[w]
            void run(
              game.setWeather(weather).then((err) => {
                if (!err && player) void refreshWeather({ ...player.profile, weather })
                return err
              }),
            )
          }}
          options={[
            { value: 'real', label: t('dev.weatherReal') },
            ...(['clear', 'sun', 'rain', 'cold'] as const).map((w) => ({ value: w, ariaLabel: t(`weather.${w}`), label: <PixelIcon name={w} size={18} /> })),
          ]}
        />
        <p className="mt-1 text-xs text-mist-400">{t('dev.weatherNote')}</p>
      </Section>

      <Section title={t('dev.inventory')}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!player || busy} onClick={() => void run(game.devAddItems({ 'poke-ball': 10, 'great-ball': 5, 'ultra-ball': 3 }))}>
            {t('dev.addBalls')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player || busy} onClick={() => void run(game.devAddDust(1000))}>
            {t('dev.addDust')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player || busy} onClick={() => void run(game.devAddCandies(10))}>
            {t('dev.addCandies')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player || busy} onClick={() => void run(game.devAddItems({ potion: 3, 'super-potion': 2, 'hyper-potion': 1, revive: 1, 'fire-stone': 1, 'water-stone': 1, 'thunder-stone': 1, 'leaf-stone': 1, 'moon-stone': 1 }))}>
            {t('dev.addItems')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player || busy} onClick={() => void run(game.devLevelUp(5))}>
            {t('dev.levelUp')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player || busy} onClick={() => void run(game.devAddRandomPokemon(10))}>
            {t('dev.addPokemon')}
          </Button>
        </div>
      </Section>

      <Section title={t('dev.trainerExp')}>
        {player && (
          <>
            <p className="mb-2 font-num text-xl leading-none">{t('dev.trainerExpNow', { level: player.trainer.level, exp: player.trainer.exp })}</p>
            <div className="flex flex-wrap gap-2">
              {[100, 1000].map((n) => (
                <Button key={n} size="sm" variant="secondary" disabled={busy} onClick={() => void run(game.devAddTrainerExp(n))}>
                  +{n}
                </Button>
              ))}
              <Button size="sm" variant="secondary" disabled={busy || player.trainer.exp <= 0} onClick={() => void run(game.devAddTrainerExp(-Math.min(100, player.trainer.exp)))}>
                −100
              </Button>
              <Button size="sm" variant="secondary" disabled={busy || player.trainer.level >= defaultContext().config.trainer.maxLevel} onClick={() => void run(game.devAddTrainerExp(Math.max(1, trainerExpForLevel(player.trainer.level + 1) - player.trainer.exp)))}>
                {t('dev.trainerLevelUp')}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy || player.trainer.level <= 1} onClick={() => void run(game.devAddTrainerExp(trainerExpForLevel(player.trainer.level - 1) - player.trainer.exp))}>
                {t('dev.trainerLevelDown')}
              </Button>
            </div>
            <p className="mt-1 text-xs text-mist-400">{t('dev.trainerExpNote')}</p>
          </>
        )}
      </Section>

      <Section title={t('dev.rng')}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setDev({ seed: seed.trim() || null, rngCounter: 0 })
            toast.add({ title: seed.trim() ? t('dev.seedSet', { seed: seed.trim() }) : t('dev.seedOff') })
          }}
        >
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder={t('dev.seedPlaceholder')}
            className="min-h-9 min-w-0 flex-1 bg-dusk-900 px-2 text-mist-50 shadow-frame"
          />
          <Button size="sm" type="submit" variant="secondary">
            {t('dev.apply')}
          </Button>
        </form>
        <p className={cx('mt-1 text-xs', dev.seed ? 'text-leaf-400' : 'text-mist-400')}>{dev.seed ? t('dev.seedOn', { seed: dev.seed, n: dev.rngCounter }) : t('dev.seedRandom')}</p>
      </Section>

        </>
      )}

      <Section title={t('dev.audio')}>
        <details className="text-mist-100">
          <summary className="cursor-pointer text-mist-300">{t('dev.audioLab')}</summary>
          <div className="mt-2 max-h-96 overflow-y-auto bg-dusk-900 p-2 text-xs">
            <Suspense fallback={null}>
              <AudioLab />
            </Suspense>
          </div>
        </details>
      </Section>

      <Section title={t('dev.help')}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            resetHints()
            toast.add({ title: t('settings.replayDone'), type: 'success' })
          }}
        >
          {t('dev.resetHints')}
        </Button>
      </Section>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t-2 border-dusk-700 py-3 first-of-type:border-t-0 first-of-type:pt-0">
      <h3 className="mb-2 text-base text-mist-300">{title}</h3>
      {children}
    </section>
  )
}
