import { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { PixelIcon } from './components'
import { cx } from './lib/cx'
import { formatInstant, formatRelative, formatWindow, pickNotice, type NoticeView } from './lib/maintenance'
import { useAnnouncements } from './store/announcements'

/**
 * One maintenance notice as a bar: what it is, when (in the viewer's time
 * zone), what to do about it and the admin's own note. Purely presentational:
 * the admin screen reuses it as a preview.
 */
export function MaintenanceNoticeBar({ view, now, onDismiss, className }: { view: NoticeView; now: number; onDismiss?: () => void; className?: string }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const { notice, phase } = view
  const active = phase === 'active'
  return (
    <aside
      role="status"
      className={cx('flex items-start gap-3 p-3 shadow-frame', active ? 'bg-cheek-700 text-mist-50' : 'bg-amber-400 text-ink', className)}
    >
      <PixelIcon name="wrench" size={20} className="mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg leading-tight">{t(active ? 'maintenance.activeTitle' : 'maintenance.upcomingTitle')}</p>
        <p className="font-num text-xl leading-tight">
          {active ? t('maintenance.until', { until: formatInstant(notice.endsAt, lng) }) : formatWindow(notice.startsAt, notice.endsAt, lng)}
        </p>
        <p className="text-sm">
          {active ? t('maintenance.activeAdvice') : t('maintenance.upcomingAdvice', { when: formatRelative(notice.startsAt - now, lng) })}
        </p>
        {notice.note && <p className="mt-1 break-words">{notice.note}</p>}
      </div>
      {onDismiss && !active && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('maintenance.dismiss')}
          title={t('maintenance.dismiss')}
          className="grid size-9 shrink-0 place-items-center hover:bg-ink/10"
        >
          <PixelIcon name="close" size={16} />
        </button>
      )}
    </aside>
  )
}

/**
 * The maintenance banner: the running window if there is one, otherwise the
 * soonest upcoming one. Times are compared with the server's clock. An
 * upcoming notice can be closed (until the next reload); a running one cannot.
 */
export function MaintenanceBanner({ className }: { className?: string }) {
  const maintenance = useAnnouncements((s) => s.maintenance)
  const skew = useAnnouncements((s) => s.skew)
  const dismissed = useAnnouncements((s) => s.dismissed)
  const dismiss = useAnnouncements((s) => s.dismiss)
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  // Re-evaluate phase and countdown while there is something to show.
  useEffect(() => {
    if (maintenance.length === 0) return
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [maintenance])
  if (maintenance.length === 0) return null
  const now = Date.now() + skew
  const view = pickNotice(maintenance, now, new Set(dismissed))
  if (!view) return null
  return <MaintenanceNoticeBar view={view} now={now} onDismiss={() => dismiss(view.notice.id)} className={className} />
}
