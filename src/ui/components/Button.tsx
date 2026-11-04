import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../lib/cx'
import { PixelIcon, type IconName } from './PixelIcon'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Pixel icon before the label. */
  icon?: IconName
  /** Extra content after the label (a count, a key hint). */
  trailing?: ReactNode
  /** Pulsing beacon ring (used by guided moments, e.g. the first throw). */
  beacon?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-volt-400 text-ink shadow-raised inset-shadow-bevel hover:bg-volt-300 active:bg-volt-500 disabled:bg-dusk-600 disabled:text-mist-400',
  secondary:
    'bg-dusk-600 text-mist-50 shadow-raised inset-shadow-bevel hover:bg-dusk-500 active:bg-dusk-700 disabled:text-mist-400 disabled:bg-dusk-700',
  danger:
    'bg-cheek-500 text-mist-50 shadow-raised inset-shadow-bevel hover:bg-cheek-400 active:bg-cheek-700 disabled:bg-dusk-600 disabled:text-mist-400',
  ghost: 'bg-transparent text-mist-100 hover:bg-dusk-700 active:bg-dusk-800 disabled:text-mist-400',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 gap-2 text-base',
  md: 'min-h-11 px-5 gap-2.5 text-lg',
  lg: 'min-h-15 px-8 gap-3 text-2xl',
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 20, lg: 20 }

/**
 * Game button: flat color, 2px ink frame with notched corners, hard bottom
 * edge that "presses" down 3px. Tiny5 label.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, trailing, beacon, className, children, type = 'button', ...rest },
  ref,
) {
  const pressable = variant !== 'ghost'
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'relative inline-flex items-center justify-center font-display leading-none whitespace-nowrap select-none',
        'transition-[background-color,translate] duration-75',
        pressable && 'active:not-disabled:translate-y-[3px] active:not-disabled:shadow-pressed disabled:shadow-frame',
        VARIANT[variant],
        SIZE[size],
        beacon && 'animate-pulse-ring',
        className,
      )}
      {...rest}
    >
      {icon && <PixelIcon name={icon} size={ICON_SIZE[size]} />}
      {children}
      {trailing}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'trailing'> {
  icon: IconName
  /** Required: icon-only buttons need an accessible name. */
  label: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', variant = 'secondary', className, ...rest },
  ref,
) {
  const box = size === 'sm' ? 'size-9 px-0!' : size === 'md' ? 'size-11 px-0!' : 'size-15 px-0!'
  return (
    <Button ref={ref} variant={variant} size={size} aria-label={label} title={label} className={cx(box, className)} {...rest}>
      <PixelIcon name={icon} size={size === 'sm' ? 16 : 20} />
    </Button>
  )
})
