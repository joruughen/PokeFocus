/** Pieces shared by the JSON import and export dialogs: the text source, the issue list and the «imported» notice. */
import i18n from 'i18next'
import { useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ValidationIssue } from '../../../../game/content'
import { Button, Panel } from '../../../components'
import { cx } from '../../../lib/cx'
import { useAdminNav } from '../nav'
import type { ImportInfo } from './logic'

const NS = {
  event: ['adminJson.issues', 'eventsAdmin.issues', 'admin.content.issues'],
  content: ['adminJson.issues', 'admin.content.issues', 'eventsAdmin.issues'],
} as const

/** An issue as a sentence in the interface language (the first namespace that knows its code; else the English message). */
export function importIssueText(i: ValidationIssue, kind: 'event' | 'content'): string {
  for (const ns of NS[kind]) {
    const key = `${ns}.${i.code}`
    if (i18n.exists(key)) return i18n.t(key, { ...i.params, path: i.path })
  }
  return i.message
}

/** Errors and warnings of an import check, each with its path inside the JSON. */
export function ImportIssues({ errors, warnings, kind }: { errors: readonly ValidationIssue[]; warnings: readonly ValidationIssue[]; kind: 'event' | 'content' }) {
  const { t } = useTranslation()
  const list = (items: readonly ValidationIssue[], tone: 'error' | 'warn') => (
    <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-sm">
      {items.map((i, n) => (
        <li key={`${i.path}-${i.code}-${n}`} className={cx('break-words', tone === 'error' ? 'text-mist-100' : 'text-mist-300')}>
          {i.path !== '' && <code className="mr-1.5 bg-dusk-900 px-1 text-mist-300">{i.path}</code>}
          {importIssueText(i, kind)}
          {i.requiresConfirm && <span className="ml-1.5 text-amber-400">×</span>}
        </li>
      ))}
    </ul>
  )
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {errors.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-display text-base text-cheek-400" role="alert">
            {t('adminJson.import.errors', { count: errors.length })}
          </p>
          {list(errors, 'error')}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-display text-base text-amber-400">{t('adminJson.import.warnings', { count: warnings.length })}</p>
          {list(warnings, 'warn')}
        </div>
      )}
    </div>
  )
}

/** The text area for the JSON plus the «upload a file» button. */
export function JsonSource({ value, onChange, onFile, disabled }: { value: string; onChange: (v: string) => void; onFile: (file: File) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-display text-base text-mist-300">
        {t('adminJson.import.textLabel')}
      </label>
      <textarea
        id={id}
        rows={10}
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="min-h-48 w-full bg-dusk-900 px-3 py-2 font-num text-sm text-mist-50 shadow-frame inset-shadow-well placeholder:text-mist-400 disabled:text-mist-400"
        placeholder='{ "format": "pokefocus.event@1", … }'
      />
      <p className="text-sm text-mist-400">{t('adminJson.import.textHint')}</p>
      <input
        ref={input}
        type="file"
        accept=".json,application/json,text/plain"
        hidden
        data-testid="json-file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(f)
        }}
      />
      <Button variant="secondary" size="sm" icon="plus" className="self-start" disabled={disabled} onClick={() => input.current?.click()}>
        {t('adminJson.import.file')}
      </Button>
    </div>
  )
}

/** What an import did and what is left to do, at the top of the event editor (nothing was published). */
export function ImportNotice({ info, onDismiss }: { info: ImportInfo; onDismiss: () => void }) {
  const { t } = useTranslation()
  const lines: ReactNode[] = [t('adminJson.notice.body')]
  lines.push(info.imageNote ? t('adminJson.notice.imageNote', { note: info.imageNote }) : t('adminJson.notice.noImage'))
  if (info.tied) lines.push(t('adminJson.notice.tied', { title: info.tied.title, id: info.tied.id }))
  if (info.tied?.revertWhenEnds) lines.push(t('adminJson.notice.tiedRevert'))
  if (info.tiedError) lines.push(t('adminJson.notice.tiedFailed', { error: info.tiedError }))
  return (
    <Panel variant="frame" title={t('adminJson.notice.title')} headingLevel={3}>
      <div className="flex flex-col gap-2" role="status">
        {lines.map((l, i) => (
          <p key={i} className="break-words text-mist-100">
            {l}
          </p>
        ))}
        <div className="mt-1 flex flex-wrap gap-3">
          {info.tied && (
            <Button size="sm" variant="secondary" onClick={() => useAdminNav.getState().openContentVersion(info.tied!.id)}>
              {t('adminJson.notice.openContent')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            {t('adminJson.notice.dismiss')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
