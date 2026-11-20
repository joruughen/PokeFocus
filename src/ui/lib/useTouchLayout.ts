import { useSyncExternalStore } from 'react'

/** Touch screens and narrow phones: no keyboard modifiers (Shift, Esc) to mention in help texts. */
const QUERY = '(pointer: coarse), (max-width: 639px)'

function subscribe(cb: () => void): () => void {
  if (typeof matchMedia === 'undefined') return () => {}
  const mq = matchMedia(QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

const snapshot = (): boolean => typeof matchMedia !== 'undefined' && matchMedia(QUERY).matches

export function useTouchLayout(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
