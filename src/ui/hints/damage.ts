/**
 * Hints of the manual damage split (docs/session-depth-plan.md §A).
 * Copy: `hints.<id>.title` / `.body` in both locale files.
 */
import { registerHints } from './engine'

registerHints([
  // Fires the first time a wave opens with damage tokens to assign.
  { id: 'waves.damage', screen: 'waves', trigger: { kind: 'event', event: 'damageTokens' }, anchor: 'waves.damage', pose: 'point', side: 'top' },
])
