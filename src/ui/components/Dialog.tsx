import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'
import { IconButton } from './Button'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Element that opens the dialog (uncontrolled use). Must forward refs (our Button does). */
  trigger?: ReactElement
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Footer buttons. Wrap a button in `<DialogClose render={...} />` to close on click. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const WIDTH = { sm: 'w-[26rem]', md: 'w-[34rem]', lg: 'w-[48rem]' }

/** Modal dialog (Base UI: focus trap, Escape, scroll lock, labelled by title). */
export function Dialog({ open, onOpenChange, trigger, title, description, children, footer, size = 'sm' }: DialogProps) {
  const { t } = useTranslation()
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange ? (o) => onOpenChange(o) : undefined}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-ink/70 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseDialog.Popup
          className={cx(
            'fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-3rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            'bg-dusk-800 p-6 shadow-plate transition-[opacity,scale] duration-150 ease-[var(--ease-snap)]',
            'data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
            WIDTH[size],
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <BaseDialog.Title className="font-display text-2xl text-mist-50">{title}</BaseDialog.Title>
            <BaseDialog.Close render={<IconButton icon="close" label={t('common.close')} size="sm" variant="ghost" />} />
          </div>
          {description && <BaseDialog.Description className="mb-4 text-mist-300">{description}</BaseDialog.Description>}
          {children}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/** Closes the surrounding Dialog when clicked: `<DialogClose render={<Button>Cancel</Button>} />`. */
export const DialogClose = BaseDialog.Close
