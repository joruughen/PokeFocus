import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale } from '../../i18n'
import { Button, Dialog } from '../components'
import { setHintsHeld, useHints } from '../hints'
import { cx } from '../lib/cx'
import { navigate, useRoute } from '../router'
import { useGame } from '../store/game'
import { usePrefs } from '../store/prefs'
import { CHANGELOG, type ChangelogEntry } from './entries'
import { fmtEntryDate, KIND_STYLE } from './entryView'
import { APP_VERSION } from './release'
import { decideWhatsNew, unseenEntries } from './whatsNew'

/** Pause after the app is ready before opening the dialog, so the screen settles first. */
const SETTLE_MS = 1200
/** How often to ask again while something else (a session, a hint, another dialog) is in the way. */
const RETRY_MS = 1000

function anotherDialogOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

/** "What's new?" is due now or waiting for a calm moment: other windows (level-up, events) let it go first. */
export function whatsNewDue(): boolean {
  const d = decideWhatsNew({ lastSeen: usePrefs.getState().lastSeenVersion, current: APP_VERSION, studying: false, hintOpen: false, otherDialogOpen: false, onChangelog: false })
  return d === 'show' || d === 'wait'
}

/**
 * "What's new?" after an update: opens once per version, only at a calm moment
 * (see `decideWhatsNew`). Mount once inside the app shell (needs a player).
 * Closing it, or going to the news page, records the version as seen.
 */
export function WhatsNewDialog() {
  const lastSeen = usePrefs((s) => s.lastSeenVersion)
  const setLastSeen = usePrefs((s) => s.setLastSeenVersion)
  const studying = useGame((s) => Boolean(s.player?.activeSession))
  const hintOpen = useHints((s) => s.active !== null)
  const onChangelog = useRoute() === 'changelog'
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<ChangelogEntry[]>([])

  const decision = decideWhatsNew({ lastSeen, current: APP_VERSION, studying, hintOpen, otherDialogOpen: false, onChangelog })

  useEffect(() => {
    if (open) return
    if (decision === 'record') {
      setLastSeen(APP_VERSION)
      return
    }
    if (decision === 'none') return
    // News to show: after a short settle, and again every second while something is in the way.
    // The timer reads the live state (another dialog may have opened in the meantime).
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      const live = usePrefs.getState().lastSeenVersion
      const now = decideWhatsNew({
        lastSeen: live,
        current: APP_VERSION,
        studying: Boolean(useGame.getState().player?.activeSession),
        hintOpen: useHints.getState().active !== null,
        otherDialogOpen: anotherDialogOpen(),
        onChangelog: location.hash.startsWith('#/changelog'),
      })
      if (now === 'show') {
        setEntries(unseenEntries(CHANGELOG, live))
        setOpen(true)
      } else if (now === 'wait') timer = setTimeout(attempt, RETRY_MS)
    }
    timer = setTimeout(attempt, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [decision, open, setLastSeen])

  // No automatic hint over the dialog.
  useEffect(() => {
    if (!open) return
    setHintsHeld(true)
    return () => setHintsHeld(false)
  }, [open])

  const close = () => {
    setOpen(false)
    setLastSeen(APP_VERSION)
  }

  if (!open || entries.length === 0) return null
  return <WhatsNewModal entries={entries} onClose={close} onSeeAll={() => (close(), navigate('changelog'))} />
}

/** The dialog itself (controlled, open). Exported for tests. */
export function WhatsNewModal({ entries, onClose, onSeeAll }: { entries: ChangelogEntry[]; onClose: () => void; onSeeAll: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      size="md"
      title={t('whatsNew.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('whatsNew.gotIt')}
          </Button>
          <Button icon="star" onClick={onSeeAll}>
            {t('whatsNew.seeAll')}
          </Button>
        </>
      }
    >
      <WhatsNewBody entries={entries} />
    </Dialog>
  )
}

/** Latest unseen entry in full, and a note about the older unseen versions. */
export function WhatsNewBody({ entries }: { entries: ChangelogEntry[] }) {
  const { t, i18n } = useTranslation()
  const lng = (i18n.language === 'es' ? 'es' : 'en') as Locale
  const latest = entries[0]
  if (!latest) return null
  const more = entries.length - 1
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-3 text-mist-300">
          <span className="font-display text-lg text-volt-300">{t('changelog.versionLabel', { version: latest.version })}</span>
          <time dateTime={latest.date} className="font-num text-lg">
            {fmtEntryDate(latest.date, lng)}
          </time>
        </p>
        <h3 className="font-display text-xl text-mist-50">{latest.title[lng]}</h3>
      </header>
      <ul className="flex flex-col gap-3">
        {latest.items.map((item, i) => (
          <li key={i} className="flex flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
            <span className={cx('shrink-0 px-1.5 pt-0.5 text-center font-display text-sm leading-tight uppercase sm:mt-0.5 sm:w-24', KIND_STYLE[item.kind])}>
              {t(`changelog.kind.${item.kind}`)}
            </span>
            <span className="min-w-0 flex-1 text-mist-100">{item.text[lng]}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="text-sm text-mist-300">{t('whatsNew.more', { count: more })}</p>}
    </div>
  )
}
