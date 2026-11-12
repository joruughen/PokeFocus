import { useTranslation } from 'react-i18next'
import type { AdminContentVersionSummary } from '../../../../game/protocol'
import { asLocale } from '../../../lib/names'
import { eventText } from '../../events/model'

type Linked = Pick<AdminContentVersionSummary, 'linkedEvent' | 'linkedRole' | 'revertStale'>

/**
 * «con el evento X» under a version tied to a live event (the one that takes effect with it, or the copy that goes
 * back when it ends), and the warning when that copy is out of date because another version came in between.
 */
export function EventLinkLine({ v, className }: { v: Linked; className?: string }) {
  const { t, i18n } = useTranslation()
  if (!v.linkedEvent) return null
  const name = eventText(v.linkedEvent.name, asLocale(i18n.language))
  return (
    <div className={className}>
      <p className="text-sm break-words text-volt-400">
        {t(v.linkedRole === 'end' ? 'admin.content.link.ends' : 'admin.content.link.starts', { name })}
        {v.linkedEvent.status === 'archived' && ` · ${t('admin.content.link.archived')}`}
      </p>
      {v.revertStale && (
        <p role="note" className="text-sm break-words text-amber-400">
          {t('admin.content.link.stale')}
        </p>
      )}
    </div>
  )
}
