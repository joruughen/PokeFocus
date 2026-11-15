import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EventImportData, ImportResult } from '../../../../game/content'
import type { AdminEvent } from '../../../../game/protocol'
import { Button, Dialog, TextField } from '../../../components'
import { contentErrorText } from '../content/errors'
import { contentApi } from '../content/api'
import { formatEventWhen } from '../../events/model'
import type { EventDraft } from '../events/draft'
import { eventsErrorText } from '../events/errors'
import { createTiedDraft, filledDraft, freeSlug, importedDraft, isSlug, knownEventItems, loadAdminJson, readFileText, slugState, type ImportInfo } from './logic'
import { ImportIssues, JsonSource } from './parts'

export interface EventImported {
  draft: EventDraft
  /** The existing draft the import updates (list mode). */
  target: AdminEvent | null
  info: ImportInfo
}

export interface EventImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * `list`: creates a new draft or updates an existing one; the events decide what a slug clash offers.
   * `fill`: fills the open editor (`current`) with the JSON.
   */
  mode: 'list' | 'fill'
  events?: readonly AdminEvent[]
  current?: EventDraft
  onImported: (r: EventImported) => void
}

type Choice = 'update' | 'new'

/**
 * «Importar JSON» of events: paste text or upload a file, check it in the browser with the server's own rules,
 * show every problem with its path, and — only when it is valid — create or fill a DRAFT. It never publishes.
 */
export function EventImportDialog({ open, onOpenChange, mode, events = [], current, onImported }: EventImportDialogProps) {
  const { t, i18n } = useTranslation()
  const [text, setText] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<ImportResult<EventImportData> | null>(null)
  const [choice, setChoice] = useState<Choice>('update')
  const [newSlug, setNewSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A fresh dialog every time it opens.
  useEffect(() => {
    if (!open) return
    setText('')
    setResult(null)
    setError(null)
  }, [open])

  const data = result?.ok ? (result.value ?? null) : null
  const clash = useMemo(() => (data && mode === 'list' ? slugState(data.slug, events) : null), [data, mode, events])
  // What to do about the slug: update the draft that has it, or take another one.
  useEffect(() => {
    if (!data || !clash) return
    setChoice(clash.kind === 'draft' ? 'update' : 'new')
    setNewSlug(clash.kind === 'free' ? data.slug : freeSlug(data.slug, events))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per checked document
  }, [data])

  const newState = slugState(newSlug, events)
  const slugError = choice === 'new' && clash && clash.kind !== 'free' ? (!isSlug(newSlug) ? t('adminJson.issues.bad_slug') : newState.kind !== 'free' ? t('adminJson.import.event.slugTaken') : null) : null

  const check = async (source = text) => {
    setChecking(true)
    setError(null)
    try {
      const m = await loadAdminJson()
      const parsed = m.parseJsonText(source)
      if (!parsed.ok) {
        setResult({ ok: false, errors: [parsed.issue], warnings: [], requiresConfirm: false })
        return
      }
      setResult(m.validateEventImport(parsed.value, { smoke: false, allEventItems: knownEventItems(events, current?.id), now: Date.now() }))
    } finally {
      setChecking(false)
    }
  }

  const onFile = async (file: File) => {
    try {
      const body = await readFileText(file)
      setText(body)
      await check(body)
    } catch {
      setResult(null)
      setError(t('adminJson.import.fileError'))
    }
  }

  const confirm = async () => {
    if (!data || busy) return
    setBusy(true)
    setError(null)
    try {
      const info: ImportInfo = { ...(data.imageNote && { imageNote: data.imageNote }) }
      if (data.content) {
        try {
          const live = data.content.applyOver === 'live' ? (await contentApi.live()).patch : null
          info.tied = await createTiedDraft(data.content, live, contentApi)
        } catch (e) {
          info.tiedError = contentErrorText(e, t)
        }
      }
      if (mode === 'fill' && current) onImported({ draft: filledDraft(current, data), target: null, info })
      else {
        const target = choice === 'update' && clash?.kind === 'draft' ? clash.event : null
        const slug = choice === 'new' && clash && clash.kind !== 'free' ? newSlug : data.slug
        onImported({ draft: importedDraft(data, { target, slug }), target, info })
      }
      onOpenChange(false)
    } catch (e) {
      setError(t('adminJson.import.failed', { error: eventsErrorText(e) }))
    } finally {
      setBusy(false)
    }
  }

  const confirmLabel = mode === 'fill' ? t('adminJson.import.event.fill') : choice === 'update' && clash?.kind === 'draft' ? t('adminJson.import.event.update') : t('adminJson.import.event.create')
  const canConfirm = data !== null && !busy && slugError === null && !(choice === 'new' && clash && clash.kind !== 'free' && newSlug === '')

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t(mode === 'fill' ? 'adminJson.import.event.fillTitle' : 'adminJson.import.event.title')}
      description={t(mode === 'fill' ? 'adminJson.import.event.fillIntro' : 'adminJson.import.event.intro')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" icon="check" disabled={checking || text.trim() === ''} onClick={() => void check()}>
            {checking ? t('adminJson.import.checking') : t('adminJson.import.check')}
          </Button>
          <Button icon="plus" disabled={!canConfirm} onClick={() => void confirm()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <JsonSource
          value={text}
          onChange={(v) => {
            setText(v)
            setResult(null)
          }}
          onFile={(f) => void onFile(f)}
          disabled={busy}
        />
        {error && (
          <p className="text-cheek-400" role="alert">
            {error}
          </p>
        )}
        {result && <ImportIssues errors={result.errors} warnings={result.warnings} kind="event" />}
        {data && (
          <div className="flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well" aria-live="polite">
            <p className="font-display text-base text-leaf-400">{t('adminJson.import.valid')}</p>
            <p className="font-display text-lg break-words">{t('adminJson.import.event.summary', { name: i18n.language.startsWith('en') ? data.name.en : data.name.es, slug: data.slug })}</p>
            <p className="text-sm text-mist-300">{t('adminJson.import.event.dates', { from: formatEventWhen(data.startsAt, undefined, i18n.language), to: formatEventWhen(data.endsAt, undefined, i18n.language) })}</p>
            <p className="text-sm text-mist-300">
              {t('adminJson.import.event.counts', { featured: data.overlay.featured.length, drops: data.overlay.drops.length, missions: data.overlay.missions.length, items: Object.keys(data.overlay.items ?? {}).length })}
            </p>
            {data.imageNote && <p className="text-sm text-mist-300">{t('adminJson.import.event.imageNote', { note: data.imageNote })}</p>}
            {data.content && <p className="text-sm text-amber-400">{t('adminJson.import.event.tied', { title: data.content.title })}</p>}
            {result?.requiresConfirm && <p className="text-sm text-amber-400">{t('adminJson.import.confirmNote')}</p>}
            <p className="text-sm text-mist-400">{t('adminJson.import.smokeNote')}</p>
            <p className="text-sm text-mist-400">{t('adminJson.import.never')}</p>
          </div>
        )}
        {data && clash && clash.kind !== 'free' && (
          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 bg-dusk-800 p-3">
            <legend className="px-1 font-display text-base text-amber-400">
              {clash.kind === 'draft' ? t('adminJson.import.event.clashDraft', { slug: data.slug }) : t('adminJson.import.event.clashLocked', { slug: data.slug, status: t(`eventsAdmin.status.${clash.event.status}`).toLowerCase() })}
            </legend>
            {clash.kind === 'draft' && (
              <>
                <label className="flex items-start gap-2">
                  <input type="radio" name="slug-choice" checked={choice === 'update'} onChange={() => setChoice('update')} className="mt-1.5" />
                  <span>{t('adminJson.import.event.choiceUpdate')}</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="slug-choice" checked={choice === 'new'} onChange={() => setChoice('new')} className="mt-1.5" />
                  <span>{t('adminJson.import.event.choiceNew')}</span>
                </label>
              </>
            )}
            {choice === 'new' && <TextField label={t('adminJson.import.event.newSlug')} value={newSlug} maxLength={64} autoComplete="off" spellCheck={false} onChange={(e) => setNewSlug(e.target.value.toLowerCase())} error={slugError} />}
          </fieldset>
        )}
      </div>
    </Dialog>
  )
}
