import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Width in px of an element, kept up to date (ResizeObserver). Lets a component choose sizes from the room it
 * actually has (a scene in a narrow column on a wide screen) instead of from the viewport. 0 until measured.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
