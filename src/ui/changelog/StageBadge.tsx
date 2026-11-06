import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '../components'
import { cx } from '../lib/cx'
import { hrefTo } from '../router'
import { usePrefs } from '../store/prefs'
import { APP_VERSION, RELEASE_STAGE } from './release'

/**
 * "ALFA v0.4.0": where the game stands, linking to the news page. A red dot
 * says there is a version the player has not looked at yet; the first time the
 * app runs on a device it just records the current version (no dot for
 * someone who has never seen an older one).
 */
export function StageBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useTranslation()
  const lastSeen = usePrefs((s) => s.lastSeenVersion)
  const setLastSeen = usePrefs((s) => s.setLastSeenVersion)
  useEffect(() => {
    if (lastSeen === null) setLastSeen(APP_VERSION)
  }, [lastSeen, setLastSeen])
  const unseen = lastSeen !== null && lastSeen !== APP_VERSION
  return (
    <Tooltip content={t(`release.${RELEASE_STAGE}.tip`)} side="right">
      <a
        href={hrefTo('changelog')}
        className={cx('inline-flex items-center gap-1.5 py-1 pr-1', className)}
        aria-label={`${t(`release.${RELEASE_STAGE}.label`)} ${t('release.version', { version: APP_VERSION })}${unseen ? `. ${t('release.unseen')}` : ''}`}
      >
        <span className="bg-volt-400 px-1.5 pt-0.5 font-display text-sm leading-tight text-ink uppercase shadow-frame">{t(`release.${RELEASE_STAGE}.label`)}</span>
        {!compact && <span className="bg-ink px-1.5 pt-0.5 font-num text-lg leading-tight text-mist-100 shadow-frame">{t('release.version', { version: APP_VERSION })}</span>}
        {unseen && <span aria-hidden className="size-2.5 bg-cheek-500 shadow-frame" />}
      </a>
    </Tooltip>
  )
}
