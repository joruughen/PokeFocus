/**
 * Throw animation that survives a reload (QA R-04).
 *
 * The server answers a throw at once and the saved state is already final, so the animation (ball flight,
 * wobble, result, counterattack feedback) lives only in `Waves`. We keep the answer in sessionStorage for as
 * long as the animation lasts (~3 s): after a reload `Waves` replays it from where it was instead of jumping
 * to the final state. Anything stale, from another encounter or unreadable is ignored.
 */
import type { ThrowBall, ThrowOutcome, WildPokemon, WildRef } from '../../../engine'

export interface ThrowFx {
  /** Encounter (`enc.sessionId`) the throw belongs to. */
  sessionId: string
  ref: WildRef
  ball: ThrowBall
  outcome: ThrowOutcome
  /** The wild as it was before the throw. */
  before: WildPokemon
  /** Team Energy before the throw, and the member whose card the dock showed. */
  energyBy: Record<string, number>
  cardUid: string | null
  /** Real time (ms) when the animation started. */
  at: number
}

const KEY = 'pokefocus-throw-fx'
export const THROW_MS = { wobble: 550, resultGap: 900 }

/** When each stage starts, in ms after the throw (a caught ball wobbles longer). */
export function throwTimeline(outcome: ThrowOutcome): { wobble: number; result: number; land: number } {
  const result = THROW_MS.wobble + (outcome.kind === 'caught' ? 1500 : 1000)
  return { wobble: THROW_MS.wobble, result, land: result + THROW_MS.resultGap }
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const defaultStore = (): Store | null => {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

export function saveThrowFx(fx: ThrowFx, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(KEY, JSON.stringify(fx))
  } catch {
    /* storage is optional */
  }
}

export function clearThrowFx(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(KEY)
  } catch {
    /* storage is optional */
  }
}

/** The animation to resume, with the ms already elapsed; null (and the entry dropped) when none applies. */
export function loadThrowFx(sessionId: string, nowMs: number, store: Store | null = defaultStore()): { fx: ThrowFx; elapsed: number } | null {
  if (!store) return null
  try {
    const raw = store.getItem(KEY)
    if (!raw) return null
    const fx = JSON.parse(raw) as ThrowFx
    const elapsed = nowMs - fx.at
    if (fx.sessionId === sessionId && fx.outcome && fx.before && fx.ref && elapsed >= 0 && elapsed < throwTimeline(fx.outcome).land) return { fx, elapsed }
  } catch {
    /* corrupt entry */
  }
  clearThrowFx(store)
  return null
}
