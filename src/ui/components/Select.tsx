import { Select as BaseSelect } from '@base-ui/react/select'
import { cx } from '../lib/cx'
import { PixelIcon } from './PixelIcon'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  /** Visible label above the trigger. */
  label: string
  id?: string
  className?: string
}

/** Single select (Base UI Select: typeahead, keyboard, aria). */
export function Select({ options, value, onChange, label, className }: SelectProps) {
  return (
    <BaseSelect.Root items={options} value={value} onValueChange={(v) => v !== null && onChange(String(v))}>
      <div className={cx('flex flex-col gap-1.5', className)}>
        <BaseSelect.Label className="font-display text-base text-mist-300">{label}</BaseSelect.Label>
        <BaseSelect.Trigger className="flex min-h-11 w-full items-center justify-between gap-3 bg-dusk-900 px-3 text-left text-mist-50 shadow-frame inset-shadow-well hover:bg-dusk-950 data-popup-open:bg-dusk-950">
          <BaseSelect.Value className="truncate" />
          <BaseSelect.Icon className="text-mist-300">
            <PixelIcon name="next" size={10} className="rotate-90" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-50">
          <BaseSelect.Popup className="max-h-[min(22rem,var(--available-height))] min-w-(--anchor-width) overflow-y-auto bg-dusk-800 py-1 shadow-plate">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  className="flex min-h-9 cursor-default items-center gap-2 px-3 text-mist-100 outline-none select-none data-highlighted:bg-volt-400 data-highlighted:text-ink"
                >
                  <BaseSelect.ItemIndicator className="w-3">
                    <PixelIcon name="check" size={10} />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
