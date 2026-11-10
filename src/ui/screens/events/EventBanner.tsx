import { useTranslation } from 'react-i18next'
import type { LiveEventPublic } from '../../../game/protocol'
import { PixelIcon } from '../../components'
import { cx } from '../../lib/cx'
import { asLocale } from '../../lib/names'
import { useNow } from '../../store/clock'
import { useLiveEvents } from '../../store/liveEvents'
import { bannerEvent, eventText, remainingKey, remainingParts } from './model'

/** A discreet one-line notice of the event running now; the player can close it (per event, remembered in this browser). */
export function EventBannerBar({ event, now, onDismiss, className }: { event: LiveEventPublic; now: number; onDismiss?: () => void; className?: string }) {
  const { t, i18n } = useTranslation()
  const name = eventText(event.name, asLocale(i18n.language))
  const rem = remainingKey(remainingParts(event.endsAt - now))
  return (
    <aside role="status" aria-label={t('events.banner.label')} className={cx('flex items-center gap-3 bg-dusk-800 p-2 pl-3 shadow-frame', className)}>
      <PixelIcon name="sparkle" size={20} className="shrink-0 text-amber-400" />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        <span className="font-display text-base break-words">{t('events.banner.title', { name })}</span>
        <span className="text-mist-300"> · {t('events.endsIn', { time: t(`events.remaining.${rem.key}`, rem.values) })}</span>
      </p>
      <a href="#/events" className="shrink-0 px-2 py-2 font-display text-base text-volt-300 underline underline-offset-2 hover:text-volt-200">
        {t('events.banner.view')}
      </a>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('events.banner.dismiss', { name })}
          title={t('events.banner.dismiss', { name })}
          className="grid size-9 shrink-0 place-items-center hover:bg-dusk-700"
        >
          <PixelIcon name="close" size={16} />
        </button>
      )}
    </aside>
  )
}

/** The banner of the first active event the player has not closed (nothing when there is none). */
export function EventBanner({ className }: { className?: string }) {
  const active = useLiveEvents((s) => s.active)
  const skew = useLiveEvents((s) => s.skew)
  const dismissed = useLiveEvents((s) => s.dismissed)
  const dismiss = useLiveEvents((s) => s.dismissBanner)
  const now = useNow() + skew
  const ev = bannerEvent(active, dismissed, now)
  if (!ev) return null
  return <EventBannerBar event={ev} now={now} onDismiss={() => dismiss(ev.id)} className={className} />
}
