/**
 * "Now" for React. One shared ticker re-renders subscribers while the tab is
 * visible (every 250 ms) and recomputes immediately on `visibilitychange`.
 * A tiny Worker keeps ticking (best effort) while the tab is hidden, so the
 * end-of-session notification is not delayed by main-thread timer throttling.
 *
 * Time always comes from `now()` (prefs.ts), which applies the dev clock.
 * Never decrement counters: compute remaining time as `endsAt - now()`.
 */
import { useSyncExternalStore } from 'react'
import { now, usePrefs } from './prefs'

type Listener = () => void
const listeners = new Set<Listener>()
let current = now()
let interval: ReturnType<typeof setInterval> | null = null
let worker: Worker | null = null

function tick() {
  current = now()
  for (const l of listeners) l()
}

function start() {
  if (interval !== null) return
  interval = setInterval(tick, 250)
  document.addEventListener('visibilitychange', tick)
  try {
    worker = new Worker(new URL('./timer.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = () => {
      if (document.hidden) tick()
    }
  } catch {
    worker = null
  }
}

function stop() {
  if (interval !== null) clearInterval(interval)
  interval = null
  document.removeEventListener('visibilitychange', tick)
  worker?.terminate()
  worker = null
}

function subscribe(l: Listener) {
  listeners.add(l)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) stop()
  }
}

// Dev clock changes (rate, jumps) must be visible at once.
usePrefs.subscribe((s, prev) => {
  if (s.dev.anchor !== prev.dev.anchor) tick()
})

/** Current game time (ms), re-rendering ~4×/s. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** Subscribe to every tick outside React (used by the session watcher). */
export function onTick(l: Listener): () => void {
  return subscribe(l)
}
