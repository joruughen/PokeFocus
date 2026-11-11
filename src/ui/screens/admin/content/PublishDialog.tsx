import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminContentVersion, ContentIssue } from '../../../../game/protocol'
import { Segmented, TextField, toast } from '../../../components'
import { browserTimeZone } from '../../../lib/format'
import { toLocalInput } from '../../../lib/maintenance'
import { ActionDialog } from './ActionDialog'
import { contentApi } from './api'
import { checkSchedule, publishDraft, publishInput, rollbackTo, unscheduleVersion } from './flow'

const NOTE_MAX = 400
const HOUR = 3_600_000

export interface PublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftId: number
  changes: number
  /** Save the draft first (autosave may still be pending). */
  flush: () => Promise<boolean>
  /** Warnings that need the tick, from the latest validation. */
  warnings: ContentIssue[]
  /** Warnings that apply at once to existing data (league week, owned Pokémon). */
  liveWarnings: ContentIssue[]
  onDone: (v: AdminContentVersion) => void
}

/** «Publish now» or «Schedule»: the time in the admin's zone and in UTC, a note, the ×3/×5 tick and the sudo password. */
export function PublishDialog({ open, onOpenChange, draftId, changes, flush, warnings, liveWarnings, onDone }: PublishDialogProps) {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<'now' | 'later'>('now')
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')
  const now = Date.now()

  // «Mandatory» simulation (E10) is a warning, not a block: ask the server whether the saved patch was simulated recently.
  const [simRecent, setSimRecent] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('now')
    setWhen(toLocalInput(Math.ceil((Date.now() + HOUR) / HOUR) * HOUR))
    setNote('')
    setSimRecent(null)
    let live = true
    void flush()
      .then(() => contentApi.version(draftId))
      .then((r) => live && setSimRecent(r.sim ? r.sim.recent : null))
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open])

  const schedule = useMemo(() => (mode === 'later' ? checkSchedule(when, now) : null), [mode, when, now])
  const at = schedule && schedule.ok ? schedule.at : null
  const utc = at !== null ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(at) : null

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.content.publish.title')}
      description={t('admin.content.publish.body', { count: changes })}
      confirmLabel={t(mode === 'now' ? 'admin.content.publish.now' : 'admin.content.publish.schedule')}
      warnings={warnings}
      canSubmit={mode === 'now' || at !== null}
      prepare={flush}
      run={(confirm) => publishDraft(draftId, publishInput(mode === 'later' && at !== null ? { mode: 'later', at } : { mode: 'now' }, confirm, note))}
      onDone={(v) => {
        toast.add({ title: t(v.scheduled ? 'admin.content.publish.scheduledDone' : 'admin.content.publish.done', { id: v.id }), type: 'success' })
        onDone(v)
      }}
    >
      <Segmented
        label={t('admin.content.publish.when')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'now', label: t('admin.content.publish.optNow') },
          { value: 'later', label: t('admin.content.publish.optLater') },
        ]}
      />
      {mode === 'later' && (
        <div className="flex flex-col gap-1">
          <TextField
            label={t('admin.content.publish.at')}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            error={schedule && !schedule.ok ? t(`admin.content.publish.problem.${schedule.problem}`) : null}
            hint={t('admin.content.publish.zone', { zone: browserTimeZone() })}
            required
          />
          {utc && <p className="text-sm text-mist-300">{t('admin.content.publish.utc', { utc })}</p>}
        </div>
      )}
      {simRecent === false && (
        <p role="note" className="bg-dusk-900 p-3 text-sm text-amber-400 inset-shadow-well">
          {t('admin.content.publish.noSim')}
        </p>
      )}
      {liveWarnings.length > 0 && (
        <div className="bg-dusk-900 p-3 inset-shadow-well">
          <p className="font-display text-base text-amber-400">{t('admin.content.publish.liveImpact')}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-mist-300">
            {[...new Set(liveWarnings.map((w) => w.code))].map((code) => (
              <li key={code}>{t(`admin.content.publish.impact.${code}`, { defaultValue: code })}</li>
            ))}
          </ul>
        </div>
      )}
      <TextField label={t('admin.content.publish.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} hint={t('admin.content.publish.noteHint')} />
    </ActionDialog>
  )
}

export interface UnscheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: number
  label: string
  onDone: (v: AdminContentVersion) => void
}

/** «Cancel the schedule»: the version goes back to a draft and never takes effect by itself. */
export function UnscheduleDialog({ open, onOpenChange, versionId, label, onDone }: UnscheduleDialogProps) {
  const { t } = useTranslation()
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.content.unschedule.title')}
      description={t('admin.content.unschedule.body', { name: label })}
      confirmLabel={t('admin.content.unschedule.confirm')}
      warnings={[]}
      run={() => unscheduleVersion(versionId)}
      onDone={(v) => {
        toast.add({ title: t('admin.content.unschedule.done', { id: v.id }), type: 'success' })
        onDone(v)
      }}
    />
  )
}

export interface RollbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: number
  label: string
  onDone: (v: AdminContentVersion) => void
}

/** «Republish this»: a new published version with an old patch, effective now. */
export function RollbackDialog({ open, onOpenChange, versionId, label, onDone }: RollbackDialogProps) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open) setNote('')
  }, [open])
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.content.rollback.title')}
      description={t('admin.content.rollback.body', { name: label })}
      confirmLabel={t('admin.content.rollback.confirm')}
      warnings={[]}
      run={(confirm) => rollbackTo(versionId, { ...(confirm && { confirm: true }), ...(note.trim() && { note: note.trim() }) })}
      onDone={(v) => {
        toast.add({ title: t('admin.content.rollback.done', { id: v.id }), type: 'success' })
        onDone(v)
      }}
    >
      <TextField label={t('admin.content.publish.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} hint={t('admin.content.publish.noteHint')} />
    </ActionDialog>
  )
}
