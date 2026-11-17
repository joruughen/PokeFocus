import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingLevelUp } from '../../engine'
import { whatsNewDue } from '../changelog/WhatsNewDialog'
import { Button, Dialog, Mascot, PixelIcon, Sprite, toast } from '../components'
import { setHintsHeld, useHints } from '../hints'
import { errorText } from '../lib/errors'
import { fmtInt } from '../lib/format'
import { useNames } from '../lib/names'
import { sfx } from '../lib/sound'
import { phaseOf, useGame } from '../store/game'
import { usePhase } from '../store/selectors'
import { decideLevelUp, mergeLevelUps } from './levelUp'
import { markLevelUpsDismissed, owedLevelUps } from './owed'

/** Pause after something changes before opening, so the screen settles first (before the event window's). */
const SETTLE_MS = 1500
/** How often to ask again while the player is busy (a session, a hint, another dialog). */
const RETRY_MS = 1000

const anotherDialogOpen = (): boolean => typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

/** Phase of the home loop from the live store (the retry timer cannot use a hook). */
function currentPhase(): string {
  const { player, timer, outcome, breakTimer } = useGame.getState()
  return phaseOf({ player, timer, outcome, breakTimer }, Date.now())
}

/**
 * The trainer level-up window. Opens by itself when the player has climbed (`PlayerState.pendingLevelUps`), at a
 * calm moment only (`decideLevelUp`): never in a session, waves or a break, over a hint, another dialog or
 * "What's new?". Several level-ups owed make one window. Closing it sends `ackLevelUp`. Mount once in the app shell.
 */
export function LevelUpHost() {
  const phase = usePhase()
  const hintOpen = useHints((s) => s.active !== null)
  const pendingList = useGame((s) => s.player?.pendingLevelUps)
  const ack = useGame((s) => s.ackLevelUp)
  const [shown, setShown] = useState<PendingLevelUp[] | null>(null)

  // Something is owed at all (the decision itself reads the live state).
  const owed = (pendingList?.length ?? 0) > 0
  const idle = shown === null

  useEffect(() => {
    if (!idle || !owed) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      const pending = owedLevelUps()
      const d = decideLevelUp({ pending, phase: currentPhase(), hintOpen: useHints.getState().active !== null, otherDialogOpen: anotherDialogOpen(), whatsNewPending: whatsNewDue() })
      if (d === 'show') setShown(pending)
      else if (d === 'wait') timer = setTimeout(attempt, RETRY_MS)
    }
    timer = setTimeout(attempt, SETTLE_MS)
    return () => clearTimeout(timer)
    // `phase`, `hintOpen`: a change re-arms the settle delay, so it never pops up the instant a session ends.
  }, [idle, owed, pendingList, phase, hintOpen])

  // No automatic hint over the window.
  useEffect(() => {
    if (idle) return
    setHintsHeld(true)
    return () => setHintsHeld(false)
  }, [idle])

  if (!shown) return null
  const close = () => {
    markLevelUpsDismissed(shown)
    setShown(null)
    void ack().then((err) => {
      if (err) toast.add({ title: errorText(err), type: 'danger' })
    })
  }
  return <LevelUpModal pending={shown} onClose={close} />
}

/** The window itself (controlled, open). Exported for tests. */
export function LevelUpModal({ pending, onClose }: { pending: readonly PendingLevelUp[]; onClose: () => void }) {
  const { t } = useTranslation()
  useEffect(() => {
    sfx('levelUp')
  }, [])
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      size="md"
      title={t('levelUp.title')}
      footer={
        <Button icon="star" onClick={onClose}>
          {t('levelUp.gotIt')}
        </Button>
      }
    >
      <LevelUpBody pending={pending} />
    </Dialog>
  )
}

/** Mascot, the level(s) reached and what the climb gave: items with sprite and name, and Dust. */
export function LevelUpBody({ pending }: { pending: readonly PendingLevelUp[] }) {
  const { t } = useTranslation()
  const merged = mergeLevelUps(pending)
  if (!merged) return null
  const items = Object.entries(merged.items).filter(([, n]) => n > 0)
  const several = merged.to > merged.from + 1
  return (
    <div className="flex flex-col items-center gap-4" aria-label={t('levelUp.label')}>
      <Mascot pose="cheer" size={96} />
      <p className="text-center font-display text-xl text-volt-300">{several ? t('levelUp.fromTo', { from: merged.from, to: merged.to }) : t('levelUp.reached', { level: merged.to })}</p>
      <section aria-label={t('levelUp.rewards')} className="flex w-full flex-col gap-2">
        <h3 className="font-display text-base text-mist-300">{t('levelUp.rewards')}</h3>
        <RewardList dust={merged.dust} items={items} />
        <p className="text-sm text-mist-300">{t('levelUp.added')}</p>
      </section>
    </div>
  )
}

/** The Dust and items of a reward as a list with sprites (shared with the support-gift window). */
export function RewardList({ dust, items }: { dust: number; items: readonly (readonly [string, number])[] }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  return (
    <ul className="flex flex-col gap-1.5 bg-dusk-900 p-3 inset-shadow-well">
      {dust > 0 && (
        <li className="flex items-center gap-2">
          <span className="grid h-8 w-10 place-items-center">
            <PixelIcon name="dust" size={20} className="text-exp-400" />
          </span>
          <span className="min-w-0 flex-1 text-sm">{t('items.dust')}</span>
          <span className="font-num text-xl leading-none tabular">+{fmtInt(dust, i18n.language)}</span>
        </li>
      )}
      {items.map(([slug, n]) => (
        <li key={slug} className="flex items-center gap-2">
          <span className="grid h-8 w-10 place-items-center">
            <Sprite kind="item" slug={slug} fit={30} alt="" />
          </span>
          <span className="min-w-0 flex-1 text-sm">{names.item(slug)}</span>
          <span className="font-num text-xl leading-none tabular">×{n}</span>
        </li>
      ))}
    </ul>
  )
}
