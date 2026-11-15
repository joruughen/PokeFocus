import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApplyOver, ContentImportData, ImportResult } from '../../../../game/content'
import type { AdminContentLiveResponse, AdminContentVersionResponse } from '../../../../game/protocol'
import { Button, Dialog, Select, toast } from '../../../components'
import { contentApi } from '../content/api'
import { contentErrorText } from '../content/errors'
import { createContentDraft, loadAdminJson, readFileText } from './logic'
import { ImportIssues, JsonSource } from './parts'

export interface ContentImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is live now (the patch the JSON merges over, and the reference of the big-change guard). */
  live: AdminContentLiveResponse | null
  /** The new draft. */
  onCreated: (r: AdminContentVersionResponse) => void
}

/**
 * «Importar JSON» of content: paste or upload, check with the server's rules (as the draft will be saved:
 * merged over what is live when asked), and only when valid create a new DRAFT with the patch. Never publishes.
 */
export function ContentImportDialog({ open, onOpenChange, live, onCreated }: ContentImportDialogProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<ImportResult<ContentImportData> | null>(null)
  const [over, setOver] = useState<ApplyOver>('live')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setText('')
    setResult(null)
    setError(null)
  }, [open])

  const data = result?.ok ? (result.value ?? null) : null

  /** `override`: the admin changed where it applies, so the same JSON is checked again. */
  const check = async (source = text, override?: ApplyOver) => {
    setChecking(true)
    setError(null)
    try {
      const m = await loadAdminJson()
      const parsed = m.parseJsonText(source)
      if (!parsed.ok) {
        setResult({ ok: false, errors: [parsed.issue], warnings: [], requiresConfirm: false })
        return
      }
      const doc = override && typeof parsed.value === 'object' && parsed.value !== null ? { ...parsed.value, applyOver: override } : parsed.value
      const r = m.validateContentImport(doc, { smoke: false, live: live?.patch ?? null })
      setResult(r)
      if (r.value) setOver(r.value.applyOver)
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

  const create = async () => {
    if (!data || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await createContentDraft({ ...data, applyOver: over }, live?.patch ?? null, contentApi)
      toast.add({ title: t('adminJson.import.content.created', { title: data.title }), type: 'success' })
      onOpenChange(false)
      onCreated(res)
    } catch (e) {
      setError(t('adminJson.import.failed', { error: contentErrorText(e, t) }))
    } finally {
      setBusy(false)
    }
  }

  const sections = data ? Object.keys(data.patch) : []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('adminJson.import.content.title')}
      description={t('adminJson.import.content.intro')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" icon="check" disabled={checking || text.trim() === ''} onClick={() => void check()}>
            {checking ? t('adminJson.import.checking') : t('adminJson.import.check')}
          </Button>
          <Button icon="plus" disabled={data === null || busy} onClick={() => void create()}>
            {t('adminJson.import.content.create')}
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
        {result && <ImportIssues errors={result.errors} warnings={result.warnings} kind="content" />}
        {data && (
          <div className="flex flex-col gap-3 bg-dusk-900 p-3 inset-shadow-well" aria-live="polite">
            <p className="font-display text-base text-leaf-400">{t('adminJson.import.valid')}</p>
            <p className="font-display text-lg break-words">{t('adminJson.import.content.summary', { title: data.title })}</p>
            <p className="text-sm text-mist-300">{sections.length > 0 ? t('adminJson.import.content.sections', { sections: sections.join(', ') }) : t('adminJson.import.content.empty')}</p>
            <Select
              label={t('adminJson.import.content.over')}
              value={over}
              onChange={(v) => {
                const next: ApplyOver = v === 'base' ? 'base' : 'live'
                setOver(next)
                void check(text, next)
              }}
              options={[
                { value: 'live', label: t('adminJson.import.content.overLive') },
                { value: 'base', label: t('adminJson.import.content.overBase') },
              ]}
            />
            {result?.requiresConfirm && <p className="text-sm text-amber-400">{t('adminJson.import.confirmNote')}</p>}
            <p className="text-sm text-mist-400">{t('adminJson.import.smokeNote')}</p>
            <p className="text-sm text-mist-400">{t('adminJson.import.never')}</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
