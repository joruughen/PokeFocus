/**
 * One simulated player: a profile's schedule played through the engine's public
 * API (start → complete → apply → captures → box decisions), with metrics.
 */
import {
  addItems,
  ALL_TYPES,
  claimAllMissions,
  applySessionResult,
  completeBreak,
  completeSession,
  createNewPlayer,
  createRng,
  finishEncounter,
  expForLevel,
  levelCap,
  levelFromExp,
  leagueForPoints,
  MINUTE_MS,
  pick,
  startSession,
  toLocal,
  typeConditionMult,
  conditionTypes,
  type LeagueId,
  type PlayerState,
  type SessionResult,
} from '../../src/engine/index.ts'
import { playEncounter } from './capture-policy.ts'
import { applyTeam, buildEnv, evolveAll, pickTeam, releaseDuplicates, sleepersInBox, spendCandies, TZ } from './policy.ts'
import { planProfile } from './profiles.ts'
import { median } from './util.ts'
import { emptyTally, type DayRec, type PlayerMetrics, type RunOptions, type SessionRec } from './types.ts'

/** Monday 2026-01-05, 00:00 local (UTC−5) is day 0. */
const DAY0_UTC = Date.UTC(2026, 0, 5)

export function localToUtc(localMinutes: number): number {
  return DAY0_UTC + (localMinutes - TZ) * MINUTE_MS
}

const LEAGUES: LeagueId[] = ['base', 'super', 'ultra', 'master']

export function runPlayer(o: RunOptions): PlayerMetrics {
  const { ctx } = o
  const cfg = ctx.config
  const plan = planProfile(o.profile, o.weeks, o.seed)
  const rng = createRng(`eng|${o.profile}|${o.seed}`)
  const brng = createRng(`beh|${o.profile}|${o.seed}`)
  const tally = emptyTally()
  const starter = pick(brng, cfg.starters)
  const created = createNewPlayer(
    { trainerName: `Sim ${o.profile} ${o.seed}`, locale: 'es', starterSlug: starter, now: localToUtc(-600), timezone: TZ },
    rng,
    ctx,
  )
  if (!created.ok) throw new Error(created.error)
  let state: PlayerState = created.value
  if (o.soloStarter) state = { ...state, inventory: {} }

  const weeks = o.weeks
  const m: PlayerMetrics = {
    profile: o.profile,
    seed: o.seed,
    weeks,
    weeklyPoints: Array(weeks).fill(0),
    weeklyMinutes: Array(weeks).fill(0),
    weeklyBestLeague: Array(weeks).fill('base'),
    weeklyLeagueDay: Array.from({ length: weeks }, () => ({ base: 0, super: null, ultra: null, master: null })),
    weeklyCaught: Array(weeks).fill(0),
    dailyPoints: Array(plan.days).fill(0),
    days: [],
    sessions: [],
    tally,
    dmgRatioByWeek: Array.from({ length: weeks }, () => []),
    legendaryEncounters: [],
    speciesFirstCaughtDay: { [starter]: 0 },
    finalTeam: [],
    finalDust: 0,
    finalCandies: 0,
    finalBalls: {},
    boxSize: 0,
    expAboveCap: 0,
  }

  const scale = o.missionScale ?? 1
  /** Engine missions (GDD §13): the simulated player claims everything completed. */
  const claimMissions = (at: number) => {
    const c = claimAllMissions(state, at, ctx)
    state = c.state
    for (const { reward } of c.rewards) {
      const it = reward.items
      tally.pokeBallsFromMissions += it['poke-ball'] ?? 0
      tally.greatBallsFromMissions += (it['great-ball'] ?? 0) * scale
      tally.ultraBallsFromMissions += (it['ultra-ball'] ?? 0) * scale
      tally.dustFromMissions += reward.dust
      tally.dustEarned += reward.dust
      tally.missionsClaimed++
      const extra: Record<string, number> = {}
      if (scale !== 1) {
        if (it['great-ball']) extra['great-ball'] = Math.round((it['great-ball'] ?? 0) * (scale - 1))
        if (it['ultra-ball']) extra['ultra-ball'] = Math.round((it['ultra-ball'] ?? 0) * (scale - 1))
        state = addItems(state, extra)
      }
    }
  }
  let recorded = 0
  let cumPoints = 0
  let cumMinutes = 0
  const protect = new Set<string>(['p1'])

  const snapshot = (day: number) => {
    const team = state.team.map((u) => state.pokemon[u]).filter((p): p is NonNullable<typeof p> => Boolean(p))
    const p1 = state.pokemon.p1
    const d: DayRec = {
      day,
      maxLevel: Math.max(0, ...team.map((p) => p.level)),
      maxExpLevel: Math.max(0, ...team.map((p) => levelFromExp(p.exp, ctx))),
      meanTeamLevel: team.length ? team.reduce((a, p) => a + p.level, 0) / team.length : 0,
      medTeamLevel: median(team.map((p) => p.level)),
      medTeamExpLevel: median(team.map((p) => levelFromExp(p.exp, ctx))),
      starterExpLevel: p1 ? levelFromExp(p1.exp, ctx) : 0,
      starterLevel: p1 ? p1.level : 0,
      caught: state.pokedex.caught.length,
      seen: state.pokedex.seen.length,
      cap: levelCap(state, ctx),
      trainerLevel: state.trainer.level,
      dust: state.dust,
      cumPoints,
      cumMinutes,
    }
    m.days.push(d)
  }
  const snapshotUpTo = (day: number) => {
    while (recorded < day && recorded < plan.days) snapshot(recorded++)
  }

  for (const ps of plan.sessions) {
    const dayIdx = Math.floor(ps.startMin / 1440)
    if (dayIdx >= plan.days) continue
    const weekIdx = Math.floor(dayIdx / 7)
    snapshotUpTo(dayIdx)
    const startTs = localToUtc(ps.startMin)
    const weather = plan.weather[dayIdx] ?? null

    // --- Box decisions before the session ------------------------------------------------------
    if (!o.soloStarter) {
      if (o.candies) state = spendCandies(state, ctx, tally)
      state = evolveAll(state, startTs, rng, ctx, tally)
      if (o.captures) state = releaseDuplicates(state, protect, ctx, tally)
      const env0 = buildEnv(state, startTs, ps.minutes, weather, null, 0, 0)
      state = applyTeam(state, pickTeam(state, env0, startTs, ctx), startTs, ctx)
    }

    // --- Session -----------------------------------------------------------------------------------
    const started = startSession(state, { plannedMinutes: ps.minutes, startedAt: startTs }, ctx)
    if (!started.ok) throw new Error(`startSession: ${started.error}`)
    const endedAt = startTs + ps.minutes * MINUTE_MS + ps.pausedSeconds * 1000
    const claimedAt = endedAt + ps.claimDelayMin * MINUTE_MS
    const members = started.value.session.teamUids.map((u) => state.pokemon[u]).filter((p): p is NonNullable<typeof p> => Boolean(p))
    const bugCount = members.filter((p) => conditionTypes(p, startTs, ctx).includes('bug')).length
    const env = buildEnv(state, startTs, ps.minutes, weather, ps.sound, ps.pausedSeconds, bugCount)
    const done = completeSession(
      started.value.state,
      started.value.session,
      {
        endedAt,
        claimedAt,
        pausedSeconds: ps.pausedSeconds,
        focusInputs: { screenshotLabels: [ps.label], missedCaptures: 0 },
        soundProfile: ps.sound,
        weather,
      },
      rng,
      ctx,
    )
    if (!done.ok) throw new Error(`completeSession: ${done.error}`)
    const result = done.value
    const applied = applySessionResult(started.value.state, result, ctx)
    if (!applied.ok) throw new Error(`applySessionResult: ${applied.error}`)
    const prevWeekPts = state.league.weeklyPoints[result.weekKey] ?? 0
    state = applied.value.state

    recordSession(m, result, env, dayIdx, weekIdx, ctx)
    cumPoints += result.totalPoints
    cumMinutes += result.valid ? result.minutes : 0

    // League milestones (day of the week each league was first reached).
    const nowPts = state.league.weeklyPoints[result.weekKey] ?? 0
    const wd = toLocal(startTs, TZ).weekday === 0 ? 6 : toLocal(startTs, TZ).weekday - 1
    for (const lg of LEAGUES) {
      if (cfg.leagues.weeklyThresholds[lg] > prevWeekPts && cfg.leagues.weeklyThresholds[lg] <= nowPts && m.weeklyLeagueDay[weekIdx]) {
        ;(m.weeklyLeagueDay[weekIdx] as Record<LeagueId, number | null>)[lg] = wd
      }
    }
    m.weeklyBestLeague[weekIdx] = leagueForPoints(nowPts, 'week', ctx)

    // --- Dust, balls and missions -------------------------------------------------------------------
    tally.dustEarned += result.dust
    tally.pokeBallsFromSessions += result.pokeBalls
    tally.pokeBallsFromConverted += result.waves.filter((w) => w.studyBall === 'converted').length
    tally.wavesTotal += result.waves.length
    if (o.missions) claimMissions(claimedAt)

    // --- Captures ------------------------------------------------------------------------------------
    const capNow = claimedAt + MINUTE_MS
    if (o.captures && state.encounter) {
      const caughtBefore = new Set(state.pokedex.caught)
      state = playEncounter(state, { rng, now: capNow, ctx, tally, ratios: m.dmgRatioByWeek[weekIdx] ?? [], legendary: m.legendaryEncounters })
      for (const sl of state.pokedex.caught) if (!caughtBefore.has(sl)) m.speciesFirstCaughtDay[sl] = dayIdx
    } else if (state.encounter) {
      state = finishEncounter(state, ctx)
    }
    if (o.missions) claimMissions(capNow)
    m.weeklyCaught[weekIdx] = state.pokedex.caught.length

    // --- Pomodoro break ------------------------------------------------------------------------------
    if (ps.breakAfter) state = completeBreak(state, claimedAt + 7 * MINUTE_MS, ctx)

    tally.restSessions += result.members.filter((x) => x.rested).length
  }
  snapshotUpTo(plan.days)

  // --- Final summary -------------------------------------------------------------------------------------
  tally.sleepingStuckEnd = sleepersInBox(state)
  m.finalTeam = state.team.map((u) => state.pokemon[u]).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => ({ slug: p.speciesSlug, level: p.level }))
  m.finalDust = state.dust
  m.finalCandies = Object.values(state.candies.chains).reduce((a, b) => a + b, 0)
  m.finalBalls = { ...state.inventory }
  m.boxSize = Object.keys(state.pokemon).length
  m.expAboveCap = state.team.reduce((a, u) => {
    const p = state.pokemon[u]
    return p && levelFromExp(p.exp, ctx) > p.level ? a + (p.exp - expForLevel(p.level, ctx)) : a
  }, 0)
  return m
}

function recordSession(
  m: PlayerMetrics,
  r: SessionResult,
  env: ReturnType<typeof buildEnv>,
  dayIdx: number,
  weekIdx: number,
  ctx: RunOptions['ctx'],
): void {
  const t = m.tally
  t.sessionsTotal++
  if (r.valid) t.sessionsValid++
  const rewarded = r.valid && r.rewardFactor > 0
  if (rewarded) t.sessionsRewarded++
  if (r.lateClaim) t.lateClaims++
  m.weeklyPoints[weekIdx] = (m.weeklyPoints[weekIdx] ?? 0) + r.totalPoints
  m.weeklyMinutes[weekIdx] = (m.weeklyMinutes[weekIdx] ?? 0) + (r.valid ? r.minutes : 0)
  m.dailyPoints[dayIdx] = (m.dailyPoints[dayIdx] ?? 0) + r.totalPoints
  const awake = r.members.filter((x) => !x.asleep)
  const condMult = ALL_TYPES.map((ty) => typeConditionMult(ty, env, ctx.config))
  const mineActive = ALL_TYPES.filter((_, i) => (condMult[i] as number) > 1)
    .slice()
    .sort()
    .join(',')
  const engineActive = [...r.conditions].sort().join(',')
  const condMatch = mineActive === engineActive
  if (!condMatch) t.condMismatch++
  t.extraWild += r.extraWild
  const rec: SessionRec = {
    day: dayIdx,
    week: weekIdx,
    minutes: r.minutes,
    valid: r.valid,
    rewarded,
    rewardFactor: r.rewardFactor,
    focus: r.focus,
    points: r.totalPoints,
    dust: r.dust,
    balls: r.pokeBalls,
    waves: r.waves.length,
    wilds: r.waves.reduce((a, w) => a + w.wilds.length, 0),
    league: r.league,
    waveSizes: r.waves.map((w) => w.wilds.length),
    teamSize: r.members.length,
    ordinal: env.sessionsEarlierToday,
    active: awake.length,
    asleep: r.members.length - awake.length,
    exhausted: awake.filter((x) => x.exhaustedAtMinute !== null).length,
    startedEmpty: awake.filter((x) => x.energyStart <= 1e-9).length,
    endEnergyFrac: awake.length ? awake.reduce((a, x) => a + (x.energyMax > 0 ? x.energyEnd / x.energyMax : 0), 0) / awake.length : 0,
    condMult,
    condMatch,
    lateClaim: r.lateClaim,
    techniqueActivations: r.members.reduce((a, x) => a + x.techniques.reduce((b, y) => b + y.count, 0), 0),
  }
  m.sessions.push(rec)
}
