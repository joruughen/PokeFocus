import { describe, expect, it } from 'vitest'
import { advanceWave, applyStatusCharge, captureChance, counterDamage, rerollWild, resolveCounter, throwBall, wildCatchChance } from './capture'
import { createEngineContext, defaultContext, type EngineContext } from './context'
import { createRng } from './rng'
import type { EncounterState, PlayerState, WildPokemon } from './state'
import { computeStats } from './stats'
import { makeMon, makePlayer, T0 } from './test-helpers'
import {
  computeDamage,
  hpFractionAfter,
  isStudyBallEligible,
  rollWaveSize,
  rollWild,
  shinyGuaranteeBall,
  typeEffectiveness,
  waveCount,
} from './waves'

const ctx = defaultContext()
const cfg = ctx.config

function wild(slug: string, level: number, patch: Partial<WildPokemon> = {}, c: EngineContext = ctx): WildPokemon {
  const gen = { focus: 1, trainerLevel: 1, soundDominant: null, teamTypes: [], typeWeightMults: {}, syncNature: null }
  const w = rollWild(createRng(`${slug}${level}`), { waveIndex: 0, gen, activeConditionTypes: [], contributions: [], forceSpecies: slug }, c)
  return { ...w, level, isShiny: false, guaranteedBall: null, ...patch }
}

function withEncounter(state: PlayerState, wilds: WildPokemon[], studyBall: 'available' | 'converted' = 'available'): PlayerState {
  const enc: EncounterState = {
    sessionId: 's0',
    waves: [
      { index: 0, wilds, studyBall, contributions: [], activeConditionTypes: [] },
      { index: 1, wilds: [wild('pidgey', 5)], studyBall: 'available', contributions: [], activeConditionTypes: [] },
    ],
    currentWave: 0,
    charges: [{ id: 'c1', kind: 'status', status: 'sleep', sourceUid: 'x', source: 'hypnosis' }],
    gen: { focus: 1, trainerLevel: 1, soundDominant: null, teamTypes: [], typeWeightMults: {}, syncNature: null },
    env: { localHour: 10, weekend: false, weather: null, noPauses: true, sessionMinutes: 25 },
  }
  return { ...state, encounter: enc }
}

describe('type chart (GDD §9.3, §11.3)', () => {
  it('multiplies dual types and applies effectiveness floors per component', () => {
    const chart = ctx.chart
    expect(typeEffectiveness('fire', ['grass'], chart)).toBe(2)
    expect(typeEffectiveness('electric', ['water', 'flying'], chart)).toBe(4)
    expect(typeEffectiveness('ground', ['electric', 'flying'], chart)).toBe(0)
    expect(typeEffectiveness('fire', ['water', 'rock'], chart)).toBe(0.25)
    expect(typeEffectiveness('grass', ['fire', 'flying'], chart, [{ from: 0.5, to: 1 }])).toBe(1) // tinted lens
    expect(typeEffectiveness('normal', ['ghost', 'poison'], chart, [{ from: 0, to: 0.5 }])).toBe(0.5) // infiltrator
  })

  it('damage uses session energy × effectiveness with a 5% HP floor', () => {
    const contributions = [{ uid: 'a', type: 'water' as const, amount: 30, amountVsLegendary: 39, effectivenessFloors: [] }]
    expect(computeDamage(contributions, ['fire'], false, ctx.chart)).toBe(60)
    expect(computeDamage(contributions, ['fire'], true, ctx.chart)).toBe(78)
    expect(hpFractionAfter(60, 100, cfg)).toBeCloseTo(0.4)
    expect(hpFractionAfter(1e6, 100, cfg)).toBe(cfg.capture.minHpFraction)
  })
})

describe('waves (GDD §10)', () => {
  it('one wave per completed 25-min block, at least one', () => {
    expect([15, 25, 49, 50, 74, 75, 99, 100, 120].map((m) => waveCount(m, cfg))).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('wave size respects min 3 and the league cap', () => {
    const rng = createRng(9)
    for (let i = 0; i < 300; i++) {
      const base = rollWaveSize(rng, 1, 'base', 3, cfg)
      expect(base).toBeLessThanOrEqual(5)
      expect(rollWaveSize(rng, 0.2, 'master', 0, cfg)).toBeGreaterThanOrEqual(3)
      expect(rollWaveSize(rng, 1, 'master', 6, cfg)).toBeLessThanOrEqual(8)
    }
    expect(rollWaveSize(createRng(1), 1, 'master', 10, cfg)).toBe(8)
    expect(rollWaveSize(createRng(1), 1, 'super', 10, cfg)).toBe(6)
  })

  it('evolved forms only appear at or above their evolution level', () => {
    const rng = createRng(4)
    const gen = { focus: 1, trainerLevel: 40, soundDominant: null, teamTypes: [], typeWeightMults: {}, syncNature: null }
    for (let i = 0; i < 300; i++) {
      const w = rollWild(rng, { waveIndex: 0, gen, activeConditionTypes: [], contributions: [] }, ctx)
      if (w.speciesSlug === 'charizard') expect(w.level).toBeGreaterThanOrEqual(36)
      if (w.speciesSlug === 'ivysaur') expect(w.level).toBeGreaterThanOrEqual(16)
      if (w.isLegendary) expect(w.level).toBeGreaterThanOrEqual(cfg.encounters.legendaryMinLevel)
    }
  })

  it('study ball eligibility: base form, not legendary, level ≤ 20', () => {
    const sp = (s: string) => ctx.speciesBySlug.get(s)!
    expect(isStudyBallEligible(sp('pidgey'), 20, cfg)).toBe(true)
    expect(isStudyBallEligible(sp('pidgey'), 21, cfg)).toBe(false)
    expect(isStudyBallEligible(sp('pidgeotto'), 18, cfg)).toBe(false)
    expect(isStudyBallEligible(sp('mew'), 10, cfg)).toBe(false)
  })

  it('shiny guarantees by ball tier; legendaries never guaranteed', () => {
    const sp = (s: string) => ctx.speciesBySlug.get(s)!
    expect(shinyGuaranteeBall(sp('pidgey'), 25, true, cfg)).toBe('poke-ball')
    expect(shinyGuaranteeBall(sp('pidgey'), 30, true, cfg)).toBe('great-ball')
    expect(shinyGuaranteeBall(sp('pidgeotto'), 20, true, cfg)).toBe('great-ball')
    expect(shinyGuaranteeBall(sp('pidgeot'), 40, true, cfg)).toBe('ultra-ball')
    expect(shinyGuaranteeBall(sp('pidgey'), 50, true, cfg)).toBe('ultra-ball')
    expect(shinyGuaranteeBall(sp('pidgey'), 10, false, cfg)).toBeNull()
    expect(shinyGuaranteeBall(sp('mewtwo'), 50, true, cfg)).toBeNull()
    const s = makePlayer([makeMon('squirtle', 10)])
    const w = wild('pidgeotto', 20, { isShiny: true, guaranteedBall: 'great-ball' })
    expect(wildCatchChance(s, w, 'ultra-ball')).toBe(1)
    expect(wildCatchChance(s, w, 'great-ball')).toBe(1)
    expect(wildCatchChance(s, w, 'poke-ball')).toBeLessThan(1)
  })
})

describe('capture formula (GDD §11.2)', () => {
  it('Mewtwo: ≈7.8% unprepared, ≈55% prepared (Ultra Ball)', () => {
    const mewtwo = ctx.speciesBySlug.get('mewtwo')!
    expect(captureChance(mewtwo.captureRate, true, 1, 2, null, cfg)).toBeCloseTo(0.078, 3)
    expect(captureChance(mewtwo.captureRate, true, 0.1, 2, 'sleep', cfg)).toBeCloseTo(0.549, 2)
    expect(captureChance(255, false, 0.05, 2, 'sleep', cfg)).toBe(1)
  })
})

describe('counterattacks (GDD §11.4)', () => {
  it('damage = maxHP · 8% · √(lvW/lvL) · eff · (1 − min(0.5, Def/400)), legendaries ×2', () => {
    const d = counterDamage(100, 25, 100, 100, 2, false, cfg)
    expect(d).toBeCloseTo(100 * 0.08 * 2 * 2 * 0.75)
    expect(counterDamage(100, 25, 1000, 25, 1, true, cfg)).toBeCloseTo(100 * 0.08 * 0.5 * 2)
  })

  it('hits the leader with its most effective type, or the next member with energy', () => {
    const leader = makeMon('charmander', 20, { uid: 'L' })
    const other = makeMon('pidgey', 20, { uid: 'O' })
    const w = wild('squirtle', 20)
    const s = withEncounter(makePlayer([leader, other]), [w])
    const r = resolveCounter(s, w, createRng(1))!
    expect(r.counter.targetUid).toBe('L')
    expect(r.counter.attackType).toBe('water')
    const st = computeStats(leader, ctx)
    expect(r.counter.damage).toBeCloseTo(counterDamage(st.hp, 20, st.defense, 20, 2, false, cfg))
    const exhausted = { ...leader, energy: { current: 0, updatedAt: T0 } }
    const r2 = resolveCounter(withEncounter(makePlayer([exhausted, other]), [w]), w, createRng(1))!
    expect(r2.counter.targetUid).toBe('O')
  })

  it('magic-guard takes no damage, sturdy keeps 1 energy, absorb abilities heal', () => {
    const w = wild('mewtwo', 80, { isLegendary: true })
    const clef = makeMon('clefairy', 10, { uid: 'C', ability: 'magic-guard' })
    expect(resolveCounter(withEncounter(makePlayer([clef]), [w]), w, createRng(1))!.counter.damage).toBe(0)
    const geo = makeMon('geodude', 5, { uid: 'G', ability: 'sturdy', energy: { current: 3, updatedAt: T0 } })
    const r = resolveCounter(withEncounter(makePlayer([geo]), [w]), w, createRng(1))!
    expect(r.counter.survivedWith1).toBe(true)
    expect(r.counter.energyAfter).toBe(1)
    const vap = makeMon('vaporeon', 30, { uid: 'V', ability: 'water-absorb', energy: { current: 10, updatedAt: T0 } })
    const sq = wild('squirtle', 30)
    const r3 = resolveCounter(withEncounter(makePlayer([vap]), [sq]), sq, createRng(1))!
    expect(r3.counter.damage).toBe(0)
    expect(r3.counter.healed).toBeCloseTo(computeStats(vap, ctx).hp * cfg.capture.counter.immuneHealPct)
  })
})

describe('counter effects', () => {
  it('counterReflect removes wild HP (5% floor), counterStatus inflicts a status, nextThrowBonus boosts', () => {
    const w = wild('pidgey', 20)
    const esp = makeMon('espeon', 30, { uid: 'E', ability: 'magic-bounce' })
    const r = resolveCounter(withEncounter(makePlayer([esp]), [w]), w, createRng(1))!
    expect(r.counter.reflected).toBeCloseTo(0.1)
    expect(r.wild.hpFraction).toBeCloseTo(0.9)
    const low = { ...w, hpFraction: 0.08 }
    expect(resolveCounter(withEncounter(makePlayer([esp]), [low]), low, createRng(1))!.wild.hpFraction).toBe(cfg.capture.minHpFraction)
    const sure = createEngineContext({
      abilities: { ...ctx.abilities, 'cursed-body': { ...ctx.abilities['cursed-body']!, effects: [{ kind: 'counterStatus', status: 'paralysis', chance: 1 }] } },
    })
    const gen = makeMon('gengar', 30, { uid: 'G', ability: 'cursed-body' }, sure)
    const r2 = resolveCounter(withEncounter(makePlayer([gen], {}, sure), [w]), w, createRng(1), sure)!
    expect(r2.counter.statusInflicted).toBe('paralysis')
    const mach = makeMon('machop', 30, { uid: 'M', ability: 'steadfast' })
    expect(resolveCounter(withEncounter(makePlayer([mach]), [w]), w, createRng(1))!.wild.nextThrowBonus).toBe(1.15)
  })
})

describe('throwing balls (GDD §11.1)', () => {
  const noLuck = createEngineContext({ config: { capture: { balls: { 'poke-ball': { mult: 0, shinyGuarantee: { maxStage: 1, maxLevel: 25 } } } } } })

  it('Study Ball: guaranteed on eligible wilds, one per wave, lost when advancing', () => {
    const s = withEncounter(makePlayer([makeMon('squirtle', 10)]), [wild('pidgey', 5), wild('pidgeotto', 20)])
    expect(throwBall(s, { waveIndex: 0, wildIndex: 1 }, 'study-ball', createRng(1), T0)).toEqual({ ok: false, error: 'not_study_eligible' })
    const r = throwBall(s, { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    expect(r.ok && r.value.outcome.kind).toBe('caught')
    if (!r.ok) return
    const caughtUid = r.value.outcome.kind === 'caught' ? r.value.outcome.uid : ''
    expect(r.value.state.pokemon[caughtUid]?.speciesSlug).toBe('pidgey')
    expect(r.value.state.candies.chains[String(ctx.speciesBySlug.get('pidgey')!.evolutionChainId)]).toBe(3)
    expect(r.value.state.inventory['study-ball']).toBeUndefined()
    const again = withEncounter(makePlayer([makeMon('squirtle', 10)]), [wild('pidgey', 5), wild('pidgey', 6)])
    const once = throwBall(again, { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    expect(once.ok && throwBall(once.value.state, { waveIndex: 0, wildIndex: 1 }, 'study-ball', createRng(1), T0)).toEqual({ ok: false, error: 'study_ball_unavailable' })
    const next = advanceWave(again)
    expect(next.encounter?.waves[0]?.studyBall).toBe('lost')
    expect(throwBall(next, { waveIndex: 0, wildIndex: 1 }, 'poke-ball', createRng(1), T0)).toEqual({ ok: false, error: 'wave_not_current' })
  })

  it('fails trigger counters, the wild flees after maxFailedThrows; legendaries become roaming', () => {
    let s = withEncounter(makePlayer([makeMon('squirtle', 30, { uid: 'L' })]), [wild('mewtwo', 50, { isLegendary: true })])
    const outcomes = []
    for (let i = 0; i < cfg.capture.maxFailedThrows; i++) {
      const r = throwBall(s, { waveIndex: 0, wildIndex: 0 }, 'poke-ball', createRng(i), T0, noLuck)
      if (!r.ok) throw new Error(r.error)
      outcomes.push(r.value.outcome)
      s = r.value.state
    }
    expect(outcomes.map((o) => o.kind)).toEqual(['failed', 'failed', 'fled'])
    expect(outcomes.every((o) => o.kind !== 'caught' && o.counter !== null)).toBe(true)
    expect(s.roaming).toEqual([{ speciesSlug: 'mewtwo', sessionsLeft: cfg.encounters.roamingSessions }])
    expect(s.inventory['poke-ball']).toBe(10 - cfg.capture.maxFailedThrows)
  })

  it('counterNoFirst skips the first counter; maxFailedThrows adds a throw (non-stacking)', () => {
    const leader = makeMon('houndour', 20, { uid: 'H', ability: 'unnerve' })
    const z1 = makeMon('zubat', 20, { uid: 'Z1', equippedMoves: ['mean-look'], learnedMoves: ['mean-look'] })
    const z2 = makeMon('gastly', 20, { uid: 'Z2', equippedMoves: ['mean-look'], learnedMoves: ['mean-look'] })
    let s = withEncounter(makePlayer([leader, z1, z2]), [wild('pidgey', 10)])
    const kinds: string[] = []
    const counters: boolean[] = []
    for (let i = 0; i < 4; i++) {
      const r = throwBall(s, { waveIndex: 0, wildIndex: 0 }, 'poke-ball', createRng(i), T0, noLuck)
      if (!r.ok) throw new Error(r.error)
      kinds.push(r.value.outcome.kind)
      if (r.value.outcome.kind !== 'caught') counters.push(r.value.outcome.counter !== null)
      s = r.value.state
    }
    expect(kinds).toEqual(['failed', 'failed', 'failed', 'fled'])
    expect(counters).toEqual([false, true, true, true])
  })

  it('status charges set the wild status and boost the catch chance', () => {
    const w = wild('pidgey', 10)
    const s = withEncounter(makePlayer([makeMon('squirtle', 10)]), [w])
    const before = wildCatchChance(s, w, 'poke-ball')
    const r = applyStatusCharge(s, 'c1', { waveIndex: 0, wildIndex: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const after = r.value.encounter!.waves[0]!.wilds[0]!
    expect(after.status).toBe('sleep')
    expect(wildCatchChance(r.value, after, 'poke-ball')).toBeCloseTo(Math.min(1, before * cfg.capture.statusMult.sleep))
    expect(r.value.encounter!.charges).toHaveLength(0)
  })
})

describe('reroll charges', () => {
  it('replaces a wild and converts the Study Ball if no eligible wild remains', () => {
    const s0 = withEncounter(makePlayer([makeMon('squirtle', 10)]), [wild('pidgey', 5)])
    const s = { ...s0, encounter: { ...s0.encounter!, charges: [{ id: 'r1', kind: 'reroll' as const, sourceUid: 'x', source: 'roar' }] } }
    const r = rerollWild(s, 'r1', { waveIndex: 0, wildIndex: 0 }, createRng(99))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.encounter!.charges).toHaveLength(0)
    const w = r.value.encounter!.waves[0]!
    if (!w.wilds[0]!.studyBallEligible) {
      expect(w.studyBall).toBe('converted')
      expect(r.value.inventory['poke-ball']).toBe(11)
    }
    expect(applyStatusCharge(s, 'r1', { waveIndex: 0, wildIndex: 0 })).toEqual({ ok: false, error: 'wrong_charge_kind' })
  })
})
