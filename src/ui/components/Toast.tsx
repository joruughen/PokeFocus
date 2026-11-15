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

/** Most toasts on screen at once; the rest wait in the provider's queue until one closes. */
export const MAX_VISIBLE_TOASTS = 3
/** Space between stacked toasts, in px. */
export const TOAST_GAP = 8
/** The same toast fired again within this window is dropped (double clicks, repeated reducer notices). */
export const TOAST_DEDUPE_MS = 1500

/**
 * Remembers recently shown toasts. `check(key, now)` returns the id of an identical toast shown less
 * than `windowMs` ago (so the caller can skip the new one) or null after registering `key` with `id`.
 */
export function createToastDeduper(windowMs: number = TOAST_DEDUPE_MS) {
  const seen = new Map<string, { id: string; at: number }>()
  return {
    check(key: string, now: number): string | null {
      for (const [k, v] of seen) if (now - v.at >= windowMs) seen.delete(k)
      return seen.get(key)?.id ?? null
    },
    remember(key: string, id: string, now: number) {
      seen.set(key, { id, at: now })
    },
  }
}

export function toastKey(opts: { type?: string; title?: unknown; description?: unknown }): string {
  return `${opts.type ?? 'info'}|${typeof opts.title === 'string' ? opts.title : ''}|${typeof opts.description === 'string' ? opts.description : ''}`
}

// Errors get the soft "nope" sound (audio module), so every failed action sounds the same.
const baseAdd = toast.add.bind(toast)
const deduper = createToastDeduper()
toast.add = ((opts: Parameters<typeof baseAdd>[0]) => {
  const key = toastKey(opts)
  const now = Date.now()
  const dup = opts.id ? null : deduper.check(key, now)
  if (dup) return dup
  if (opts.type === 'danger') sfx('error')
  const id = baseAdd(opts)
  deduper.remember(key, id, now)
  return id
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
          // Always laid out as a list (newest at the bottom), never as an overlapping deck:
          // each toast sits above the ones below it, by their measured heights plus a gap.
          // (8px = TOAST_GAP: Tailwind only sees literal class names.)
          '[transform:translateY(calc(var(--toast-offset-y)*-1-var(--toast-index)*8px))]',
          'transition-[transform,opacity] duration-200 ease-[var(--ease-snap)]',
          'data-starting-style:translate-y-6 data-starting-style:opacity-0 data-ending-style:opacity-0 data-limited:pointer-events-none data-limited:opacity-0',
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
    <BaseToast.Provider toastManager={toast} limit={MAX_VISIBLE_TOASTS} timeout={5000}>
      {children}
      <BaseToast.Portal>
        {/* On phones the bottom navigation bar (about 3.5rem + safe area) must stay reachable: toasts sit above it. */}
        <BaseToast.Viewport className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] w-[min(24rem,calc(100vw-2rem))] sm:right-6 sm:bottom-6">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}
