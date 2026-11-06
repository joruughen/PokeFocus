import { describe, expect, it } from 'vitest'
import { createEngineContext, defaultContext } from './context'
import type { AbilityDef } from './effect-types'
import { activationChance } from './session'
import { computeStats } from './stats'
import { makeMon, makePlayer, MIN, runSession, T0 } from './test-helpers'

const ctx = defaultContext()
const cfg = ctx.config

describe('session report logging', () => {
  it('logs damage moves per member, summing to the actions', () => {
    const b = makeMon('bulbasaur', 20, { uid: 'b', equippedMoves: ['vine-whip', 'tackle'], learnedMoves: ['vine-whip', 'tackle'] })
    const m = runSession(makePlayer([b]), 50).result.members[0]!
    expect(m.damageMoves!.map((d) => d.move).sort()).toEqual(['tackle', 'vine-whip'])
    expect(m.damageMoves!.reduce((a, d) => a + d.count, 0)).toBe(m.actions)

    const noMove = makeMon('abra', 10, { uid: 'a', equippedMoves: [], learnedMoves: [] })
    const n = runSession(makePlayer([noMove]), 25).result.members[0]!
    expect(n.damageMoves).toEqual([{ move: null, count: n.actions }])
  })

  it('logs activable attempts, activations and the per-action chance', () => {
    const g = makeMon('gengar', 40, { uid: 'g', equippedMoves: ['hypnosis'], learnedMoves: ['hypnosis'] })
    const m = runSession(makePlayer([g]), 100, 3).result.members[0]!
    const log = m.activables!.find((a) => a.move === 'hypnosis')!
    const expected = activationChance(ctx.techniques.hypnosis!.baseChance!, computeStats(g).specialDefense, 0, 1, cfg)
    expect(log.chanceAvg).toBeCloseTo(expected)
    expect(log.chanceMin).toBeCloseTo(expected)
    expect(log.chanceMax).toBeCloseTo(expected)
    expect(log.activations).toBe(m.techniques.find((t) => t.move === 'hypnosis')?.count ?? 0)
    expect(log.limitPerSession).toBe(ctx.techniques.hypnosis!.limitPerSession ?? null)
    // Every action rolls until the limit is reached.
    if (log.limitReached) expect(log.attempts).toBeLessThan(m.actions)
    else expect(log.attempts).toBe(m.actions)
  })

  it('logs passive triggers: statusOnAction charges and per-action statMods', () => {
    const abilities: Record<string, AbilityDef> = { ...ctx.abilities, static: { ...ctx.abilities.static!, effects: [{ kind: 'statusOnAction', status: 'paralysis', chance: 1, limit: 1 }] } }
    const c = createEngineContext({ abilities })
    const pk = makeMon('pikachu', 15, { uid: 'p', ability: 'static', equippedMoves: ['thunder-shock'], learnedMoves: ['thunder-shock'] }, c)
    const r = runSession(makePlayer([pk], {}, c), 25, 1, {}, c).result
    const log = r.members[0]!.passives!.find((x) => x.source === 'static')!
    expect(log).toMatchObject({ sourceKind: 'ability', count: 1 })
    expect(log.effect.kind).toBe('statusOnAction')
    expect(r.charges).toEqual([expect.objectContaining({ kind: 'status', status: 'paralysis', sourceUid: 'p', source: 'static' })])

    const sw = makeMon('swinub', 30, { uid: 's', ability: 'thick-fat' })
    const m = runSession(makePlayer([sw]), 25).result.members[0]!
    expect(m.passives!.find((x) => x.source === 'thick-fat')?.count).toBe(m.actions)
  })

  it('logs the condition multiplier per action with its type', () => {
    // 21:00 UTC → night: Ghost condition.
    const g = makeMon('gastly', 20, { uid: 'g' })
    const r = runSession(makePlayer([g]), 25, 1, { startedAt: T0 + 11 * 60 * MIN }).result
    const m = r.members[0]!
    expect(r.conditions).toContain('ghost')
    const ghost = m.conditionLog!.find((c) => c.type === 'ghost')!
    expect(ghost.mult).toBeGreaterThan(1)
    expect(ghost.forced).toBe(false)
    expect(m.conditionLog!.reduce((a, c) => a + c.actions, 0)).toBe(m.actions)
    expect(r.wildFactors!.localHour).toBe(21)
  })

  it('records why these wilds: league, wave sizes, encounterWeight and Synchronize sources', () => {
    const mag = makeMon('magnemite', 20, { uid: 'm', ability: 'magnet-pull' })
    const abra = makeMon('abra', 20, { uid: 'a', ability: 'synchronize', nature: 'timid' })
    const r = runSession(makePlayer([mag, abra]), 50).result
    const f = r.wildFactors!
    expect(f.waveSizes).toEqual(r.waves.map((w) => w.wilds.length))
    expect(f.league).toBe(r.league)
    expect(f.typeWeights).toEqual([{ type: 'steel', mult: 2, uid: 'm', source: 'magnet-pull' }])
    expect(f.sync).toEqual({ uid: 'a', source: 'synchronize', nature: 'timid', chance: 0.5 })
    expect(r.members.find((x) => x.uid === 'm')!.passives!.some((p) => p.source === 'magnet-pull')).toBe(true)
  })

  it('logging does not change the outcome (same seed, same rewards and wilds)', () => {
    const g = makeMon('gengar', 40, { uid: 'g', equippedMoves: ['hypnosis', 'lick'], learnedMoves: ['hypnosis', 'lick'] })
    const a = runSession(makePlayer([g]), 75, 9).result
    const b = runSession(makePlayer([g]), 75, 9).result
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
