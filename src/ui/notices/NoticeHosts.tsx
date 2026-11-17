import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingGift } from '../../engine'
import type { ContentNoteNotice } from '../../game/protocol'
import { whatsNewDue } from '../changelog/WhatsNewDialog'
import { Button, Dialog, Mascot, toast } from '../components'
import { setHintsHeld, useHints } from '../hints'
import { errorText } from '../lib/errors'
import { asLocale } from '../lib/names'
import { sfx } from '../lib/sound'
import { owedLevelUps } from '../levelUp/owed'
import { RewardList } from '../levelUp/LevelUpDialog'
import { phaseOf, useGame } from '../store/game'
import { useAnnouncements } from '../store/announcements'
import { usePhase } from '../store/selectors'
import { contentNoteOwed, decideNotice, noteText } from './notices'

/** Pauses after something changes (the gift goes before the note, both after the level-up window). */
const GIFT_SETTLE_MS = 1700
const NOTE_SETTLE_MS = 2400
const RETRY_MS = 1000

const anotherDialogOpen = (): boolean => typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

function currentPhase(): string {
  const { player, timer, outcome, breakTimer } = useGame.getState()
  return phaseOf({ player, timer, outcome, breakTimer }, Date.now())
}

/** Gifts closed on this device while `ackGifts` is in flight (so the window does not reopen on the old state). */
const dismissedGifts = new Set<number>()
export function resetGiftDismissedForTests(): void {
  dismissedGifts.clear()
}
const owedGifts = (): PendingGift[] => (useGame.getState().player?.pendingGifts ?? []).filter((g) => !dismissedGifts.has(g.at))

/**
 * Opens `show` at a calm moment when `owed()` says so (re-checked on every retry), after `settleMs`. Returns the
 * value to show, or null. `deps` re-arm the settle delay.
 */
function useCalmWindow<T>(owed: () => T | null, settleMs: number, extra: () => { giftPending?: boolean }, deps: readonly unknown[]): [T | null, (v: T | null) => void] {
  const [shown, setShown] = useState<T | null>(null)
  const idle = shown === null
  useEffect(() => {
    if (!idle || owed() === null) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      const value = owed()
      const d = decideNotice({
        owed: value !== null,
        phase: currentPhase(),
        hintOpen: useHints.getState().active !== null,
        otherDialogOpen: anotherDialogOpen(),
        whatsNewPending: whatsNewDue(),
        levelUpPending: owedLevelUps().length > 0,
        ...extra(),
      })
      if (d === 'show') setShown(value)
      else if (d === 'wait') timer = setTimeout(attempt, RETRY_MS)
    }
    timer = setTimeout(attempt, settleMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` re-arm it
  }, [idle, ...deps])
  // No automatic hint over the window.
  useEffect(() => {
    if (idle) return
    setHintsHeld(true)
    return () => setHintsHeld(false)
  }, [idle])
  return [shown, setShown]
}

/**
 * The support-gift window: opens by itself when an admin gave the player something with a message
 * (`PlayerState.pendingGifts`); closing it sends `ackGifts`. Mount once in the app shell.
 */
export function GiftHost() {
  const phase = usePhase()
  const hintOpen = useHints((s) => s.active !== null)
  const pending = useGame((s) => s.player?.pendingGifts)
  const ack = useGame((s) => s.ackGifts)
  const [shown, setShown] = useCalmWindow<PendingGift[]>(() => (owedGifts().length > 0 ? owedGifts() : null), GIFT_SETTLE_MS, () => ({}), [pending, phase, hintOpen])
  if (!shown) return null
  const close = () => {
    for (const g of shown) dismissedGifts.add(g.at)
    setShown(null)
    void ack().then((err) => {
      if (err) toast.add({ title: errorText(err), type: 'danger' })
    })
  }
  return <GiftModal gifts={shown} onClose={close} />
}

export function GiftModal({ gifts, onClose }: { gifts: readonly PendingGift[]; onClose: () => void }) {
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
      title={t('gift.title')}
      footer={
        <Button icon="star" onClick={onClose}>
          {t('gift.gotIt')}
        </Button>
      }
    >
      <GiftBody gifts={gifts} />
    </Dialog>
  )
}

/** Mascot, the admin's message (plain text) and what came with it, one block per gift. */
export function GiftBody({ gifts }: { gifts: readonly PendingGift[] }) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  return (
    <div className="flex flex-col items-center gap-4" aria-label={t('gift.label')}>
      <Mascot pose="cheer" size={96} />
      {gifts.map((g) => (
        <section key={g.at} className="flex w-full flex-col gap-2">
          {/* Plain text on purpose (never RichText/HTML): the message comes from an admin's free text. */}
          <p className="bg-dusk-900 p-3 text-center whitespace-pre-line break-words text-mist-50 inset-shadow-well">{noteText(g.message, lng)}</p>
          <RewardList dust={g.dust} items={Object.entries(g.items).filter(([, n]) => n > 0)} />
        </section>
      ))}
      <p className="text-sm text-mist-300">{t('gift.added')}</p>
    </div>
  )
}

/**
 * The «what changed» window of a content update: opens once per device when the version that carries an admin
 * note takes effect (`GET /api/announcements`), at a calm moment. Mount once in the app shell.
 */
export function ContentNoteHost() {
  const phase = usePhase()
  const hintOpen = useHints((s) => s.active !== null)
  const notice = useAnnouncements((s) => s.contentNote)
  const seen = useAnnouncements((s) => s.noteSeen)
  const markSeen = useAnnouncements((s) => s.markNoteSeen)
  const [shown, setShown] = useCalmWindow<ContentNoteNotice>(
    () => {
      const s = useAnnouncements.getState()
      return contentNoteOwed(s.contentNote, s.noteSeen)
    },
    NOTE_SETTLE_MS,
    () => ({ giftPending: owedGifts().length > 0 }),
    [notice, seen, phase, hintOpen],
  )
  if (!shown) return null
  const close = () => {
    markSeen(shown.versionId)
    setShown(null)
  }
  return <ContentNoteModal notice={shown} onClose={close} />
}

export function ContentNoteModal({ notice, onClose }: { notice: ContentNoteNotice; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      size="md"
      title={t('contentNote.title')}
      footer={
        <Button icon="check" onClick={onClose}>
          {t('contentNote.gotIt')}
        </Button>
      }
    >
      <ContentNoteBody notice={notice} />
    </Dialog>
  )
}

/** Mascot and the admin's note (plain text, never HTML). */
export function ContentNoteBody({ notice }: { notice: ContentNoteNotice }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-4" aria-label={t('contentNote.label')}>
      <Mascot pose="idle" size={96} />
      <p className="w-full bg-dusk-900 p-3 whitespace-pre-line break-words text-mist-50 inset-shadow-well">{noteText(notice.note, asLocale(i18n.language))}</p>
    </div>
  )
}
