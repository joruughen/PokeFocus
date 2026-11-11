import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, TextField } from '../../../components'
import { issueText, type IssueLike } from './errors'

/** What the dialog is asking permission for. `schedule` = publish with a start in the future. */
export type SudoMode = 'publish' | 'schedule' | 'save' | 'archive'

export interface SudoSubmit {
  password: string
  /** The admin ticked «I confirm» for the big-change warnings (×3 / ×5). */
  confirm: boolean
  note: string
}

export interface SudoFormProps {
  mode: SudoMode
  eventName: string
  /** The session already has the sudo mode (30 min after a password check). */
  elevated: boolean
  /** Warnings that need an explicit confirmation before it goes live. */
  risky: readonly IssueLike[]
  busy: boolean
  error: string | null
  onSubmit: (v: SudoSubmit) => void
  onCancel: () => void
}

/**
 * The confirmation of a sensitive event action (docs/admin-plan.md §4): the password again when the sudo mode
 * has run out, a note for the audit log, and, for changes beyond ×3 (probabilities ×5), an explicit «I confirm».
 */
export function SudoForm({ mode, eventName, elevated, risky, busy, error, onSubmit, onCancel }: SudoFormProps) {
  const { t } = useTranslation()
  const id = useId()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  // Archiving takes the event out of play: the ×3 / ×5 checks of its numbers do not apply.
  const needsConfirm = mode !== 'archive' && risky.length > 0
  const ready = (elevated || password !== '') && (!needsConfirm || confirm)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    // The dialog is rendered inside the editor's own <form>: React bubbles submit through portals and would also save the draft.
    e.stopPropagation()
    if (ready && !busy) onSubmit({ password, confirm, note: note.trim() })
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <p className="text-mist-300">{t(`eventsAdmin.sudo.body.${mode}`, { name: eventName })}</p>
      {needsConfirm && (
        <div className="flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well" role="group" aria-labelledby={`${id}-risky`}>
          <p id={`${id}-risky`} className="font-display text-base text-amber-400">
            {t('eventsAdmin.sudo.riskyTitle')}
          </p>
          <ul className="list-disc pl-5 text-sm break-words text-mist-100">
            {risky.map((w, i) => (
              <li key={`${w.path}-${i}`}>
                <code className="font-mono text-xs text-mist-300">{w.path}</code> {issueText(w)}
              </li>
            ))}
          </ul>
          <label className="mt-1 flex min-h-11 items-start gap-3">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 size-5 shrink-0 accent-volt-400" />
            <span>{t('eventsAdmin.sudo.confirm')}</span>
          </label>
        </div>
      )}
      {!elevated && (
        <TextField
          label={t('eventsAdmin.sudo.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          revealable
          autoComplete="current-password"
          hint={t('eventsAdmin.sudo.passwordHint')}
        />
      )}
      <TextField label={t('eventsAdmin.sudo.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} hint={t('eventsAdmin.sudo.noteHint')} />
      <p className="min-h-5 text-sm break-words text-cheek-400" role="alert">
        {error}
      </p>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant={mode === 'publish' || mode === 'schedule' || mode === 'save' ? 'primary' : 'danger'} disabled={!ready || busy}>
          {t(`eventsAdmin.sudo.submit.${mode}`)}
        </Button>
      </div>
    </form>
  )
}

export interface SudoDialogProps extends Omit<SudoFormProps, 'onCancel'> {
  open: boolean
  onClose: () => void
}

/** `SudoForm` in a modal. The form is unmounted when it closes, so a password never lingers. */
export function SudoDialog({ open, onClose, ...form }: SudoDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t(`eventsAdmin.sudo.title.${form.mode}`)} size="md">
      {open && <SudoForm {...form} onCancel={onClose} />}
    </Dialog>
  )
}
