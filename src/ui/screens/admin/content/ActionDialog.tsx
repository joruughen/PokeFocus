import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminContentVersion, ContentIssue } from '../../../../game/protocol'
import { Button, Dialog, TextField } from '../../../components'
import { errorText } from '../../../lib/errors'
import { contentApi } from './api'
import { reauthThen, type Outcome } from './flow'
import { IssueList, factorOf } from './ReviewPanel'

export interface ActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel: string
  /** Warnings known beforehand that need the «I confirm» tick (×3 / ×5 changes). */
  warnings: ContentIssue[]
  /** Extra checks of the caller (a valid schedule time…). */
  canSubmit?: boolean
  /** Runs before the request (save the draft); false aborts. */
  prepare?: () => Promise<boolean>
  /** The request. The dialog handles the sudo password, the confirm tick and the 422 errors around it. */
  run: (confirm: boolean) => Promise<Outcome<AdminContentVersion>>
  onDone: (version: AdminContentVersion) => void
  /** Body fields of the caller (schedule, note). */
  children?: ReactNode
}

function errorLine(o: Extract<Outcome<unknown>, { kind: 'error' }>, t: (k: string, v?: Record<string, unknown>) => string): string {
  if (o.code === 'wrong_password') return t('admin.content.action.wrongPassword')
  if (o.code === 'rate_limited' || o.retryAfter !== null) return t('admin.content.action.rateLimited', { count: Math.max(1, Math.ceil((o.retryAfter ?? 60) / 60)) })
  if (['not_draft', 'not_published', 'not_scheduled', 'invalid_effective_at', 'too_many_drafts'].includes(o.code)) return t(`admin.content.errors.${o.code}`)
  return errorText(o.code)
}

/**
 * The common shell of the sudo-protected content actions (publish, schedule, rollback): it asks for the password
 * when the session is not elevated (known from /admin/me up front, or from a 403 `elevation_required`), makes the
 * admin tick «I confirm» for ×3 / ×5 changes, and shows the 422 validation errors the server answers with.
 */
export function ActionDialog({ open, onOpenChange, title, description, confirmLabel, warnings, canSubmit = true, prepare, run, onDone, children }: ActionDialogProps) {
  const { t } = useTranslation()
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [serverWarnings, setServerWarnings] = useState<ContentIssue[]>([])
  const [serverErrors, setServerErrors] = useState<ContentIssue[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Fresh state every time the dialog opens; ask the server whether sudo is already on.
  useEffect(() => {
    if (!open) return
    setPassword('')
    setConfirmed(false)
    setServerWarnings([])
    setServerErrors([])
    setMessage(null)
    let live = true
    contentApi
      .me()
      .then((me) => live && setNeedsPassword(!me.elevated))
      .catch(() => live && setNeedsPassword(false))
    return () => {
      live = false
    }
  }, [open])

  const gate = [...warnings.filter((w) => w.requiresConfirm), ...serverWarnings.filter((w) => !warnings.some((k) => k.path === w.path && k.code === w.code))]
  const needsConfirm = gate.length > 0
  const ready = canSubmit && (!needsConfirm || confirmed) && (!needsPassword || password.length > 0) && !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setMessage(null)
    setServerErrors([])
    try {
      if (prepare && !(await prepare())) {
        setMessage(t('admin.content.action.saveFailed'))
        return
      }
      const attempt = () => run(needsConfirm && confirmed)
      const o = needsPassword ? await reauthThen(password, attempt) : await attempt()
      switch (o.kind) {
        case 'ok':
          onOpenChange(false)
          onDone(o.value)
          break
        case 'elevation':
          setNeedsPassword(true)
          setMessage(t('admin.content.action.elevation'))
          break
        case 'confirm':
          setServerWarnings(o.warnings)
          setMessage(t('admin.content.action.confirmNeeded'))
          break
        case 'invalid':
          setServerErrors(o.errors)
          setServerWarnings(o.warnings.filter((w) => w.requiresConfirm))
          setMessage(t('admin.content.action.invalid', { count: o.errors.length }))
          break
        case 'error':
          setMessage(errorLine(o, t))
          if (o.code === 'wrong_password') setPassword('')
          break
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="content-action-form" icon="check" disabled={!ready}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="content-action-form" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {children}
        {needsConfirm && (
          <div className="flex flex-col gap-3 bg-dusk-900 p-3 inset-shadow-well">
            <p className="text-amber-400">{t('admin.content.action.bigChanges', { count: gate.length })}</p>
            <IssueList errors={[]} warnings={gate} />
            <label className="flex items-start gap-3 text-mist-50">
              <input type="checkbox" className="mt-1 size-5 accent-volt-400" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{t('admin.content.action.confirmTick', { factors: [...new Set(gate.map(factorOf).filter((f): f is number => f !== null))].map((f) => `×${f}`).join(' / ') || '×3' })}</span>
            </label>
          </div>
        )}
        {serverErrors.length > 0 && <IssueList errors={serverErrors} warnings={[]} />}
        {needsPassword && (
          <TextField
            label={t('admin.content.action.password')}
            hint={t('admin.content.action.passwordHint')}
            type="password"
            revealable
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <p className="min-h-5 text-sm text-cheek-400" role="alert">
          {message}
        </p>
      </form>
    </Dialog>
  )
}
