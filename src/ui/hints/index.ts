/**
 * Hint engine public API. Register a screen's hints by adding a module here
 * (side-effect import) — see docs/ui-foundation.md §Hints.
 */
import './registry'

export { emitHintEvent, openHint, registerHints, setHintsHeld, setHintsSuppressed, useHints, MAX_AUTO_PER_SCREEN, type HintDef, type HintTrigger } from './engine'
export { hintAnchor, useHintEvent, useHintScreen } from './hooks'
export { HintLayer } from './HintLayer'
