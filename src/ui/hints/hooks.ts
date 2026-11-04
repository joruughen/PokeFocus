import { useEffect } from 'react'
import { emitHintEvent, enterScreen, leaveScreen } from './engine'

/** Declare the current screen (enables its `firstVisit` hints). Call once per screen component. */
export function useHintScreen(screen: string): void {
  useEffect(() => {
    enterScreen(screen)
    return () => leaveScreen(screen)
  }, [screen])
}

/** Spread on the element a hint should point at: `<div {...hintAnchor('home.team')}>`. */
export function hintAnchor(id: string): { 'data-hint-anchor': string } {
  return { 'data-hint-anchor': id }
}

/** Emit an event once when `when` becomes true (e.g. charges exist). */
export function useHintEvent(event: string, when: boolean): void {
  useEffect(() => {
    if (when) emitHintEvent(event)
  }, [event, when])
}
