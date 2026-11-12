import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TimeZoneSpec } from '../../../engine'
import type { LiveEventPublic } from '../../../game/protocol'
import { decideWhatsNew } from '../../changelog/whatsNew'
import { APP_VERSION } from '../../changelog/release'
import { Button, Dialog, RichText, Sprite } from '../../components'
import { setHintsHeld, useHints } from '../../hints'
import { asLocale, speciesName } from '../../lib/names'
import { navigate, useRoute } from '../../router'
import { phaseOf, useGame } from '../../store/game'
import { useLiveEvents } from '../../store/liveEvents'
import { usePrefs } from '../../store/prefs'
import { usePhase } from '../../store/selectors'
import { eventText, fmtMult, formatEventWhen, imageSrcSet } from './model'
import { decideEventPopup, pendingPopups, popupCandidates, type PopupCandidate, type PopupPhase } from './popup'

/** Pause after something changes before opening, so the screen settles first (a bit after "What's new?"). */
const SETTLE_MS = 2000
/** How often to ask again while the player is busy (a session, a hint, another dialog). */
const RETRY_MS = 1000

const anotherDialogOpen = (): boolean => typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

/** "What's new?" has priority: it is due now or waiting for a calm moment. */
function whatsNewDue(): boolean {
  const d = decideWhatsNew({ lastSeen: usePrefs.getState().lastSeenVersion, current: APP_VERSION, studying: false, hintOpen: false, otherDialogOpen: false, onChangelog: false })
  return d === 'show' || d === 'wait'
}

/**
 * The live event window. Opens by itself for a running event the device has not shown yet, and again for every
 * "Notify players" (also «Coming soon» for a scheduled event), at a calm moment only (`decideEventPopup`): never
 * in a study session, over a hint, another dialog or "What's new?". One at a time. Mount once in the app shell.
 */
export function EventPopupHost() {
  const route = useRoute()
  const phase = usePhase()
  const hintOpen = useHints((s) => s.active !== null)
  const active = useLiveEvents((s) => s.active)
  const upcoming = useLiveEvents((s) => s.upcoming)
  const seen = useLiveEvents((s) => s.popupSeen)
  const markSeen = useLiveEvents((s) => s.markPopupSeen)
  const tz = useGame((s) => s.player?.profile.timezone)
  const [shown, setShown] = useState<PopupCandidate | null>(null)

  // Something is owed at all (cheap check on every render; the decision itself reads the live state).
  const owed = pendingPopups(active, upcoming, seen, Date.now() + useLiveEvents.getState().skew).length > 0
  const idle = shown === null

  useEffect(() => {
    if (!idle || !owed) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      const s = useLiveEvents.getState()
      const now = Date.now() + s.skew
      const d = decideEventPopup({
        pending: pendingPopups(s.active, s.upcoming, s.popupSeen, now),
        phase: currentPhase(),
        hintOpen: useHints.getState().active !== null,
        otherDialogOpen: anotherDialogOpen(),
        whatsNewPending: whatsNewDue(),
        onEvents: location.hash.startsWith('#/events'),
      })
      if (d.kind === 'show') setShown(d.candidate)
      else if (d.kind === 'record') s.markPopupSeen(d.keys)
      else if (d.kind === 'wait') timer = setTimeout(attempt, RETRY_MS)
    }
    timer = setTimeout(attempt, SETTLE_MS)
    return () => clearTimeout(timer)
    // `phase`, `route`, `hintOpen`: a change re-arms the settle delay, so it never pops up the instant a session ends.
  }, [idle, owed, seen, active, upcoming, phase, route, hintOpen])

  // No automatic hint over the window.
  useEffect(() => {
    if (idle) return
    setHintsHeld(true)
    return () => setHintsHeld(false)
  }, [idle])

  if (!shown) return null
  const close = () => {
    // Every pop-up of this event that is owed right now is done with (a notice that arrived while it was open too).
    const s = useLiveEvents.getState()
    const same = popupCandidates(s.active, s.upcoming, Date.now() + s.skew).filter((c) => c.event.id === shown.event.id)
    markSeen([shown.key, ...same.map((c) => c.key)])
    setShown(null)
  }
  return <EventPopupModal candidate={shown} tz={tz} onClose={close} onView={() => (close(), navigate('events'))} />
}

/** Phase of the home loop from the live store (the retry timer cannot use a hook). */
function currentPhase(): string {
  const { player, timer, outcome, breakTimer } = useGame.getState()
  return phaseOf({ player, timer, outcome, breakTimer }, Date.now())
}

export interface EventPopupModalProps {
  candidate: PopupCandidate
  onClose: () => void
  onView: () => void
  tz?: TimeZoneSpec
}

/** The window itself (controlled, open). Exported for tests. */
export function EventPopupModal({ candidate, onClose, onView, tz }: EventPopupModalProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const { event, phase } = candidate
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      size="lg"
      title={eventText(event.name, lng)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('events.popup.close')}
          </Button>
          <Button icon="sparkle" onClick={onView}>
            {t('events.popup.view')}
          </Button>
        </>
      }
    >
      <EventPopupBody event={event} phase={phase} tz={tz} />
    </Dialog>
  )
}

const BADGE: Record<PopupPhase, string> = { active: 'bg-volt-400 text-ink', upcoming: 'bg-amber-400 text-ink' }

/** Image, status, dates, description and featured species of one event. */
export function EventPopupBody({ event, phase, tz }: { event: LiveEventPublic; phase: PopupPhase; tz?: TimeZoneSpec }) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const when = (ts: number) => formatEventWhen(ts, tz, i18n.language)
  return (
    <div className="flex flex-col gap-4" aria-label={t('events.popup.label')}>
      {event.image && (
        <img
          src={event.image.url}
          srcSet={imageSrcSet(event.image)}
          sizes="(min-width: 768px) 42rem, calc(100vw - 4rem)"
          width={1600}
          height={900}
          alt=""
          decoding="async"
          className="aspect-video w-full bg-dusk-900 object-cover"
        />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`px-1.5 pt-0.5 font-display text-sm leading-tight uppercase ${BADGE[phase]}`}>{t(phase === 'active' ? 'events.popup.live' : 'events.popup.comingSoon')}</span>
        <span className="text-sm text-mist-300">
          {phase === 'active' ? t('events.popup.endsOn', { when: when(event.endsAt) }) : t('events.popup.startsOn', { when: when(event.startsAt) })}
        </span>
      </div>
      {phase === 'upcoming' && <p className="text-sm text-mist-300">{t('events.window', { start: when(event.startsAt), end: when(event.endsAt) })}</p>}
      <RichText text={eventText(event.description, lng)} className="text-mist-100" />
      {event.featured.length > 0 && (
        <section aria-label={t('events.featured')} className="flex flex-col gap-2">
          <h3 className="font-display text-base text-mist-300">{t('events.featured')}</h3>
          <ul className="flex flex-wrap gap-2">
            {event.featured.map((f) => (
              <li key={f.species} className="flex min-w-[5.5rem] flex-col items-center gap-0.5 bg-dusk-900 px-2 py-1.5 inset-shadow-well">
                <span className="grid h-10 place-items-center">
                  <Sprite kind="icon" slug={f.species} scale={1} alt="" />
                </span>
                <span className="text-center text-sm leading-tight">{speciesName(f.species, lng)}</span>
                <span className="font-num text-lg leading-none text-volt-300">×{fmtMult(f.weightMult)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
