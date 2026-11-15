import { describe, expect, it } from 'vitest'
import {
  abilityCapsuleChoices,
  activeTera,
  bottleCapStats,
  CHOICE_MINT,
  isMintItem,
  mintChoices,
  mintItem,
  mintNatureOf,
  mintSourceFor,
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
  it('unlock levels follow GDD §12.7 (TMs 15, Tera 20, Mints 25, Ability Capsule 30, Bottle Caps 40)', () => {
    expect(unlockLevel('tm', ctx)).toBe(15)
    expect(unlockLevel('tera', ctx)).toBe(20)
    expect(unlockLevel('mint', ctx)).toBe(25)
    expect(unlockLevel('abilityCapsule', ctx)).toBe(30)
    expect(unlockLevel('bottleCap', ctx)).toBe(40)
  })

  it('the unlock levels give their one-time gift with the level reward; Bottle Caps have none (event-only)', () => {
    expect(trainerLevelRewards(19, 20, ctx).items['tera-shard']).toBe(2)
    expect(trainerLevelRewards(29, 30, ctx).items['ability-capsule']).toBe(1)
    expect(trainerLevelRewards(20, 24, ctx).items['tera-shard']).toBeUndefined()
    const none = createEngineContext({ config: { advanced: { tera: { unlockGift: 0 } } } })
    expect(trainerLevelRewards(19, 20, none).items['tera-shard']).toBeUndefined()
  })

  it('no level reward gives a Bottle Cap, at any level up to the maximum', () => {
    expect(trainerLevelRewards(0, ctx.config.trainer.maxLevel, ctx).items['bottle-cap']).toBeUndefined()
    expect(trainerLevelRewards(39, 40, ctx).items['bottle-cap']).toBeUndefined()
    expect(ctx.config.trainer.levelRewards.tiers.every((t) => !('bottle-cap' in t))).toBe(true)
  })

  it('every use is refused one level before its unlock and accepted at it (TM 15, Mint 25, Bottle Cap 40)', () => {
    const p = makeMon('pidgey', 20, { uid: 'a', ivs: { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 } })
    const move = tmCandidates(p, ctx)[0]!
    const inv = { 'technical-machine': 1, [CHOICE_MINT]: 1, 'bottle-cap': 1 }
    const locked = { ok: false, error: 'trainer_level_too_low' }
    expect(useTm(player([p], 14, inv), 'a', move, ctx)).toEqual(locked)
    expect(useTm(player([p], 15, inv), 'a', move, ctx).ok).toBe(true)
    expect(useMint(player([p], 24, inv), 'a', 'timid', ctx)).toEqual(locked)
    expect(useMint(player([p], 25, inv), 'a', 'timid', ctx).ok).toBe(true)
    expect(useBottleCap(player([p], 39, inv), 'a', 'attack', ctx)).toEqual(locked)
    expect(useBottleCap(player([p], 40, inv), 'a', 'attack', ctx).ok).toBe(true)
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
    const s = okState(useTm(player([p], 15, { 'technical-machine': 1 }), 'a', move, ctx))
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
    expect(useTm(player([p], 15, { 'technical-machine': 1 }), 'a', 'surf', ctx)).toEqual({ ok: false, error: 'move_not_compatible' })
    expect(useTm(player([p], 15, { 'technical-machine': 1 }), 'a', p.learnedMoves[0]!, ctx)).toEqual({ ok: false, error: 'move_already_known' })
    expect(useTm(player([p], 15, {}), 'a', move, ctx)).toEqual({ ok: false, error: 'no_item' })
    const st = okState(startSession(player([p], 15, { 'technical-machine': 1 }), { plannedMinutes: 25, startedAt: T0 }, ctx)).state
    expect(useTm(st, 'a', move, ctx)).toEqual({ ok: false, error: 'session_active' })
  })
})

describe('useMint', () => {
  const mon = () => makeMon('pikachu', 30, { uid: 'a', nature: 'hardy' })

  it('changes the stats to the mint nature and keeps the original nature', () => {
    const p = mon()
    const s = okState(useMint(player([p], 25, { 'modest-mint': 1 }), 'a', 'modest', ctx))
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
    const s = okState(useMint(player([{ ...mon(), nature: 'jolly', mintNature: 'modest' }], 25, { 'jolly-mint': 1 }), 'a', 'jolly', ctx))
    expect(s.pokemon.a!.mintNature).toBeUndefined()
    expect('mintNature' in s.pokemon.a!).toBe(false)
  })

  it('refuses: locked level, unknown nature, same effect, no mint', () => {
    expect(useMint(player([mon()], 24, { 'modest-mint': 1 }), 'a', 'modest', ctx)).toEqual({ ok: false, error: 'trainer_level_too_low' })
    expect(useMint(player([mon()], 25, { 'x-mint': 1 }), 'a', 'x', ctx)).toEqual({ ok: false, error: 'invalid_nature' })
    // Hardy → Serious: both neutral, same effect.
    expect(useMint(player([mon()], 25, { 'serious-mint': 1 }), 'a', 'serious', ctx)).toEqual({ ok: false, error: 'same_nature' })
    expect(useMint(player([mon()], 25, {}), 'a', 'modest', ctx)).toEqual({ ok: false, error: 'no_item' })
    expect(mintChoices(mon(), ctx)).toHaveLength(20)
    expect(mintItem('modest')).toBe('modest-mint')
    expect(mintNatureOf('modest-mint', ctx)).toBe('modest')
    expect(mintNatureOf('bottle-cap', ctx)).toBeNull()
  })
})

describe('useMint with the choice mint', () => {
  const mon = () => makeMon('pikachu', 30, { uid: 'a', nature: 'hardy' })

  it('sets the chosen nature and spends one choice mint', () => {
    const s = okState(useMint(player([mon()], 25, { [CHOICE_MINT]: 2 }), 'a', 'timid', ctx))
    expect(s.pokemon.a!.nature).toBe('hardy')
    expect(s.pokemon.a!.mintNature).toBe('timid')
    expect(s.inventory[CHOICE_MINT]).toBe(1)
    expect(computeStats(s.pokemon.a!, ctx).speed).toBeGreaterThan(computeStats(mon(), ctx).speed)
  })

  it('choosing the original nature through the choice mint removes the change', () => {
    const p = { ...mon(), nature: 'jolly', mintNature: 'modest' }
    const s = okState(useMint(player([p], 25, { [CHOICE_MINT]: 1 }), 'a', 'jolly', ctx))
    expect('mintNature' in s.pokemon.a!).toBe(false)
    expect(s.inventory[CHOICE_MINT]).toBe(0)
  })

  it('spends the specific mint of that nature before the choice mint (legacy stock keeps working)', () => {
    const s = okState(useMint(player([mon()], 25, { 'modest-mint': 1, [CHOICE_MINT]: 1 }), 'a', 'modest', ctx))
    expect(s.inventory['modest-mint']).toBe(0)
    expect(s.inventory[CHOICE_MINT]).toBe(1)
    const other = okState(useMint(player([mon()], 25, { 'modest-mint': 1, [CHOICE_MINT]: 1 }), 'a', 'jolly', ctx))
    expect(other.inventory['modest-mint']).toBe(1)
    expect(other.inventory[CHOICE_MINT]).toBe(0)
  })

  it('refuses: locked level, unknown nature, same effect, no mint, member of a session', () => {
    expect(useMint(player([mon()], 24, { [CHOICE_MINT]: 1 }), 'a', 'modest', ctx)).toEqual({ ok: false, error: 'trainer_level_too_low' })
    expect(useMint(player([mon()], 25, { [CHOICE_MINT]: 1 }), 'a', 'x', ctx)).toEqual({ ok: false, error: 'invalid_nature' })
    expect(useMint(player([mon()], 25, { [CHOICE_MINT]: 1 }), 'a', 'serious', ctx)).toEqual({ ok: false, error: 'same_nature' })
    expect(useMint(player([mon()], 25, { [CHOICE_MINT]: 0 }), 'a', 'modest', ctx)).toEqual({ ok: false, error: 'no_item' })
    expect(useMint(player([mon()], 25, { [CHOICE_MINT]: 1 }), 'zz', 'modest', ctx)).toEqual({ ok: false, error: 'unknown_pokemon' })
  })

  it('helpers: isMintItem, mintSourceFor and the choice mint has no fixed nature', () => {
    expect(isMintItem(CHOICE_MINT, ctx)).toBe(true)
    expect(isMintItem('adamant-mint', ctx)).toBe(true)
    expect(isMintItem('bottle-cap', ctx)).toBe(false)
    expect(mintNatureOf(CHOICE_MINT, ctx)).toBeNull()
    expect(mintSourceFor({ inventory: {} }, 'modest')).toBeNull()
    expect(mintSourceFor({ inventory: { [CHOICE_MINT]: 1 } }, 'modest')).toBe(CHOICE_MINT)
    expect(mintSourceFor({ inventory: { 'modest-mint': 1, [CHOICE_MINT]: 1 } }, 'modest')).toBe('modest-mint')
  })
})

describe('useBottleCap', () => {
  it('raises one IV to the max; HP also fills the extra Energy', () => {
    const p = makeMon('pikachu', 40, { uid: 'a' })
    const s = okState(useBottleCap(player([p], 40, { 'bottle-cap': 2 }), 'a', 'hp', ctx))
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
    expect(useBottleCap(player([p], 39, { 'bottle-cap': 1 }), 'a', 'attack', ctx)).toEqual({ ok: false, error: 'trainer_level_too_low' })
    expect(useBottleCap(player([p], 40, { 'bottle-cap': 1 }), 'a', 'hp', ctx)).toEqual({ ok: false, error: 'iv_maxed' })
    expect(useBottleCap(player([p], 40, { 'bottle-cap': 1 }), 'a', 'luck' as never, ctx)).toEqual({ ok: false, error: 'invalid_stat' })
    expect(useBottleCap(player([p], 40, {}), 'a', 'attack', ctx)).toEqual({ ok: false, error: 'no_item' })
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
    const s = okState(useTm(player([p], 15, { 'technical-machine': 1 }), 'a', tmCandidates(p, ctx)[0]!, ctx))
    expect(s.pokemon.a!.tmMoves).toHaveLength(1)
    expect(T0 + MIN).toBeGreaterThan(T0)
  })
})
