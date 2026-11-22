import { useSyncExternalStore } from 'react'

/** True while the viewport is at least `px` wide (Tailwind's `sm` = 640, `lg` = 1024). */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia === 'undefined') return () => {}
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
    () => true,
  )
}
