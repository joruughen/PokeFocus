import { useTranslation } from 'react-i18next'
import type { AdminContentLiveResponse, AdminContentStatus, AdminContentVersionSummary } from '../../../../game/protocol'
import { Button, IconButton, Panel, Segmented } from '../../../components'
import { cx } from '../../../lib/cx'
import { canRollback, canUnschedule, shortHash, versionKind, versionName, type VersionKind } from './versions'

const KIND_CLASS: Record<VersionKind, string> = {
  active: 'bg-leaf-600 text-mist-50',
  scheduled: 'bg-amber-400 text-ink',
  published: 'bg-dusk-600 text-mist-50',
  draft: 'bg-volt-400 text-ink',
  archived: 'bg-dusk-700 text-mist-300',
}

export function KindBadge({ kind }: { kind: VersionKind }) {
  const { t } = useTranslation()
  return <span className={cx('shrink-0 px-1.5 pt-0.5 font-display text-sm leading-tight uppercase', KIND_CLASS[kind])}>{t(`admin.content.kind.${kind}`)}</span>
}

function useWhen() {
  const { i18n } = useTranslation()
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  return (ts: number | null) => (ts === null ? '—' : fmt.format(ts))
}

/** `starts`: the card of a scheduled version, whose date is when it will take effect (not when it did). */
function VersionCard({ title, version, empty, starts }: { title: string; version: AdminContentVersionSummary | null; empty: string; starts?: boolean }) {
  const { t } = useTranslation()
  const when = useWhen()
  return (
    <Panel variant="frame" title={title} headingLevel={3}>
      {version ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-mist-400">{t('admin.content.live.version')}</dt>
          <dd className="font-num">{versionName(version)}</dd>
          <dt className="text-mist-400">{t(starts ? 'admin.content.live.starts' : 'admin.content.live.effective')}</dt>
          <dd>{when(version.effectiveAt)}</dd>
          <dt className="text-mist-400">{t('admin.content.live.hash')}</dt>
          <dd className="font-mono text-sm">{shortHash(version.hash)}</dd>
          {version.publishedBy && (
            <>
              <dt className="text-mist-400">{t('admin.content.live.by')}</dt>
              <dd>{version.publishedBy.trainerName}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-mist-300">{empty}</p>
      )}
    </Panel>
  )
}

/** What is in force now: the active version, the next scheduled one and the live events. */
export function LiveStatus({ live, onReload, loading }: { live: AdminContentLiveResponse; onReload: () => void; loading: boolean }) {
  const { t } = useTranslation()
  const when = useWhen()
  return (
    <Panel
      title={t('admin.content.live.title')}
      actions={<IconButton icon="reroll" size="sm" variant="ghost" label={t('admin.content.live.reload')} disabled={loading} onClick={onReload} />}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <VersionCard title={t('admin.content.live.active')} version={live.active} empty={t('admin.content.live.noneActive')} />
        <VersionCard title={t('admin.content.live.scheduled')} version={live.scheduled} empty={t('admin.content.live.noneScheduled')} starts />
        <Panel variant="frame" title={t('admin.content.live.events')} headingLevel={3}>
          {live.events.length === 0 ? (
            <p className="text-mist-300">{t('admin.content.live.noEvents')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {live.events.map((e) => (
                <li key={e.id}>
                  <span className="text-mist-50">{e.slug}</span> <span className="text-sm text-mist-400">→ {when(e.endsAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="mt-3 text-sm text-mist-400">
        {t('admin.content.live.hashLine', { hash: shortHash(live.hash), base: shortHash(live.baseHash) })}
        {live.hash === 'base' && ` · ${t('admin.content.live.isBase')}`}
      </p>
    </Panel>
  )
}

export type StatusFilter = AdminContentStatus | 'all'

export interface VersionsListProps {
  items: AdminContentVersionSummary[]
  filter: StatusFilter
  onFilter: (f: StatusFilter) => void
  canEdit: boolean
  busy: boolean
  onOpen: (v: AdminContentVersionSummary) => void
  onRollback: (v: AdminContentVersionSummary) => void
  onUnschedule: (v: AdminContentVersionSummary) => void
  onCopy: (v: AdminContentVersionSummary) => void
  onDelete: (v: AdminContentVersionSummary) => void
}

/** Versions, newest first: active, scheduled, drafts, archived. Actions depend on the kind and on the role. */
export function VersionsList({ items, filter, onFilter, canEdit, busy, onOpen, onRollback, onUnschedule, onCopy, onDelete }: VersionsListProps) {
  const { t } = useTranslation()
  const when = useWhen()
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label={t('admin.content.versions.filter')}
        value={filter}
        onChange={onFilter}
        options={(['all', 'draft', 'published', 'archived'] as const).map((f) => ({ value: f, label: t(`admin.content.versions.${f}`) }))}
      />
      {items.length === 0 ? (
        <p className="text-mist-300">{t('admin.content.versions.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('admin.content.versions.title')}>
          {items.map((v) => {
            const kind = versionKind(v)
            const val = v.validation
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-dusk-900 p-3 inset-shadow-well">
                <KindBadge kind={kind} />
                <div className="min-w-0 flex-1 basis-60">
                  <p className="truncate font-num text-lg">{versionName(v)}</p>
                  <p className="text-sm text-mist-400">
                    {kind === 'draft' ? t('admin.content.versions.createdBy', { who: v.createdBy?.trainerName ?? '—', when: when(v.createdAt) }) : t(kind === 'scheduled' ? 'admin.content.versions.startsBy' : 'admin.content.versions.effectiveBy', { when: when(v.effectiveAt), who: v.publishedBy?.trainerName ?? '—' })}
                    {' · '}
                    <span className="font-mono">{shortHash(v.hash)}</span>
                  </p>
                  {v.note && <p className="mt-0.5 break-words text-sm text-mist-300">{v.note}</p>}
                  {kind === 'draft' && (
                    <p className={cx('text-sm', val === null ? 'text-mist-400' : val.errors > 0 ? 'text-cheek-400' : val.warnings > 0 ? 'text-amber-400' : 'text-leaf-400')}>
                      {val === null ? t('admin.content.versions.notValidated') : t('admin.content.versions.validation', { errors: val.errors, warnings: val.warnings })}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => onOpen(v)}>
                    {t(kind === 'draft' && canEdit ? 'admin.content.versions.edit' : 'admin.content.versions.view')}
                  </Button>
                  {canEdit && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCopy(v)}>
                      {t('admin.content.versions.copy')}
                    </Button>
                  )}
                  {canEdit && canRollback(v) && (
                    <Button size="sm" variant="ghost" icon="reroll" disabled={busy} onClick={() => onRollback(v)}>
                      {t('admin.content.versions.rollback')}
                    </Button>
                  )}
                  {canEdit && canUnschedule(v) && (
                    <Button size="sm" variant="ghost" icon="close" disabled={busy} onClick={() => onUnschedule(v)}>
                      {t('admin.content.versions.unschedule')}
                    </Button>
                  )}
                  {canEdit && kind === 'draft' && <IconButton icon="trash" size="sm" variant="ghost" label={t('admin.content.versions.delete', { name: versionName(v) })} disabled={busy} onClick={() => onDelete(v)} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
