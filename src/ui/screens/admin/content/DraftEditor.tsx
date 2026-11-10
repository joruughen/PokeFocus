import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { LimitGroup } from '../../../../game/content/limits'
import type { AdminContentLiveResponse, AdminContentValidation, AdminContentVersionResponse } from '../../../../game/protocol'
import { isApiError } from '../../../api'
import { Button, Panel, Tabs, TextField, toast } from '../../../components'
import { errorText } from '../../../lib/errors'
import { contentApi } from './api'
import { AdvancedJson } from './AdvancedJson'
import { ConfigForm } from './ConfigForm'
import { MovesTable, SpeciesTable } from './DataTables'
import { createDraftStore } from './draftStore'
import { liveValidate, NO_ISSUES, type IssueSet } from './live'
import { fieldId, groupOfPath, sectionOfPath, type EditorSection } from './patch'
import { PublishDialog } from './PublishDialog'
import { DiffList, IssueList, issuesToSet, ValidationSummary } from './ReviewPanel'
import { SpawnPreview } from './SpawnPreview'
import { versionName } from './versions'

export interface DraftEditorProps {
  first: AdminContentVersionResponse
  live: AdminContentLiveResponse | null
  onClose: () => void
  /** The draft became a published/scheduled version: refresh the lists. */
  onPublished: () => void
}

/** Focus the field a path points at (tries the path, then its parents: a list item lives inside its list's id). */
function focusField(path: string): void {
  const parts = path.split('.')
  for (let n = parts.length; n >= 1; n--) {
    const el = document.getElementById(fieldId(parts.slice(0, n).join('.')))
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.focus({ preventScroll: true })
      return
    }
  }
}

/**
 * The draft editor: title and note, the section tabs (parameters, species, moves, advanced, review, preview), live
 * validation while typing, autosave, and a bar with «Validate» and «Publish». Everything the draft holds is saved
 * to the server as it is edited; nothing reaches players until it is published.
 */
export function DraftEditor({ first, live, onClose, onPublished }: DraftEditorProps) {
  const { t } = useTranslation()
  const store = useMemo(() => createDraftStore(first, { save: contentApi.saveDraft }), [first])
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [section, setSection] = useState<EditorSection>('params')
  const [group, setGroup] = useState<LimitGroup>('encounters')
  const [liveIssues, setLiveIssues] = useState<IssueSet>(NO_ISSUES)
  const [full, setFull] = useState<{ validation: AdminContentValidation; revision: number } | null>(
    first.version.validationDetail?.smoke ? { validation: first.version.validationDetail, revision: 0 } : null,
  )
  const [validating, setValidating] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // Save what is pending when the editor closes.
  useEffect(
    () => () => {
      void store.flush().finally(() => store.dispose())
    },
    [store],
  )

  // Cheap validation while typing (no smoke test): debounced, ignoring stale results.
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      liveValidate(state.patch)
        .then((r) => current && setLiveIssues(r))
        .catch(() => current && setLiveIssues(NO_ISSUES))
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [state.revision, state.patch])

  const fullFresh = full !== null && full.revision === state.revision
  const issues = fullFresh ? issuesToSet(full.validation) : liveIssues
  const edit = store.edit

  const goto = useCallback((path: string) => {
    const next = sectionOfPath(path)
    setSection(next)
    const g = groupOfPath(path)
    if (g) setGroup(g)
    setTimeout(() => focusField(path), 80)
  }, [])

  const validate = async () => {
    setValidating(true)
    try {
      if (!(await store.flush())) {
        toast.add({ title: t('admin.content.action.saveFailed'), type: 'danger' })
        return
      }
      const rev = store.getState().revision
      const res = await contentApi.validate(state.id)
      setFull({ validation: res.validation, revision: rev })
      toast.add({ title: t(res.validation.ok ? 'admin.content.review.okSmoke' : 'admin.content.review.failed', { count: res.validation.errors.length }), type: res.validation.ok ? 'success' : 'danger' })
    } catch (e) {
      toast.add({ title: isApiError(e) && e.status === 429 ? t('admin.content.action.rateLimited', { count: Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60)) }) : errorText(isApiError(e) ? e.code : 'network'), type: 'danger' })
    } finally {
      setValidating(false)
    }
  }

  const saving = state.phase === 'saving' || state.phase === 'dirty'
  const changes = state.diff.length
  const blocked = issues.errors.length > 0
  const liveWarnings = issues.warnings.filter((w) => w.code === 'live_owned' || w.code === 'live_league_week')
  const status =
    state.phase === 'error' ? t('admin.content.editor.saveError', { code: state.error ?? '' }) : state.phase === 'saving' ? t('admin.content.editor.saving') : state.phase === 'dirty' ? t('admin.content.editor.unsaved') : t('admin.content.editor.saved')

  const tabs = [
    { value: 'params', label: t('admin.content.sections.params'), content: <ConfigForm patch={state.patch} issues={issues} group={group} onGroup={setGroup} onPatch={edit} /> },
    { value: 'species', label: t('admin.content.sections.species'), content: <SpeciesTable patch={state.patch} issues={issues} onPatch={edit} /> },
    { value: 'moves', label: t('admin.content.sections.moves'), content: <MovesTable patch={state.patch} issues={issues} onPatch={edit} /> },
    { value: 'advanced', label: t('admin.content.sections.advanced'), content: <AdvancedJson patch={state.patch} issues={issues} onPatch={edit} /> },
    {
      value: 'review',
      label: (
        <>
          {t('admin.content.sections.review')}
          {changes > 0 && <span className="ml-2 bg-volt-400 px-1.5 pt-0.5 text-sm leading-tight text-ink">{changes}</span>}
        </>
      ),
      content: (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ValidationSummary validation={full?.validation ?? null} stale={full !== null && !fullFresh} />
            <Button icon="check" variant="secondary" onClick={() => void validate()} disabled={validating}>
              {t('admin.content.review.validate')}
            </Button>
          </div>
          <p className="text-sm text-mist-400">{t('admin.content.review.hint')}</p>
          <IssueList errors={issues.errors} warnings={issues.warnings} onGoto={goto} />
          <section aria-labelledby="diff-title" className="flex flex-col gap-2">
            <h3 id="diff-title" className="text-lg">
              {t('admin.content.diff.title')} <span className="font-num text-mist-400">({changes})</span>
            </h3>
            <DiffList diff={state.diff} stale={saving} />
          </section>
        </div>
      ),
    },
    { value: 'preview', label: t('admin.content.sections.preview'), content: <SpawnPreview draftId={state.id} flush={store.flush} revision={state.server.hash ?? ''} events={live?.events ?? []} /> },
  ]

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={t('admin.content.editor.title', { name: versionName(state.server) })}
        actions={
          <Button variant="ghost" size="sm" icon="back" onClick={onClose}>
            {t('admin.content.editor.back')}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={t('admin.content.editor.name')} value={state.title} onChange={(e) => store.setTitle(e.target.value)} maxLength={80} />
          <TextField label={t('admin.content.editor.note')} value={state.note} onChange={(e) => store.setNote(e.target.value)} maxLength={400} hint={t('admin.content.editor.noteHint')} />
        </div>
        <p className="text-sm text-mist-300">{t('admin.content.editor.baseNote')}</p>
      </Panel>

      <Panel>
        <Tabs label={t('admin.content.sections.label')} items={tabs} value={section} onValueChange={(v) => setSection(v as EditorSection)} />
      </Panel>

      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-dusk-800 p-3 shadow-plate" role="region" aria-label={t('admin.content.editor.bar')}>
        <p className={state.phase === 'error' ? 'text-cheek-400' : 'text-mist-300'} role="status">
          {status}
          {state.phase === 'error' && (
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => void store.flush()}>
              {t('admin.content.editor.retry')}
            </Button>
          )}
          <span className="ml-3 text-sm text-mist-400">{t('admin.content.editor.changes', { count: changes })}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {blocked && <span className="text-sm text-cheek-400">{t('admin.content.editor.blocked', { count: issues.errors.length })}</span>}
          <Button variant="secondary" icon="check" onClick={() => void validate()} disabled={validating}>
            {t('admin.content.review.validate')}
          </Button>
          <Button icon="play" onClick={() => setPublishing(true)} disabled={blocked || state.phase === 'error'}>
            {t('admin.content.editor.publish')}
          </Button>
        </div>
      </div>

      <PublishDialog
        open={publishing}
        onOpenChange={setPublishing}
        draftId={state.id}
        changes={changes}
        flush={store.flush}
        warnings={issues.warnings.filter((w) => w.requiresConfirm)}
        liveWarnings={liveWarnings}
        onDone={() => {
          onPublished()
          onClose()
        }}
      />
    </div>
  )
}
