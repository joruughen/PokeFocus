import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { cx } from '../lib/cx'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name (usually the row's visible label). */
  label: string
  disabled?: boolean
  className?: string
}

/** Pixel on/off switch: a sliding key with a hard edge. */
export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={(c) => onChange(c)}
      aria-label={label}
      disabled={disabled}
      data-sfx="toggle"
      className={cx(
        'relative inline-flex h-8 w-16 shrink-0 items-center bg-dusk-900 p-1 shadow-frame inset-shadow-well transition-colors duration-100',
        'data-checked:bg-leaf-600 data-disabled:opacity-45',
        className,
      )}
    >
      <BaseSwitch.Thumb className="block h-6 w-7 bg-mist-50 shadow-[0_3px_0_0_var(--color-ink)] transition-[translate] duration-100 ease-[var(--ease-snap)] data-checked:translate-x-7" />
    </BaseSwitch.Root>
  )
}
