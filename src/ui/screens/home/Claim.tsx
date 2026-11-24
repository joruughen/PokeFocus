import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MINUTE_MS, pendingCopyUids } from '../../../engine'
import { Button, ProgressBar, Stage, StageTeam, toast } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { claimErrorText } from '../../lib/errors'
import { fmtCountdown, fmtPct } from '../../lib/format'
import { lookOfMon } from '../../lib/look'
import { useNames } from '../../lib/names'
import { sfx } from '../../lib/sound'
import { useNow } from '../../store/clock'
import { AutoDamageToggle } from './AutoDamageToggle'
import { timerOf, useGame } from '../../store/game'
import { usePrefs } from '../../store/prefs'
import { usePlayer, useScene } from '../../store/selectors'
import { useContent } from '../../store/content'
import { CopyQuestion } from './CopyQuestion'
import { useMyTrainer } from '../../lib/useMyTrainer'

/** Timer done: claim within the window for full rewards (GDD §3.2). */
export function Claim({ late }: { late: boolean }) {
  const ctx = useContent()
  const cfg = ctx.config
  useHintScreen('claim')
  const { t, i18n } = useTranslation()
  const names = useNames()
  const trainer = useMyTrainer()
  const now = useNow()
  const player = usePlayer()
  const timerState = useGame((s) => s.timer)
  const claim = useGame((s) => s.claim)
  const [busy, setBusy] = useState(false)
  // Ditto not copying anyone yet: asked once, before the results (GDD §7.3).
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState(false)
  const [askUids, setAskUids] = useState<readonly string[]>([])
  const session = player.activeSession!
  const timer = timerOf({ player, timer: timerState })!
  const windowMs = cfg.session.claimWindowMinutes * MINUTE_MS
  const left = timer.endsAt + windowMs - now
  const scene = useScene(player, now)

  const pending = useMemo(() => pendingCopyUids(player, ctx), [player, ctx])

  const onClaim = async () => {
    if (busy) return
    if (pending.length > 0 && !asked) {
      setAskUids(pending) // fixed: answering shrinks `pending` while the question runs
      setAsking(true)
      return
    }
    await onClaimNow()
  }

  const onClaimNow = async () => {
    if (busy) return
    setBusy(true)
    // Idempotent: the server claims an active session once; a second claim is refused.
    if (!(await claim())) {
      const code = useGame.getState().error
      toast.add({ title: claimErrorText(code, usePrefs.getState().dev.anchor !== null), type: 'danger' })
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
          trainer={trainer}
          night={scene.time === 'night'}
          members={session.teamUids.flatMap((uid) => {
            const p = player.pokemon[uid]
            if (!p) return []
            const look = lookOfMon(player, p, session.teamUids)
            return [{ uid, slug: look.slug, shiny: look.shiny, name: names.pokemonFull(p) }]
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
      {asking && (
        <CopyQuestion
          uids={askUids}
          teamUids={session.teamUids}
          onDone={() => {
            setAsking(false)
            setAsked(true)
            void onClaimNow()
          }}
        />
      )}
    </div>
  )
}
