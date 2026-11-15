import { describe, expect, it } from 'vitest'
import {
  abilityCapsuleChoices,
  activeTera,
  bottleCapStats,
  mintChoices,
  mintItem,
  mintNatureOf,
  teraChoices,
  tmCandidates,
  unlockLevel,
  useAbilityCapsule,
  useBottleCap,
  useMint,
  useTera,
  useTm,
} from './advanced'
import { createEngineContext, defaultContext } from './context'
import { equippableMoves, validateEquip } from './moves'
import { trainerLevelRewards } from './progression'
import { applySessionResult, conditionTypes } from './session'
import { startSession } from './session'
import type { OwnedPokemon, PlayerState } from './state'
import { computeStats, maxEnergyOf } from './stats'
import { makeMon, makePlayer, MIN, runSession, T0 } from './test-helpers'

const ctx = defaultContext()
const HOUR = 3_600_000

function player(mons: OwnedPokemon[], level: number, inventory: Record<string, number>, patch: Partial<PlayerState> = {}): PlayerState {
  return makePlayer(mons, { trainer: { level, exp: 0 }, inventory, ...patch })
}

const okState = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('config and unlocks', () => {
  it('unlock levels follow GDD §12.7 (Mints 10, Tera 20, Bottle Caps 25, Ability Capsule 30)', () => {
    expect(unlockLevel('mint', ctx)).toBe(10)
    expect(unlockLevel('tera', ctx)).toBe(20)
    expect(unlockLevel('bottleCap', ctx)).toBe(25)
    expect(unlockLevel('abilityCapsule', ctx)).toBe(30)
  })

  it('the unlock levels give their one-time gift with the level reward', () => {
    expect(trainerLevelRewards(19, 20, ctx).items['tera-shard']).toBe(2)
    expect(trainerLevelRewards(24, 25, ctx).items['bottle-cap']).toBe(1)
    expect(trainerLevelRewards(29, 30, ctx).items['ability-capsule']).toBe(1)
    expect(trainerLevelRewards(20, 24, ctx).items['tera-shard']).toBeUndefined()
    const none = createEngineContext({ config: { advanced: { tera: { unlockGift: 0 } } } })
    expect(trainerLevelRewards(19, 20, none).items['tera-shard']).toBeUndefined()
  })
})

describe('useTera', () => {
  const mon = () => makeMon('pikachu', 20, { uid: 'a' })

  it('spends the shards and sets the type for hours/sessions from config', () => {
    const s = okState(useTera(player([mon()], 20, { 'tera-shard': 3 }), 'a', 'water', T0, ctx))
    const p = s.pokemon.a!
    expect(s.inventory['tera-shard']).toBe(1)
    expect(p.teraType).toBe('water')
    expect(p.teraUntil).toBe(T0 + 24 * HOUR)
    expect(p.teraSessionsLeft).toBe(5)
    expect(conditionTypes(p, T0 + HOUR, ctx)).toEqual(['water'])
    expect(conditionTypes(p, T0 + 24 * HOUR, ctx)).toEqual(['electric'])
    expect(activeTera(p, T0 + 23 * HOUR)).toBe('water')
  })

  it('refuses: locked level, no shards, same single type, active session, unknown Pokémon', () => {
    expect(useTera(player([mon()], 19, { 'tera-shard': 9 }), 'a', 'water', T0, ctx)).toEqual({ ok: false, error: 'trainer_level_too_low' })
    expect(useTera(player([mon()], 20, { 'tera-shard': 1 }), 'a', 'water', T0, ctx)).toEqual({ ok: false, error: 'no_item' })
    expect(useTera(player([mon()], 20, { 'tera-shard': 9 }), 'a', 'electric', T0, ctx)).toEqual({ ok: false, error: 'same_type' })
    expect(useTera(player([mon()], 20, { 'tera-shard': 9 }), 'zz', 'water', T0, ctx)).toEqual({ ok: false, error: 'unknown_pokemon' })
    expect(useTera(player([mon()], 20, { 'tera-shard': 9 }), 'a', 'shadow' as never, T0, ctx)).toEqual({ ok: false, error: 'invalid_type' })
    const st = okState(startSession(player([mon()], 20, { 'tera-shard': 9 }), { plannedMinutes: 25, startedAt: T0 }, ctx)).state
    expect(useTera(st, 'a', 'water', T0, ctx)).toEqual({ ok: false, error: 'session_active' })
  })

  it('dual types can go mono to one of their own types; the same active Tera type is refused', () => {
    expect(teraChoices({ speciesSlug: 'bulbasaur' }, ctx)).toContain('grass')
    expect(teraChoices({ speciesSlug: 'pikachu' }, ctx)).not.toContain('electric')
    expect(teraChoices({ speciesSlug: 'pikachu' }, ctx)).toHaveLength(17)
    const s = okState(useTera(player([mon()], 20, { 'tera-shard': 4 }), 'a', 'water', T0, ctx))
    expect(useTera(s, 'a', 'water', T0 + HOUR, ctx)).toEqual({ ok: false, error: 'same_type' })
    const again = okState(useTera(s, 'a', 'fire', T0 + HOUR, ctx))
    expect(again.pokemon.a!.teraType).toBe('fire')
    expect(again.pokemon.a!.teraUntil).toBe(T0 + 25 * HOUR)
  })

  it('a session spends one Tera session; conditions use the Tera type; techniques keep their type', () => {
    const s0 = okState(useTera(player([mon()], 20, { 'tera-shard': 2 }), 'a', 'water', T0 - HOUR, ctx))
    const { result, state } = runSession(s0, 25)
    const member = result.members.find((m) => m.uid === 'a')!
    expect(member).toBeDefined()
    const applied = okState(applySessionResult(state, result, ctx)).state
    expect(applied.pokemon.a!.teraSessionsLeft).toBe(4)
    // Thunder-type moves still hit as Electric.
    const hits = result.waves.flatMap((w) => w.hits ?? []).filter((h) => h.uid === 'a' && h.move)
    for (const h of hits) expect(h.type).not.toBe('water')
    expect(hits.every((h) => !h.stab || h.type === 'electric' || h.type === 'water')).toBe(true)
  })

  it('an expired Tera does not spend sessions', () => {
    const s0 = okState(useTera(player([mon()], 20, { 'tera-shard': 2 }), 'a', 'water', T0 - 30 * HOUR, ctx))
    const { result, state } = runSession(s0, 25)
    expect(okState(applySessionResult(state, result, ctx)).state.pokemon.a!.teraSessionsLeft).toBe(5)
  })

  it('without Tera, the session result is the same as before (no RNG change)', () => {
    const a = runSession(player([mon()], 20, {}), 25, 'same').result
    const b = runSession(player([{ ...mon(), teraType: 'water', teraUntil: T0 - 1, teraSessionsLeft: 3 }], 20, {}), 25, 'same').result
    expect(b.totalPoints).toBe(a.totalPoints)
    expect(b.waves.map((w) => w.wilds.map((x) => x.speciesSlug))).toEqual(a.waves.map((w) => w.wilds.map((x) => x.speciesSlug)))
  })
})

describe('useTm', () => {
  const mon = () => makeMon('pikachu', 10, { uid: 'a' })

  it('teaches a compatible TM move: learned and equippable, the TM is spent', () => {
    const p = mon()
    const cands = tmCandidates(p, ctx)
    expect(cands.length).toBeGreaterThan(0)
    const move = cands[0]!
    const s = okState(useTm(player([p], 1, { 'technical-machine': 1 }), 'a', move, ctx))
    expect(s.inventory['technical-machine']).toBe(0)
    expect(s.pokemon.a!.learnedMoves).toContain(move)
    expect(s.pokemon.a!.tmMoves).toEqual([move])
    expect(equippableMoves(s.pokemon.a!, ctx)).toContain(move)
    expect(validateEquip(s.pokemon.a!, [move], ctx)).toBeNull()
    expect(tmCandidates(s.pokemon.a!, ctx)).not.toContain(move)
  })

  it('refuses: not compatible, already known, no TM, active session', () => {
    const p = mon()
    const move = tmCandidates(p, ctx)[0]!
    expect(useTm(player([p], 1, { 'technical-machine': 1 }), 'a', 'surf', ctx)).toEqual({ ok: false, error: 'move_not_compatible' })
    expect(useTm(player([p], 1, { 'technical-machine': 1 }), 'a', p.learnedMoves[0]!, ctx)).toEqual({ ok: false, error: 'move_already_known' })
    expect(useTm(player([p], 1, {}), 'a', move, ctx)).toEqual({ ok: false, error: 'no_item' })
    const st = okState(startSession(player([p], 1, { 'technical-machine': 1 }), { plannedMinutes: 25, startedAt: T0 }, ctx)).state
    expect(useTm(st, 'a', move, ctx)).toEqual({ ok: false, error: 'session_active' })
  })
})

describe('useMint', () => {
  const mon = () => makeMon('pikachu', 30, { uid: 'a', nature: 'hardy' })

  it('changes the stats to the mint nature and keeps the original nature', () => {
    const p = mon()
    const s = okState(useMint(player([p], 10, { 'modest-mint': 1 }), 'a', 'modest', ctx))
    const m = s.pokemon.a!
    expect(m.nature).toBe('hardy')
    expect(m.mintNature).toBe('modest')
    expect(s.inventory['modest-mint']).toBe(0)
    const before = computeStats(p, ctx)
    const after = computeStats(m, ctx)
    expect(after.specialAttack).toBeGreaterThan(before.specialAttack)
    expect(after.attack).toBeLessThan(before.attack)
    expect(after.hp).toBe(before.hp)
    expect(computeStats({ ...m, nature: 'modest', mintNature: undefined }, ctx)).toEqual(after)
  })

  it('the mint of the original nature removes the change', () => {
    const s = okState(useMint(player([{ ...mon(), nature: 'jolly', mintNature: 'modest' }], 10, { 'jolly-mint': 1 }), 'a', 'jolly', ctx))
    expect(s.pokemon.a!.mintNature).toBeUndefined()
    expect('mintNature' in s.pokemon.a!).toBe(false)
  })

  it('refuses: locked level, unknown nature, same effect, no mint', () => {
    expect(useMint(player([mon()], 9, { 'modest-mint': 1 }), 'a', 'modest', ctx)).toEqual({ ok: false, error: 'trainer_level_too_low' })
    expect(useMint(player([mon()], 10, { 'x-mint': 1 }), 'a', 'x', ctx)).toEqual({ ok: false, error: 'invalid_nature' })
    // Hardy → Serious: both neutral, same effect.
    expect(useMint(player([mon()], 10, { 'serious-mint': 1 }), 'a', 'serious', ctx)).toEqual({ ok: false, error: 'same_nature' })
    expect(useMint(player([mon()], 10, {}), 'a', 'modest', ctx)).toEqual({ ok: false, error: 'no_item' })
    expect(mintChoices(mon(), ctx)).toHaveLength(20)
    expect(mintItem('modest')).toBe('modest-mint')
    expect(mintNatureOf('modest-mint', ctx)).toBe('modest')
    expect(mintNatureOf('bottle-cap', ctx)).toBeNull()
  })
})

describe('useBottleCap', () => {
  it('raises one IV to the max; HP also fills the extra Energy', () => {
    const p = makeMon('pikachu', 40, { uid: 'a' })
    const s = okState(useBottleCap(player([p], 25, { 'bottle-cap': 2 }), 'a', 'hp', ctx))
    const m = s.pokemon.a!
    expect(m.ivs.hp).toBe(31)
    expect(m.bottleCapped).toEqual(['hp'])
    expect(s.inventory['bottle-cap']).toBe(1)
    expect(maxEnergyOf(m, ctx)).toBeGreaterThan(maxEnergyOf(p, ctx))
    expect(m.energy.current - p.energy.current).toBe(maxEnergyOf(m, ctx) - maxEnergyOf(p, ctx))
    expect(bottleCapStats(m, ctx)).not.toContain('hp')
  })

  it('refuses: locked level, IV already max, bad stat, no cap', () => {
    const p = makeMon('pikachu', 40, { uid: 'a', ivs: { hp: 31, attack: 10, defense: 10, specialAttack: 10, specialDefense: 10, speed: 10 } })
    expect(useBottleCap(player([p], 24, { 'bottle-cap': 1 }), 'a', 'attack', ctx)).toEqual({ ok: false, error: 'trainer_level_too_low' })
    expect(useBottleCap(player([p], 25, { 'bottle-cap': 1 }), 'a', 'hp', ctx)).toEqual({ ok: false, error: 'iv_maxed' })
    expect(useBottleCap(player([p], 25, { 'bottle-cap': 1 }), 'a', 'luck' as never, ctx)).toEqual({ ok: false, error: 'invalid_stat' })
    expect(useBottleCap(player([p], 25, {}), 'a', 'attack', ctx)).toEqual({ ok: false, error: 'no_item' })
  })
})

describe('useAbilityCapsule', () => {
  it('switches to another defined, non-hidden ability', () => {
    const p = makeMon('pidgey', 20, { uid: 'a', ability: 'keen-eye' })
    expect(abilityCapsuleChoices(p, ctx)).toEqual(['tangled-feet'])
    const s = okState(useAbilityCapsule(player([p], 30, { 'ability-capsule': 1 }), 'a', 'tangled-feet', ctx))
    expect(s.pokemon.a!.ability).toBe('tangled-feet')
    expect(s.inventory['ability-capsule']).toBe(0)
  })

  it('a hidden ability can be swapped for a normal one, never the other way', () => {
    const p = makeMon('pidgey', 20, { uid: 'a', ability: 'big-pecks' })
    expect(abilityCapsuleChoices(p, ctx)).toEqual(['keen-eye', 'tangled-feet'])
    const q = makeMon('pidgey', 20, { uid: 'a', ability: 'keen-eye' })
    expect(useAbilityCapsule(player([q], 30, { 'ability-capsule': 1 }), 'a', 'big-pecks', ctx)).toEqual({ ok: false, error: 'invalid_ability' })
  })

  it('refuses: locked level, single ability, same ability, no capsule', () => {
    const p = makeMon('pidgey', 20, { uid: 'a', ability: 'keen-eye' })
    expect(useAbilityCapsule(player([p], 29, { 'ability-capsule': 1 }), 'a', 'tangled-feet', ctx)).toEqual({ ok: false, error: 'trainer_level_too_low' })
    expect(useAbilityCapsule(player([p], 30, { 'ability-capsule': 1 }), 'a', 'keen-eye', ctx)).toEqual({ ok: false, error: 'same_ability' })
    expect(useAbilityCapsule(player([p], 30, {}), 'a', 'tangled-feet', ctx)).toEqual({ ok: false, error: 'no_item' })
    const pika = makeMon('pikachu', 20, { uid: 'b', ability: 'static' })
    expect(useAbilityCapsule(player([pika], 30, { 'ability-capsule': 1 }), 'b', 'static', ctx)).toEqual({ ok: false, error: 'no_other_ability' })
  })
})

describe('older saves', () => {
  it('a Pokémon without the new fields works with every query', () => {
    const p = makeMon('pidgey', 20, { uid: 'a' })
    delete (p as Partial<OwnedPokemon>).mintNature
    delete (p as Partial<OwnedPokemon>).bottleCapped
    delete (p as Partial<OwnedPokemon>).tmMoves
    expect(computeStats(p, ctx)).toEqual(computeStats({ speciesSlug: p.speciesSlug, level: p.level, ivs: p.ivs, nature: p.nature }, ctx))
    expect(activeTera(p, T0)).toBeNull()
    const s = okState(useTm(player([p], 1, { 'technical-machine': 1 }), 'a', tmCandidates(p, ctx)[0]!, ctx))
    expect(s.pokemon.a!.tmMoves).toHaveLength(1)
    expect(T0 + MIN).toBeGreaterThan(T0)
  })
})
