import { useTranslation } from 'react-i18next'
import type { AdminContentVersionResponse } from '../../../../game/protocol'
import { Button, Panel } from '../../../components'
import { DiffList, IssueList, ValidationSummary } from './ReviewPanel'
import { KindBadge } from './Overview'
import { canRollback, canUnschedule, shortHash, versionKind, versionName } from './versions'

export interface VersionViewProps {
  data: AdminContentVersionResponse
  canEdit: boolean
  busy: boolean
  onBack: () => void
  onRollback: () => void
  onUnschedule: () => void
  onCopy: () => void
}

/** Read-only look at one version: who made it, its validation and what it changes against the live content. */
export function VersionView({ data, canEdit, busy, onBack, onRollback, onUnschedule, onCopy }: VersionViewProps) {
  const { t, i18n } = useTranslation()
  const v = data.version
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  const kind = versionKind(v)
  return (
    <Panel
      title={t('admin.content.view.title', { name: versionName(v) })}
      actions={
        <Button variant="ghost" size="sm" icon="back" onClick={onBack}>
          {t('admin.content.editor.back')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <KindBadge kind={kind} />
          <span className="font-mono text-sm text-mist-300">{shortHash(v.hash)}</span>
          {canEdit && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={onCopy}>
                {t('admin.content.versions.copy')}
              </Button>
              {canUnschedule(v) && (
                <Button size="sm" icon="close" disabled={busy} onClick={onUnschedule}>
                  {t('admin.content.versions.unschedule')}
                </Button>
              )}
              {canRollback(v) && (
                <Button size="sm" icon="reroll" disabled={busy} onClick={onRollback}>
                  {t('admin.content.versions.rollback')}
                </Button>
              )}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-mist-400">{t('admin.content.view.created')}</dt>
          <dd>
            {fmt.format(v.createdAt)} · {v.createdBy?.trainerName ?? '—'}
          </dd>
          {v.effectiveAt !== null && (
            <>
              <dt className="text-mist-400">{t(kind === 'scheduled' ? 'admin.content.live.starts' : 'admin.content.live.effective')}</dt>
              <dd>
                {fmt.format(v.effectiveAt)} · {v.publishedBy?.trainerName ?? '—'}
              </dd>
            </>
          )}
          {v.parentId !== null && (
            <>
              <dt className="text-mist-400">{t('admin.content.view.parent')}</dt>
              <dd className="font-num">#{v.parentId}</dd>
            </>
          )}
          {v.note && (
            <>
              <dt className="text-mist-400">{t('admin.content.editor.note')}</dt>
              <dd className="break-words">{v.note}</dd>
            </>
          )}
        </dl>
        <section className="flex flex-col gap-2">
          <h3 className="text-lg">{t('admin.content.review.title')}</h3>
          <ValidationSummary validation={v.validationDetail} stale={false} />
          {v.validationDetail && <IssueList errors={v.validationDetail.errors} warnings={v.validationDetail.warnings} />}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-lg">
            {t('admin.content.diff.title')} <span className="font-num text-mist-400">({data.diff.length})</span>
          </h3>
          <p className="text-sm text-mist-400">{t(kind === 'active' ? 'admin.content.view.isActive' : 'admin.content.view.diffHint')}</p>
          {kind !== 'active' && <DiffList diff={data.diff} />}
        </section>
      </div>
    </Panel>
  )
}
