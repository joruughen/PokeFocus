import { Popover } from '@base-ui/react/popover'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'
import { PixelIcon } from './PixelIcon'

const POPUP =
  'max-h-[var(--available-height)] max-w-72 overflow-y-auto overscroll-contain bg-mist-50 px-3 py-2 text-sm text-ink shadow-raised origin-[var(--transform-origin)] transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0'

export interface TooltipProps {
  /** The trigger. Must forward refs and spread props (our Button, a span, a TypeBadge…). */
  children: ReactElement
  content: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  /**
   * - `plain` (default): short supplementary label on hover/focus (Base UI Tooltip; not shown on touch).
   * - `help`: an "info tip" that also opens on click/tap, for content people need (Base UI Popover with `openOnHover`).
   */
  variant?: 'plain' | 'help'
}

/** Wrap the whole app once (shared delay between tooltips). */
export const TooltipProvider = BaseTooltip.Provider

export function Tooltip({ children, content, side = 'top', variant = 'plain' }: TooltipProps) {
  if (variant === 'help') {
    return (
      <Popover.Root>
        <Popover.Trigger openOnHover delay={150} closeDelay={80} render={children} nativeButton={isButton(children)} />
        <Popover.Portal>
          <Popover.Positioner side={side} sideOffset={10} collisionPadding={12} className="z-50">
            <Popover.Popup className={POPUP}>{content}</Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    )
  }
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} delay={250} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={10} collisionPadding={12} className="z-50">
          <BaseTooltip.Popup className={POPUP}>{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

function isButton(el: ReactElement): boolean {
  return typeof el.type === 'string' ? el.type === 'button' : true
}

/** A small "i" trigger with a help tooltip, for inline explanations. */
export function InfoTip({ content, label, className }: { content: ReactNode; label?: string; className?: string }) {
  const { t } = useTranslation()
  return (
    <Tooltip variant="help" content={content}>
      <button
        type="button"
        aria-label={label ?? t('common.moreInfo')}
        className={cx('inline-grid size-5 place-items-center text-mist-400 hover:text-volt-300', className)}
      >
        <PixelIcon name="help" size={10} />
      </button>
    </Tooltip>
  )
}
