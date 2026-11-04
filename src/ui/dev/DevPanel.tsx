import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DAY_MS, HOUR_MS, type FocusLabel } from '../../engine'
import { Button, IconButton, PixelIcon, Segmented, toast } from '../components'
import { cx } from '../lib/cx'
import { fmtClock } from '../lib/format'
import { cancelSessionEnd } from '../lib/sound'

const AudioLab = lazy(() => import('../../audio/AudioLab').then((m) => ({ default: m.AudioLab })))
import { useNow } from '../store/clock'
import { useGame } from '../store/game'
import { usePrefs } from '../store/prefs'

const LABELS: (FocusLabel | 'none')[] = ['studying', 'educational', 'chat', 'social', 'game', 'none']

/**
 * Developer panel (`?dev` in the URL, or Settings → Developer tools).
 * Everything here goes through the same store actions as the real UI.
 */
export function DevPanel() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const now = useNow()
  const dev = usePrefs((s) => s.dev)
  const setDev = usePrefs((s) => s.setDev)
  const setRate = usePrefs((s) => s.setRate)
  const advance = usePrefs((s) => s.advanceClock)
  const resetClock = usePrefs((s) => s.resetClock)
  const resetHints = usePrefs((s) => s.resetHints)
  const player = useGame((s) => s.player)
  const game = useGame()
  const [seed, setSeed] = useState(dev.seed ?? '')
  const tz = player?.profile.timezone ?? 0

  if (!open) {
    return (
      <div className="fixed bottom-4 left-4 z-[55] sm:left-24 xl:left-[16rem]">
        <IconButton icon="wrench" label={t('dev.open')} onClick={() => setOpen(true)} />
      </div>
    )
  }

  return (
    <aside aria-label={t('dev.title')} className="fixed bottom-4 left-4 z-[55] max-h-[calc(100dvh-2rem)] sm:left-24 xl:left-[16rem] w-80 overflow-y-auto bg-dusk-950 p-4 text-sm shadow-plate">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg">
          <PixelIcon name="wrench" size={20} className="text-volt-400" />
          {t('dev.title')}
        </h2>
        <IconButton icon="close" size="sm" variant="ghost" label={t('dev.close')} onClick={() => setOpen(false)} />
      </header>

      <Section title={t('dev.clock')}>
        <p className="mb-2 text-mist-300">
          {t('dev.gameTime', { time: fmtClock(now, tz, i18n.language) })}
          {dev.anchor && <span className="text-amber-400"> {t('dev.shifted')}</span>}
        </p>
        <Segmented
          label={t('dev.rate')}
          value={String(dev.rate)}
          onChange={(v) => {
            cancelSessionEnd()
            setRate(Number(v))
          }}
          options={[
            { value: '1', label: '1×' },
            { value: '60', label: t('dev.fast') },
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => {
            cancelSessionEnd()
            advance(HOUR_MS)
          }}>
            +1 h
          </Button>
          <Button size="sm" variant="secondary" onClick={() => {
            cancelSessionEnd()
            advance(DAY_MS)
          }}>
            {t('dev.plusDay')}
          </Button>
          <Button size="sm" variant="ghost" disabled={Boolean(player?.activeSession)} onClick={resetClock}>
            {t('dev.realTime')}
          </Button>
        </div>
      </Section>

      <Section title={t('dev.session')}>
        <Button size="sm" disabled={!player?.activeSession} onClick={() => {
          cancelSessionEnd()
          game.devFinishNow()
        }}>
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

      <Section title={t('dev.inventory')}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!player} onClick={() => game.devAddItems({ 'poke-ball': 10, 'great-ball': 5, 'ultra-ball': 3 })}>
            {t('dev.addBalls')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player} onClick={() => game.devAddDust(1000)}>
            {t('dev.addDust')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player} onClick={() => game.devAddCandies(10)}>
            {t('dev.addCandies')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player} onClick={() => game.devAddItems({ potion: 3, 'super-potion': 2, 'hyper-potion': 1, revive: 1, 'fire-stone': 1, 'water-stone': 1, 'thunder-stone': 1, 'leaf-stone': 1, 'moon-stone': 1 })}>
            {t('dev.addItems')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player} onClick={() => game.devLevelUp(5)}>
            {t('dev.levelUp')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!player} onClick={() => game.devAddRandomPokemon(10)}>
            {t('dev.addPokemon')}
          </Button>
        </div>
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
