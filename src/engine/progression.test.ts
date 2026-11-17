import { describe, expect, it } from 'vitest'
import { evolvePokemon, MAX_RELEASE_BATCH, previewCandies, releaseMany, releasePokemon, useCandy } from './box'
import { defaultContext } from './context'
import { candyDustCost, evolutionOptions, expForLevel, gainExp, levelCapFor, levelFromExp, trainerLevelFromExp } from './progression'
import { createRng } from './rng'
import { makeMon, makePlayer, T0 } from './test-helpers'

const ctx = defaultContext()

describe('EXP curve (GDD §12.1)', () => {
  it('round(4 · L^2.8) up to level 20, then bends to exponent 4.0 (GDD §12.1)', () => {
    expect(expForLevel(10)).toBeGreaterThan(2400)
    expect(expForLevel(10)).toBeLessThan(2600)
    expect(expForLevel(20)).toBe(Math.round(4 * 20 ** 2.8)) // the knee: same as the old curve
    expect(expForLevel(30) / 89_000).toBeCloseTo(1, 1)
    expect(expForLevel(36) / 184_500).toBeCloseTo(1, 1)
    expect(expForLevel(50) / 686_600).toBeCloseTo(1, 1)
    expect(expForLevel(60) / 1_423_700).toBeCloseTo(1, 1)
    expect(levelFromExp(expForLevel(37))).toBe(37)
    expect(levelFromExp(expForLevel(37) - 1)).toBe(36)
  })

  it('level ups learn moves and announce level evolutions; the cap holds', () => {
    const p = makeMon('charmander', 5)
    const g = gainExp(p, expForLevel(17) - p.exp, 30, ctx)
    expect(g.pokemon.level).toBe(17)
    expect(g.pokemon.learnedMoves).toContain('ember')
    expect(g.events.some((e) => e.type === 'evolutionAvailable' && e.to === 'charmeleon')).toBe(true)
    const capped = gainExp(p, expForLevel(45), 30, ctx)
    expect(capped.pokemon.level).toBe(30)
    expect(capped.events.some((e) => e.type === 'levelCapped')).toBe(true)
  })

  it('level caps by distinct species caught (GDD §12.5)', () => {
    expect(levelCapFor(0)).toBe(30)
    expect(levelCapFor(54)).toBe(30)
    expect(levelCapFor(55)).toBe(40)
    expect(levelCapFor(100)).toBe(50)
    expect(levelCapFor(139)).toBe(50)
    expect(levelCapFor(140)).toBe(60)
  })

  it('trainer level grows with study', () => {
    expect(trainerLevelFromExp(0)).toBe(1)
    expect(trainerLevelFromExp(100_000)).toBeGreaterThan(10)
  })
})

describe('candies and dust (GDD §12.2–12.3)', () => {
  it('dust cost per candy = 25 + 3·level + 0.03·level²', () => {
    expect(candyDustCost(10)).toBe(58)
    expect(candyDustCost(30)).toBe(142)
    expect(candyDustCost(50)).toBe(250)
  })

  it('useCandy spends dust at the current level and respects the cap', () => {
    const p = makeMon('charmander', 10, { uid: 'a' })
    const s = makePlayer([p], { dust: 1000, candies: { chains: { '2': 5 }, types: { fire: 1 } } })
    const r = useCandy(s, 'a', { kind: 'species' }, 2, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.dustSpent).toBe(2 * candyDustCost(10)) // +600 EXP doesn't reach level 11
    expect(r.value.state.candies.chains['2']).toBe(3)
    expect(r.value.state.pokemon.a!.exp).toBe(p.exp + 600)
    expect(useCandy(s, 'a', { kind: 'type', type: 'water' }, 1, ctx)).toEqual({ ok: false, error: 'wrong_type' })
    const capped = makePlayer([makeMon('charmander', 30, { uid: 'a' })], { dust: 1000, candies: { chains: { '2': 5 }, types: {} } })
    expect(useCandy(capped, 'a', { kind: 'species' }, 1, ctx)).toEqual({ ok: false, error: 'level_cap' })
  })

  it('previewCandies simulates useCandy without touching the state', () => {
    const p = makeMon('charmander', 10, { uid: 'a' })
    const s = makePlayer([p], { dust: 5000, candies: { chains: { '2': 40 }, types: {} } })
    const snap = JSON.stringify(s)
    const pv = previewCandies(s, 'a', { kind: 'species' }, 6, ctx)
    expect(JSON.stringify(s)).toBe(snap)
    const real = useCandy(s, 'a', { kind: 'species' }, 6, ctx)
    expect(pv.ok && real.ok).toBe(true)
    if (!pv.ok || !real.ok) return
    expect(pv.value.used).toBe(6)
    expect(pv.value.stoppedBy).toBeNull()
    expect(pv.value.dustSpent).toBe(real.value.dustSpent)
    expect(pv.value.dustLeft).toBe(real.value.state.dust)
    expect(pv.value.candiesLeft).toBe(real.value.state.candies.chains['2'])
    expect(pv.value.levelTo).toBe(real.value.state.pokemon.a!.level)
    expect(pv.value.expGained).toBe(real.value.state.pokemon.a!.exp - p.exp)
    expect(pv.value.levelTo).toBeGreaterThan(pv.value.levelFrom)
  })

  it('previewCandies stops at the level cap and reports unused candies; never errors on cap/dust', () => {
    const cap = levelCapFor(makePlayer([]).pokedex.caught.length, ctx)
    const p = makeMon('charmander', cap - 1, { uid: 'a' })
    const s = makePlayer([p], { dust: 100000, candies: { chains: { '2': 50 }, types: {} } })
    const pv = previewCandies(s, 'a', { kind: 'species' }, 50, ctx)
    expect(pv.ok).toBe(true)
    if (!pv.ok) return
    expect(pv.value.levelTo).toBe(cap)
    expect(pv.value.used).toBeLessThan(50)
    expect(pv.value.unused).toBe(50 - pv.value.used)
    expect(pv.value.stoppedBy).toBe('level_cap')
    const atCap = previewCandies({ ...s, pokemon: { a: makeMon('charmander', cap, { uid: 'a' }) } }, 'a', { kind: 'species' }, 3, ctx)
    expect(atCap.ok && atCap.value.used).toBe(0)
    const broke = previewCandies({ ...s, dust: 0 }, 'a', { kind: 'species' }, 3, ctx)
    expect(broke.ok && broke.value.stoppedBy).toBe('not_enough_dust')
    expect(previewCandies(s, 'a', { kind: 'type', type: 'water' }, 1, ctx)).toEqual({ ok: false, error: 'wrong_type' })
  })

  it('release gives candies by stage; team members cannot be released', () => {
    const a = makeMon('charmeleon', 20, { uid: 'a' })
    const b = makeMon('charmander', 5, { uid: 'b' })
    const s = { ...makePlayer([a]), pokemon: { a, b } }
    expect(releasePokemon(s, 'a').ok).toBe(false)
    const r = releasePokemon({ ...s, team: ['b'] }, 'a')
    expect(r.ok && r.value.candies.chains['2']).toBe(2)
  })
})

describe('releaseMany', () => {
  const mk = () => {
    const a = makeMon('charmeleon', 20, { uid: 'a' }) // chain 2, stage 2 → 2 candies
    const b = makeMon('charmander', 5, { uid: 'b' }) // chain 2, stage 1 → 1
    const c = makeMon('squirtle', 5, { uid: 'c' }) // another chain → 1
    const t = makeMon('pidgey', 5, { uid: 't' })
    return { ...makePlayer([t]), pokemon: { a, b, c, t } }
  }
  it('releases all of them and adds the candies per chain', () => {
    const s = mk()
    const r = releaseMany(s, ['a', 'b', 'c'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.value.state.pokemon)).toEqual(['t'])
    expect(r.value.released).toBe(3)
    expect(r.value.totalCandies).toBe(4)
    expect(r.value.candies['2']).toBe(3)
    expect(r.value.state.candies.chains['2']).toBe(3)
    const sq = Object.entries(r.value.candies).find(([k]) => k !== '2')!
    expect(sq[1]).toBe(1)
  })
  it('is all or nothing: one invalid uid changes nothing', () => {
    const s = mk()
    expect(releaseMany(s, ['a', 't'])).toEqual({ ok: false, error: 'in_team' })
    expect(releaseMany(s, ['a', 'nope'])).toEqual({ ok: false, error: 'unknown_pokemon' })
    expect(Object.keys(s.pokemon)).toHaveLength(4)
    expect(s.candies.chains).toEqual({})
  })
  it('rejects empty, repeated and oversized lists', () => {
    const s = mk()
    expect(releaseMany(s, [])).toEqual({ ok: false, error: 'empty_selection' })
    expect(releaseMany(s, ['a', 'a'])).toEqual({ ok: false, error: 'duplicate_selection' })
    expect(releaseMany(s, Array.from({ length: MAX_RELEASE_BATCH + 1 }, (_, i) => `x${i}`))).toEqual({ ok: false, error: 'too_many_selected' })
  })
  it('leaves saved teams alone, like releasePokemon', () => {
    const s = { ...mk(), teamPresets: [{ id: 't1', name: 'X', uids: ['a', 't'] }] }
    const r = releaseMany(s, ['a'])
    expect(r.ok && r.value.state.teamPresets).toEqual(s.teamPresets)
  })
})

const chainOf = (slug: string) => String(ctx.speciesBySlug.get(slug)!.evolutionChainId)
const candiesFor = (slug: string, n: number) => ({ chains: { [chainOf(slug)]: n }, types: {} })

describe('evolution costs and third-stage requirements (GDD §12.6)', () => {
  const mon = (patch = {}) => makeMon('charmeleon', 40, { uid: 'c', ...patch })
  const block = (s: ReturnType<typeof makePlayer>, m: ReturnType<typeof mon>) => evolutionOptions(s, m, T0).find((o) => o.to === 'charizard')?.blockedBy

  it('a second stage costs 25 candies of its line, a third stage 100', () => {
    expect(evolutionOptions(makePlayer([makeMon('charmander', 20, { uid: 'a' })]), makeMon('charmander', 20, { uid: 'a' }), T0)[0]!.candyCost).toBe(25)
    expect(evolutionOptions(makePlayer([mon()]), mon(), T0)[0]!.candyCost).toBe(100)
  })

  it('a third stage needs trainer level 15 and the candies, in that order (no Bond or Pokédex requirement)', () => {
    const base = makePlayer([mon()])
    expect(block(base, mon())).toBe('trainer_level_too_low')
    const lvl = { ...base, trainer: { ...base.trainer, level: 15 } }
    expect(block(lvl, mon())).toBe('not_enough_candies') // no bond minutes and a tiny Pokédex are fine
    const rich = { ...lvl, candies: candiesFor('charmander', 100) }
    expect(block(rich, mon())).toBeNull()
    expect(evolvePokemon({ ...rich, pokemon: { c: mon() }, team: ['c'] }, 'c', 'charizard', T0, createRng(1))).toMatchObject({ ok: true })
  })

  it('without enough candies the evolution fails and nothing is spent', () => {
    const base = makePlayer([makeMon('charmander', 20, { uid: 'a' })], { candies: candiesFor('charmander', 24) })
    expect(evolvePokemon(base, 'a', 'charmeleon', T0, createRng(1))).toEqual({ ok: false, error: 'not_enough_candies' })
  })
})

describe('evolution (GDD §12.6)', () => {
  it('stone evolutions consume the item; trade is unavailable; friendship needs Bond and time', () => {
    const pika = makeMon('pikachu', 10, { uid: 'a' })
    const s = makePlayer([pika], { inventory: { 'thunder-stone': 1 }, candies: candiesFor('pikachu', 25) })
    const r = evolvePokemon(s, 'a', 'raichu', T0, createRng(1))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.state.inventory['thunder-stone']).toBe(0)
      expect(r.value.state.pokemon.a!.speciesSlug).toBe('raichu')
      expect(r.value.state.pokedex.caught).toContain('raichu')
      expect(r.value.state.candies.chains[chainOf('pikachu')]).toBe(0) // the evolution cost 25 candies
    }
    expect(evolvePokemon({ ...s, inventory: {} }, 'a', 'raichu', T0, createRng(1))).toEqual({ ok: false, error: 'missing_item' })
    const kadabra = makeMon('kadabra', 40, { uid: 'k' })
    expect(evolvePokemon(makePlayer([kadabra]), 'k', 'alakazam', T0, createRng(1))).toEqual({ ok: false, error: 'trade_unavailable' })
    const eevee = makeMon('eevee', 20, { uid: 'e', bondMinutes: 2000 })
    const es = makePlayer([eevee], { candies: candiesFor('eevee', 25) })
    const day = Date.UTC(2026, 10, 3, 10)
    const night = Date.UTC(2026, 10, 3, 22)
    const opt = (now: number, slug: string) => evolutionOptions(es, eevee, now).find((o) => o.to === slug)?.blockedBy
    expect(opt(day, 'espeon')).toBeNull()
    expect(opt(day, 'umbreon')).toBe('wrong_time_of_day')
    expect(opt(night, 'umbreon')).toBeNull()
    expect(evolutionOptions(makePlayer([{ ...eevee, bondMinutes: 0 }]), { ...eevee, bondMinutes: 0 }, day).find((o) => o.to === 'espeon')?.blockedBy).toBe('bond_too_low')
  })
})
