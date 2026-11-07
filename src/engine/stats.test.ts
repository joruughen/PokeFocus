import { describe, expect, it } from 'vitest'
import { createEngineContext, defaultContext } from './context'
import { createIndividual, rollAbility, rollIvs } from './individual'
import { createRng } from './rng'
import { computeStats, defenseFocusBonus, effectiveBase, effectiveFocus, natureMultiplier, statValue } from './stats'
import { extraMoveCandidates, getTechnique, isUsableMove, techniqueSlots } from './moves'

const ctx = defaultContext()
const cfg = ctx.config

describe('stat formula (GDD §5.1, §6.1)', () => {
  it('matches the Bulbasaur level-50 table on raw base stats', () => {
    // HP base 45, SpAtk base 65
    expect(statValue('hp', 45, 0, 50)).toBe(105)
    expect(statValue('hp', 45, 31, 50)).toBe(120)
    expect(statValue('specialAttack', 65, 0, 50, 0.9)).toBe(63)
    expect(statValue('specialAttack', 65, 31, 50, 1.1)).toBe(93)
  })

  it('applies the stat curve before the formula: pivot + (base − pivot)·k', () => {
    const c = cfg.statCurves.speed
    expect(effectiveBase('speed', 130, cfg)).toBeCloseTo(c.pivot + (130 - c.pivot) * c.k)
    expect(effectiveBase('speed', c.pivot, cfg)).toBe(c.pivot)
    // With k = 1 the curve is the identity and computeStats equals the raw formula.
    const flat = createEngineContext({
      config: {
        statCurves: Object.fromEntries(['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'].map((k) => [k, { pivot: 70, k: 1 }])),
      },
    })
    const ivs = { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 }
    const st = computeStats({ speciesSlug: 'bulbasaur', level: 50, ivs, nature: 'hardy' }, flat)
    expect(st.hp).toBe(105)
    // Curves compress extremes: Bulbasaur HP 45 → 48.75 effective, so more HP than raw.
    expect(computeStats({ speciesSlug: 'bulbasaur', level: 50, ivs, nature: 'hardy' }, ctx).hp).toBeGreaterThan(105)
  })

  it('nature multipliers are 0.9 / 1.0 / 1.1 and never touch HP', () => {
    const timid = ctx.naturesBySlug.get('timid')
    expect(natureMultiplier(timid, 'speed')).toBe(1.1)
    expect(natureMultiplier(timid, 'attack')).toBe(0.9)
    expect(natureMultiplier(timid, 'hp')).toBe(1)
    expect(natureMultiplier(ctx.naturesBySlug.get('hardy'), 'speed')).toBe(1)
  })
})

describe('individuals (GDD §6)', () => {
  it('IVs stay within 0..ivMax and legendaries get 3 perfect IVs', () => {
    const rng = createRng(3)
    for (let i = 0; i < 200; i++) {
      const ivs = Object.values(rollIvs(rng, false, ctx))
      for (const v of ivs) expect(v >= 0 && v <= cfg.progression.ivMax).toBe(true)
      const leg = Object.values(rollIvs(rng, true, ctx))
      expect(leg.filter((v) => v === cfg.progression.ivMax).length).toBeGreaterThanOrEqual(cfg.progression.legendaryPerfectIvs)
    }
  })

  it('rolls only defined abilities, the hidden one rarely', () => {
    const sp = ctx.speciesBySlug.get('bulbasaur')!
    const rng = createRng(5)
    const counts: Record<string, number> = {}
    for (let i = 0; i < 4000; i++) {
      const a = rollAbility(sp, rng, ctx)!
      counts[a] = (counts[a] ?? 0) + 1
    }
    expect(Object.keys(counts).sort()).toEqual(['chlorophyll', 'overgrow'])
    expect((counts.chlorophyll ?? 0) / 4000).toBeCloseTo(cfg.progression.hiddenAbilityChance, 1)
  })

  it('extra moves are 2–3 usable egg/tutor/machine moves', () => {
    const rng = createRng(11)
    for (let i = 0; i < 50; i++) {
      const ind = createIndividual('charmander', 10, rng, {}, ctx)
      expect(ind.extraMoves.length).toBeGreaterThanOrEqual(2)
      expect(ind.extraMoves.length).toBeLessThanOrEqual(3)
      for (const m of ind.extraMoves) expect(isUsableMove(m, ctx)).toBe(true)
    }
    const cands = extraMoveCandidates(ctx.speciesBySlug.get('bulbasaur')!, ctx)
    expect(cands).not.toContain('tackle') // level-up move
  })
})

describe('techniques (GDD §7)', () => {
  it('only damage moves with power or defined techniques exist', () => {
    expect(getTechnique('ember', ctx)?.kind).toBe('damage')
    expect(getTechnique('hypnosis', ctx)?.kind).toBe('activable')
    expect(getTechnique('calm-mind', ctx)?.kind).toBe('passive')
    expect(getTechnique('growl', ctx)).toBeNull() // undefined status move
    expect(getTechnique('return', ctx)).toBeNull() // damage move with null power
  })

  it('slots by level: 1 / 2 at 15 / 3 at 30 / 4 at 50', () => {
    expect([1, 14, 15, 29, 30, 49, 50, 100].map((l) => techniqueSlots(l, ctx))).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('extra move unlock levels (progression.extraMoveUnlock)', () => {
  it('damage: max(1, round((power − 40) / 2)); special techniques: statusLevel', async () => {
    const { extraMoveUnlockLevel } = await import('./moves')
    expect(extraMoveUnlockLevel('solar-beam', ctx)).toBe(40)
    expect(extraMoveUnlockLevel('flamethrower', ctx)).toBe(25)
    expect(extraMoveUnlockLevel('tackle', ctx)).toBe(1)
    expect(extraMoveUnlockLevel('safeguard', ctx)).toBe(cfg.progression.extraMoveUnlock.statusLevel)
    expect(extraMoveUnlockLevel('growl', ctx)).toBeNull()
  })

  it('locked extra moves are not equippable, not in the default loadout, and unlock on level up', async () => {
    const { equippableMoves, lockedExtraMoves, validateEquip } = await import('./moves')
    const { toOwnedPokemon } = await import('./individual')
    const { gainExp, expForLevel } = await import('./progression')
    const { pokemonView } = await import('./views')
    const { makePlayer } = await import('./test-helpers')
    const core = { ...createIndividual('bulbasaur', 5, createRng(1), {}, ctx), extraMoves: ['solar-beam', 'safeguard'] }
    const p = toOwnedPokemon(core, 'a', 0, 'starter', ctx)
    expect(p.equippedMoves).toEqual(['tackle'])
    expect(equippableMoves(p, ctx)).not.toContain('solar-beam')
    expect(lockedExtraMoves(p, ctx)).toEqual([
      { move: 'solar-beam', unlockLevel: 40 },
      { move: 'safeguard', unlockLevel: 15 },
    ])
    expect(validateEquip(p, ['solar-beam'], ctx)).toBe('move_locked')
    const g = gainExp(p, expForLevel(15) - p.exp, 30, ctx)
    const ev = g.events.find((e) => e.type === 'levelUp')
    expect(ev?.type === 'levelUp' && ev.newMoves).toContain('safeguard')
    expect(equippableMoves(g.pokemon, ctx)).toContain('safeguard')
    expect(validateEquip(g.pokemon, ['tackle', 'safeguard'], ctx)).toBeNull()
    const view = pokemonView(makePlayer([p]), 'a', 0, ctx)!
    expect(view.lockedExtraMoves.map((x) => [x.technique.slug, x.unlockLevel])).toEqual([['solar-beam', 40], ['safeguard', 15]])
    expect(view.extraMoves.every((x) => !x.unlocked)).toBe(true)
  })
})

describe('Grit raises the Pokémon\'s own Focus (GDD §4, §5.1)', () => {
  it('effective = Focus × (1 + 0.10 · min(1, Def / 200)): exact values at Def 0 / 100 / 200', () => {
    expect(cfg.actions.defenseFocusMaxBonus).toBe(0.1)
    expect(cfg.actions.defenseFocusCap).toBe(200)
    expect(effectiveFocus(1, 0, cfg)).toBeCloseTo(1, 10)
    expect(effectiveFocus(1, 100, cfg)).toBeCloseTo(1.05, 10)
    expect(effectiveFocus(1, 200, cfg)).toBeCloseTo(1.1, 10)
    expect(defenseFocusBonus(50, cfg)).toBeCloseTo(0.025, 10)
  })

  it('is monotonic in Defense and capped at +10 % from Def 200 on', () => {
    let prev = 0
    for (let def = 0; def <= 400; def += 5) {
      const f = effectiveFocus(1, def, cfg)
      expect(f).toBeGreaterThanOrEqual(prev)
      expect(f).toBeLessThanOrEqual(1.1 + 1e-12)
      prev = f
    }
    expect(effectiveFocus(1, 250, cfg)).toBeCloseTo(1.1, 10)
    expect(effectiveFocus(1, 999, cfg)).toBeCloseTo(1.1, 10)
  })

  it('a late claim (Focus 0.5) keeps the same relative bonus: 0.5 → 0.525 at Def 100, 0.55 at Def ≥ 200', () => {
    expect(effectiveFocus(0.5, 0, cfg)).toBeCloseTo(0.5, 10)
    expect(effectiveFocus(0.5, 100, cfg)).toBeCloseTo(0.525, 10)
    expect(effectiveFocus(0.5, 200, cfg)).toBeCloseTo(0.55, 10)
  })
})
