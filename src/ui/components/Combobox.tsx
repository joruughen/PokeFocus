import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'
import { exactOption, filterOptions, type Searchable } from './comboboxFilter'
import { PixelIcon } from './PixelIcon'

export interface ComboboxOption extends Searchable {
  /** Icon or sprite on the left (decorative: the label already names it). */
  icon?: ReactNode
  /** Smaller line under the label (number, other-language name, category). */
  secondary?: string
  /** Badges on the right (types, stage). */
  trailing?: ReactNode
}

export interface ComboboxProps {
  /** Visible label (Tiny5) above the input. */
  label: string
  options: readonly ComboboxOption[]
  /** The chosen option's `value`; with `freeText`, also whatever text was typed. */
  value: string
  onChange: (value: string) => void
  /** Accept text that is not in the list (the value becomes the text, through `normalize`). */
  freeText?: boolean
  /** Shapes typed free text before it becomes the value (e.g. trim + lower case for slugs). */
  normalize?: (text: string) => string
  placeholder?: string
  hint?: ReactNode
  error?: string | null
  disabled?: boolean
  /** Most rows listed at once (the rest are reached by typing more). */
  maxVisible?: number
  id?: string
  className?: string
}

const DEFAULT_MAX = 40

/**
 * Searchable select: a text input (same look as `TextField`) with a game-style
 * list under it that filters while typing (accents and case ignored; starts-with
 * first, then contains). Arrow keys move, Enter picks, Esc closes, Tab leaves;
 * rows are 44 px tall for touch. Picking a row gives its `value`. With `freeText`
 * the typed text is the value when it is not in the list; without it, text that
 * is not picked is dropped when the field loses focus. Built on Base UI Combobox
 * (ARIA combobox + listbox).
 */
export function Combobox({ label, options, value, onChange, freeText = false, normalize, placeholder, hint, error, disabled, maxVisible = DEFAULT_MAX, id, className }: ComboboxProps) {
  const { t } = useTranslation()
  const autoId = useId()
  const inputId = id ?? autoId
  const msgId = `${inputId}-msg`
  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value])
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  const [text, setText] = useState(() => labelOf(value))
  // What the person typed since the list opened (null: show everything).
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const focused = useRef(false)
  const emitted = useRef(value)

  // Closed, the field shows the chosen option's name (or the stored text), also after the value changes from outside.
  useEffect(() => {
    if (open) return
    if (freeText && focused.current && value === emitted.current) return
    emitted.current = value
    setText(labelOf(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelOf only closes over `options`
  }, [open, value, options, freeText])

  const ranked = useMemo(() => filterOptions(options, query ?? ''), [options, query])
  const shown = ranked.length > maxVisible ? ranked.slice(0, maxVisible) : ranked
  const hidden = ranked.length - shown.length

  const emit = (v: string) => {
    emitted.current = v
    if (v !== value) onChange(v)
  }

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="font-display text-base text-mist-300">
        {label}
      </label>
      <BaseCombobox.Root<ComboboxOption>
        items={shown}
        filter={null}
        value={selected}
        disabled={disabled}
        autoHighlight={!freeText}
        itemToStringLabel={(o) => o.label}
        isItemEqualToValue={(a, b) => a.value === b.value}
        inputValue={text}
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setQuery(null)
        }}
        onValueChange={(o) => {
          if (o) emit(o.value)
          else if (!freeText) emit('')
        }}
        onInputValueChange={(v, details) => {
          // Only typing and picking a row change the text; Base UI's own resets (on close, on a value change)
          // are ignored: the effect above decides what the closed field shows.
          if (details.reason === 'item-press') setText(v)
          if (details.reason !== 'input-change') return
          setText(v)
          setQuery(v)
          const hit = exactOption(options, v)
          if (hit) emit(hit.value)
          else if (freeText) emit(normalize ? normalize(v) : v)
          else if (v.trim() === '') emit('')
        }}
      >
        <div className="relative">
          <BaseCombobox.Input
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error || hint ? msgId : undefined}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            onFocus={() => {
              focused.current = true
            }}
            onBlur={() => {
              focused.current = false
              // Free text keeps what was typed; otherwise the field goes back to the chosen option's name.
              setText(labelOf(emitted.current))
            }}
            className={cx(
              'min-h-12 w-full bg-dusk-900 pr-12 pl-3 text-lg text-mist-50 shadow-frame inset-shadow-well placeholder:text-mist-400',
              'disabled:text-mist-400',
              error && 'outline-2 -outline-offset-2 outline-cheek-400',
            )}
          />
          <BaseCombobox.Trigger
            aria-label={t('combobox.show')}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center text-mist-300 hover:text-mist-50 disabled:text-mist-400"
          >
            <PixelIcon name="next" size={12} className="rotate-90" />
          </BaseCombobox.Trigger>
        </div>
        <BaseCombobox.Portal>
          <BaseCombobox.Positioner sideOffset={6} className="z-50">
            <BaseCombobox.Popup className="w-(--anchor-width) max-w-[calc(100vw-1.5rem)] bg-dusk-800 shadow-plate">
              <BaseCombobox.Empty className="px-3 py-3 text-mist-300 empty:hidden">
                {freeText && query?.trim() ? t('combobox.noResultsFree', { text: query.trim() }) : t('combobox.noResults')}
              </BaseCombobox.Empty>
              <BaseCombobox.List className="max-h-[min(20rem,calc(var(--available-height)-3rem))] overflow-y-auto overscroll-contain py-1">
                {(o: ComboboxOption) => (
                  <BaseCombobox.Item
                    key={o.value}
                    value={o}
                    className="group flex min-h-11 cursor-default items-center gap-2.5 px-3 py-1.5 text-mist-100 outline-none select-none data-highlighted:bg-volt-400 data-highlighted:text-ink"
                  >
                    {o.icon && <span className="grid w-10 shrink-0 place-items-center">{o.icon}</span>}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="leading-tight break-words">{o.label}</span>
                      {o.secondary && <span className="truncate text-sm leading-tight text-mist-400 group-data-highlighted:text-ink/75">{o.secondary}</span>}
                    </span>
                    {o.trailing && <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{o.trailing}</span>}
                    <BaseCombobox.ItemIndicator className="w-3 shrink-0">
                      <PixelIcon name="check" size={10} />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
              {hidden > 0 && <p className="border-t-2 border-dusk-700 px-3 py-2 text-sm text-mist-400">{t('combobox.more', { count: hidden })}</p>}
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
      <p id={msgId} aria-live="polite" className={cx('min-h-0 text-sm', error ? 'text-cheek-400' : 'text-mist-400')}>
        {error ?? hint ?? null}
      </p>
    </div>
  )
}
