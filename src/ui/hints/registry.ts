/**
 * Hints of the core loop (part A). Other screens register theirs in their own
 * module with `registerHints([...])` (imported once from `src/ui/hints/index.ts`).
 * Copy: `hints.<id>.title` and `hints.<id>.body` in both locale files.
 */
import { registerHints } from './engine'
import './partB'
import './social'

registerHints([
  // Home / pre-session
  { id: 'home.team', screen: 'home', trigger: { kind: 'firstVisit' }, anchor: 'home.team', pose: 'point', side: 'bottom', order: 1 },
  { id: 'home.start', screen: 'home', trigger: { kind: 'firstVisit' }, anchor: 'home.start', pose: 'cheer', side: 'top', order: 2 },
  { id: 'home.conditions', screen: 'home', trigger: { kind: 'focus' }, anchor: 'home.conditions', pose: 'think', side: 'left' },
  { id: 'home.weather', screen: 'home', trigger: { kind: 'focus' }, anchor: 'home.weather', pose: 'point', side: 'top' },
  { id: 'home.league', screen: 'home', trigger: { kind: 'focus' }, anchor: 'home.league', pose: 'think', side: 'left' },
  { id: 'home.energy', screen: 'home', trigger: { kind: 'event', event: 'energyLow' }, anchor: 'home.energy', pose: 'sleep', side: 'top' },
  { id: 'home.duration', screen: 'home', trigger: { kind: 'manual' }, anchor: 'home.duration', pose: 'point' },

  // Claim + results
  { id: 'claim.window', screen: 'claim', trigger: { kind: 'firstVisit' }, anchor: 'claim.button', pose: 'point', side: 'right' },
  { id: 'results.why', screen: 'results', trigger: { kind: 'firstVisit' }, anchor: 'results.points', pose: 'cheer', side: 'bottom' },
  { id: 'results.levelUp', screen: 'results', trigger: { kind: 'event', event: 'levelUp' }, anchor: 'results.team', pose: 'cheer', side: 'top' },

  // Waves: the first one is a guided moment (4 steps).
  { id: 'waves.hp', screen: 'waves', trigger: { kind: 'firstVisit' }, anchor: 'waves.hp', pose: 'point', side: 'bottom', sequence: 'firstWave', order: 1 },
  { id: 'waves.studyBall', screen: 'waves', trigger: { kind: 'firstVisit' }, anchor: 'waves.studyBall', pose: 'cheer', side: 'top', sequence: 'firstWave', order: 2 },
  { id: 'waves.throw', screen: 'waves', trigger: { kind: 'firstVisit' }, anchor: 'waves.throw', pose: 'point', side: 'top', sequence: 'firstWave', order: 3 },
  { id: 'waves.flee', screen: 'waves', trigger: { kind: 'firstVisit' }, anchor: 'waves.fails', pose: 'think', side: 'bottom', sequence: 'firstWave', order: 4 },
  { id: 'waves.counter', screen: 'waves', trigger: { kind: 'event', event: 'throw.failed' }, anchor: 'waves.leader', pose: 'think', side: 'top' },
  { id: 'waves.fled', screen: 'waves', trigger: { kind: 'event', event: 'throw.fled' }, pose: 'think' },
  { id: 'waves.firstCatch', screen: 'waves', trigger: { kind: 'event', event: 'throw.caught' }, anchor: 'nav.box', pose: 'cheer', side: 'right' },
  { id: 'waves.charges', screen: 'waves', trigger: { kind: 'event', event: 'charges' }, anchor: 'waves.charges', pose: 'point', side: 'top' },
  { id: 'waves.shiny', screen: 'waves', trigger: { kind: 'event', event: 'shiny' }, pose: 'cheer' },
  { id: 'waves.next', screen: 'waves', trigger: { kind: 'event', event: 'waveDone' }, anchor: 'waves.next', pose: 'point', side: 'top' },
])
