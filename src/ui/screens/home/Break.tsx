import { useTranslation } from 'react-i18next'
import { MINUTE_MS } from '../../../engine'
import { Button, Panel, ProgressBar, Segmented, Sprite, Stage, StageTeam, toast } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtCountdown, fmtPct } from '../../lib/format'
import { lookOf } from '../../lib/look'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useBusy, usePlayer, useScene, useTeamViews } from '../../store/selectors'
import { useState } from 'react'
import { MuteMusicButton } from './MuteMusicButton'
import { SoundUnlockChip } from './SoundUnlockChip'
import { useContent } from '../../store/content'
import { useMyTrainer } from '../../lib/useMyTrainer'

export const BREAK_OPTIONS = ['5', '10', '15'] as const
/** How long after a claim the break is still offered (minutes of game time). */
export const BREAK_OFFER_MINUTES = 60

/** Is a pomodoro break on offer right now? One per session, soon after it. */
export function useBreakOffer(): boolean {
  const player = usePlayer()
  const now = useNow()
  const lastBreakFor = useGame((s) => s.lastBreakFor)
  const last = player.history[player.history.length - 1]
  return Boolean(last && last.minutes > 0 && !player.activeSession && !player.encounter && lastBreakFor !== last.id && now - last.claimedAt < BREAK_OFFER_MINUTES * MINUTE_MS)
}

/** Toast the error of a game action, if any. */
async function report(p: Promise<string | null>) {
  const err = await p
  if (err) toast.add({ title: errorText(err), type: 'danger' })
}

/** Offer on Home after a session: rest for real and the team recovers Energy (GDD §5.3). */
export function BreakOffer() {
  const cfg = useContent().config
  const { t, i18n } = useTranslation()
  const player = usePlayer()
  const startBreak = useGame((s) => s.startBreak)
  const skipBreak = useGame((s) => s.skipBreak)
  const busy = useBusy()
  const last = player.history[player.history.length - 1]
  const suggested = last && last.minutes >= 75 ? '15' : last && last.minutes >= 50 ? '10' : '5'
  const [choice, setChoice] = useState<string>(suggested)
  return (
    <Panel title={t('break.offerTitle')} help="home.break" {...hintAnchor('home.break')} className="outline-2 -outline-offset-2 outline-exp-400/60">
      <p className="text-sm text-mist-300">{t('break.offerBody', { pct: fmtPct(cfg.energy.breakRecoverPct, i18n.language) })}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented
          label={t('break.length')}
          value={choice}
          onChange={setChoice}
          options={BREAK_OPTIONS.map((m) => ({ value: m, label: <span className="font-num text-2xl leading-none">{m}</span>, ariaLabel: t('common.minutes', { count: Number(m) }) }))}
        />
        <span className="text-sm text-mist-400">{t('common.min')}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button icon="coffee" disabled={busy} onClick={() => void report(startBreak(Number(choice)))}>
          {t('break.start')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void report(skipBreak())}>
          {t('break.skip')}
        </Button>
      </div>
    </Panel>
  )
}

/** The break itself: a calm countdown; finishing it heals the team. */
export function Break() {
  const cfg = useContent().config
  useHintScreen('break')
  const { t, i18n } = useTranslation()
  const names = useNames()
  const trainer = useMyTrainer()
  const now = useNow()
  const player = usePlayer()
  const b = useGame((s) => s.breakTimer)!
  const endBreak = useGame((s) => s.endBreak)
  const busy = useBusy()
  const views = useTeamViews(player, now)
  const scene = useScene(player, now)
  const left = b.endsAt - now
  const done = left <= 0
  const total = b.minutes * MINUTE_MS
  const pct = cfg.energy.breakRecoverPct

  const finish = async () => {
    if (busy) return
    const rewarded = await endBreak()
    const err = useGame.getState().error
    if (!rewarded && err) {
      toast.add({ title: errorText(err), type: 'danger' })
      return
    }
    if (rewarded) {
      sfx('heal')
      toast.add({ title: t('break.healed', { pct: fmtPct(pct, i18n.language) }), type: 'success' })
    } else toast.add({ title: t('break.ended'), type: 'info' })
  }

  return (
    <div className="flex flex-col gap-8">
      <Stage time={scene.time} weather={scene.weather} variant="focus">
        <StageTeam
          className="min-h-64"
          trainer={trainer}
          night={scene.time === 'night'}
          bob={false}
          dim
          members={views.map((v) => ({ uid: v.pokemon.uid, slug: lookOf(v).slug, shiny: lookOf(v).shiny, name: names.pokemonFull(v.pokemon) }))}
        />
      </Stage>

      <section className="mx-auto flex w-full max-w-3xl flex-col items-center text-center" {...hintAnchor('break.timer')}>
        <h1 id="break-title" tabIndex={-1} className="text-xl text-mist-300 outline-none">
          {done ? t('break.doneTitle') : t('break.title', { count: b.minutes })}
        </h1>
        <p role="timer" aria-live="off" className={cx('mt-2 font-num text-timer tabular', done ? 'text-leaf-400' : 'text-mist-50')}>
          {fmtCountdown(Math.max(0, left))}
        </p>
        <p className="mt-3 max-w-[52ch] text-mist-300">{done ? t('break.doneBody') : t('break.body')}</p>
        <SoundUnlockChip focusAfterId="break-title" className="mt-4" />
        <ProgressBar className="mt-8 w-full" size="lg" variant="volt" value={Math.min(total, total - left)} max={total} label={t('break.progress')} />

        <ul className="mt-8 grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">
          {views.map((v) => {
            const after = Math.min(v.maxEnergy, v.energy + v.maxEnergy * pct)
            const look = lookOf(v)
            return (
              <li key={v.pokemon.uid} className="flex items-center gap-3 bg-dusk-800 p-3 shadow-frame">
                <Sprite kind="icon" slug={look.slug} shiny={look.shiny} alt="" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-base">{names.pokemon(v.pokemon)}</span>
                  <ProgressBar size="sm" variant="energy" value={after} from={v.energy} max={v.maxEnergy} label={t('pokemon.energyOf', { name: names.pokemon(v.pokemon) })} />
                </span>
                <span className="font-num text-lg leading-none text-leaf-400 tabular">+{Math.round(after - v.energy)}</span>
              </li>
            )
          })}
        </ul>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          {done ? (
            <Button size="lg" icon="potion" onClick={() => void finish()} disabled={busy} beacon data-sfx="none">
              {t('break.collect', { pct: fmtPct(pct, i18n.language) })}
            </Button>
          ) : (
            <Button size="lg" variant="ghost" icon="close" onClick={() => void finish()} disabled={busy}>
              {t('break.early')}
            </Button>
          )}
          <MuteMusicButton phase="break" />
        </div>
        {!done && <p className="mt-3 max-w-[52ch] text-sm text-mist-400">{t('break.earlyNote')}</p>}
      </section>
    </div>
  )
}
