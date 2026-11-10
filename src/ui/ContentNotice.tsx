import { useTranslation } from 'react-i18next'
import { PixelIcon } from './components'
import { cx } from './lib/cx'
import { useContentStale } from './store/content'

/**
 * Discreet bar: the server runs other shipped data than this page (a redeploy
 * happened), so the player should reload. Presentational; `ContentNotice`
 * decides when to show it.
 */
export function ContentNoticeBar({ onReload, className }: { onReload: () => void; className?: string }) {
  const { t } = useTranslation()
  return (
    <aside role="status" className={cx('flex items-center gap-3 bg-dusk-800 px-3 py-2 text-sm text-mist-100 shadow-frame', className)}>
      <PixelIcon name="sparkle" size={16} className="shrink-0" />
      <p className="min-w-0 flex-1">{t('contentUpdate.message')}</p>
      <button type="button" onClick={onReload} className="shrink-0 px-2 py-1 font-display underline hover:text-volt-400">
        {t('contentUpdate.reload')}
      </button>
    </aside>
  )
}

/** Shown while the server's `baseHash` differs from the build's (see store/content.ts). */
export function ContentNotice({ className }: { className?: string }) {
  const stale = useContentStale()
  if (!stale) return null
  return <ContentNoticeBar onReload={() => window.location.reload()} className={className} />
}
