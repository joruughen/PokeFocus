/**
 * Number controls generated from `limits.ts` bounds: a single field (label, input with unit, base value, change %,
 * ×3/×5 badge, reset), a list of numbers and a table of rows. Presentational: the editor owns the patch.
 */
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigLimit, ConfigListLimit, ConfigTableLimit, NumberBounds } from '../../../../game/content/limits'
import type { ContentIssue } from '../../../../game/protocol'
import { Button, IconButton } from '../../../components'
import { cx } from '../../../lib/cx'
import { bigChangeFactor, changePercent, displayBounds, fieldId, formatNumber, parseNumber, toDisplay, type NumberProblem } from './patch'

export interface FieldIssues {
  errors: ContentIssue[]
  warnings: ContentIssue[]
}

const unitOf = (b: NumberBounds): string | undefined => (b.kind === 'prob' ? '%' : b.unit)

interface NumberInputProps {
  id?: string
  /** Accessible name when there is no visible <label for>. */
  ariaLabel?: string
  labelledBy?: string
  describedBy?: string
  bounds: NumberBounds
  value: number
  onCommit: (value: number) => void
  invalid?: boolean
  disabled?: boolean
  className?: string
}

/**
 * A number input that keeps what is being typed: it only commits a value that parses inside the bounds and
 * shows the problem otherwise (the draft keeps the last good value). Follows outside changes (reset, undo).
 */
export function NumberInput({ id, ariaLabel, labelledBy, describedBy, bounds, value, onCommit, invalid, disabled, className }: NumberInputProps) {
  const { t } = useTranslation()
  const shown = String(toDisplay(bounds.kind, value))
  const [text, setText] = useState(shown)
  const [problem, setProblem] = useState<NumberProblem | null>(null)
  const { min, max, step } = displayBounds(bounds)
  const unit = unitOf(bounds)
  const msgId = useId()

  useEffect(() => {
    const p = parseNumber(text, bounds)
    if (!p.ok || p.value !== value) {
      setText(shown)
      setProblem(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow `value` only; `text` is what the user is typing
  }, [value])

  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode={bounds.kind === 'int' ? 'numeric' : 'decimal'}
          aria-label={ariaLabel}
          aria-labelledby={labelledBy}
          aria-invalid={problem || invalid ? true : undefined}
          aria-describedby={problem ? msgId : describedBy}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const next = e.target.value
            setText(next)
            const p = parseNumber(next, bounds)
            if (p.ok) {
              setProblem(null)
              if (p.value !== value) onCommit(p.value)
            } else setProblem(p.problem)
          }}
          className={cx(
            'min-h-10 w-full bg-dusk-900 px-2 text-right font-num text-lg text-mist-50 shadow-frame inset-shadow-well disabled:text-mist-400',
            unit && 'pr-9',
            (problem || invalid) && 'outline-2 -outline-offset-2 outline-cheek-400',
          )}
        />
        {unit && <span className="pointer-events-none absolute inset-y-0 right-2 grid place-items-center text-sm text-mist-400">{unit}</span>}
      </div>
      {problem && (
        <p id={msgId} role="alert" className="text-sm text-cheek-400">
          {t(`admin.content.number.${problem}`, { min, max })}
        </p>
      )}
    </div>
  )
}

function IssueLines({ issues, text }: { issues?: FieldIssues; text: (i: ContentIssue) => string }) {
  if (!issues || issues.errors.length + issues.warnings.length === 0) return null
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
      {issues.errors.map((e, i) => (
        <li key={`e${i}`} className="text-cheek-400">
          {text(e)}
        </li>
      ))}
      {issues.warnings.map((w, i) => (
        <li key={`w${i}`} className="text-amber-400">
          {text(w)}
        </li>
      ))}
    </ul>
  )
}

export interface ScalarFieldProps {
  limit: ConfigLimit
  label: string
  base: number
  value: number
  overridden: boolean
  issues?: FieldIssues
  issueText: (i: ContentIssue) => string
  disabled?: boolean
  onChange: (value: number) => void
  onReset: () => void
}

/** One config number: label, input with its unit, base value, change vs base, ×3/×5 badge and a reset button. */
export function ScalarField({ limit, label, base, value, overridden, issues, issueText, disabled, onChange, onReset }: ScalarFieldProps) {
  const { t, i18n } = useTranslation()
  const id = fieldId(`config.${limit.path}`)
  const pct = overridden ? changePercent(base, value) : null
  const factor = overridden ? bigChangeFactor(limit.kind, base, value) : null
  const baseText = `${formatNumber(limit.kind, base, i18n.language)}${limit.unit && limit.kind !== 'prob' ? ` ${limit.unit}` : ''}`
  const limitsText = t('admin.content.number.limits', { min: formatNumber(limit.kind, limit.min, i18n.language), max: formatNumber(limit.kind, limit.max, i18n.language) })
  return (
    <div className={cx('border-b border-dusk-700 py-2', overridden && 'bg-dusk-800/60')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label htmlFor={id} className="min-w-0 flex-1 basis-56 text-mist-100">
          {label}
          {limit.impact && <span className="ml-2 bg-amber-400 px-1 pt-0.5 font-display text-xs leading-tight text-ink uppercase">{t(`admin.content.impact.${limit.impact}`)}</span>}
        </label>
        <NumberInput id={id} describedBy={`${id}-info`} bounds={limit} value={value} onCommit={onChange} invalid={(issues?.errors.length ?? 0) > 0} disabled={disabled} className="w-36" />
        <p id={`${id}-info`} className="flex min-w-40 flex-wrap items-center gap-x-2 text-sm text-mist-400">
          <span title={limitsText}>{t('admin.content.base', { value: baseText })}</span>
          {pct !== null && (
            <span className={cx('font-num', pct > 0 ? 'text-leaf-400' : 'text-exp-400')}>
              {pct > 0 ? '+' : '−'}
              {new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(Math.abs(pct))}%
            </span>
          )}
          {factor !== null && <span className="bg-cheek-500 px-1 pt-0.5 font-display text-xs leading-tight text-mist-50">{t('admin.content.bigChange', { factor })}</span>}
        </p>
        <IconButton icon="reroll" size="sm" variant="ghost" label={t('admin.content.reset', { name: label })} disabled={!overridden || disabled} onClick={onReset} />
      </div>
      <IssueLines issues={issues} text={issueText} />
    </div>
  )
}

export interface ListFieldProps {
  limit: ConfigListLimit
  label: string
  base: number[]
  value: number[]
  overridden: boolean
  issues?: FieldIssues
  issueText: (i: ContentIssue) => string
  disabled?: boolean
  onChange: (value: number[]) => void
  onReset: () => void
}

/** A list of numbers (one per tier): inputs in a row, add/remove within `minItems..maxItems`. */
export function ListField({ limit, label, base, value, overridden, issues, issueText, disabled, onChange, onReset }: ListFieldProps) {
  const { t, i18n } = useTranslation()
  const id = fieldId(`config.${limit.path}`)
  const set = (i: number, v: number) => onChange(value.map((x, j) => (j === i ? v : x)))
  return (
    <div id={id} className={cx('border-b border-dusk-700 py-2', overridden && 'bg-dusk-800/60')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-label`} className="text-mist-100">
          {label}
        </p>
        <IconButton icon="reroll" size="sm" variant="ghost" label={t('admin.content.reset', { name: label })} disabled={!overridden || disabled} onClick={onReset} />
      </div>
      <ol className="mt-1 flex flex-wrap items-start gap-2" aria-labelledby={`${id}-label`}>
        {value.map((v, i) => (
          <li key={i} className="flex items-start gap-1">
            <NumberInput ariaLabel={`${label} #${i + 1}`} bounds={limit.item} value={v} onCommit={(n) => set(i, n)} disabled={disabled} className="w-28" />
            <IconButton
              icon="minus"
              size="sm"
              variant="ghost"
              label={t('admin.content.removeRow', { n: i + 1 })}
              disabled={disabled || value.length <= limit.minItems}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            />
          </li>
        ))}
        <li>
          <Button size="sm" variant="secondary" icon="plus" disabled={disabled || value.length >= limit.maxItems} onClick={() => onChange([...value, value.at(-1) ?? limit.item.min])}>
            {t('admin.content.addRow')}
          </Button>
        </li>
      </ol>
      <p className="mt-1 text-sm text-mist-400">{t('admin.content.base', { value: `[${base.map((x) => formatNumber(limit.item.kind, x, i18n.language)).join(', ')}]` })}</p>
      <IssueLines issues={issues} text={issueText} />
    </div>
  )
}

export interface TableFieldProps {
  limit: ConfigTableLimit
  label: string
  base: Record<string, number>[]
  value: Record<string, number>[]
  overridden: boolean
  issues?: FieldIssues
  issueText: (i: ContentIssue) => string
  disabled?: boolean
  onChange: (value: Record<string, number>[]) => void
  onReset: () => void
}

/** A table of rows with numeric columns (the whole table is replaced, like every array in the patch). */
export function TableField({ limit, label, base, value, overridden, issues, issueText, disabled, onChange, onReset }: TableFieldProps) {
  const { t } = useTranslation()
  const id = fieldId(`config.${limit.path}`)
  const cols = Object.keys(limit.columns)
  const set = (i: number, col: string, v: number) => onChange(value.map((r, j) => (j === i ? { ...r, [col]: v } : r)))
  const blank = () => Object.fromEntries(cols.map((c) => [c, value.at(-1)?.[c] ?? limit.columns[c]!.min]))
  return (
    <div id={id} className={cx('border-b border-dusk-700 py-2', overridden && 'bg-dusk-800/60')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-label`} className="text-mist-100">
          {label}
          {limit.impact && <span className="ml-2 bg-amber-400 px-1 pt-0.5 font-display text-xs leading-tight text-ink uppercase">{t(`admin.content.impact.${limit.impact}`)}</span>}
        </p>
        <IconButton icon="reroll" size="sm" variant="ghost" label={t('admin.content.reset', { name: label })} disabled={!overridden || disabled} onClick={onReset} />
      </div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-72 border-separate border-spacing-y-1 text-left" aria-labelledby={`${id}-label`}>
          <thead>
            <tr className="text-sm text-mist-400">
              <th scope="col" className="w-8 font-normal">
                #
              </th>
              {cols.map((c) => (
                <th key={c} scope="col" className="font-normal">
                  {t(`admin.content.columns.${c}`)}
                </th>
              ))}
              <th scope="col" className="w-10">
                <span className="sr-only">{t('admin.content.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i}>
                <td className="font-num text-mist-400">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} className="pr-2">
                    <NumberInput ariaLabel={`${label} #${i + 1} · ${t(`admin.content.columns.${c}`)}`} bounds={limit.columns[c]!} value={row[c] ?? 0} onCommit={(n) => set(i, c, n)} disabled={disabled} />
                  </td>
                ))}
                <td>
                  <IconButton
                    icon="minus"
                    size="sm"
                    variant="ghost"
                    label={t('admin.content.removeRow', { n: i + 1 })}
                    disabled={disabled || value.length <= limit.minItems}
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" icon="plus" disabled={disabled || value.length >= limit.maxItems} onClick={() => onChange([...value, blank()])}>
          {t('admin.content.addRow')}
        </Button>
        <p className="text-sm text-mist-400">{t('admin.content.baseRows', { count: base.length })}</p>
      </div>
      <IssueLines issues={issues} text={issueText} />
    </div>
  )
}
