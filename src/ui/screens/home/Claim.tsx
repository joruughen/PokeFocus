import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, MINUTE_MS } from '../../../engine'
import { Button, ProgressBar, Stage, StageTeam, toast } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { errorText } from '../../lib/errors'
import { fmtCountdown, fmtPct } from '../../lib/format'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { AutoDamageToggle } from './AutoDamageToggle'
import { timerOf, useGame } from '../../store/game'
import { usePlayer, useScene } from '../../store/selectors'

const cfg = defaultContext().config

/** Timer done: claim within the window for full rewards (GDD §3.2). */
export function Claim({ late }: { late: boolean }) {
  useHintScreen('claim')
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const player = usePlayer()
  const timerState = useGame((s) => s.timer)
  const claim = useGame((s) => s.claim)
  const [busy, setBusy] = useState(false)
  const session = player.activeSession!
  const timer = timerOf({ player, timer: timerState })!
  const windowMs = cfg.session.claimWindowMinutes * MINUTE_MS
  const left = timer.endsAt + windowMs - now
  const scene = useScene(player, now)

  const onClaim = async () => {
    if (busy) return
    setBusy(true)
    // Idempotent: the server claims an active session once; a second claim is refused.
    if (!(await claim())) {
      const code = useGame.getState().error
      toast.add({ title: code && code !== 'not_finished' && code !== 'no_session' ? errorText(code) : t('errors.claimFailed'), type: 'danger' })
      setBusy(false)
      return
    }
    sfx('claim')
  }

  return (
    <div className="flex flex-col gap-8">
      <Stage time={scene.time} weather={scene.weather}>
        <StageTeam
          className="min-h-64"
          night={scene.time === 'night'}
          members={session.teamUids.flatMap((uid) => {
            const p = player.pokemon[uid]
            return p ? [{ uid, slug: p.speciesSlug, shiny: p.isShiny, name: names.species(p.speciesSlug) }] : []
          })}
        />
      </Stage>

      <section className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 text-center">
        <h1 className="text-4xl">{t('claim.title')}</h1>
        <p className="text-lg text-mist-300">{t('claim.subtitle', { count: session.plannedMinutes })}</p>

        {!late ? (
          <div className="w-full max-w-md">
            <ProgressBar value={Math.max(0, left)} max={windowMs} label={t('claim.windowLabel')} valueText={fmtCountdown(left)} />
            <p className="mt-2 text-sm text-mist-300">{t('claim.window', { minutes: cfg.session.claimWindowMinutes })}</p>
          </div>
        ) : (
          <p className="max-w-[52ch] bg-dusk-900 p-3 text-amber-400 inset-shadow-well">
            {t('claim.late', { pct: fmtPct(cfg.session.lateClaimMultiplier, i18n.language), minutes: cfg.session.claimWindowMinutes })}
          </p>
        )}

        <Button {...hintAnchor('claim.button')} size="lg" icon="star" onClick={() => void onClaim()} disabled={busy} aria-busy={busy} beacon={!late} data-sfx="none">
          {t('claim.button')}
        </Button>
        <AutoDamageToggle disabled={busy} />
      </section>
    </div>
  )
}
