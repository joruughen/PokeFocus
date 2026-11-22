import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export interface SegmentOption<V extends string> {
  value: V
  label: ReactNode
  /** Accessible label when `label` is not plain text. */
  ariaLabel?: string
  disabled?: boolean
}

export interface SegmentedProps<V extends string> {
  options: SegmentOption<V>[]
  value: V
  onChange: (value: V) => void
  /** Accessible name of the group. */
  label: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Data attribute passthrough for hint anchors. */
  anchor?: string
}

/** One-of-many choice drawn as pixel keys (Base UI ToggleGroup: arrow keys, aria-pressed). */
export function Segmented<V extends string>({ options, value, onChange, label, size = 'md', className, anchor }: SegmentedProps<V>) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => {
        const next = v[0] as V | undefined
        if (next) onChange(next)
      }}
      className={cx('flex flex-wrap gap-2', className)}
      {...(anchor ? { 'data-hint-anchor': anchor } : {})}
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          disabled={o.disabled}
          className={cx(
            'inline-flex items-center justify-center gap-2 bg-dusk-700 font-display text-mist-100 shadow-raised inset-shadow-bevel select-none',
            'transition-[background-color,translate] duration-75 hover:bg-dusk-600',
            'data-pressed:translate-y-[3px] data-pressed:bg-volt-400 data-pressed:text-ink data-pressed:shadow-pressed',
            'data-disabled:opacity-40',
            size === 'lg' ? 'min-h-14 min-w-16 px-4 text-2xl' : size === 'sm' ? 'min-h-8 px-2 text-sm' : 'min-h-10 px-3 text-base',
          )}
        >
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
