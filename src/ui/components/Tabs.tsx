import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export interface TabItem {
  value: string
  label: ReactNode
  content: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Accessible name of the tab list. */
  label: string
  className?: string
}

/** Tabs with a sliding pixel indicator (Base UI Tabs: arrow keys, roving focus). */
export function Tabs({ items, value, defaultValue, onValueChange, label, className }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange ? (v) => onValueChange(String(v)) : undefined}
      className={className}
    >
      <BaseTabs.List aria-label={label} className="relative z-0 mb-4 flex gap-1 bg-dusk-900 p-1 inset-shadow-well">
        {items.map((it) => (
          <BaseTabs.Tab
            key={it.value}
            value={it.value}
            disabled={it.disabled}
            className={cx(
              'relative z-10 min-h-9 px-4 font-display text-base text-mist-300 transition-colors select-none',
              'hover:text-mist-50 data-active:text-ink data-disabled:opacity-40',
            )}
          >
            {it.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="absolute top-1 left-0 z-0 h-[calc(100%-0.5rem)] w-(--active-tab-width) translate-x-(--active-tab-left) bg-volt-400 shadow-frame transition-[translate,width] duration-150 ease-[var(--ease-snap)]" />
      </BaseTabs.List>
      {items.map((it) => (
        <BaseTabs.Panel key={it.value} value={it.value} className="outline-none">
          {it.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}
