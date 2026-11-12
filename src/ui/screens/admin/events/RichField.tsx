import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DATA_LIMITS } from '../../../../game/content/limits'
import { richPlainLength, RICH_COLORS, RICH_RAW_FACTOR, wrapSelection, type RichColor } from '../../../../game/richText'
import { RichText, RICH_TEXT_CLASS } from '../../../components'
import { cx } from '../../../lib/cx'

/** Visible characters allowed in a description. */
const RICH_VISIBLE_MAX = DATA_LIMITS.longText

const BTN = 'inline-flex min-h-9 min-w-9 items-center justify-center gap-1 bg-dusk-700 px-2 text-sm text-mist-100 shadow-frame hover:bg-dusk-600 focus-visible:outline-2 focus-visible:outline-volt-400 disabled:opacity-50'

export interface RichFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  disabled?: boolean
  className?: string
}

/**
 * A description in the rich mini-format: a format bar (bold, italic, the seven colours; each wraps the selection),
 * the text area, a counter of VISIBLE characters and a live preview exactly as players read it.
 */
export function RichField({ label, value, onChange, error, disabled, className }: RichFieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const visible = richPlainLength(value)
  const over = visible > RICH_VISIBLE_MAX
  const rawMax = RICH_VISIBLE_MAX * RICH_RAW_FACTOR

  const wrap = (kind: 'bold' | 'italic' | RichColor) => {
    const el = area.current
    if (!el || disabled) return
    const r = wrapSelection(value, el.selectionStart, el.selectionEnd, kind)
    onChange(r.value)
    // The textarea is controlled: restore the selection once React has written the new value.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(r.start, r.end)
    })
  }

  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="font-display text-base text-mist-300">
        {label}
      </label>
      <div role="toolbar" aria-label={`${t('eventsAdmin.format.label')}: ${label}`} className="flex flex-wrap gap-1.5">
        <button type="button" className={cx(BTN, 'font-bold')} disabled={disabled} onClick={() => wrap('bold')} title={t('eventsAdmin.format.bold')} aria-label={t('eventsAdmin.format.bold')}>
          B
        </button>
        <button type="button" className={cx(BTN, 'italic')} disabled={disabled} onClick={() => wrap('italic')} title={t('eventsAdmin.format.italic')} aria-label={t('eventsAdmin.format.italic')}>
          I
        </button>
        {RICH_COLORS.map((c) => (
          <button key={c} type="button" className={cx(BTN, RICH_TEXT_CLASS[c])} disabled={disabled} onClick={() => wrap(c)} title={t(`eventsAdmin.format.colors.${c}`)} aria-label={t(`eventsAdmin.format.colors.${c}`)}>
            <span aria-hidden="true" className="size-3 bg-current" />
            <span className="max-sm:sr-only">{t(`eventsAdmin.format.colors.${c}`)}</span>
          </button>
        ))}
      </div>
      <textarea
        id={id}
        ref={area}
        rows={5}
        value={value}
        maxLength={rawMax}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error || over ? true : undefined}
        aria-describedby={`${id}-msg`}
        className={cx('min-h-28 w-full bg-dusk-900 px-3 py-2 text-lg text-mist-50 shadow-frame inset-shadow-well placeholder:text-mist-400 disabled:text-mist-400', (error || over) && 'outline-2 -outline-offset-2 outline-cheek-400')}
      />
      <p id={`${id}-msg`} className={cx('text-sm', error || over ? 'text-cheek-400' : 'text-mist-400')}>
        {error ?? t('eventsAdmin.format.count', { n: visible, max: RICH_VISIBLE_MAX })}
      </p>
      <div className="flex flex-col gap-1">
        <p className="font-display text-sm text-mist-400">{t('eventsAdmin.format.preview')}</p>
        <div className="min-h-12 bg-dusk-800 p-3 shadow-frame" aria-live="off">
          {value.trim() === '' ? <p className="text-mist-400">{t('eventsAdmin.format.previewEmpty')}</p> : <RichText text={value} className="text-mist-100" />}
        </div>
      </div>
    </div>
  )
}
