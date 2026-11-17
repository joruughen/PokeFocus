import { describe, expect, it } from 'vitest'
import { completeBreak, isAsleepAt, refreshEnergy } from './energy'
import { createEngineContext, defaultContext, type EngineContext } from './context'
import { currentLeague, leagueForPoints, weekKey } from './league'
import { createRng } from './rng'
import {
  activationChance,
  applySessionResult,
  cancelKeep,
  captureValue,
  completeSession,
  dailyRewardFactor,
  startSession,
} from './session'
import type { TechniqueDef } from './effect-types'
import { computeStats, effectiveFocus, maxEnergyOf } from './stats'
import { makeMon, makePlayer, MIN, runSession, STUDYING, T0 } from './test-helpers'
import { rollWaveSize } from './waves'

const ctx = defaultContext()
const cfg = ctx.config

/** Context where the given techniques always activate. */
function alwaysActivate(...slugs: string[]): EngineContext {
  const techniques: Record<string, TechniqueDef> = { ...ctx.techniques }
  for (const s of slugs) techniques[s] = { ...(techniques[s] as TechniqueDef), baseChance: 1 }
  return createEngineContext({ techniques, config: { actions: { maxActivationChance: 1 } } })
}

describe('technique activation (GDD §7.2)', () => {
  it('Gengar L50, Hypnosis 6%, ★★★ → ≈10% per action', () => {
    const gengar = makeMon('gengar', 50)
    const spDef = computeStats(gengar).specialDefense
    const p = activationChance(0.06, spDef, 15 * 60, 1, cfg)
    expect(p).toBeGreaterThan(0.095)
    expect(p).toBeLessThan(0.115)
    expect(activationChance(1, 500, 0, 1, cfg)).toBe(cfg.actions.maxActivationChance)
  })

  it('respects limitPerSession and produces status charges', () => {
    const c = alwaysActivate('hypnosis')
    const g = makeMon('gengar', 40, { uid: 'g', equippedMoves: ['hypnosis'], learnedMoves: ['hypnosis'] }, c)
    const { result } = runSession(makePlayer([g], {}, c), 50, 1, {}, c)
    const m = result.members[0]!
    expect(m.actions).toBeGreaterThan(2)
    expect(m.techniques).toEqual([{ move: 'hypnosis', count: 2 }])
    expect(result.charges.filter((x) => x.kind === 'status' && x.status === 'sleep')).toHaveLength(2)
  })

  it('activateCondition forces a type condition for the rest of the session', () => {
    const c = alwaysActivate('rain-dance')
    const sq = makeMon('squirtle', 20, { uid: 's', equippedMoves: ['rain-dance'], learnedMoves: ['rain-dance'] }, c)
    const { result } = runSession(makePlayer([sq], {}, c), 25, 1, {}, c)
    expect(result.forcedConditions.map((f) => f.type)).toEqual(['water'])
    expect(result.waves[0]!.activeConditionTypes).toContain('water')
  })
})

describe('energy during sessions (GDD §5.3)', () => {
  it('exhaustion stops actions but EXP is still granted', () => {
    const p = makeMon('pidgey', 50, { uid: 'a', energy: { current: 1, updatedAt: T0 } })
    const { result } = runSession(makePlayer([p]), 25, 1, { startedAt: T0 + 5 * MIN })
    const m = result.members[0]!
    expect(m.actions).toBe(1)
    expect(m.exhaustedAtMinute).not.toBeNull()
    expect(m.energyEnd).toBe(0)
    expect(m.exp).toBe(Math.round(cfg.rewards.expPerMinute * 25 * m.focusEffective))
  })

  it('Rest heals fully and the Pokémon skips the next session (still gets EXP)', () => {
    const c = alwaysActivate('rest')
    const p = makeMon('squirtle', 20, { uid: 'a', equippedMoves: ['rest'], learnedMoves: ['rest'] }, c)
    const s0 = makePlayer([p], {}, c)
    const first = runSession(s0, 25, 1, {}, c)
    expect(first.result.members[0]!.rested).toBe(true)
    const applied = applySessionResult(first.state, first.result, c)
    if (!applied.ok) throw new Error(applied.error)
    expect(applied.value.state.pokemon.a!.asleepNextSession).toBe(true)
    const second = runSession(applied.value.state, 25, 2, { startedAt: T0 + 60 * MIN }, c)
    const m = second.result.members[0]!
    expect(m.asleep).toBe(true)
    expect(m.actions).toBe(0)
    expect(m.exp).toBeGreaterThan(0)
    const after = applySessionResult(second.state, second.result, c)
    expect(after.ok && after.value.state.pokemon.a!.asleepNextSession).toBe(false)
  })

  it('Rest sleep ends at the daily reset or after sitting out one completed session (boxed Pokémon)', () => {
    const c = alwaysActivate('rest')
    const p = makeMon('squirtle', 20, { uid: 'a', equippedMoves: ['rest'], learnedMoves: ['rest'] }, c)
    const q = makeMon('pidgey', 20, { uid: 'b' }, c)
    const first = runSession({ ...makePlayer([p], {}, c), pokemon: { a: p, b: q } }, 25, 1, {}, c)
    const applied = applySessionResult(first.state, first.result, c)
    if (!applied.ok) throw new Error(applied.error)
    const asleep = applied.value.state
    expect(asleep.pokemon.a!.asleepNextSession).toBe(true)
    expect(isAsleepAt(asleep, asleep.pokemon.a!, T0 + 60 * MIN, c)).toBe(true)
    // Boxed: next morning after 05:00 it wakes up.
    const boxed = { ...asleep, team: ['b'] }
    expect(isAsleepAt(boxed, boxed.pokemon.a!, Date.UTC(2026, 10, 4, 4, 59), c)).toBe(true)
    expect(refreshEnergy(boxed, Date.UTC(2026, 10, 4, 5, 0), c).pokemon.a!.asleepNextSession).toBe(false)
    // Boxed during a completed session (same day): it wakes up too.
    const other = runSession(boxed, 25, 2, { startedAt: T0 + 60 * MIN }, c)
    const after = applySessionResult(other.state, other.result, c)
    expect(after.ok && after.value.state.pokemon.a!.asleepNextSession).toBe(false)
  })

  it('Hydration avoids Rest sleep in rain', () => {
    const c = alwaysActivate('rest')
    const p = makeMon('vaporeon', 30, { uid: 'v', ability: 'hydration', equippedMoves: ['rest'], learnedMoves: ['rest'] }, c)
    const { result } = runSession(makePlayer([p], {}, c), 25, 1, { weather: { rain: true, sun: false, tempC: 15 } }, c)
    expect(result.members[0]!.techniques).toEqual([{ move: 'rest', count: 1 }])
    expect(result.members[0]!.rested).toBe(false)
  })

  it('Wish heals the teammate with least energy at the next session start', () => {
    const c = alwaysActivate('wish')
    const a = makeMon('clefairy', 20, { uid: 'a', equippedMoves: ['wish'], learnedMoves: ['wish'] }, c)
    const b = makeMon('pidgey', 20, { uid: 'b', energy: { current: 2, updatedAt: T0 } }, c)
    const first = runSession(makePlayer([a, b], {}, c), 25, 1, {}, c)
    expect(first.result.wishes).toHaveLength(1)
    const applied = applySessionResult(first.state, first.result, c)
    if (!applied.ok) throw new Error(applied.error)
    const st = startSession(applied.value.state, { plannedMinutes: 25, startedAt: T0 + 40 * MIN }, c)
    expect(st.ok && st.value.session.startHeals.map((h) => h.uid)).toEqual(['b'])
  })

  it('daily reset at 05:00 local, box regen per hour, break recovery', () => {
    const a = makeMon('pidgey', 20, { uid: 'a', energy: { current: 0, updatedAt: T0 } })
    const b = makeMon('zubat', 20, { uid: 'b', energy: { current: 0, updatedAt: T0 } })
    const s = { ...makePlayer([a]), pokemon: { a, b } }
    const later = refreshEnergy(s, T0 + 2 * 60 * MIN)
    expect(later.pokemon.a!.energy.current).toBe(0) // team: no regen
    expect(later.pokemon.b!.energy.current).toBeCloseTo(maxEnergyOf(b) * cfg.energy.boxRecoverPctPerHour * 2)
    const nextDay = refreshEnergy(s, Date.UTC(2026, 10, 4, 5, 0))
    expect(nextDay.pokemon.a!.energy.current).toBe(maxEnergyOf(a))
    const beforeReset = refreshEnergy(s, Date.UTC(2026, 10, 4, 4, 59))
    expect(beforeReset.pokemon.a!.energy.current).toBe(0)
    const br = completeBreak(s, T0 + MIN)
    expect(br.pokemon.a!.energy.current).toBeCloseTo(maxEnergyOf(a) * cfg.energy.breakRecoverPct)
  })
})

describe('rewards (GDD §3.2, §3.3, §4, §5.2)', () => {
  it('daily diminishing returns: 100% to 360 min, 50% to 600, then 0', () => {
    expect(dailyRewardFactor(0, 100, cfg)).toBe(1)
    expect(dailyRewardFactor(300, 100, cfg)).toBeCloseTo((60 + 40 * 0.5) / 100)
    expect(dailyRewardFactor(400, 50, cfg)).toBe(0.5)
    expect(dailyRewardFactor(600, 25, cfg)).toBe(0)
    const p = makeMon('pidgey', 20, { uid: 'a' })
    const capped = runSession(makePlayer([p], { days: { '2026-11-03': { minutes: 600, sessions: 10, firstStartMinute: 300 } } }), 25)
    expect(capped.result.rewardFactor).toBe(0)
    expect(capped.result.totalPoints).toBe(0)
    expect(capped.result.dust).toBe(0)
    expect(capped.result.waves).toHaveLength(0)
    expect(capped.result.members[0]!.exp).toBe(0)
  })

  it('base rewards: expPerMinute·25·(its Focus) EXP at focus 1, dustPerMinute·25 dust, pokeBallsPerSession balls', () => {
    const p = makeMon('pidgey', 20, { uid: 'a' })
    const { result } = runSession(makePlayer([p]), 25)
    expect(result.focus).toBe(1)
    // EXP uses the Pokémon's own Focus (session Focus × the Grit bonus); dust uses the session Focus.
    expect(result.members[0]!.exp).toBe(Math.round(cfg.rewards.expPerMinute * 25 * effectiveFocus(1, computeStats(p).defense, cfg)))
    expect(result.dust).toBe(Math.round(cfg.rewards.dustPerMinute * 25))
    expect(result.pokeBalls).toBe(cfg.rewards.pokeBallsPerSession)
    // Explicit config: the formula, not the tuning (no Grit bonus).
    const c = createEngineContext({ config: { rewards: { expPerMinute: 24, dustPerMinute: 10, pokeBallsPerSession: 2 }, actions: { defenseFocusMaxBonus: 0 } } })
    const fixed = runSession(makePlayer([makeMon('pidgey', 20, { uid: 'a' }, c)], {}, c), 25, 7, {}, c).result
    expect(fixed.members[0]!.exp).toBe(600)
    expect(fixed.dust).toBe(250)
    expect(fixed.pokeBalls).toBe(2)
    expect(result.waves).toHaveLength(1)
  })

  it('late claim halves focus except for lateClaimImmune Pokémon', () => {
    const gastly = makeMon('gastly', 20, { uid: 'g', ability: 'levitate' })
    const pidgey = makeMon('pidgey', 20, { uid: 'p', ability: 'keen-eye' })
    const endedAt = T0 + 25 * MIN
    const { result } = runSession(makePlayer([gastly, pidgey]), 25, 1, { claimedAt: endedAt + 10 * MIN })
    expect(result.lateClaim).toBe(true)
    expect(result.focus).toBe(cfg.session.lateClaimMultiplier)
    const [g, p] = result.members
    expect(g!.focusEffective).toBeCloseTo(effectiveFocus(1, computeStats(gastly).defense, cfg))
    expect(p!.focusEffective).toBeCloseTo(effectiveFocus(0.5, computeStats(pidgey).defense, cfg))
  })

  it('focus floors: no labels = base value, label floors per Pokémon', () => {
    // No shipped ability uses focusLabelFloor any more (screenshot Focus was discarded; Despiste is now a counterMiss),
    // so the primitive is exercised with a test-only ability.
    const labelCtx = createEngineContext({
      abilities: {
        ...ctx.abilities,
        'test-label-floor': { effects: [{ kind: 'focusLabelFloor', labels: ['chat', 'social'], value: 0.8 }], description: { es: '', en: '' } },
      },
    })
    const sw = makeMon('swinub', 20, { uid: 's', ability: 'test-label-floor' }, labelCtx)
    const social = { focusInputs: { screenshotLabels: ['social' as const], missedCaptures: 0 } }
    const { result } = runSession(makePlayer([sw], {}, labelCtx), 25, 1, social, labelCtx)
    expect(result.captureValue).toBe(cfg.focus.labelValues.social)
    expect(result.members[0]!.focusEffective).toBeGreaterThanOrEqual(0.8)
    // Without the ability the same screenshot leaves it below the floor.
    const plain = makeMon('swinub', 20, { uid: 's', ability: 'thick-fat' }, labelCtx)
    expect(runSession(makePlayer([plain], {}, labelCtx), 25, 1, social, labelCtx).result.members[0]!.focusEffective).toBeLessThan(0.8)
    const np = runSession(makePlayer([sw], {}, labelCtx), 25, 1, { focusInputs: { screenshotLabels: null, missedCaptures: 0 } }, labelCtx)
    expect(np.result.captureValue).toBe(cfg.focus.baseValue)
  })
})

describe('session Focus: 100 % on time, 50 % late, Grit on top (GDD §4)', () => {
  const NO_LABELS = { focusInputs: { screenshotLabels: null, missedCaptures: 0 } }

  it('base value is 1.0 (production has no labels); a late claim halves it to 0.5', () => {
    expect(cfg.focus.baseValue).toBe(1)
    expect(captureValue(NO_LABELS.focusInputs, cfg)).toBe(1)
    const p = makeMon('pidgey', 20, { uid: 'a', ability: 'keen-eye' }) // not Tangled Feet (a Focus floor)
    const onTime = runSession(makePlayer([p]), 25, 1, NO_LABELS).result
    expect(onTime.lateClaim).toBe(false)
    expect(onTime.focus).toBe(1)
    const late = runSession(makePlayer([p]), 25, 1, { ...NO_LABELS, claimedAt: T0 + 25 * MIN + (cfg.session.claimWindowMinutes + 1) * MIN }).result
    expect(late.lateClaim).toBe(true)
    expect(late.focus).toBe(0.5)
    // Each Pokémon: session Focus × its Grit bonus.
    const def = computeStats(p).defense
    expect(onTime.members[0]!.focusEffective).toBeCloseTo(1 + 0.1 * Math.min(1, def / 200))
    expect(late.members[0]!.focusEffective).toBeCloseTo(0.5 * (1 + 0.1 * Math.min(1, def / 200)))
  })

  it('the wave loses one wild on a late claim only', () => {
    const c = createEngineContext({ config: { encounters: { waveSizeJitter: 0 } } }).config
    const onTime = rollWaveSize(createRng(1), cfg.focus.baseValue, { league: 'super', sub: 5 }, 0, c)
    const late = rollWaveSize(createRng(1), cfg.focus.baseValue * cfg.session.lateClaimMultiplier, { league: 'super', sub: 5 }, 0, c)
    expect(late).toBe(onTime - 1)
    // Even with the strongest Grit the session Focus (not the Pokémon's) decides the wave size.
    expect(cfg.focus.baseValue).toBeGreaterThanOrEqual(cfg.encounters.lowFocusThreshold)
    expect(cfg.focus.baseValue * cfg.session.lateClaimMultiplier).toBeLessThan(cfg.encounters.lowFocusThreshold)
  })

  it('Inner Focus still floors a late claim at 75 %', () => {
    const z = makeMon('zubat', 30, { uid: 'z', ability: 'inner-focus' })
    const plain = makeMon('zubat', 30, { uid: 'y', ability: 'keen-eye' })
    const lateAt = { ...NO_LABELS, claimedAt: T0 + 25 * MIN + 10 * MIN }
    const late = runSession(makePlayer([z, plain]), 25, 1, lateAt).result
    expect(late.members[0]!.focusEffective).toBeCloseTo(0.75)
    expect(late.members[1]!.focusEffective).toBeCloseTo(effectiveFocus(0.5, computeStats(plain).defense, cfg))
    expect(late.members[1]!.focusEffective).toBeLessThan(0.75)
    // On time the floor does nothing (Focus is already ≥ 100 %).
    const onTime = runSession(makePlayer([z]), 25, 1, NO_LABELS).result
    expect(onTime.members[0]!.focusEffective).toBeCloseTo(effectiveFocus(1, computeStats(z).defense, cfg))
  })

  it('economy is neutral: the 0.85-scaled base values pay what the old 0.85 Focus paid (±2 %)', () => {
    // The old rule on time: Focus 0.85, effective = 0.85 + 0.15 · min(0.5, Def / 400)
    //   = 0.85 · (1 + (0.075 / 0.85) · min(1, Def / 200)), base points 5 + SpAtk / 4, 29 EXP/min, 10 dust/min.
    const legacy = createEngineContext({
      config: {
        focus: { baseValue: 0.85 },
        actions: { pointsBase: 5, pointsSpAtkDivisor: 4, defenseFocusMaxBonus: 0.075 / 0.85, defenseFocusCap: 200 },
        rewards: { expPerMinute: 29, dustPerMinute: 10 },
      },
    })
    const mon = (c: EngineContext) => makeMon('geodude', 50, { uid: 'g' }, c)
    const def = computeStats(mon(ctx)).defense
    expect(def).toBeGreaterThan(80) // mid Grit
    expect(def).toBeLessThan(150)
    const now = runSession(makePlayer([mon(ctx)]), 50, 3, NO_LABELS).result
    const old = runSession(makePlayer([mon(legacy)], {}, legacy), 50, 3, NO_LABELS, legacy).result
    expect(old.focus).toBe(0.85)
    expect(now.members[0]!.actions).toBe(old.members[0]!.actions)
    const near = (a: number, b: number) => expect(Math.abs(a / b - 1)).toBeLessThan(0.02)
    near(now.totalPoints, old.totalPoints)
    near(now.members[0]!.exp, old.members[0]!.exp)
    near(now.dust, old.dust)
    // Legendary (× Focus) and shiny (× (0.5 + Focus)) odds per wild are unchanged on time.
    expect(cfg.encounters.legendaryChance * cfg.focus.baseValue).toBeCloseTo(0.0016 * 0.85, 8)
    expect(cfg.encounters.shinyChance * (0.5 + cfg.focus.baseValue)).toBeCloseTo((1 / 512) * (0.5 + 0.85), 8)
  })
})

describe('session lifecycle (GDD §15)', () => {
  it('only one active session; claim is idempotent', () => {
    const s = makePlayer([makeMon('pidgey', 10, { uid: 'a' })])
    const st = startSession(s, { plannedMinutes: 25, startedAt: T0 })
    if (!st.ok) throw new Error(st.error)
    expect(startSession(st.value.state, { plannedMinutes: 25, startedAt: T0 + MIN })).toEqual({ ok: false, error: 'session_active' })
    expect(startSession(s, { plannedMinutes: 5, startedAt: T0 })).toEqual({ ok: false, error: 'invalid_duration' })
    const fake = { ...st.value.session, id: 'other' }
    const input = { endedAt: T0 + 25 * MIN, claimedAt: T0 + 26 * MIN, pausedSeconds: 0, focusInputs: STUDYING }
    expect(completeSession(st.value.state, fake, input, createRng(1))).toEqual({ ok: false, error: 'no_active_session' })
    const r = completeSession(st.value.state, st.value.session, input, createRng(1))
    if (!r.ok) throw new Error(r.error)
    const a = applySessionResult(st.value.state, r.value)
    if (!a.ok) throw new Error(a.error)
    expect(a.value.state.activeSession).toBeNull()
    expect(applySessionResult(a.value.state, r.value)).toEqual({ ok: false, error: 'already_applied' })
  })

  it('is deterministic with a fixed seed', () => {
    const team = [makeMon('gengar', 40, { uid: 'g', equippedMoves: ['shadow-ball', 'hypnosis'], learnedMoves: ['shadow-ball', 'hypnosis'] }), makeMon('pidgeot', 40, { uid: 'p' })]
    const s = makePlayer(team)
    const a = runSession(s, 100, 'seed-1').result
    const b = runSession(s, 100, 'seed-1').result
    const c = runSession(s, 100, 'seed-2').result
    expect(a).toEqual(b)
    expect(JSON.stringify(a.waves)).not.toEqual(JSON.stringify(c.waves))
    expect(a.waves).toHaveLength(4)
    expect(a.energyByBlock).toHaveLength(4)
  })

  it('applying a session updates league, history, streak, dust, balls and the encounter', () => {
    const s = makePlayer([makeMon('pidgey', 20, { uid: 'a' })])
    const { result, state } = runSession(s, 50)
    const a = applySessionResult(state, result)
    if (!a.ok) throw new Error(a.error)
    const n = a.value.state
    expect(n.league.weeklyPoints[weekKey(n, T0)]).toBe(result.totalPoints)
    expect(n.history).toHaveLength(1)
    expect(n.streak.current).toBe(1)
    expect(n.dust).toBe(s.dust + result.dust)
    expect(n.encounter?.waves).toHaveLength(2)
    expect(n.days['2026-11-03']).toEqual({ minutes: 50, sessions: 1, firstStartMinute: 600 })
    expect(n.pokemon.a!.exp).toBe(s.pokemon.a!.exp + result.members[0]!.exp)
  })
})

describe('leagues (GDD §14)', () => {
  it('thresholds and weekly reset on local Monday', () => {
    const th = cfg.leagues.weeklyThresholds
    expect(leagueForPoints(0)).toBe('base')
    expect(leagueForPoints(th.super)).toBe('super')
    expect(leagueForPoints(th.super - 1)).toBe('base')
    expect(leagueForPoints(th.master)).toBe('master')
    expect(leagueForPoints(th.super * cfg.leagues.monthlyMultiplier - 1, 'month')).toBe('base')
    const c = createEngineContext({ config: { leagues: { weeklyThresholds: { base: 0, super: 8000, ultra: 20000, master: 45000 }, monthlyMultiplier: 4 } } })
    expect(leagueForPoints(8000, 'week', c)).toBe('super')
    expect(leagueForPoints(45000, 'week', c)).toBe('master')
    expect(leagueForPoints(8000 * 4 - 1, 'month', c)).toBe('base')
    const s = makePlayer([makeMon('pidgey', 10)], { league: { weeklyPoints: { '2026-11-02': th.ultra }, monthlyPoints: {}, bestLeague: 'ultra' } })
    expect(weekKey(s, T0)).toBe('2026-11-02')
    expect(currentLeague(s, T0)).toBe('ultra')
    expect(currentLeague(s, Date.UTC(2026, 10, 9, 0, 1))).toBe('base')
  })
})

describe('effect primitives in sessions (docs/effects.md)', () => {
  it('content files only use known primitives', () => {
    expect(ctx.warnings).toEqual([])
  })

  it('pointsBurst, extraWild, healOverTime, lastActionMult', () => {
    const c = alwaysActivate('focus-energy', 'sweet-scent', 'aqua-ring')
    const base = makeMon('machop', 20, { uid: 'm', ability: 'guts', equippedMoves: ['karate-chop'], learnedMoves: ['karate-chop'] }, c)
    const plain = runSession(makePlayer([base], {}, c), 50, 1, {}, c).result.members[0]!
    const burst = runSession(makePlayer([{ ...base, equippedMoves: ['karate-chop', 'focus-energy'], level: 20 }], {}, c), 50, 1, {}, c).result.members[0]!
    expect(burst.techniques).toEqual([{ move: 'focus-energy', count: 1 }])
    expect(burst.points).toBeGreaterThan(plain.points)

    const scent = makeMon('bulbasaur', 20, { uid: 'b', equippedMoves: ['vine-whip', 'sweet-scent'], learnedMoves: ['vine-whip', 'sweet-scent'] }, c)
    expect(runSession(makePlayer([scent], {}, c), 25, 1, {}, c).result.extraWild).toBe(1)

    const ring = makeMon('vaporeon', 20, { uid: 'v', equippedMoves: ['water-gun', 'aqua-ring'], learnedMoves: ['water-gun', 'aqua-ring'], energy: { current: 10, updatedAt: T0 } }, c)
    expect(runSession(makePlayer([ring], {}, c), 25, 1, {}, c).result.members[0]!.energyHealed).toBeGreaterThan(0)

    const mag = makeMon('magnemite', 20, { uid: 'g', ability: 'sturdy' })
    const ana = { ...mag, ability: 'analytic' }
    const p1 = runSession(makePlayer([mag]), 25).result.members[0]!
    const p2 = runSession(makePlayer([ana]), 25).result.members[0]!
    expect(p2.points).toBeGreaterThan(p1.points)
  })

  it('statMod energyCost (thick-fat) and pace (agility)', () => {
    const sw = makeMon('swinub', 30, { uid: 's', ability: 'snow-cloak' })
    const fat = { ...sw, ability: 'thick-fat' }
    const a = runSession(makePlayer([sw]), 50).result.members[0]!
    const b = runSession(makePlayer([fat]), 50).result.members[0]!
    expect(b.energySpent / b.actions).toBeCloseTo((a.energySpent / a.actions) * 0.85)
    const pk = makeMon('pikachu', 10, { uid: 'p', equippedMoves: ['thunder-shock'], learnedMoves: ['thunder-shock'] })
    const fast = { ...pk, equippedMoves: ['thunder-shock', 'agility'], learnedMoves: ['thunder-shock', 'agility'] }
    expect(runSession(makePlayer([fast]), 50).result.members[0]!.actions).toBeGreaterThan(runSession(makePlayer([pk]), 50).result.members[0]!.actions)
  })
})

describe('cancelling a long session (GDD §3.4)', () => {
  it('cancelKeep: long sessions keep the minutes from 15 min on, and one wave per full block', () => {
    expect(cancelKeep(25, 20, cfg)).toEqual({ keeps: false, reason: 'short_session', minutes: 20, waves: 0 })
    expect(cancelKeep(50, 14.99, cfg)).toEqual({ keeps: false, reason: 'too_few_minutes', minutes: 14, waves: 0 })
    expect(cancelKeep(50, 15, cfg)).toEqual({ keeps: true, reason: null, minutes: 15, waves: 0 })
    expect(cancelKeep(50, 24.9, cfg)).toMatchObject({ keeps: true, minutes: 24, waves: 0 })
    expect(cancelKeep(50, 25, cfg)).toMatchObject({ keeps: true, minutes: 25, waves: 1 })
    expect(cancelKeep(100, 99.5, cfg)).toMatchObject({ keeps: true, minutes: 99, waves: 3 })
  })

  it('no wave, no Poké Balls and no roaming tick before the first block; energy is still spent', () => {
    const s = { ...makePlayer([makeMon('charmander', 20, { uid: 'a' })]), roaming: [{ speciesSlug: 'mewtwo', sessionsLeft: 2 }] }
    const { result } = runSession(s, 50, 3, { endedAt: T0 + 20 * MIN, claimedAt: T0 + 20 * MIN, cancelled: true })
    expect(result).toMatchObject({ cancelled: true, minutes: 20, pokeBalls: 0, lateClaim: false })
    expect(result.waves).toHaveLength(0)
    expect(result.energyByBlock).toHaveLength(0)
    expect(result.roamingAfter).toEqual([{ speciesSlug: 'mewtwo', sessionsLeft: 2 }])
    expect(result.totalPoints).toBeGreaterThan(0)
    expect(result.members[0]!.energySpent).toBeGreaterThan(0)
  })

  it('same as a completed session of the same length, except the waves (and nothing is ever late)', () => {
    const s = makePlayer([makeMon('charmander', 20, { uid: 'a' })])
    const done60 = runSession(s, 60, 5).result
    const cancel60 = runSession(s, 100, 5, { endedAt: T0 + 60 * MIN, claimedAt: T0 + 60 * MIN, cancelled: true }).result
    expect(cancel60.waves).toHaveLength(2)
    expect(cancel60.totalPoints).toBe(done60.totalPoints)
    expect(cancel60.dust).toBe(done60.dust)
    expect(cancel60.members[0]!.exp).toBe(done60.members[0]!.exp)
    // Cancelled long after the stop it reports (paused): never a late claim.
    const paused = runSession(s, 100, 5, { endedAt: T0 + 60 * MIN, claimedAt: T0 + 300 * MIN, cancelled: true }).result
    expect(paused).toMatchObject({ lateClaim: false, focus: 1 })
  })
})
