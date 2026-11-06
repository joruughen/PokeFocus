import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, MINUTE_MS, waveCount } from '../../../engine'
import { Button, Dialog, DialogClose, Platform, ProgressBar, Sprite, Stage, toast } from '../../components'
import { useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtClock, fmtCountdown, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { cancelSessionEnd, scheduleSessionEnd } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { AutoDamageToggle } from './AutoDamageToggle'
import { timerOf, useGame } from '../../store/game'
import { useBusy, usePlayer, useScene } from '../../store/selectors'
import { GroupSessionStatus } from './GroupStudy'
import { MuteMusicButton } from './MuteMusicButton'
import { MicIndicator } from './SoundStyle'

const cfg = defaultContext().config

/**
 * Active focus session: one calm number. Remaining time is always
 * `endsAt - now` (persisted timestamps), so reloads and sleeping tabs are safe.
 * No hints here (the hint engine is suppressed while focusing).
 */
export function FocusSession() {
  useHintScreen('session')
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const timerState = useGame((s) => s.timer)
  const pause = useGame((s) => s.pause)
  const resume = useGame((s) => s.resume)
  const cancel = useGame((s) => s.cancel)
  const busy = useBusy()
  const [confirm, setConfirm] = useState(false)
  const session = player.activeSession!
  const timer = timerOf({ player, timer: timerState })!
  const paused = timer.pausedAt !== null
  const remaining = paused ? timer.endsAt - (timer.pausedAt ?? now) : timer.endsAt - now
  const totalMs = session.plannedMinutes * MINUTE_MS
  const studied = Math.max(0, totalMs - remaining)
  const scene = useScene(player, session.startedAt)
  const wave = cfg.session.waveMinutes * MINUTE_MS
  const ticks = Array.from({ length: Math.floor(session.plannedMinutes / cfg.session.waveMinutes) }, (_, i) => (i + 1) * wave).filter((x) => x < totalMs)

  useEffect(() => {
    const prev = document.title
    document.title = `${fmtCountdown(remaining)} ${paused ? `(${t('session.paused')})` : ''} | PokeFocus`
    return () => {
      document.title = prev
    }
  })

  return (
    <div className="flex flex-col gap-8">
      <Stage time={scene.time} weather={scene.weather} variant="focus" className="h-72">
        <div className="flex h-full items-end justify-center gap-6 px-6 pb-6">
          {session.teamUids.map((uid, i) => {
            const p = player.pokemon[uid]
            if (!p) return null
            return (
              <div key={uid} className="relative flex w-28 flex-col items-center">
                <Platform width={104} night={scene.time === 'night'} className="absolute bottom-0 brightness-75" />
                <Sprite
                  kind="showdown"
                  slug={p.speciesSlug}
                  shiny={p.isShiny}
                  scale={2}
                  flip
                  alt={names.species(p.speciesSlug)}
                  className={cx('relative mb-3', !paused && 'motion-safe:animate-bob', session.asleepUids.includes(uid) && 'opacity-60')}
                  style={{ animationDelay: `${i * 0.27}s` }}
                />
              </div>
            )
          })}
        </div>
      </Stage>

      <section aria-labelledby="timer-title" className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <h1 id="timer-title" className="text-xl text-mist-300">
          {paused ? t('session.pausedTitle') : t('session.title', { count: session.plannedMinutes })}
        </h1>
        <p
          role="timer"
          aria-live="off"
          aria-label={t('session.remaining', { time: fmtCountdown(remaining) })}
          className={cx('mt-2 font-num text-timer text-mist-50 tabular transition-opacity', paused && 'opacity-45')}
        >
          {fmtCountdown(remaining)}
        </p>
        <p className="mt-3 text-mist-300">
          {paused ? t('session.pausedNote') : t('session.endsAt', { time: fmtClock(timer.endsAt, player.profile.timezone, i18n.language) })}
        </p>

        <div className="mt-8 w-full">
          <ProgressBar value={studied} max={totalMs} ticks={ticks} label={t('session.progress')} ariaValueText={fmtPct(studied / totalMs, i18n.language)} size="lg" />
          <div className="mt-2 flex justify-between text-sm text-mist-400">
            <span>{t(ticks.length > 0 ? 'session.waveLegend' : 'session.waveOne', { count: waveCount(session.plannedMinutes, cfg) })}</span>
            <span>{t('session.teamWorking')}</span>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          {paused ? (
            <Button
              size="lg"
              icon="play"
              disabled={busy}
              onClick={async () => {
                const err = await resume()
                if (err) return void toast.add({ title: errorText(err), type: 'danger' })
                const tm = useGame.getState().timer
                if (tm) scheduleSessionEnd(tm.sessionId, tm.endsAt)
              }}
            >
              {t('session.resume')}
            </Button>
          ) : (
            <Button
              size="lg"
              variant="secondary"
              icon="pause"
              disabled={busy}
              onClick={async () => {
                const err = await pause()
                if (err) return void toast.add({ title: errorText(err), type: 'danger' })
                cancelSessionEnd()
              }}
            >
              {t('session.pause')}
            </Button>
          )}
          <Button size="lg" variant="ghost" icon="close" disabled={busy} onClick={() => setConfirm(true)}>
            {t('session.cancel')}
          </Button>
          <MuteMusicButton />
        </div>
        <p className="mt-4 max-w-[52ch] text-sm text-mist-400">{t('session.rockNote')}</p>
        <AutoDamageToggle compact className="mt-6" />
        <div className="mt-4"><MicIndicator /></div>
      </section>

      <GroupSessionStatus />

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('session.cancelTitle')}
        description={t('session.cancelBody', { minutes: Math.floor(studied / MINUTE_MS) })}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('session.keepGoing')}</Button>} />
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const err = await cancel()
                if (err) return void toast.add({ title: errorText(err), type: 'danger' })
                cancelSessionEnd()
                setConfirm(false)
              }}
            >
              {t('session.cancelConfirm')}
            </Button>
          </>
        }
      />
    </div>
  )
}
