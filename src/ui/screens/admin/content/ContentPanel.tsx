import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminContentLiveResponse, AdminContentVersionResponse, AdminContentVersionSummary } from '../../../../game/protocol'
import { isApiError } from '../../../api'
import { Button, Dialog, DialogClose, Panel, TextField, toast } from '../../../components'
import { errorText } from '../../../lib/errors'
import { useAuth } from '../../../store/auth'
import { contentApi } from './api'
import { DraftEditor } from './DraftEditor'
import { LiveStatus, VersionsList, type StatusFilter } from './Overview'
import { RollbackDialog, UnscheduleDialog } from './PublishDialog'
import { VersionView } from './VersionView'
import { contentPermissions, versionName } from './versions'

type View = { kind: 'overview' } | { kind: 'view'; id: number } | { kind: 'edit'; id: number }

const OWN = ['forbidden', 'not_found', 'not_draft', 'not_published', 'not_scheduled', 'too_many_drafts', 'invalid_body']

/** Text of an error of the content API (own copy for its codes, else the generic one). */
export function contentErrorText(e: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!isApiError(e)) return errorText('network')
  if (e.status === 429) return t('admin.content.action.rateLimited', { count: Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)) })
  if (OWN.includes(e.code)) return t(`admin.content.errors.${e.code}`)
  return errorText(e.code)
}

/**
 * Content tab of the admin screen (support reads, admin edits): what is live, the versions, and the draft editor.
 * Drafts are autosaved on the server; publishing (now or scheduled) and rollback need the sudo mode, which the
 * dialogs ask for when the API says `elevation_required`.
 */
export default function ContentPanel() {
  const { t } = useTranslation()
  const role = useAuth((s) => s.user?.role)
  const perms = contentPermissions(role)
  const [view, setView] = useState<View>({ kind: 'overview' })
  const [live, setLive] = useState<AdminContentLiveResponse | null>(null)
  const [versions, setVersions] = useState<AdminContentVersionSummary[] | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState<AdminContentVersionResponse | null>(null)
  const [rollback, setRollback] = useState<AdminContentVersionSummary | null>(null)
  /** «New draft» waits for a name: nothing is created until it is given. */
  const [naming, setNaming] = useState<'active' | 'empty' | null>(null)
  const [draftName, setDraftName] = useState('')
  const [unscheduling, setUnscheduling] = useState<AdminContentVersionSummary | null>(null)
  const [removing, setRemoving] = useState<AdminContentVersionSummary | null>(null)

  const reload = useCallback(
    async (f: StatusFilter = filter) => {
      setLoading(true)
      setError(null)
      try {
        const [l, v] = await Promise.all([contentApi.live(), contentApi.versions(f === 'all' ? undefined : f)])
        setLive(l)
        setVersions(v.items)
      } catch (e) {
        setError(contentErrorText(e, t))
      } finally {
        setLoading(false)
      }
    },
    [filter, t],
  )

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only; the filter reloads through `changeFilter`
  }, [])

  // Load the version the view points at.
  const viewId = view.kind === 'overview' ? null : view.id
  useEffect(() => {
    setLoaded(null)
    if (viewId === null) return
    let current = true
    contentApi
      .version(viewId)
      .then((r) => current && setLoaded(r))
      .catch((e) => {
        if (!current) return
        toast.add({ title: contentErrorText(e, t), type: 'danger' })
        setView({ kind: 'overview' })
      })
    return () => {
      current = false
    }
  }, [viewId, t])

  const changeFilter = (f: StatusFilter) => {
    setFilter(f)
    void reload(f)
  }

  const open = (v: AdminContentVersionSummary) => setView(v.status === 'draft' && perms.edit ? { kind: 'edit', id: v.id } : { kind: 'view', id: v.id })

  const act = async <T,>(run: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    try {
      return await run()
    } catch (e) {
      toast.add({ title: contentErrorText(e, t), type: 'danger' })
      return null
    } finally {
      setBusy(false)
    }
  }

  const createDraft = async (body: Parameters<typeof contentApi.createDraft>[0]) => {
    const r = await act(() => contentApi.createDraft(body))
    if (r) {
      void reload()
      setView({ kind: 'edit', id: r.version.id })
    }
  }

  const startNaming = (from: 'active' | 'empty' | null) => {
    setNaming(from)
    setDraftName('')
  }
  const confirmNaming = async () => {
    const title = draftName.trim()
    if (!naming || title === '') return
    const from = naming
    startNaming(null)
    await createDraft({ from, title })
  }

  const remove = async (v: AdminContentVersionSummary) => {
    const ok = await act(async () => {
      await contentApi.deleteDraft(v.id)
      return true
    })
    if (ok) {
      toast.add({ title: t('admin.content.versions.deleted'), type: 'success' })
      void reload()
    }
  }

  if (view.kind === 'edit') {
    return loaded ? (
      <DraftEditor key={loaded.version.id} first={loaded} live={live} onClose={() => { setView({ kind: 'overview' }); void reload() }} onPublished={() => void reload()} />
    ) : (
      <p className="text-mist-300">{t('common.loading')}</p>
    )
  }

  if (view.kind === 'view') {
    return loaded ? (
      <>
        <VersionView
          data={loaded}
          canEdit={perms.edit}
          busy={busy}
          onBack={() => setView({ kind: 'overview' })}
          onRollback={() => setRollback(loaded.version)}
          onUnschedule={() => setUnscheduling(loaded.version)}
          onCopy={() => void createDraft({ fromVersionId: loaded.version.id })}
        />
        <RollbackTarget target={rollback} onClose={() => setRollback(null)} onDone={() => { setView({ kind: 'overview' }); void reload() }} />
        <UnscheduleTarget target={unscheduling} onClose={() => setUnscheduling(null)} onDone={() => { setView({ kind: 'overview' }); void reload() }} />
      </>
    ) : (
      <p className="text-mist-300">{t('common.loading')}</p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[70ch] text-mist-300">{t(perms.edit ? 'admin.content.intro' : 'admin.content.introReadonly')}</p>
      {error && (
        <p role="alert" className="text-cheek-400">
          {error}{' '}
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            {t('admin.content.retry')}
          </Button>
        </p>
      )}
      {live && <LiveStatus live={live} onReload={() => void reload()} loading={loading} />}
      <Panel
        title={t('admin.content.versions.title')}
        actions={
          perms.edit && (
            <>
              <Button size="sm" icon="plus" disabled={busy} onClick={() => startNaming('active')}>
                {t('admin.content.versions.newFromLive')}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => startNaming('empty')}>
                {t('admin.content.versions.newEmpty')}
              </Button>
            </>
          )
        }
      >
        {versions === null ? (
          <p className="text-mist-300">{t('common.loading')}</p>
        ) : (
          <VersionsList
            items={versions}
            filter={filter}
            onFilter={changeFilter}
            canEdit={perms.edit}
            busy={busy}
            onOpen={open}
            onRollback={setRollback}
            onUnschedule={setUnscheduling}
            onCopy={(v) => void createDraft({ fromVersionId: v.id })}
            onDelete={setRemoving}
          />
        )}
      </Panel>

      <Dialog
        open={naming !== null}
        onOpenChange={(o) => !o && startNaming(null)}
        title={t(naming === 'empty' ? 'admin.content.versions.newEmptyTitle' : 'admin.content.versions.newFromLiveTitle')}
        description={t(naming === 'empty' ? 'admin.content.versions.newEmptyBody' : 'admin.content.versions.newFromLiveBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => startNaming(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="new-draft-form" icon="plus" disabled={draftName.trim() === '' || busy}>
              {t('admin.content.versions.create')}
            </Button>
          </>
        }
      >
        <form
          id="new-draft-form"
          onSubmit={(e) => {
            e.preventDefault()
            void confirmNaming()
          }}
        >
          <TextField label={t('admin.content.editor.name')} value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={80} autoComplete="off" autoFocus />
        </form>
      </Dialog>

      <RollbackTarget target={rollback} onClose={() => setRollback(null)} onDone={() => void reload()} />
      <UnscheduleTarget target={unscheduling} onClose={() => setUnscheduling(null)} onDone={() => void reload()} />

      <Dialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('admin.content.versions.deleteTitle')}
        description={removing ? t('admin.content.versions.deleteBody', { name: versionName(removing) }) : undefined}
        footer={
          <>
            <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} />
            <DialogClose
              render={
                <Button
                  variant="danger"
                  onClick={() => {
                    if (removing) void remove(removing)
                  }}
                >
                  {t('admin.content.versions.deleteConfirm')}
                </Button>
              }
            />
          </>
        }
      />
    </div>
  )
}

function RollbackTarget({ target, onClose, onDone }: { target: AdminContentVersionSummary | null; onClose: () => void; onDone: () => void }) {
  // Keep the last target while the dialog animates out.
  const [last, setLast] = useState<AdminContentVersionSummary | null>(target)
  useEffect(() => {
    if (target) setLast(target)
  }, [target])
  if (!last) return null
  return (
    <RollbackDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      versionId={last.id}
      label={versionName(last)}
      onDone={() => {
        onClose()
        onDone()
      }}
    />
  )
}

function UnscheduleTarget({ target, onClose, onDone }: { target: AdminContentVersionSummary | null; onClose: () => void; onDone: () => void }) {
  const [last, setLast] = useState<AdminContentVersionSummary | null>(target)
  useEffect(() => {
    if (target) setLast(target)
  }, [target])
  if (!last) return null
  return (
    <UnscheduleDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      versionId={last.id}
      label={versionName(last)}
      onDone={() => {
        onClose()
        onDone()
      }}
    />
  )
}
