import { describe, expect, it } from 'vitest'
import { createNewPlayer, evolvePokemon } from './box'
import { throwBall } from './capture'
import { createEngineContext, defaultContext } from './context'
import {
  claimAllMissions,
  claimMission,
  missionsView,
  recordMissionEvent,
  refreshMissions,
  type MissionDef,
  type MissionsContent,
} from './missions'
import { createRng } from './rng'
import { applySessionResult } from './session'
import type { EncounterState, PlayerState } from './state'
import { makeMon, makePlayer, MIN, runSession, T0 } from './test-helpers'
import { rollWild } from './waves'

const ctx = defaultContext()
const DAY = 24 * 60 * MIN

function def(id: string, period: MissionDef['period'], kind: MissionDef['kind'], target: number, extra: Partial<MissionDef> = {}): MissionDef {
  return {
    id,
    period,
    kind,
    target,
    title: { es: `T ${id}`, en: `T ${id}` },
    description: { es: 'Haz {n} ({minutes}) {type}', en: 'Do {n} ({minutes}) {type}' },
    rewards: [
      { minTrainerLevel: 1, items: { 'poke-ball': 2 } },
      { minTrainerLevel: 5, items: { 'great-ball': 1 }, dust: 10 },
    ],
    ...extra,
  }
}

/** A tiny pool where every mission is drawn (3 daily, 3 weekly). */
const content: MissionsContent = {
  dailyCount: 3,
  weeklyCount: 3,
  placeholderItems: {},
  pool: [
    def('d-sessions', 'daily', 'sessions', 2),
    def('d-long', 'daily', 'longSession', 1, { minMinutes: 50 }),
    def('d-study', 'daily', 'studyBall', 1),
    def('w-days', 'weekly', 'studyDays', 2),
    def('w-type', 'weekly', 'catchType', 1, { type: 'normal', rewards: [{ typeCandies: 5 }] }),
    def('w-evolve', 'weekly', 'evolve', 1),
  ],
  pokedex: [
    {
      id: 'dex-2',
      species: 2,
      title: { es: 'Dex {n}', en: 'Dex {n}' },
      description: { es: '', en: '' },
      rewards: [{ items: { 'ultra-ball': 1 }, randomItem: { pool: ['fire-stone', 'water-stone'], count: 2 } }],
    },
  ],
}
const mctx = createEngineContext({ missions: content })

describe('missions (GDD §13)', () => {
  it('shipped content: 3 daily + 3 weekly, valid kinds, bilingual texts filled in', () => {
    expect(ctx.warnings).toEqual([])
    const r = createNewPlayer({ trainerName: 'A', locale: 'es', starterSlug: 'charmander', now: T0, timezone: 0 }, createRng(1))
    if (!r.ok) throw new Error(r.error)
    const v = missionsView(r.value, T0)
    expect(v.daily.missions).toHaveLength(ctx.missions.dailyCount)
    expect(v.weekly.missions).toHaveLength(ctx.missions.weeklyCount)
    expect(new Set(v.daily.missions.map((m) => m.defId)).size).toBe(ctx.missions.dailyCount)
    for (const m of [...v.daily.missions, ...v.weekly.missions, ...v.pokedex]) {
      expect(m.title.es).not.toMatch(/\{|\}/)
      expect(m.description.en).not.toMatch(/\{|\}/)
      expect(m.progress).toBe(m.period === 'pokedex' ? 1 : 0) // the starter is registered
    }
    expect(v.daily.endsAt).toBe(Date.UTC(2026, 10, 4))
    expect(v.weekly.endsAt).toBe(Date.UTC(2026, 10, 9))
    // Every pool entry and milestone has at least one reward tier.
    for (const d of [...ctx.missions.pool, ...ctx.missions.pokedex]) expect(d.rewards.length).toBeGreaterThan(0)
  })

  it('rotation is deterministic per player and changes by day / week', () => {
    const s = makePlayer([makeMon('pidgey', 10)])
    const a = refreshMissions(s, T0)
    const b = refreshMissions(s, T0 + 5 * MIN)
    expect(b.missions).toEqual(a.missions)
    expect(refreshMissions(a, T0 + MIN)).toBe(a)
    const ids = (st: PlayerState) => st.missions!.daily.slots.map((x) => x.defId).join()
    const days = Array.from({ length: 10 }, (_, i) => ids(refreshMissions(s, T0 + i * DAY)))
    expect(new Set(days).size).toBeGreaterThan(1)
    const next = refreshMissions(a, T0 + DAY)
    expect(next.missions!.daily.key).toBe('2026-11-04')
    expect(next.missions!.weekly).toEqual(a.missions!.weekly) // same week
    const other = { ...s, profile: { ...s.profile, createdAt: s.profile.createdAt + 1 } }
    const many = Array.from({ length: 10 }, (_, i) => ids(refreshMissions(other, T0 + i * DAY)))
    expect(many).not.toEqual(days)
  })

  it('reward tiers follow the trainer level at generation', () => {
    const low = refreshMissions(makePlayer([makeMon('pidgey', 10)], {}, mctx), T0, mctx)
    const high = refreshMissions({ ...makePlayer([makeMon('pidgey', 10)], {}, mctx), trainer: { level: 6, exp: 0 }, missions: undefined }, T0, mctx)
    const r = (st: PlayerState) => st.missions!.daily.slots.find((x) => x.defId === 'd-sessions')!.reward
    expect(r(low)).toEqual({ items: { 'poke-ball': 2 }, dust: 0, typeCandies: {} })
    expect(r(high)).toEqual({ items: { 'great-ball': 1 }, dust: 10, typeCandies: {} })
  })

  it('sessions, long sessions and distinct days progress through applySessionResult', () => {
    let s = makePlayer([makeMon('pidgey', 20, { uid: 'a' }, mctx)], {}, mctx)
    for (const [i, minutes] of [[0, 25], [1, 50]] as const) {
      const run = runSession(s, minutes, i, { startedAt: T0 + i * 90 * MIN }, mctx)
      const a = applySessionResult(run.state, run.result, mctx)
      if (!a.ok) throw new Error(a.error)
      s = a.value.state
    }
    const v = missionsView(s, T0 + 4 * 60 * MIN, mctx)
    const by = (id: string) => [...v.daily.missions, ...v.weekly.missions].find((m) => m.defId === id)!
    expect(by('d-sessions')).toMatchObject({ progress: 2, target: 2, completed: true, claimed: false })
    expect(by('d-long')).toMatchObject({ progress: 1, completed: true })
    expect(by('d-long').description.es).toBe('Haz 1 (50) ')
    expect(by('w-days')).toMatchObject({ progress: 1, completed: false })
    expect(v.claimable).toBe(2)
    // Next day: the daily missions rotate, the weekly progress stays.
    const run = runSession(s, 25, 9, { startedAt: T0 + DAY }, mctx)
    const a = applySessionResult(run.state, run.result, mctx)
    if (!a.ok) throw new Error(a.error)
    const v2 = missionsView(a.value.state, T0 + DAY + 30 * MIN, mctx)
    expect(v2.daily.key).toBe('2026-11-04')
    expect(v2.daily.missions.find((m) => m.defId === 'd-sessions')!.progress).toBe(1)
    expect(v2.weekly.missions.find((m) => m.defId === 'w-days')!.progress).toBe(2)
  })

  it('a cancelled long session counts its minutes and length but not as a completed session (GDD §3.4)', () => {
    const s = makePlayer([makeMon('pidgey', 20, { uid: 'a' }, mctx)], {}, mctx)
    // Planned 100, cancelled at 50.
    const run = runSession(s, 100, 1, { endedAt: T0 + 50 * MIN, claimedAt: T0 + 50 * MIN, cancelled: true }, mctx)
    expect(run.result).toMatchObject({ cancelled: true, minutes: 50 })
    const a = applySessionResult(run.state, run.result, mctx)
    if (!a.ok) throw new Error(a.error)
    const v = missionsView(a.value.state, T0 + 60 * MIN, mctx)
    const by = (id: string) => [...v.daily.missions, ...v.weekly.missions].find((m) => m.defId === id)!
    expect(by('d-sessions').progress).toBe(0)
    expect(by('d-long').progress).toBe(1)
    expect(by('w-days').progress).toBe(1)
  })

  it('catches (type, Study Ball) progress through throwBall; evolutions through evolvePokemon', () => {
    const gen = { focus: 1, trainerLevel: 1, soundDominant: null, teamTypes: [], typeWeightMults: {}, syncNature: null }
    const w = rollWild(createRng(1), { waveIndex: 0, gen, activeConditionTypes: [], contributions: [], forceSpecies: 'pidgey' }, mctx)
    const wild = { ...w, level: 5, studyBallEligible: true, isShiny: false, guaranteedBall: null }
    const enc: EncounterState = {
      sessionId: 's0',
      waves: [{ index: 0, wilds: [wild], studyBall: 'available', contributions: [], activeConditionTypes: [] }],
      currentWave: 0,
      charges: [],
      gen,
      env: { localHour: 10, weekend: false, weather: null, noPauses: true, sessionMinutes: 25 },
    }
    const s = { ...makePlayer([makeMon('charmander', 16, { uid: 'c' }, mctx)], {}, mctx), encounter: enc }
    const r = throwBall(s, { waveIndex: 0, wildIndex: 0 }, 'study-ball', createRng(1), T0, mctx)
    if (!r.ok) throw new Error(r.error)
    const v = missionsView(r.value.state, T0, mctx)
    expect(v.daily.missions.find((m) => m.defId === 'd-study')!.completed).toBe(true)
    expect(v.weekly.missions.find((m) => m.defId === 'w-type')!.completed).toBe(true) // pidgey is normal/flying
    const e = evolvePokemon(r.value.state, 'c', 'charmeleon', T0, createRng(2), mctx)
    if (!e.ok) throw new Error(e.error)
    expect(missionsView(e.value.state, T0, mctx).weekly.missions.find((m) => m.defId === 'w-evolve')!.completed).toBe(true)
  })

  it('claimMission grants items, dust and type candies once; errors otherwise', () => {
    let s = refreshMissions(makePlayer([makeMon('pidgey', 10)], {}, mctx), T0, mctx)
    const typeSlot = s.missions!.weekly.slots.find((x) => x.defId === 'w-type')!
    expect(claimMission(s, typeSlot.id, T0, mctx)).toEqual({ ok: false, error: 'not_completed' })
    s = recordMissionEvent(s, { kind: 'catch', types: ['normal'], ball: 'poke-ball', firstThrow: true }, T0, mctx)
    const before = s.candies.types.normal ?? 0
    const c = claimMission(s, typeSlot.id, T0, mctx)
    if (!c.ok) throw new Error(c.error)
    expect(c.value.state.candies.types.normal).toBe(before + 5)
    expect(claimMission(c.value.state, typeSlot.id, T0, mctx)).toEqual({ ok: false, error: 'already_claimed' })
    expect(claimMission(c.value.state, 'nope', T0, mctx)).toEqual({ ok: false, error: 'unknown_mission' })
    // Past periods are gone.
    expect(claimMission(s, typeSlot.id, T0 + 8 * DAY, mctx)).toEqual({ ok: false, error: 'unknown_mission' })
  })

  it('Pokédex milestones: claim once when reached, deterministic random items', () => {
    const s = makePlayer([makeMon('pidgey', 10)], {}, mctx)
    const one = { ...s, pokedex: { seen: ['pidgey'], caught: ['pidgey'] } }
    expect(claimMission(one, 'dex-2', T0, mctx)).toEqual({ ok: false, error: 'not_completed' })
    const two = { ...s, pokedex: { seen: ['pidgey', 'zubat'], caught: ['pidgey', 'zubat'] }, inventory: {} }
    const view = missionsView(two, T0, mctx).pokedex[0]!
    expect(view).toMatchObject({ completed: true, claimed: false, progress: 2, target: 2 })
    const stones = (view.reward.items['fire-stone'] ?? 0) + (view.reward.items['water-stone'] ?? 0)
    expect(stones).toBe(2)
    const all = claimAllMissions(two, T0, mctx)
    expect(all.rewards.map((r) => r.id)).toEqual(['dex-2'])
    expect(all.state.inventory).toEqual(view.reward.items)
    expect(missionsView(all.state, T0, mctx).pokedex[0]!.claimed).toBe(true)
    expect(claimMission(all.state, 'dex-2', T0, mctx)).toEqual({ ok: false, error: 'already_claimed' })
  })

  it('old saves without missions get them lazily', () => {
    const s = makePlayer([makeMon('pidgey', 10)])
    const { missions: _drop, ...old } = s
    void _drop
    const v = missionsView(old as PlayerState, T0)
    expect(v.daily.missions.length).toBe(ctx.missions.dailyCount)
  })
})
