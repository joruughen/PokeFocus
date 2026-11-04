import { Toast as BaseToast } from '@base-ui/react/toast'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'
import { sfx } from '../lib/sound'
import { IconButton } from './Button'
import { PixelIcon, type IconName } from './PixelIcon'

/**
 * Global toast manager. Call from anywhere (components, store actions):
 *   toast.add({ title: t('…'), description: '…', type: 'success' })
 * Types: 'info' (default) | 'success' | 'danger'.
 */
export const toast = BaseToast.createToastManager()

// Errors get the soft "nope" sound (audio module), so every failed action sounds the same.
const baseAdd = toast.add.bind(toast)
toast.add = ((opts: Parameters<typeof baseAdd>[0]) => {
  if (opts.type === 'danger') sfx('error')
  return baseAdd(opts)
}) as typeof toast.add

const TONE: Record<string, { icon: IconName; bar: string; color: string }> = {
  info: { icon: 'help', bar: 'bg-exp-400', color: 'text-exp-400' },
  success: { icon: 'check', bar: 'bg-leaf-400', color: 'text-leaf-400' },
  danger: { icon: 'bolt', bar: 'bg-cheek-400', color: 'text-cheek-400' },
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager()
  const { t } = useTranslation()
  return toasts.map((item) => {
    const tone = TONE[item.type ?? 'info'] ?? TONE.info!
    return (
      <BaseToast.Root
        key={item.id}
        toast={item}
        className={cx(
          'absolute right-0 bottom-0 w-full bg-dusk-700 text-mist-50 shadow-plate select-none',
          '[transform:translateY(calc(var(--toast-index)*-12px))_scale(calc(1-var(--toast-index)*0.04))] origin-bottom',
          'transition-[transform,opacity] duration-200 ease-[var(--ease-snap)]',
          'data-expanded:[transform:translateY(var(--toast-offset-y))] data-starting-style:translate-y-6 data-starting-style:opacity-0 data-ending-style:opacity-0 data-limited:opacity-0',
        )}
        style={{ zIndex: 'calc(1000 - var(--toast-index))' as unknown as number }}
      >
        <BaseToast.Content className="flex items-start gap-3 p-3 pl-0">
          <span className={cx('w-1.5 self-stretch', tone.bar)} aria-hidden />
          <PixelIcon name={tone.icon} size={20} className={cx('mt-0.5 shrink-0', tone.color)} />
          <div className="min-w-0 flex-1">
            <BaseToast.Title className="font-display text-lg leading-tight" />
            <BaseToast.Description className="mt-0.5 text-sm text-mist-300" />
          </div>
          <BaseToast.Close render={<IconButton icon="close" label={t('common.close')} size="sm" variant="ghost" />} />
        </BaseToast.Content>
      </BaseToast.Root>
    )
  })
}

/** Mount once near the app root. */
export function ToastViewport({ children }: { children?: ReactNode }) {
  return (
    <BaseToast.Provider toastManager={toast} limit={3} timeout={5000}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed right-6 bottom-6 z-[60] w-[min(24rem,calc(100vw-2rem))]">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}
