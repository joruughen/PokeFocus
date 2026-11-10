import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cancelKeep, defaultContext, MINUTE_MS, validatedMinutes, waveCount } from '../../../engine'
import { Button, Dialog, DialogClose, ProgressBar, Stage, StageTeam, toast } from '../../components'
import { useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtClock, fmtCountdown, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { cancelSessionEnd, scheduleSessionEnd } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { AutoDamageToggle } from './AutoDamageToggle'
import { timerOf, useGame } from '../../store/game'
import { useBusy, usePlayer, useScene, useTeamViews } from '../../store/selectors'
import { GroupSessionStatus } from './GroupStudy'
import { MuteMusicButton } from './MuteMusicButton'
import { MicIndicator } from './SoundStyle'
import { SoundUnlockChip } from './SoundUnlockChip'
import { TeamEnergy } from './TeamEnergy'

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
  const teamViews = useTeamViews(player, now, session.teamUids)
  // Same rule the server applies with its own clock (GDD §5.6); shown in the confirmation.
  const keep = cancelKeep(session.plannedMinutes, validatedMinutes(session, timer.pausedAt ?? now, timer.pausedMs / 1000), cfg)
  const totalBlocks = Math.floor(session.plannedMinutes / cfg.session.waveMinutes)
  const nextBlockIn = keep.waves < totalBlocks ? (keep.waves + 1) * cfg.session.waveMinutes - keep.minutes : null
  const ticks = Array.from({ length: Math.floor(session.plannedMinutes / cfg.session.waveMinutes) }, (_, i) => (i + 1) * wave).filter((x) => x < totalMs)

  useEffect(() => {
    const prev = document.title
    // No double spaces: `document.title` reads back whitespace-collapsed, and the cleanup compares it.
    const mine = `${fmtCountdown(remaining)}${paused ? ` (${t('session.paused')})` : ''} | PokeFocus`
    document.title = mine
    return () => {
      // Keep a title someone else set meanwhile (SessionWatcher's "session over" in a hidden tab).
      if (document.title === mine) document.title = prev
    }
  })

  return (
    <div className="flex flex-col gap-8">
      <Stage time={scene.time} weather={scene.weather} variant="focus" className="h-72">
        <StageTeam
          className="h-full"
          night={scene.time === 'night'}
          bob={!paused}
          dim
          members={session.teamUids.flatMap((uid) => {
            const p = player.pokemon[uid]
            return p
              ? [{ uid, slug: p.speciesSlug, shiny: p.isShiny, name: names.pokemon(p), faded: session.asleepUids.includes(uid) }]
              : []
          })}
        />
      </Stage>

      <section aria-labelledby="timer-title" className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <h1 id="timer-title" tabIndex={-1} className="text-xl text-mist-300 outline-none">
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
        {/* Shown only while sound is on but the browser keeps it suspended (e.g. after a reload). */}
        <SoundUnlockChip focusAfterId="timer-title" className="mt-4" />

        <div className="mt-8 w-full">
          <ProgressBar value={studied} max={totalMs} ticks={ticks} label={t('session.progress')} ariaValueText={fmtPct(studied / totalMs, i18n.language)} size="lg" />
          <div className="mt-2 flex justify-between text-sm text-mist-400">
            <span>{t(ticks.length > 0 ? 'session.waveLegend' : 'session.waveOne', { count: waveCount(session.plannedMinutes, cfg) })}</span>
            <span>{t('session.teamWorking')}</span>
          </div>
        </div>

        <div className="mt-8 w-full text-left">
          <TeamEnergy views={teamViews} leaderUid={session.teamUids[0]} title={t('teamEnergy.title')} />
          <p className="mt-2 text-xs text-mist-400">{t('teamEnergy.sessionNote')}</p>
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
        description={
          keep.reason === 'short_session'
            ? t('session.cancelBody', { minutes: keep.minutes })
            : keep.reason === 'too_few_minutes'
              ? t('session.cancelTooFew', { minutes: keep.minutes, planned: session.plannedMinutes, min: cfg.session.minMinutes })
              : t('session.cancelKeepIntro', { minutes: keep.minutes, planned: session.plannedMinutes })
        }
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('session.keepGoing')}</Button>} />
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const r = await cancel()
                if (!r.ok) return void toast.add({ title: errorText(r.error), type: 'danger' })
                cancelSessionEnd()
                setConfirm(false)
                const res = r.outcome?.result
                toast.add({
                  title: res ? t('session.cancelledKept', { minutes: res.minutes, count: res.waves.length }) : t('session.cancelledNothing'),
                  type: res ? 'success' : 'info',
                })
              }}
            >
              {keep.keeps ? t('session.cancelConfirmKeep') : t('session.cancelConfirm')}
            </Button>
          </>
        }
      >
        {keep.keeps && (
          <div className="flex flex-col gap-2 text-sm">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>{t('session.cancelKeepMinutes', { minutes: keep.minutes })}</li>
              <li>
                {keep.waves > 0
                  ? t('session.cancelKeepWaves', { count: keep.waves, total: totalBlocks })
                  : t('session.cancelKeepNoWaves', { left: nextBlockIn ?? 0 })}
              </li>
            </ul>
            {keep.waves > 0 && nextBlockIn !== null && <p className="text-mist-400">{t('session.cancelNextWave', { left: nextBlockIn })}</p>}
            <p className="text-mist-400">{t('session.cancelKeepNote')}</p>
          </div>
        )}
      </Dialog>
    </div>
  )
}
