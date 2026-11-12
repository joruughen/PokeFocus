/**
 * Hints of the part B screens: Box, Pokémon detail, Team, Pokédex, League and
 * stats, the pomodoro break, the getting-started checklist, IV reveal, audio.
 * Copy: `hints.<id>.title` / `.body` in both locale files.
 */
import { registerHints } from './engine'

registerHints([
  // Box
  { id: 'box.intro', screen: 'box', trigger: { kind: 'firstVisit' }, anchor: 'box.grid', pose: 'point', side: 'top', order: 1 },
  { id: 'box.filters', screen: 'box', trigger: { kind: 'focus' }, anchor: 'box.filters', pose: 'think', side: 'bottom' },

  // Bag
  { id: 'bag.intro', screen: 'bag', trigger: { kind: 'manual' }, pose: 'point' },

  // Pokémon detail: a short 3-step tour the first time, then "?" on each widget.
  { id: 'detail.techniques', screen: 'detail', trigger: { kind: 'firstVisit' }, anchor: 'detail.slots', pose: 'point', side: 'top', sequence: 'detailTour', order: 1 },
  { id: 'detail.candies', screen: 'detail', trigger: { kind: 'firstVisit' }, anchor: 'detail.candies', pose: 'think', side: 'top', sequence: 'detailTour', order: 2 },
  { id: 'detail.actions', screen: 'detail', trigger: { kind: 'firstVisit' }, anchor: 'detail.actions', pose: 'cheer', side: 'bottom', sequence: 'detailTour', order: 3 },
  { id: 'detail.mastery', screen: 'detail', trigger: { kind: 'manual' }, pose: 'think' },
  { id: 'detail.extraMoves', screen: 'detail', trigger: { kind: 'manual' }, pose: 'think' },
  { id: 'detail.iv', screen: 'detail', trigger: { kind: 'manual' }, anchor: 'detail.iv', pose: 'think', side: 'left' },
  { id: 'detail.stats', screen: 'detail', trigger: { kind: 'manual' }, pose: 'point' },
  { id: 'detail.levelCap', screen: 'detail', trigger: { kind: 'manual' }, anchor: 'detail.cap', pose: 'think', side: 'top' },
  { id: 'detail.evolve', screen: 'detail', trigger: { kind: 'event', event: 'evolveReady' }, anchor: 'detail.evolve', pose: 'cheer', side: 'top' },
  { id: 'detail.energy', screen: 'detail', trigger: { kind: 'manual' }, anchor: 'detail.energy', pose: 'sleep', side: 'left' },
  { id: 'detail.bond', screen: 'detail', trigger: { kind: 'manual' }, pose: 'cheer' },

  // Team
  { id: 'team.intro', screen: 'team', trigger: { kind: 'firstVisit' }, anchor: 'team.slots', pose: 'point', side: 'top', order: 1 },
  { id: 'team.leader', screen: 'team', trigger: { kind: 'firstVisit' }, anchor: 'team.leaderPanel', pose: 'think', side: 'left', order: 2 },
  { id: 'team.order', screen: 'team', trigger: { kind: 'manual' }, anchor: 'team.slots', pose: 'point', side: 'top' },
  { id: 'team.tired', screen: 'team', trigger: { kind: 'event', event: 'teamTired' }, anchor: 'team.slots', pose: 'sleep', side: 'top' },

  // Pokédex
  { id: 'dex.intro', screen: 'dex', trigger: { kind: 'firstVisit' }, anchor: 'dex.grid', pose: 'point', side: 'top', order: 1 },
  { id: 'dex.cap', screen: 'dex', trigger: { kind: 'firstVisit' }, anchor: 'dex.cap', pose: 'think', side: 'bottom', order: 2 },

  // League + stats
  { id: 'league.intro', screen: 'league', trigger: { kind: 'firstVisit' }, anchor: 'league.ladder', pose: 'cheer', side: 'bottom', order: 1 },
  { id: 'league.stats', screen: 'league', trigger: { kind: 'focus' }, anchor: 'league.stats', pose: 'think', side: 'top' },
  { id: 'league.focus', screen: 'league', trigger: { kind: 'manual' }, pose: 'think' },

  // Home extras: break offer and getting-started checklist
  { id: 'home.break', screen: 'home', trigger: { kind: 'event', event: 'breakOffer' }, anchor: 'home.break', pose: 'sleep', side: 'left' },
  { id: 'home.checklist', screen: 'home', trigger: { kind: 'event', event: 'checklist' }, anchor: 'home.checklist', pose: 'point', side: 'left' },
  { id: 'break.why', screen: 'break', trigger: { kind: 'firstVisit' }, anchor: 'break.timer', pose: 'sleep', side: 'top' },

  // Waves: IV reveal (Foresight / Odor Sleuth in the team)
  { id: 'waves.iv', screen: 'waves', trigger: { kind: 'event', event: 'ivReveal' }, anchor: 'waves.iv', pose: 'think', side: 'bottom' },

  // Missions
  { id: 'missions.intro', screen: 'missions', trigger: { kind: 'firstVisit' }, anchor: 'missions.daily', pose: 'point', side: 'bottom', order: 1 },
  { id: 'missions.ready', screen: '*', trigger: { kind: 'event', event: 'missionReady' }, anchor: 'nav.missions', pose: 'cheer', side: 'right' },
  { id: 'missions.pokedex', screen: 'missions', trigger: { kind: 'manual' }, pose: 'think' },

  // Settings
  { id: 'settings.audio', screen: 'settings', trigger: { kind: 'focus' }, anchor: 'settings.audio', pose: 'cheer', side: 'left' },
])
