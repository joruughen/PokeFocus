import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { HelpDot } from './HelpDot'

export type PanelVariant = 'plate' | 'frame' | 'well'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /**
   * - `plate`: main blocks of a screen (frame + 8px hard drop edge).
   * - `frame`: secondary blocks inside a plate or a grid (frame only).
   * - `well`: inset area for lists, meters and read-only values (no frame).
   */
  variant?: PanelVariant
  /** Heading (Tiny5). Rendered as h2 unless `headingLevel` says otherwise. */
  title?: ReactNode
  headingLevel?: 2 | 3
  /** Hint id: shows a "?" next to the title that opens that hint. */
  help?: string
  /** Right side of the header (buttons, a value). */
  actions?: ReactNode
  as?: 'section' | 'div' | 'aside' | 'article'
  padded?: boolean
}

const VARIANT: Record<PanelVariant, string> = {
  plate: 'bg-dusk-800 shadow-plate',
  frame: 'bg-dusk-800 shadow-frame',
  well: 'bg-dusk-900 inset-shadow-well',
}

/** Surface with optional header. The frame is drawn with box-shadows, so keep 2px of space around it. */
export function Panel({
  variant = 'plate',
  title,
  headingLevel = 2,
  help,
  actions,
  as: Tag = 'section',
  padded = true,
  className,
  children,
  ...rest
}: PanelProps) {
  const H = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <Tag className={cx('relative', VARIANT[variant], padded && (variant === 'well' ? 'p-3' : 'p-5'), className)} {...rest}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {title && (
            <div className="flex min-w-0 items-center gap-2">
              <H className={cx('truncate', headingLevel === 2 ? 'text-xl' : 'text-lg')}>{title}</H>
              {help && <HelpDot hint={help} />}
            </div>
          )}
          {actions && <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  )
}
