import { useTranslation } from 'react-i18next'
import type { AdminContentDiffEntry, AdminContentValidation, ContentIssue } from '../../../../game/protocol'
import { Button } from '../../../components'
import { cx } from '../../../lib/cx'
import { asLocale } from '../../../lib/names'
import { issueText, pathLabel, valueText } from './describe'
import type { IssueSet } from './live'

/** The ×3 / ×5 factor of a big-change issue, when it is one. */
export const factorOf = (i: ContentIssue): number | null => (i.code === 'big_change' && typeof i.params?.factor === 'number' ? i.params.factor : null)

export interface IssueListProps {
  errors: ContentIssue[]
  warnings: ContentIssue[]
  /** «Go to the field»; omit for a read-only list. */
  onGoto?: (path: string) => void
}

/** Errors (block publishing) and warnings (`requiresConfirm` ones need the tick), each with a link to its field. */
export function IssueList({ errors, warnings, onGoto }: IssueListProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const row = (i: ContentIssue, kind: 'error' | 'warning', n: number) => {
    const factor = factorOf(i)
    return (
      <li key={`${kind}${n}`} className={cx('flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-dusk-900 p-2 inset-shadow-well', kind === 'error' ? 'border-l-4 border-cheek-500' : 'border-l-4 border-amber-400')}>
        <span className={cx('px-1.5 pt-0.5 font-display text-xs leading-tight uppercase', kind === 'error' ? 'bg-cheek-500 text-mist-50' : 'bg-amber-400 text-ink')}>{t(kind === 'error' ? 'admin.content.issues.error' : 'admin.content.issues.warning')}</span>
        {factor !== null && <span className="bg-cheek-500 px-1.5 pt-0.5 font-display text-xs leading-tight text-mist-50">{t('admin.content.bigChange', { factor })}</span>}
        <span className="min-w-0 flex-1 basis-60 break-words text-mist-100">
          {i.path && <span className="mr-2 text-mist-300">{pathLabel(i.path, t, lng)}:</span>}
          {issueText(i, t)}
        </span>
        {onGoto && i.path && (
          <Button size="sm" variant="ghost" onClick={() => onGoto(i.path)}>
            {t('admin.content.issues.goto')}
          </Button>
        )}
      </li>
    )
  }
  if (errors.length + warnings.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {errors.map((e, n) => row(e, 'error', n))}
      {warnings.map((w, n) => row(w, 'warning', n))}
    </ul>
  )
}

export interface DiffListProps {
  diff: AdminContentDiffEntry[]
  /** Dim the list (the draft has unsaved edits the diff does not include yet). */
  stale?: boolean
}

/** What the draft changes against the live content, in words: «Shiny chance  1% → 2%». */
export function DiffList({ diff, stale }: DiffListProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  if (diff.length === 0) return <p className="text-mist-300">{t('admin.content.diff.empty')}</p>
  return (
    <div className={cx('overflow-x-auto', stale && 'opacity-60')}>
      <table className="w-full min-w-[32rem] border-separate border-spacing-y-1 text-left">
        <caption className="sr-only">{t('admin.content.diff.title')}</caption>
        <thead>
          <tr className="text-sm text-mist-400">
            <th scope="col" className="font-normal">
              {t('admin.content.diff.what')}
            </th>
            <th scope="col" className="font-normal">
              {t('admin.content.diff.before')}
            </th>
            <th scope="col" className="font-normal">
              {t('admin.content.diff.after')}
            </th>
          </tr>
        </thead>
        <tbody>
          {diff.map((d) => (
            <tr key={d.path} className="bg-dusk-900">
              <td className="p-2">
                <p className="text-mist-50">{pathLabel(d.path, t, lng)}</p>
                <p className="font-mono text-xs text-mist-400">{d.path}</p>
              </td>
              <td className="p-2 font-num text-mist-300 line-through decoration-cheek-500/60">{valueText(d.path, d.before, t, i18n.language)}</td>
              <td className="p-2 font-num text-leaf-400">{valueText(d.path, d.after, t, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export interface ValidationSummaryProps {
  validation: AdminContentValidation | null
  /** The patch was edited after this validation ran. */
  stale: boolean
}

/** Result line of the full validation (with the engine smoke test). */
export function ValidationSummary({ validation, stale }: ValidationSummaryProps) {
  const { t, i18n } = useTranslation()
  if (!validation) return <p className="text-mist-300">{t('admin.content.review.notValidated')}</p>
  const when = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'medium' }).format(validation.at)
  return (
    <p role="status" className={cx('text-lg', validation.ok ? 'text-leaf-400' : 'text-cheek-400')}>
      {validation.ok ? t(validation.smoke ? 'admin.content.review.okSmoke' : 'admin.content.review.okLive') : t('admin.content.review.failed', { count: validation.errors.length })}
      <span className="ml-3 text-sm text-mist-400">
        {t('admin.content.review.at', { time: when })}
        {stale ? ` · ${t('admin.content.review.stale')}` : ''}
      </span>
    </p>
  )
}

export function issuesToSet(v: AdminContentValidation): IssueSet {
  return { errors: v.errors, warnings: v.warnings, requiresConfirm: v.requiresConfirm }
}
