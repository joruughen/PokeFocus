/**
 * Pure model of the Profile screen: trainer level progress, streak status, unlock ladder and
 * study statistics. Everything is derived from the player state and the engine config (never
 * hard-coded levels), so it follows live content and admin edits.
 */
import {
  addDays,
  daysBetween,
  defaultContext,
  trainerExpForLevel,
  trainerLevelRewards,
  UNLOCK_GIFT_ITEMS,
  type EngineContext,
  type LeagueId,
  type OwnedPokemon,
  type PlayerState,
  type TrainerLevelRewards,
} from '../../../engine'

// --- Trainer level -----------------------------------------------------------

export interface TrainerProgress {
  level: number
  maxLevel: number
  isMax: boolean
  /** Total trainer EXP. */
  exp: number
  /** Total EXP at which the current level started. */
  levelStart: number
  /** Total EXP needed for the next level (null at the maximum). */
  nextLevelAt: number | null
  /** EXP earned inside the current level. */
  into: number
  /** EXP the current level spans (null at the maximum). */
  span: number | null
  /** EXP still missing for the next level (0 at the maximum). */
  missing: number
  /** Study minutes that would cover `missing` (null: no EXP per minute, or maximum level). */
  minutes: number | null
  /** New species that would cover `missing` (null: none give EXP, or maximum level). */
  species: number | null
  /** 0..1 progress inside the level (1 at the maximum). */
  fraction: number
}

/** Where the trainer stands: EXP inside the level, what is missing for the next one and what that means in minutes. */
export function trainerProgress(trainer: PlayerState['trainer'], ctx: EngineContext = defaultContext()): TrainerProgress {
  const cfg = ctx.config.trainer
  const level = Math.max(1, Math.min(trainer.level, cfg.maxLevel))
  const exp = Math.max(0, trainer.exp)
  const isMax = level >= cfg.maxLevel
  const levelStart = trainerExpForLevel(level, ctx)
  const nextLevelAt = isMax ? null : trainerExpForLevel(level + 1, ctx)
  const into = Math.max(0, exp - levelStart)
  const span = nextLevelAt === null ? null : Math.max(1, nextLevelAt - levelStart)
  const missing = nextLevelAt === null ? 0 : Math.max(0, nextLevelAt - exp)
  return {
    level,
    maxLevel: cfg.maxLevel,
    isMax,
    exp,
    levelStart,
    nextLevelAt,
    into,
    span,
    missing,
    minutes: isMax || !(cfg.expPerMinute > 0) ? null : Math.ceil(missing / cfg.expPerMinute),
    species: isMax || !(cfg.expPerNewSpecies > 0) ? null : Math.ceil(missing / cfg.expPerNewSpecies),
    fraction: span === null ? 1 : Math.max(0, Math.min(1, into / span)),
  }
}

/** What reaching the next trainer level gives (null at the maximum). */
export function nextLevelReward(level: number, ctx: EngineContext = defaultContext()): (TrainerLevelRewards & { level: number }) | null {
  if (level >= ctx.config.trainer.maxLevel) return null
  return { level: level + 1, ...trainerLevelRewards(level, level + 1, ctx) }
}

// --- Streak ------------------------------------------------------------------

/**
 * - `none`: no session yet.
 * - `today`: already studied today.
 * - `atRisk`: last studied yesterday; a session today keeps it going.
 * - `lapsed`: missed exactly one day; only a streak-protect technique can still save it (once a week).
 * - `lost`: two or more days missed; the next session starts a new streak at 1.
 */
export type StreakState = 'none' | 'today' | 'atRisk' | 'lapsed' | 'lost'

export interface StreakStatus {
  state: StreakState
  /** Days of the running streak as it stands today (0 once it is lost). */
  current: number
  best: number
}

export function streakStatus(streak: PlayerState['streak'], todayKey: string): StreakStatus {
  const best = Math.max(streak.best, streak.current)
  if (streak.lastDayKey === null) return { state: 'none', current: 0, best }
  const gap = daysBetween(streak.lastDayKey, todayKey)
  if (gap <= 0) return { state: 'today', current: Math.max(1, streak.current), best }
  if (gap === 1) return { state: 'atRisk', current: streak.current, best }
  if (gap === 2) return { state: 'lapsed', current: streak.current, best }
  return { state: 'lost', current: 0, best }
}

// --- Unlock ladder -------------------------------------------------------------

export type UnlockKind = 'mint' | 'tera' | 'bottleCap' | 'abilityCapsule' | 'missions' | 'wild'

export interface UnlockEntry {
  kind: UnlockKind
  /** Item shown with the entry (sprite and name): the gift, or one of the items the missions start giving. */
  item?: string
  /** Items the entry gives once, with the reward of its level (`advanced.<kind>.unlockGift`). */
  gift?: { item: string; count: number }
  /** `wild`: the wild level range from this trainer level on. */
  wild?: { min: number; max: number }
}

export interface UnlockLevel {
  level: number
  entries: UnlockEntry[]
  /** The trainer already has this level. */
  done: boolean
}

const ADVANCED_KINDS = ['mint', 'tera', 'bottleCap', 'abilityCapsule'] as const

/** The item that stands for a mint unlock in the ladder. */
export const MINT_ICON = 'choice-mint'
const ADVANCED_ICON: Record<(typeof ADVANCED_KINDS)[number], string> = { mint: MINT_ICON, tera: 'tera-shard', bottleCap: 'bottle-cap', abilityCapsule: 'ability-capsule' }

/**
 * Levels where something opens up, ascending, grouped by level: the advanced items (`config.advanced.*`),
 * the levels where the missions' reward tiers improve (`missions.pool[].rewards[].minTrainerLevel`) and where the wild
 * level range grows (`encounters.wildLevelByTrainerLevel`). Levels above the maximum never happen and are left out.
 */
export function trainerUnlocks(level: number, ctx: EngineContext = defaultContext()): UnlockLevel[] {
  const max = ctx.config.trainer.maxLevel
  const byLevel = new Map<number, UnlockEntry[]>()
  const add = (lvl: number, entry: UnlockEntry) => {
    if (!(lvl > 1) || lvl > max) return
    byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), entry])
  }

  for (const kind of ADVANCED_KINDS) {
    const a = ctx.config.advanced?.[kind]
    if (!a) continue
    const giftItem = kind === 'mint' ? null : UNLOCK_GIFT_ITEMS[kind]
    const count = 'unlockGift' in a ? a.unlockGift : 0
    add(a.minTrainerLevel, {
      kind,
      item: ADVANCED_ICON[kind],
      ...(giftItem && count > 0 ? { gift: { item: giftItem, count } } : {}),
    })
  }

  // Missions: the first item each improved reward tier brings (random picks are not listed).
  const missionItems = new Map<number, string>()
  for (const def of ctx.missions.pool) {
    for (const tier of def.rewards) {
      const lvl = tier.minTrainerLevel ?? 1
      if (lvl <= 1) continue
      const first = Object.entries(tier.items ?? {}).find(([, n]) => n > 0)?.[0]
      if (!missionItems.has(lvl)) missionItems.set(lvl, first ?? '')
    }
  }
  for (const [lvl, item] of missionItems) add(lvl, { kind: 'missions', ...(item ? { item } : {}) })

  for (const w of ctx.config.encounters.wildLevelByTrainerLevel) add(w.trainerLevel, { kind: 'wild', wild: { min: w.min, max: w.max } })

  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lvl, entries]) => ({ level: lvl, entries: sortEntries(entries), done: level >= lvl }))
}

const ORDER: UnlockKind[] = ['mint', 'tera', 'bottleCap', 'abilityCapsule', 'missions', 'wild']
function sortEntries(entries: UnlockEntry[]): UnlockEntry[] {
  return [...entries].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

// --- Statistics ----------------------------------------------------------------

export interface ProfileStats {
  sessions: number
  totalMinutes: number
  avgMinutes: number
  longestMinutes: number
  /** Mean Focus of the sessions in the history (0..1); null without sessions. */
  avgFocus: number | null
  /** Different local days with a session in the history. */
  studyDays: number
  /** Dust earned in the sessions of the history. */
  dustEarned: number
  /** Wild Pokémon caught in the sessions of the history. */
  catches: number
  speciesCaught: number
  speciesSeen: number
  speciesTotal: number
  /** Shiny Pokémon in the box right now. */
  shinyOwned: number
  /** Legendary or mythical species ever caught (Pokédex). */
  legendaryCaught: number
  /** Pokémon in the box that arrived by trade. */
  tradedOwned: number
  bestLeague: LeagueId
  /** The Pokémon with the most Bond minutes (null if there are none). */
  longestBond: OwnedPokemon | null
}

export function profileStats(player: PlayerState, ctx: EngineContext = defaultContext()): ProfileStats {
  const h = player.history
  const totalMinutes = h.reduce((a, s) => a + s.minutes, 0)
  const mons = Object.values(player.pokemon)
  const legendary = player.pokedex.caught.filter((slug) => {
    const sp = ctx.speciesBySlug.get(slug)
    return Boolean(sp?.isLegendary || sp?.isMythical)
  }).length
  let longestBond: OwnedPokemon | null = null
  for (const m of mons) if (m.bondMinutes > 0 && (!longestBond || m.bondMinutes > longestBond.bondMinutes)) longestBond = m
  return {
    sessions: h.length,
    totalMinutes,
    avgMinutes: h.length ? Math.round(totalMinutes / h.length) : 0,
    longestMinutes: h.reduce((a, s) => Math.max(a, s.minutes), 0),
    avgFocus: h.length ? h.reduce((a, s) => a + s.focus, 0) / h.length : null,
    studyDays: new Set(h.map((s) => s.dayKey)).size,
    dustEarned: h.reduce((a, s) => a + s.dust, 0),
    catches: h.reduce((a, s) => a + s.caught, 0),
    speciesCaught: player.pokedex.caught.length,
    speciesSeen: player.pokedex.seen.length,
    speciesTotal: ctx.data.species.length,
    shinyOwned: mons.filter((m) => m.isShiny).length,
    legendaryCaught: legendary,
    tradedOwned: mons.filter((m) => (m.traded?.count ?? 0) > 0).length,
    bestLeague: player.league.bestLeague,
    longestBond,
  }
}

export interface WeekMinutes {
  /** Monday of the week (day key). */
  weekKey: string
  minutes: number
}

/** Minutes studied per week for the last `weeks` weeks, oldest first, ending with the week of `currentWeekKey`. */
export function weeklyMinutes(history: PlayerState['history'], currentWeekKey: string, weeks: number): WeekMinutes[] {
  const keys = Array.from({ length: weeks }, (_, i) => addDays(currentWeekKey, -7 * (weeks - 1 - i)))
  const sums = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const s of history) if (sums.has(s.weekKey)) sums.set(s.weekKey, sums.get(s.weekKey)! + s.minutes)
  return keys.map((k) => ({ weekKey: k, minutes: sums.get(k)! }))
}

/** The Pokémon beside the trainer: the team leader, else the one with the most Bond minutes. */
export function companionOf(player: PlayerState): OwnedPokemon | null {
  const leader = player.team[0] ? player.pokemon[player.team[0]] : undefined
  if (leader) return leader
  let best: OwnedPokemon | null = null
  for (const m of Object.values(player.pokemon)) if (!best || m.bondMinutes > best.bondMinutes) best = m
  return best
}

export interface StreakDay {
  dayKey: string
  /** A session was completed that day (`PlayerState.days`, which keeps the last 14 days). */
  studied: boolean
  today: boolean
}

/** The last `count` local days ending today (oldest first), marking those with study minutes. */
export function lastDays(days: PlayerState['days'], todayKey: string, count: number): StreakDay[] {
  return Array.from({ length: count }, (_, i) => {
    const dayKey = addDays(todayKey, -(count - 1 - i))
    return { dayKey, studied: (days[dayKey]?.minutes ?? 0) > 0, today: dayKey === todayKey }
  })
}
