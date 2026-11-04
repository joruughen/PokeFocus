import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { openHint, useHints } from '../hints/engine'
import { cx } from '../lib/cx'
import { PixelIcon } from './PixelIcon'

export interface HelpDotProps {
  /** Registered hint id (copy at `hints.<id>.*`). */
  hint: string
  className?: string
}

/**
 * "?" button that re-opens a hint on demand, even if it was already seen or
 * tips are turned off. Put it next to any widget that needs explaining.
 */
export function HelpDot({ hint, className }: HelpDotProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLButtonElement>(null)
  const open = useHints((s) => s.active?.id === hint)
  const title = t(`hints.${hint}.title`)
  return (
    <button
      ref={ref}
      type="button"
      aria-label={t('hint.helpFor', { title })}
      aria-expanded={open}
      onClick={() => openHint(hint, ref.current)}
      className={cx(
        'inline-grid size-6 shrink-0 place-items-center bg-dusk-600 text-volt-300 shadow-frame transition-colors hover:bg-volt-400 hover:text-ink',
        open && 'bg-volt-400 text-ink',
        className,
      )}
    >
      <PixelIcon name="help" size={10} />
    </button>
  )
}
