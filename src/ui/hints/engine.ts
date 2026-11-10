/**
 * Hint engine: contextual tips spoken by the mascot. See docs/ui-foundation.md §Hints.
 *
 * - A hint is registered once (`registerHints`) with an id, the screen it
 *   belongs to, a trigger and (usually) an anchor element id.
 * - Copy lives in the locale files under `hints.<id>.title` / `hints.<id>.body`.
 * - Rules: at most one hint on screen; at most `MAX_AUTO_PER_SCREEN` automatic
 *   hints per screen visit (a sequence counts once); never while a focus session
 *   runs; nothing automatic when tips are off. Seen flags persist (prefs store).
 * - `openHint(id)` (used by `<HelpDot>`) shows any hint on demand, ignoring
 *   seen flags and the tips setting.
 */
import { create } from 'zustand'
import type { MascotPose } from '../components/Mascot'
import { usePrefs } from '../store/prefs'

export type HintTrigger =
  /** The first time the screen is shown. */
  | { kind: 'firstVisit' }
  /** The first time `emitHintEvent(event)` is called while on the screen. */
  | { kind: 'event'; event: string }
  /** The first time the anchor element is hovered or focused. */
  | { kind: 'focus' }
  /** Only on demand (HelpDot). */
  | { kind: 'manual' }

export interface HintDef {
  id: string
  /** Screen id (`useHintScreen(id)`), or '*' for any screen. */
  screen: string
  trigger: HintTrigger
  /** `data-hint-anchor` value of the element the bubble points at. Omit for a docked bubble. */
  anchor?: string
  pose?: MascotPose
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Hints sharing a sequence id play back to back with a step counter (max 4 steps). */
  sequence?: string
  /** Lower first (screen order and order inside a sequence). */
  order?: number
}

export const MAX_AUTO_PER_SCREEN = 2

const registry = new Map<string, HintDef>()

export function registerHints(defs: HintDef[]): void {
  for (const d of defs) registry.set(d.id, d)
}
export function getHint(id: string): HintDef | undefined {
  return registry.get(id)
}
export function allHints(): HintDef[] {
  return [...registry.values()]
}

function sequenceOf(def: HintDef): HintDef[] {
  if (!def.sequence) return [def]
  return allHints()
    .filter((h) => h.sequence === def.sequence)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export interface ActiveHint {
  id: string
  manual: boolean
  /** Element to point at for manual opens (the HelpDot), if the anchor is not on screen. */
  fallbackAnchor: Element | null
  step: { index: number; total: number } | null
  values?: Record<string, string | number>
}

interface HintRuntime {
  active: ActiveHint | null
  queue: string[]
  screen: string | null
  autoShown: number
  /** True during a focus session: no automatic hints. */
  suppressed: boolean
  /** True while a modal ("What's new?") is open: no automatic hints appear over it. */
  held: boolean
  values: Record<string, Record<string, string | number>>
}

export const useHints = create<HintRuntime>(() => ({
  active: null,
  queue: [],
  screen: null,
  autoShown: 0,
  suppressed: false,
  held: false,
  values: {},
}))

const seen = (id: string) => Boolean(usePrefs.getState().seenHints[id])
const tipsOn = () => usePrefs.getState().tipsEnabled

function stepFor(def: HintDef): ActiveHint['step'] {
  const seq = sequenceOf(def)
  if (seq.length < 2) return null
  return { index: seq.findIndex((h) => h.id === def.id), total: seq.length }
}

let pumpTimer: ReturnType<typeof setTimeout> | null = null

/** Show the next queued hint if the rules allow it (after a short settle delay). */
function pump(delay = 450): void {
  if (pumpTimer) clearTimeout(pumpTimer)
  pumpTimer = setTimeout(() => {
    pumpTimer = null
    const s = useHints.getState()
    if (s.active || s.suppressed || s.held || !tipsOn()) return
    if (s.autoShown >= MAX_AUTO_PER_SCREEN) return
    const queue = s.queue.filter((id) => !seen(id))
    const id = queue.shift()
    if (!id) {
      useHints.setState({ queue })
      return
    }
    const def = registry.get(id)
    if (!def) return
    useHints.setState({
      queue,
      autoShown: s.autoShown + 1,
      active: { id, manual: false, fallbackAnchor: null, step: stepFor(def), values: s.values[id] },
    })
  }, delay)
}

function enqueue(ids: string[], front = false): void {
  const s = useHints.getState()
  const fresh = ids.filter((id) => !seen(id) && !s.queue.includes(id) && s.active?.id !== id)
  if (fresh.length === 0) return
  useHints.setState({ queue: front ? [...fresh, ...s.queue] : [...s.queue, ...fresh] })
  pump()
}

/** Called by `useHintScreen` when a screen mounts. */
export function enterScreen(screen: string): void {
  const s = useHints.getState()
  if (s.screen === screen) return
  // Leaving a screen closes its automatic hint without marking it seen.
  const keep = s.active?.manual ? s.active : null
  useHints.setState({ screen, autoShown: 0, queue: [], active: keep })
  const ids = allHints()
    .filter((h) => h.trigger.kind === 'firstVisit' && (h.screen === screen || h.screen === '*'))
    .filter((h) => !h.sequence || sequenceOf(h)[0]?.id === h.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((h) => h.id)
  enqueue(ids)
}

export function leaveScreen(screen: string): void {
  if (useHints.getState().screen === screen) useHints.setState({ screen: null, queue: [] })
}

/** Something happened (first catch, failed throw…). Hints listening for it may show. */
export function emitHintEvent(event: string, values?: Record<string, string | number>): void {
  const screen = useHints.getState().screen
  const ids = allHints()
    .filter((h) => h.trigger.kind === 'event' && h.trigger.event === event)
    .filter((h) => h.screen === '*' || h.screen === screen)
    .map((h) => h.id)
  if (values) {
    const v = { ...useHints.getState().values }
    for (const id of ids) v[id] = values
    useHints.setState({ values: v })
  }
  enqueue(ids)
}

/** An anchor got hover/focus (wired by HintLayer). */
export function anchorFocused(anchor: string): void {
  const screen = useHints.getState().screen
  const ids = allHints()
    .filter((h) => h.trigger.kind === 'focus' && h.anchor === anchor && (h.screen === '*' || h.screen === screen))
    .map((h) => h.id)
  enqueue(ids)
}

/** Open a hint on demand (HelpDot). Works even if seen or tips are off. */
export function openHint(id: string, fallbackAnchor: Element | null = null): void {
  const def = registry.get(id)
  if (!def) return
  useHints.setState((s) => ({
    active: { id, manual: true, fallbackAnchor, step: null, values: s.values[id] },
  }))
}

/** Close the current hint. `markSeen` false = it may come back later (e.g. screen left). */
export function closeHint(markSeen = true): void {
  const a = useHints.getState().active
  if (!a) return
  if (markSeen) {
    // Closing a sequence step skips the rest of that sequence.
    const def = registry.get(a.id)
    const ids = a.step && def ? sequenceOf(def).map((h) => h.id) : [a.id]
    for (const id of ids) usePrefs.getState().markHintSeen(id)
  }
  useHints.setState({ active: null })
  pump(700)
}

/** Next step of a sequence (does not count toward the per-screen cap). */
export function nextInSequence(): void {
  const a = useHints.getState().active
  if (!a) return
  const def = registry.get(a.id)
  usePrefs.getState().markHintSeen(a.id)
  const seq = def ? sequenceOf(def) : []
  const next = seq.slice(seq.findIndex((h) => h.id === a.id) + 1).find((h) => !seen(h.id))
  if (!next) {
    useHints.setState({ active: null })
    pump(700)
    return
  }
  useHints.setState((s) => ({
    active: { id: next.id, manual: false, fallbackAnchor: null, step: stepFor(next), values: s.values[next.id] },
  }))
}

/** "Don't show tips": turns automatic tips off (HelpDots keep working). */
export function disableTips(): void {
  usePrefs.getState().setTipsEnabled(false)
  useHints.setState({ active: null, queue: [] })
}

/** Focus sessions call this with true: closes an automatic hint and blocks new ones. */
export function setHintsSuppressed(on: boolean): void {
  const s = useHints.getState()
  if (s.suppressed === on) return
  useHints.setState({ suppressed: on, active: on && s.active && !s.active.manual ? null : s.active })
  if (!on) pump()
}

/**
 * A modal dialog calls this with true while it is open: no automatic hint pops
 * up over it (queued ones wait). Unlike `setHintsSuppressed` it leaves a hint
 * that is already open alone (callers wait for it before opening the modal).
 */
export function setHintsHeld(on: boolean): void {
  if (useHints.getState().held === on) return
  useHints.setState({ held: on })
  if (!on) pump()
}
