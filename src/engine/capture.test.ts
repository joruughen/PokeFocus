import { describe, expect, it } from 'vitest'
import { applySessionResult } from './session'
import { advanceWave, applyStatusCharge, ballCounterTarget, captureChance, catchBreakdown, counterDamage, encounterModifiers, rerollWild, resolveCounter, resolveCounterOn, throwBall, wildCatchChance } from './capture'
import { createEngineContext, defaultContext, type EngineContext } from './context'
import type { AbilityDef } from './effect-types'
import { passiveEffects } from './effects'
import { createRng, type Rng } from './rng'
import type { EncounterState, PlayerState, WildPokemon } from './state'
import { computeStats } from './stats'
import { makeMon, makePlayer, runSession, T0 } from './test-helpers'
import type { WaveHit } from './state'
import {
  classicDamage,
  computeDamage,
  damageFromHits,
  hitDamage,
  hpFractionAfter,
  STAB_MULT,
  studyBallMaxLevelFor,
  syncedLevel,
  wildLevelRange,
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

  it('legacy damage (old saves) uses session energy × effectiveness with a 5% HP floor', () => {
    const contributions = [{ uid: 'a', type: 'water' as const, amount: 30, amountVsLegendary: 39, effectivenessFloors: [] }]
    expect(computeDamage(contributions, ['fire'], false, ctx.chart)).toBe(60)
    expect(computeDamage(contributions, ['fire'], true, ctx.chart)).toBe(78)
    expect(hpFractionAfter(60, 100, cfg)).toBeCloseTo(0.4)
    expect(hpFractionAfter(1e6, 100, cfg)).toBe(cfg.capture.minHpFraction)
  })
})

describe('capture damage: classic formula (GDD §11.3)', () => {
  const base: WaveHit = {
    uid: 'a',
    target: 0,
    move: 'water-gun',
    type: 'water',
    power: 40,
    damageClass: 'special',
    level: 20,
    attack: 40,
    stab: false,
    units: 1,
    unitsVsLegendary: 1,
    effectivenessFloors: [],
  }
  const noSync = createEngineContext({ config: { capture: { levelSync: null, captureDamageScale: 1 } } })

  it('((2L/5+2)·P·A/D/50+2) · STAB · effectiveness · scale · units', () => {
    expect(classicDamage(50, 100, 100, 100)).toBeCloseTo(((2 * 50) / 5 + 2) * 100 / 50 + 2)
    const st = { defense: 30, specialDefense: 20 }
    const core = classicDamage(20, 40, 40, 20)
    expect(hitDamage(base, st, 20, ['normal'], false, noSync)).toBeCloseTo(core)
    expect(hitDamage({ ...base, damageClass: 'physical' }, st, 20, ['normal'], false, noSync)).toBeCloseTo(classicDamage(20, 40, 40, 30))
    expect(hitDamage({ ...base, stab: true }, st, 20, ['normal'], false, noSync)).toBeCloseTo(core * STAB_MULT)
    expect(hitDamage(base, st, 20, ['fire'], false, noSync)).toBeCloseTo(core * 2)
    expect(hitDamage(base, st, 20, ['grass', 'dragon'], false, noSync)).toBeCloseTo(core * 0.25)
    expect(hitDamage({ ...base, effectivenessFloors: [{ from: 0.5, to: 1 }] }, st, 20, ['grass'], false, noSync)).toBeCloseTo(core)
    expect(hitDamage({ ...base, units: 3, unitsVsLegendary: 4 }, st, 20, ['normal'], false, noSync)).toBeCloseTo(core * 3)
    expect(hitDamage({ ...base, units: 3, unitsVsLegendary: 4 }, st, 20, ['normal'], true, noSync)).toBeCloseTo(core * 4)
    const half = createEngineContext({ config: { capture: { levelSync: null, captureDamageScale: 0.5 } } })
    expect(hitDamage(base, st, 20, ['normal'], false, half)).toBeCloseTo(core * 0.5)
  })

  it('level sync: against a weaker wild the attacker fights at its level (Attack scaled)', () => {
    const c = createEngineContext({ config: { capture: { levelSync: { ratio: 1, gap: 0 }, captureDamageScale: 1 } } })
    expect(syncedLevel(40, 10, c.config)).toBe(10)
    expect(syncedLevel(8, 10, c.config)).toBe(8)
    expect(syncedLevel(40, 10, noSync.config)).toBe(40)
    const st = { defense: 20, specialDefense: 20 }
    const hit = { ...base, level: 40, attack: 80 }
    expect(hitDamage(hit, st, 10, ['normal'], false, c)).toBeCloseTo(classicDamage(10, 40, 20, 20))
  })

  it('damageFromHits only counts the hits aimed at that slot, against the wild Def/SpDef', () => {
    const w = wild('charmander', 15)
    const stats = computeStats(w, ctx)
    const hits = [base, { ...base, target: 1, units: 5 }, { ...base, damageClass: 'physical' as const, units: 2 }]
    const expected = hitDamage(base, stats, 15, ['fire'], false, ctx) + hitDamage(hits[2]!, stats, 15, ['fire'], false, ctx)
    expect(damageFromHits(hits, 0, w, false, ctx)).toBeCloseTo(expected)
  })

  it('session waves: every wild damage = its hits, units = actions (pace-neutral), floor 5%', () => {
    const team = [makeMon('squirtle', 20, { uid: 'a' }), makeMon('charmander', 20, { uid: 'b' })]
    const { result } = runSession(makePlayer(team), 50, 3)
    expect(result.waves).toHaveLength(2)
    for (const wave of result.waves) {
      expect(wave.hits!.length).toBeGreaterThan(0)
      wave.wilds.forEach((w, i) => {
        expect(w.damage).toBeCloseTo(damageFromHits(wave.hits!, i, w, w.isLegendary, ctx))
        expect(w.hpFraction).toBeCloseTo(hpFractionAfter(w.damage, w.maxHp, cfg))
        expect(w.hpFraction).toBeGreaterThanOrEqual(cfg.capture.minHpFraction)
      })
      for (const h of wave.hits!) expect(h.target).toBeLessThan(wave.wilds.length)
    }
    // Pace-neutral: Σ units of a member = its actions × interval ratio (no captureEnergy mods here).
    const unitsA = result.waves.flatMap((w) => w.hits!).filter((h) => h.uid === 'a').reduce((x, h) => x + h.units, 0)
    expect(unitsA).toBeGreaterThan(0)
    const plain = createEngineContext({ config: { capture: { damageReferenceSpeed: null } } })
    const r2 = runSession(makePlayer(team, {}, plain), 50, 3, {}, plain).result
    const actionsA = r2.members.find((m) => m.uid === 'a')!.actions
    const unitsPlain = r2.waves.flatMap((w) => w.hits!).filter((h) => h.uid === 'a').reduce((x, h) => x + h.units, 0)
    expect(unitsPlain).toBeCloseTo(actionsA)
  })

  it('no damage move: Normal, power 40, physical, × noDamageMoveEnergyFactor', () => {
    const meta = makeMon('metapod', 12, { uid: 'm', equippedMoves: ['harden'], learnedMoves: ['harden'] })
    const plain = createEngineContext({ config: { capture: { damageReferenceSpeed: null } } })
    const { result } = runSession(makePlayer([meta], {}, plain), 25, 1, {}, plain)
    const hits = result.waves[0]!.hits!
    expect(hits.every((h) => h.type === 'normal' && h.power === 40 && h.damageClass === 'physical' && h.move === null)).toBe(true)
    const units = hits.reduce((x, h) => x + h.units, 0)
    expect(units).toBeCloseTo(result.members[0]!.actions * plain.config.actions.noDamageMoveEnergyFactor)
  })

  it('reroll: the new wild takes the hits aimed at its slot', () => {
    const team = [makeMon('squirtle', 20, { uid: 'a' })]
    const { result, state } = runSession(makePlayer(team, { autoDamage: true }), 25, 5)
    const applied = applySessionResult(state, result)
    if (!applied.ok) throw new Error(applied.error)
    const s0 = applied.value.state
    const s = { ...s0, encounter: { ...s0.encounter!, charges: [{ id: 'r1', kind: 'reroll' as const, sourceUid: 'a', source: 'roar' }] } }
    const r = rerollWild(s, 'r1', { waveIndex: 0, wildIndex: 0 }, createRng(3))
    if (!r.ok) throw new Error(r.error)
    const wave = r.value.encounter!.waves[0]!
    const w = wave.wilds[0]!
    expect(w.damage).toBeCloseTo(damageFromHits(wave.hits!, 0, w, w.isLegendary, ctx))
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

  it('league wave bonus is added before the league cap', () => {
    const c = createEngineContext({
      config: { encounters: { baseWaveSize: 4, waveSizeJitter: 0, minWaveSize: 3, leagueWaveBonus: { base: 0, super: 1, ultra: 2, master: 3 }, leagueMaxWaveSize: { base: 5, super: 6, ultra: 7, master: 8 } } } }).config
    const sizes = (['base', 'super', 'ultra', 'master'] as const).map((l) => rollWaveSize(createRng(1), 1, l, 0, c))
    expect(sizes).toEqual([4, 5, 6, 7])
    expect(rollWaveSize(createRng(1), 1, 'master', 2, c)).toBe(8) // capped
    expect(rollWaveSize(createRng(1), 0.2, 'super', 0, c)).toBe(4) // low focus −1
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

  it('study ball eligibility: base form, not legendary, level ≤ max(studyBallMaxLevel, wild min + margin)', () => {
    const sp = (s: string) => ctx.speciesBySlug.get(s)!
    const max1 = studyBallMaxLevelFor(1, cfg)
    expect(max1).toBe(Math.max(cfg.encounters.studyBallMaxLevel, wildLevelRange(1, cfg).min + cfg.encounters.studyBallLevelMargin))
    expect(isStudyBallEligible(sp('pidgey'), max1, cfg)).toBe(true)
    expect(isStudyBallEligible(sp('pidgey'), max1 + 1, cfg)).toBe(false)
    expect(isStudyBallEligible(sp('pidgeotto'), 18, cfg)).toBe(false)
    expect(isStudyBallEligible(sp('mew'), 10, cfg)).toBe(false)
    const c = createEngineContext({
      config: { encounters: { studyBallMaxLevel: 20, studyBallLevelMargin: 10, wildLevelByTrainerLevel: [{ trainerLevel: 1, min: 2, max: 10 }, { trainerLevel: 40, min: 20, max: 50 }] } } }).config
    expect(studyBallMaxLevelFor(1, c)).toBe(20)
    expect(studyBallMaxLevelFor(40, c)).toBe(30)
    expect(isStudyBallEligible(sp('pidgey'), 30, c, 40)).toBe(true)
    expect(isStudyBallEligible(sp('pidgey'), 31, c, 40)).toBe(false)
    expect(isStudyBallEligible(sp('pidgey'), 25, c)).toBe(false)
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

describe('catchBreakdown (catch chance tooltip)', () => {
  it('a Squirtle at minimum HP with a Great Ball: ≈26 %, from its low capture rate (45), not its level or the weather', () => {
    const s = makePlayer([makeMon('bulbasaur', 10)])
    const w = wild('squirtle', 3, { hpFraction: 0.01 })
    const b = catchBreakdown(s, w, 'great-ball')
    expect(b.chance).toBe(wildCatchChance(s, w, 'great-ball'))
    expect(b.captureRate).toBe(45)
    expect(b.hpAtFloor).toBe(true)
    expect(b.hpFraction).toBe(cfg.capture.minHpFraction)
    expect(b.ballMult).toBe(1.5)
    expect(b.abilityMult).toBe(1)
    expect(b.chance).toBeCloseTo(0.256, 2)
    expect(b.hpFactor * b.rateFactor * b.ballMult * b.abilityMult * b.statusMult * b.nextThrowBonus).toBeCloseTo(b.chance, 10)
    // What would help: sleep ×2.5, paralysis ×1.5, an Ultra Ball ×2.
    expect(b.ifAsleep).toBeCloseTo(b.chance * cfg.capture.statusMult.sleep, 10)
    expect(b.ifParalyzed).toBeCloseTo(b.chance * cfg.capture.statusMult.paralysis, 10)
    expect(b.withUltra).toBeCloseTo((b.chance / 1.5) * 2, 10)
    // Level does not enter the formula.
    expect(catchBreakdown(s, wild('squirtle', 40, { hpFraction: 0.01 }), 'great-ball').chance).toBe(b.chance)
  })

  it('status already applied: no "if asleep" hints; guaranteed throws and capped chances', () => {
    const s = makePlayer([makeMon('bulbasaur', 10)])
    const asleep = catchBreakdown(s, wild('squirtle', 3, { hpFraction: 0.01, status: 'sleep' }), 'poke-ball')
    expect(asleep.ifAsleep).toBeNull()
    expect(asleep.ifParalyzed).toBeNull()
    expect(asleep.statusMult).toBe(cfg.capture.statusMult.sleep)
    const shiny = catchBreakdown(s, wild('pidgeotto', 20, { isShiny: true, guaranteedBall: 'great-ball' }), 'ultra-ball')
    expect(shiny).toMatchObject({ chance: 1, guaranteed: 'ball', withUltra: null })
    const easy = catchBreakdown(s, wild('pidgey', 3, { hpFraction: 0.01 }), 'ultra-ball')
    expect(easy.chance).toBe(1)
    expect(easy.capped).toBe(true)
    expect(easy.withUltra).toBeNull()
    for (const ball of ['poke-ball', 'great-ball', 'ultra-ball'] as const) {
      for (const slug of ['squirtle', 'pidgey', 'mewtwo']) {
        const w = wild(slug, 20, { hpFraction: 0.4, isLegendary: slug === 'mewtwo' })
        expect(catchBreakdown(s, w, ball).chance).toBe(wildCatchChance(s, w, ball))
      }
    }
  })
})

describe('capture formula (GDD §11.2)', () => {
  it('Mewtwo with R = 30 (GDD example): ≈7.8% unprepared, ≈55% prepared (Ultra Ball)', () => {
    const c30 = createEngineContext({ config: { capture: { legendaryMinCaptureRate: 30 } } }).config
    const mewtwo = ctx.speciesBySlug.get('mewtwo')!
    expect(captureChance(mewtwo.captureRate, true, 1, 2, null, c30)).toBeCloseTo(0.078, 3)
    expect(captureChance(mewtwo.captureRate, true, 0.1, 2, 'sleep', c30)).toBeCloseTo(0.549, 2)
    expect(captureChance(255, false, 0.05, 2, 'sleep', cfg)).toBe(1)
  })

  it('legendaries use max(captureRate, legendaryMinCaptureRate) from config', () => {
    const mewtwo = ctx.speciesBySlug.get('mewtwo')!
    const R = Math.max(mewtwo.captureRate, cfg.capture.legendaryMinCaptureRate)
    expect(captureChance(mewtwo.captureRate, true, 1, 2, null, cfg)).toBeCloseTo((1 / 3) * (R / 255) * 2, 6)
    const h = 0.1
    expect(captureChance(mewtwo.captureRate, true, h, 2, 'sleep', cfg)).toBeCloseTo((1 - (2 * h) / 3) * (R / 255) * 2 * cfg.capture.statusMult.sleep, 6)
  })
})

describe('counterattacks (GDD §11.4)', () => {
  it('damage = maxHP · 8% · √(lvW/lvL) · eff · (1 − min(0.5, Def/400)), legendaries ×2', () => {
    const m = cfg.capture.counter.damageMult
    const d = counterDamage(100, 25, 100, 100, 2, false, cfg)
    expect(d).toBeCloseTo(100 * 0.08 * 2 * 2 * 0.75 * m)
    expect(counterDamage(100, 25, 1000, 25, 1, true, cfg)).toBeCloseTo(100 * 0.08 * 0.5 * 2 * m)
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

describe('a failed ball always hits the leader (GDD §11.4)', () => {
  const hit = (uid: string, target: number, attack: number, units = 10): WaveHit => ({
    uid, target, move: 'tackle', type: 'normal', power: 40, damageClass: 'physical', level: 20, attack, stab: false, units, unitsVsLegendary: units, effectivenessFloors: [],
  })
  const L = makeMon('charmander', 20, { uid: 'L' })
  const A = makeMon('bulbasaur', 20, { uid: 'A' })
  /** Squirtle in slot 0, already attacked by A (locked: A assigned there, its attack recorded). */
  function setup(team = [L, A]): PlayerState {
    const s = withEncounter(makePlayer(team), [wild('squirtle', 20), wild('pidgey', 20)])
    const enc = s.encounter!
    return {
      ...s,
      encounter: {
        ...enc,
        waves: enc.waves.map((w) =>
          w.index === 0 ? { ...w, hits: [hit('A', 0, 60)], assignments: { A: 0 }, damageLocked: true, attacks: { A: { wildIndex: 0, counter: null, skipped: null } } } : w,
        ),
      },
    }
  }
  const ref = { waveIndex: 0, wildIndex: 0 }

  it('ballCounterTarget is the leader, or the next member with Energy', () => {
    expect(ballCounterTarget(setup())).toBe('L')
    const tiredL = { ...L, energy: { current: 0, updatedAt: T0 } }
    expect(ballCounterTarget(setup([tiredL, A]))).toBe('A')
    expect(ballCounterTarget(setup([tiredL, { ...A, energy: { current: 0, updatedAt: T0 } }]))).toBeNull()
  })

  it('the wild that A attacked still strikes the leader when a ball fails', () => {
    const s = setup()
    let out = null
    for (let seed = 1; seed < 60 && !out; seed++) {
      const r = throwBall(s, ref, 'poke-ball', createRng(seed), T0)
      if (r.ok && r.value.outcome.kind === 'failed') out = r.value
    }
    expect(out).not.toBeNull()
    if (!out || out.outcome.kind !== 'failed') return
    expect(out.outcome.counter?.targetUid).toBe('L')
    expect(out.state.pokemon.A!.energy.current).toBe(A.energy.current)
    expect(out.state.pokemon.L!.energy.current).toBeLessThan(L.energy.current)
  })

  it('a ball counter ignores the wild\'s status (only attacks are spared by sleep)', () => {
    const s = setup()
    const asleep = { ...s.encounter!.waves[0]!.wilds[0]!, status: 'sleep' as const }
    expect(resolveCounter(s, asleep, createRng(1))!.counter.targetUid).toBe('L')
  })

  it('resolveCounterOn hits whoever it is given, with its own abilities', () => {
    const bouncer = makeMon('espeon', 20, { uid: 'A', ability: 'magic-bounce' })
    const s = setup([L, bouncer])
    const w = s.encounter!.waves[0]!.wilds[0]!
    const r = resolveCounterOn(s, 'A', w, createRng(1))!
    expect(r.counter.targetUid).toBe('A')
    expect(r.counter.reflected).toBeCloseTo(0.1)
    expect(r.wild.extraHpLoss).toBeCloseTo(0.1)
    expect(resolveCounter(s, w, createRng(1))!.counter.reflected).toBe(0)
  })

  it('capture.counter.damageMult scales every counterattack', () => {
    const x2 = createEngineContext({ config: { capture: { counter: { damageMult: 2 } } } })
    const x1 = createEngineContext({ config: { capture: { counter: { damageMult: 1 } } } })
    expect(counterDamage(100, 20, 100, 20, 1, false, x2.config)).toBeCloseTo(2 * counterDamage(100, 20, 100, 20, 1, false, x1.config))
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

describe('Despiste: team-scope counterMiss', () => {
  const DESPISTE: AbilityDef['effects'] = [{ kind: 'counterMiss', chance: 0.15, scope: 'team' }]
  const wildSq = wild('squirtle', 20)

  /** An Rng that records every draw, so tests can count how many a counter consumed. */
  function recorder(seed: number | string): { rng: Rng; draws: number[] } {
    const base = createRng(seed)
    const draws: number[] = []
    return {
      draws,
      rng: {
        next() {
          const u = base.next()
          draws.push(u)
          return u
        },
      },
    }
  }

  /** `n` independent counterattacks against the same state, from one seeded stream. */
  function counters(state: PlayerState, n: number, seed: number | string, c: EngineContext = ctx) {
    const { rng, draws } = recorder(seed)
    const results = []
    for (let i = 0; i < n; i++) {
      const before = draws.length
      const r = resolveCounter(state, wildSq, rng, c)!
      results.push({ counter: r.counter, used: draws.slice(before) })
    }
    return { results, draws }
  }

  const missRate = (rs: { counter: { missed: boolean } }[]) => rs.filter((r) => r.counter.missed).length / rs.length

  function team(opts: { holderFirst?: boolean; holder?: Partial<Parameters<typeof makeMon>[2]>; c?: EngineContext } = {}) {
    const c = opts.c ?? ctx
    const leader = makeMon('charmander', 20, { uid: 'L', ability: null }, c)
    const holder = makeMon('piloswine', 25, { uid: 'P', ability: 'oblivious', ...opts.holder }, c)
    const members = opts.holderFirst ? [holder, leader] : [leader, holder]
    return withEncounter(makePlayer(members, {}, c), [wildSq])
  }

  it('Swinub and Piloswine load it from the real data (es + en, numbers in sync)', () => {
    expect(ctx.abilities.oblivious?.effects).toEqual(DESPISTE)
    expect(ctx.warnings.filter((w) => w.includes('oblivious'))).toEqual([])
    for (const slug of ['swinub', 'piloswine']) {
      expect(getAbilitySlugs(slug)).toContain('oblivious')
      const mon = makeMon(slug, 20, { ability: 'oblivious' })
      expect(passiveEffects(mon, ctx).filter((e) => e.sourceKind === 'ability').map((e) => e.effect)).toEqual(DESPISTE)
    }
    const d = ctx.abilities.oblivious!.description
    expect(d.es).toContain('15%')
    expect(d.en).toContain('15%')
    expect(d.es).not.toMatch(/Foco/)
  })

  function getAbilitySlugs(slug: string): string[] {
    return ctx.speciesBySlug.get(slug)!.abilities.map((a) => a.slug)
  }

  it('applies to whoever is hit, even when the holder is not the target (~15% of counters miss)', () => {
    const s = team()
    const N = 6000
    const { results, draws } = counters(s, N, 'despiste-team')
    expect(results.every((r) => r.counter.targetUid === 'L')).toBe(true)
    expect(encounterModifiers(s, ctx).teamCounterMiss).toBe(0.15)
    // Exactly one draw per counter, and a miss exactly when that draw is below 15%.
    expect(draws).toHaveLength(N)
    for (const r of results) expect(r.counter.missed).toBe(r.used[0]! < 0.15)
    expect(Math.abs(missRate(results) - 0.15)).toBeLessThan(0.02)
    // Missed counters do no damage; the others hit as usual.
    const plain = resolveCounter(team({ holder: { ability: null } }), wildSq, createRng(1))!.counter.damage
    for (const r of results) expect(r.counter.damage).toBe(r.counter.missed ? 0 : plain)
    // Deterministic with the same seed.
    expect(counters(s, 500, 'despiste-team').results.map((r) => r.counter.missed)).toEqual(results.slice(0, 500).map((r) => r.counter.missed))
  })

  it('also applies when the holder leads and is the one hit', () => {
    const { results } = counters(team({ holderFirst: true }), 4000, 'despiste-leader')
    expect(results.every((r) => r.counter.targetUid === 'P')).toBe(true)
    expect(Math.abs(missRate(results) - 0.15)).toBeLessThan(0.02)
  })

  it('without a holder nothing changes: no miss, no random draw', () => {
    const s = team({ holder: { ability: null } })
    expect(encounterModifiers(s, ctx).teamCounterMiss).toBe(0)
    const { results, draws } = counters(s, 200, 'no-holder')
    expect(draws).toHaveLength(0)
    expect(results.some((r) => r.counter.missed)).toBe(false)
  })

  it('does not stack with the target\'s own counterMiss: the strongest wins (max, never a sum or product)', () => {
    // Target with snow-cloak (self 25%) + Despiste on the team (15%) -> 25%.
    const leader = makeMon('swinub', 20, { uid: 'L', ability: 'snow-cloak' })
    const holder = makeMon('piloswine', 25, { uid: 'P', ability: 'oblivious' })
    const s = withEncounter(makePlayer([leader, holder]), [wildSq])
    const a = counters(s, 6000, 'max-self-wins')
    expect(a.results.every((r) => r.counter.targetUid === 'L')).toBe(true)
    expect(a.draws).toHaveLength(6000)
    for (const r of a.results) expect(r.counter.missed).toBe(r.used[0]! < 0.25)
    expect(Math.abs(missRate(a.results) - 0.25)).toBeLessThan(0.02)
    // A weaker own counterMiss (10%) loses to the team's 15%.
    const weak = createEngineContext({ abilities: { ...ctx.abilities, 'snow-cloak': { ...ctx.abilities['snow-cloak']!, effects: [{ kind: 'counterMiss', chance: 0.1 }] } } })
    const l2 = makeMon('swinub', 20, { uid: 'L', ability: 'snow-cloak' }, weak)
    const h2 = makeMon('piloswine', 25, { uid: 'P', ability: 'oblivious' }, weak)
    const b = counters(withEncounter(makePlayer([l2, h2], {}, weak), [wildSq]), 3000, 'max-team-wins', weak)
    for (const r of b.results) expect(r.counter.missed).toBe(r.used[0]! < 0.15)
    // Two holders (and a self-scope 25% on the target) still give a single draw at the best chance.
    const h3 = makeMon('swinub', 20, { uid: 'Q', ability: 'oblivious' })
    const c = counters(withEncounter(makePlayer([leader, holder, h3]), [wildSq]), 500, 'two-holders')
    expect(c.draws).toHaveLength(500)
    for (const r of c.results) expect(r.counter.missed).toBe(r.used[0]! < 0.25)
    const two = counters(withEncounter(makePlayer([makeMon('charmander', 20, { uid: 'L', ability: null }), holder, h3]), [wildSq]), 500, 'two-holders-2')
    for (const r of two.results) expect(r.counter.missed).toBe(r.used[0]! < 0.15)
  })

  it('a team-scope effect on the target itself does not double count with the self rule', () => {
    const s = team({ holderFirst: true })
    const { results } = counters(s, 500, 'self-team')
    expect(results.every((r) => r.used.length === 1)).toBe(true)
    for (const r of results) expect(r.counter.missed).toBe(r.used[0]! < 0.15)
  })

  it('contributors count like the other team-scope effects: exhausted members still count, members outside the team do not', () => {
    // Convention check: an exhausted holder keeps contributing its team effects (unnerve = counterNoFirst).
    const exhaustedUnnerve = makeMon('houndour', 20, { uid: 'H', ability: 'unnerve', energy: { current: 0, updatedAt: T0 } })
    const lead = makeMon('charmander', 20, { uid: 'L', ability: null })
    expect(encounterModifiers(makePlayer([lead, exhaustedUnnerve]), ctx).counterNoFirst).toBe(true)
    // Same for Despiste: the holder is exhausted (cannot be the target) but the team still gets it.
    const s = team({ holder: { energy: { current: 0, updatedAt: T0 } } })
    expect(encounterModifiers(s, ctx).teamCounterMiss).toBe(0.15)
    const { results } = counters(s, 300, 'exhausted-holder')
    expect(results.every((r) => r.counter.targetUid === 'L')).toBe(true)
    for (const r of results) expect(r.counter.missed).toBe(r.used[0]! < 0.15)
    // A holder in the box (not on the team) does nothing.
    const solo = withEncounter(makePlayer([makeMon('charmander', 20, { uid: 'L', ability: null })]), [wildSq])
    const away = { ...solo, pokemon: { ...solo.pokemon, P: makeMon('piloswine', 25, { uid: 'P', ability: 'oblivious' }) } }
    expect(away.team).not.toContain('P')
    expect(encounterModifiers(away, ctx).teamCounterMiss).toBe(0)
    const none = counters(away, 100, 'box-holder')
    expect(none.draws).toHaveLength(0)
  })

  it("each contributor's `when` is read against its own context (isLeader on the holder)", () => {
    const c = createEngineContext({ abilities: { ...ctx.abilities, oblivious: { ...ctx.abilities.oblivious!, effects: [{ kind: 'counterMiss', chance: 0.15, scope: 'team', when: { isLeader: true } }] } } })
    const notLeader = team({ c })
    expect(encounterModifiers(notLeader, c).teamCounterMiss).toBe(0)
    expect(counters(notLeader, 50, 'when-no', c).draws).toHaveLength(0)
    const leader = team({ c, holderFirst: true })
    expect(encounterModifiers(leader, c).teamCounterMiss).toBe(0.15)
    expect(counters(leader, 50, 'when-yes', c).draws).toHaveLength(50)
  })

  it('a self-scope counterMiss on a non-target never leaks to the team (sand-veil second does nothing)', () => {
    const lead = makeMon('charmander', 20, { uid: 'L', ability: null })
    const veil = makeMon('sandshrew', 20, { uid: 'S', ability: 'sand-veil' })
    const s = withEncounter(makePlayer([lead, veil]), [wildSq])
    expect(encounterModifiers(s, ctx).teamCounterMiss).toBe(0)
    expect(counters(s, 100, 'veil-second').draws).toHaveLength(0)
  })

  it('RNG sequence is unchanged for teams without a team-scope counterMiss (same draws and outcomes as the old rule)', () => {
    // Old rule: miss chance = the target's own counterMiss only; chance(rng, 0) draws nothing.
    const legacyMiss = (state: PlayerState): number => {
      const target = state.team.map((u) => state.pokemon[u]!).find((p) => p.energy.current > 0)!
      return Math.max(0, ...passiveEffects(target, ctx).flatMap((e) => (e.effect.kind === 'counterMiss' ? [e.effect.chance] : [])))
    }
    const mk = (...mons: ReturnType<typeof makeMon>[]) => withEncounter(makePlayer(mons), [wildSq])
    const teams: Record<string, PlayerState> = {
      plain: mk(makeMon('charmander', 20, { uid: 'L', ability: null }), makeMon('pidgey', 20, { uid: 'O', ability: null })),
      selfVeil: mk(makeMon('swinub', 20, { uid: 'L', ability: 'snow-cloak' }), makeMon('pidgey', 20, { uid: 'O', ability: null })),
      veilSecond: mk(makeMon('charmander', 20, { uid: 'L', ability: null }), makeMon('swinub', 20, { uid: 'S', ability: 'snow-cloak' })),
      otherTeamEffects: mk(makeMon('houndour', 20, { uid: 'L', ability: 'unnerve' }), makeMon('clefairy', 20, { uid: 'F', ability: 'friend-guard' })),
      swinubOtherAbility: mk(makeMon('swinub', 20, { uid: 'L', ability: 'thick-fat' }), makeMon('piloswine', 25, { uid: 'S', ability: 'snow-cloak' })),
    }
    for (const [name, s] of Object.entries(teams)) {
      const legacy = legacyMiss(s)
      expect(encounterModifiers(s, ctx).teamCounterMiss, name).toBe(0)
      for (let seed = 1; seed <= 60; seed++) {
        const { rng, draws } = recorder(seed)
        const r = resolveCounter(s, wildSq, rng, ctx)!
        expect(draws.length, `${name} seed ${seed}`).toBe(legacy > 0 ? 1 : 0)
        expect(r.counter.missed, `${name} seed ${seed}`).toBe(legacy > 0 && draws[0]! < legacy)
        // Whatever was drawn, the stream continues exactly where the old code would have left it.
        const ref = createRng(seed)
        if (legacy > 0) ref.next()
        expect(rng.next()).toBe(ref.next())
      }
    }
  })

  it('throwBall passes the team miss through the real throw flow', () => {
    const noLuck = createEngineContext({ config: { capture: { balls: { 'poke-ball': { mult: 0, shinyGuarantee: { maxStage: 1, maxLevel: 25 } } } } } })
    let missed = 0
    let total = 0
    for (let seed = 0; seed < 300; seed++) {
      let s = team({ c: noLuck })
      const rng = createRng(`flow${seed}`)
      for (let i = 0; i < noLuck.config.capture.maxFailedThrows; i++) {
        const r = throwBall(s, { waveIndex: 0, wildIndex: 0 }, 'poke-ball', rng, T0, noLuck)
        if (!r.ok || r.value.outcome.kind === 'caught') throw new Error('unexpected')
        const c = r.value.outcome.counter!
        expect(c.targetUid).toBe('L')
        total++
        if (c.missed) missed++
        s = r.value.state
      }
    }
    expect(Math.abs(missed / total - 0.15)).toBeLessThan(0.04)
  })
})

describe('throwing balls (GDD §11.1)', () => {
  const noLuck = createEngineContext({ config: { capture: { balls: { 'poke-ball': { mult: 0, shinyGuarantee: { maxStage: 1, maxLevel: 25 } } } } } })

  it('Study Ball: guaranteed on eligible wilds, one per wave, lost when advancing', () => {
    const s = withEncounter(makePlayer([makeMon('squirtle', 10)]), [wild('pidgey', 5, { studyBallEligible: true }), wild('pidgeotto', 20, { studyBallEligible: false })])
    expect(throwBall(s, { waveIndex: 0, wildIndex: 1 }, 'study-ball', createRng(1), T0)).toEqual({ ok: false, error: 'not_study_eligible' })
    const r = throwBall(s, { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    expect(r.ok && r.value.outcome.kind).toBe('caught')
    if (!r.ok) return
    const caughtUid = r.value.outcome.kind === 'caught' ? r.value.outcome.uid : ''
    expect(r.value.state.pokemon[caughtUid]?.speciesSlug).toBe('pidgey')
    expect(r.value.state.candies.chains[String(ctx.speciesBySlug.get('pidgey')!.evolutionChainId)]).toBe(3)
    expect(r.value.state.inventory['study-ball']).toBeUndefined()
    const again = withEncounter(makePlayer([makeMon('squirtle', 10)]), [wild('pidgey', 5, { studyBallEligible: true }), wild('pidgey', 6, { studyBallEligible: true })])
    const once = throwBall(again, { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    expect(once.ok && throwBall(once.value.state, { waveIndex: 0, wildIndex: 1 }, 'study-ball', createRng(1), T0)).toEqual({ ok: false, error: 'study_ball_unavailable' })
    const next = advanceWave(again)
    expect(next.encounter?.waves[0]?.studyBall).toBe('lost')
    expect(throwBall(next, { waveIndex: 0, wildIndex: 1 }, 'poke-ball', createRng(1), T0)).toEqual({ ok: false, error: 'wave_not_current' })
  })

  it('the Study Ball does not lock the wave: nobody attacks or takes a counter, and the team can still be assigned', () => {
    // A real claimed session (damage tokens included), so the first ball would normally make everyone attack.
    const s0 = makePlayer([makeMon('machamp', 15, { uid: 'L' }), makeMon('butterfree', 17, { uid: 'B' }), makeMon('pidgey', 13, { uid: 'P' })])
    const run = runSession(s0, 25, 1)
    const applied = applySessionResult(run.state, run.result)
    if (!applied.ok) throw new Error(applied.error)
    const enc = applied.value.state.encounter!
    const wave0 = enc.waves[0]!
    const s: PlayerState = {
      ...applied.value.state,
      encounter: { ...enc, waves: enc.waves.map((w) => (w.index === 0 ? { ...w, studyBall: 'available', wilds: w.wilds.map((x, i) => (i === 0 ? { ...x, studyBallEligible: true } : x)) } : w)) },
    }
    const before = Object.fromEntries(s.team.map((u) => [u, s.pokemon[u]!.energy.current]))
    const r = throwBall(s, { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0)
    expect(r.ok && r.value.outcome.kind).toBe('caught')
    if (!r.ok) return
    const after = r.value.state
    for (const u of s.team) expect(after.pokemon[u]!.energy.current).toBe(before[u])
    const wave = after.encounter!.waves[0]!
    expect(wave.damageLocked ?? false).toBe(false)
    expect(Object.keys(wave.attacks ?? {})).toHaveLength(0)
    // Another ball afterwards still locks the wave as usual (everyone left attacks).
    expect(wave0.wilds.length).toBeGreaterThan(1)
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

  it('refuses a status charge on a wild that already has a status (the charge is kept)', () => {
    const w = { ...wild('pidgey', 10), status: 'paralysis' as const }
    const s = withEncounter(makePlayer([makeMon('squirtle', 10)]), [w])
    expect(applyStatusCharge(s, 'c1', { waveIndex: 0, wildIndex: 0 })).toEqual({ ok: false, error: 'already_has_status' })
    expect(s.encounter!.charges).toHaveLength(1)
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
