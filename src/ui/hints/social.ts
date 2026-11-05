/**
 * Hints of the F2 social screens: friends (code, add, requests) and the
 * leaderboards in the League screen.
 * Copy: `hints.<id>.title` / `.body` in both locale files.
 */
import { registerHints } from './engine'

registerHints([
  // Friends
  { id: 'friends.code', screen: 'friends', trigger: { kind: 'firstVisit' }, anchor: 'friends.code', pose: 'point', side: 'bottom', order: 1 },
  { id: 'friends.add', screen: 'friends', trigger: { kind: 'focus' }, anchor: 'friends.add', pose: 'think', side: 'bottom' },
  { id: 'friends.request', screen: '*', trigger: { kind: 'event', event: 'friendRequest' }, anchor: 'nav.friends', pose: 'cheer', side: 'right' },

  // League: leaderboards
  { id: 'league.leaderboards', screen: 'league', trigger: { kind: 'focus' }, anchor: 'league.leaderboards', pose: 'cheer', side: 'top' },

  // Settings: account
  { id: 'settings.account', screen: 'settings', trigger: { kind: 'manual' }, anchor: 'settings.account', pose: 'think', side: 'left' },
])
