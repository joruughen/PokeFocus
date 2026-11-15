import { describe, expect, it } from 'vitest'
import { defaultContext } from './context'
import { abilityOutlook, actionPace, pointsBreakdown, sumPointsStages, techniqueOutlook, type ActivableOutlook, type DamageOutlook, type PassiveOutlook } from './explain'
import { activationChance, type PointsStages } from './session'
import { actionIntervalSeconds, catchEnergyPerAction, computeStats, energyCostPerAction, techniqueMultiplier } from './stats'
import { makeMon, makePlayer, MIN, runSession, T0 } from './test-helpers'

const ctx = defaultContext()
const cfg = ctx.config

describe('techniqueOutlook', () => {
  it('damage: Energy per action and per 25-minute block come from the same engine formulas', () => {
    const b = makeMon('bulbasaur', 20, { uid: 'b', equippedMoves: ['vine-whip', 'tackle'], learnedMoves: ['vine-whip', 'tackle'] })
    const stats = computeStats(b)
    const o = techniqueOutlook(b, 'vine-whip') as DamageOutlook
    expect(o.kind).toBe('damage')
    expect(o.stab).toBe(true) // grass on a grass Pokemon
    expect(o.share).toBeCloseTo(0.5) // two damage moves share the actions
    expect(o.energyPerAction).toBeCloseTo(catchEnergyPerAction(stats.attack, o.power, cfg))
    expect(o.pace.intervalSeconds).toBeCloseTo(actionIntervalSeconds(stats.speed, cfg))
    expect(o.pace.actionsPerWave).toBeCloseTo((cfg.session.waveMinutes * 60) / o.pace.intervalSeconds)
    expect(o.energyPerWave).toBeCloseTo(o.energyPerAction * o.pace.actionsPerWave * 0.5)
    expect(o.pace.energyCostPerAction).toBeCloseTo(energyCostPerAction(20, cfg))
    // A move that is not equipped yet counts itself among the damage moves.
    const solo = makeMon('bulbasaur', 20, { uid: 'b2', equippedMoves: [], learnedMoves: ['tackle'] })
    expect((techniqueOutlook(solo, 'tackle') as DamageOutlook).share).toBe(1)
  })

  it('damage: the energy per action matches what a real session produces', () => {
    const b = makeMon('bulbasaur', 20, { uid: 'b', equippedMoves: ['tackle'], learnedMoves: ['tackle'] })
    const m = runSession(makePlayer([b]), 25).result.members[0]!
    const o = techniqueOutlook(b, 'tackle') as DamageOutlook
    expect(m.catchEnergy).toBeCloseTo(o.energyPerAction * m.actions)
  })

  it('activable: the per-action chance is the one the session logs', () => {
    const g = makeMon('gengar', 40, { uid: 'g', equippedMoves: ['hypnosis'], learnedMoves: ['hypnosis'] })
    const o = techniqueOutlook(g, 'hypnosis') as ActivableOutlook
    expect(o.kind).toBe('activable')
    const def = ctx.techniques.hypnosis!
    expect(o.baseChance).toBe(def.baseChance)
    expect(o.techniqueMult).toBeCloseTo(techniqueMultiplier(computeStats(g).specialDefense, cfg))
    expect(o.chancePerAction).toBeCloseTo(activationChance(def.baseChance!, computeStats(g).specialDefense, 0, 1, cfg))
    const log = runSession(makePlayer([g]), 50).result.members[0]!.activables![0]!
    expect(log.chanceAvg).toBeCloseTo(o.chancePerAction)
    expect(o.inflicts).toBe('sleep')
    expect(o.limitPerSession).toBe(def.limitPerSession ?? null)
    // Expected per wave never exceeds the session limit and "at least once" is a probability.
    if (o.limitPerSession !== null) expect(o.expectedPerWave).toBeLessThanOrEqual(o.limitPerSession)
    expect(o.atLeastOncePerWave).toBeGreaterThan(0)
    expect(o.atLeastOncePerWave).toBeLessThanOrEqual(1)
  })

  it('activable: Mastery raises the chance (and the cap holds)', () => {
    const base = makeMon('gengar', 40, { uid: 'g', equippedMoves: ['hypnosis'], learnedMoves: ['hypnosis'] })
    const trained = { ...base, moveMasteryMinutes: { hypnosis: 100 * 60 } }
    const a = techniqueOutlook(base, 'hypnosis') as ActivableOutlook
    const b = techniqueOutlook(trained, 'hypnosis') as ActivableOutlook
    expect(b.masteryMult).toBeGreaterThan(a.masteryMult)
    expect(b.chancePerAction).toBeGreaterThanOrEqual(a.chancePerAction)
    expect(b.chancePerAction).toBeLessThanOrEqual(cfg.actions.maxActivationChance)
  })

  it('passive: always on without conditions; the ability reports its rolls', () => {
    const sw = makeMon('swinub', 30, { uid: 's', ability: 'snow-cloak' })
    const ab = abilityOutlook(sw) as PassiveOutlook
    expect(ab.kind).toBe('passive')
    expect(ab.rolls).toContainEqual(expect.objectContaining({ kind: 'counterMiss' }))
    const none = makeMon('swinub', 30, { uid: 's2', ability: null })
    expect(abilityOutlook(none)).toBeNull()
  })

  it('passive: a conditional effect is reported as a condition, not as always on', () => {
    const day = Object.entries(ctx.abilities).find(([, d]) => d.effects.length > 0 && d.effects.every((e) => e.when?.timeWindow === 'daylight'))
    expect(day).toBeDefined()
    const mon = makeMon('gastly', 20, { uid: 'g', ability: day![0] })
    const o = abilityOutlook(mon) as PassiveOutlook
    expect(o.always).toBe(false)
    expect(o.whens).toContainEqual(expect.objectContaining({ timeWindow: 'daylight' }))
  })

  it('returns null for a move that does not exist in the game', () => {
    expect(techniqueOutlook(makeMon('bulbasaur', 5), 'not-a-move')).toBeNull()
  })

  it('actionPace: a full Energy bar pays for max / cost actions', () => {
    const p = makeMon('pikachu', 15)
    const pace = actionPace(p)
    expect(pace.actionsOnFullEnergy).toBeCloseTo(computeStats(p).hp / energyCostPerAction(15, cfg))
  })
})

describe('pointsBreakdown', () => {
  it('steps add up to the points of every member and the team, rounded', () => {
    const team = [
      makeMon('gengar', 40, { uid: 'g', equippedMoves: ['hypnosis', 'lick'], learnedMoves: ['hypnosis', 'lick'] }),
      makeMon('pikachu', 15, { uid: 'p', equippedMoves: ['thunder-shock'], learnedMoves: ['thunder-shock'] }),
    ]
    // 21:00 (Ghost condition), a late claim and a second session of the day: several steps are active.
    const player = makePlayer(team, { days: { '2026-11-03': { minutes: 200, sessions: 3, firstStartMinute: 600 } as never } })
    const { result } = runSession(player, 50, 3, { startedAt: T0 + 11 * 60 * MIN, claimedAt: T0 + 11 * 60 * MIN + 50 * MIN + 10 * MIN })
    expect(result.lateClaim).toBe(true)
    for (const m of result.members) {
      const steps = pointsBreakdown(m.pointsStages!, result.rewardFactor, m.points)
      expect(steps[0]!.kind).toBe('base')
      expect(steps.reduce((a, s) => a + s.delta, 0)).toBe(m.points)
      expect(steps.at(-1)!.total).toBe(m.points)
    }
    const stages = sumPointsStages(result.members.map((m) => m.pointsStages))!
    const steps = pointsBreakdown(stages, result.rewardFactor, result.totalPoints)
    expect(steps.reduce((a, s) => a + s.delta, 0)).toBe(result.totalPoints)
    const kinds = steps.map((s) => s.kind)
    expect(kinds).toContain('condition')
    // Late claim is its own step (×0.5), not folded into "Focus": on-screen Focus stays at 100 %.
    expect(kinds).toContain('late')
    expect(kinds).not.toContain('focus')
    const late = steps.find((s) => s.kind === 'late')!
    expect(late.factor).toBeCloseTo(cfg.session.lateClaimMultiplier)
    expect(late.delta).toBeLessThan(0)
    expect(kinds.indexOf('late')).toBeGreaterThan(kinds.indexOf('condition'))
  })

  it('claiming on time has no late step; the steps still add up', () => {
    const { result } = runSession(makePlayer([makeMon('pikachu', 15, { uid: 'p' })]), 25)
    expect(result.lateClaim).toBe(false)
    const m = result.members[0]!
    const steps = pointsBreakdown(m.pointsStages!, result.rewardFactor, m.points)
    expect(steps.find((s) => s.kind === 'late')).toBeUndefined()
    expect(steps.reduce((a, s) => a + s.delta, 0)).toBe(m.points)
  })

  it('results saved before the late step (no afterLate) keep the late penalty inside Focus', () => {
    const stages: PointsStages = { base: 100, afterCondition: 100, afterBond: 100, afterFocus: 50, afterGrit: 50, afterFocusAdj: 50, afterMods: 50, afterBurst: 50, raw: 50 }
    const steps = pointsBreakdown(stages, 1, 50)
    expect(steps.map((s) => s.kind)).toEqual(['base', 'focus'])
    expect(steps.find((s) => s.kind === 'focus')!.factor).toBeCloseTo(0.5)
    expect(sumPointsStages([stages, { ...stages, afterLate: 25 }])!.afterLate).toBeUndefined()
  })

  it('Grit appears as its own step and is capped at +10 %', () => {
    const tank = makeMon('pikachu', 50, { uid: 't', ability: null })
    const { result } = runSession(makePlayer([tank]), 25)
    const m = result.members[0]!
    const steps = pointsBreakdown(m.pointsStages!, result.rewardFactor, m.points)
    const grit = steps.find((s) => s.kind === 'grit')
    expect(grit).toBeDefined()
    expect(grit!.factor).toBeGreaterThan(1)
    expect(grit!.factor).toBeLessThanOrEqual(1 + cfg.actions.defenseFocusMaxBonus + 1e-9)
    // Focus on time is 100 %: no Focus step.
    expect(steps.find((s) => s.kind === 'focus')).toBeUndefined()
  })

  it('the daily reduction is the last step and carries the reward factor', () => {
    const p = makeMon('pikachu', 15, { uid: 'p' })
    const player = makePlayer([p], { days: { '2026-11-03': { minutes: cfg.session.dailyFullRewardMinutes + 60, sessions: 4, firstStartMinute: 600 } as never } })
    const { result } = runSession(player, 25)
    expect(result.rewardFactor).toBeLessThan(1)
    const m = result.members[0]!
    const steps = pointsBreakdown(m.pointsStages!, result.rewardFactor, m.points)
    const last = steps.at(-1)!
    expect(last.kind).toBe('daily')
    expect(last.factor).toBeCloseTo(result.rewardFactor)
    expect(last.delta).toBeLessThan(0)
  })

  it('a member with no log makes the team sum null (older results)', () => {
    const stages: PointsStages = { base: 1, afterCondition: 1, afterBond: 1, afterFocus: 1, afterGrit: 1, afterFocusAdj: 1, afterMods: 1, afterBurst: 1, raw: 1 }
    expect(sumPointsStages([stages, undefined])).toBeNull()
    expect(sumPointsStages([stages, stages])!.base).toBe(2)
  })

  it('does not change results: the same seed gives the same points', () => {
    const mk = () => makePlayer([makeMon('gengar', 40, { uid: 'g' }), makeMon('pikachu', 15, { uid: 'p' })])
    const a = runSession(mk(), 50, 11).result
    const b = runSession(mk(), 50, 11).result
    expect(b).toEqual(a)
    expect(a.members.map((m) => m.points)).toEqual(b.members.map((m) => m.points))
  })
})

void MIN
