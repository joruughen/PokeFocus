import { describe, expect, it } from 'vitest'
import { rerollWild, throwBall } from './capture'
import { resolveContent, type ContentPatch, type EventMissionDef, type EventOverlay } from './content'
import { baseContext, createEngineContext, type EngineContext } from './context'
import { isLegendarySpecies } from './individual'
import { claimMission, EVENT_MISSION_GRACE_MS, eventMissionId, missionsView, recordMissionEvent, refreshMissions } from './missions'
import { createRng } from './rng'
import { applySessionResult } from './session'
import { hourInWindow, isFeatured, legendaryChanceFor, rollEventDrops, shinyChanceFor, spawnMultiplier, spawnRuleMult, spawnWeatherOf } from './spawn'
import type { PlayerState, WaveGenParams } from './state'
import { makeMon, makePlayer, MIN, runSession, T0 } from './test-helpers'
import { rollWild, speciesWeight } from './waves'

const HOUR = 60 * MIN
const DAY = 24 * HOUR
const base = baseContext()

function ev(id: string, patch: Partial<EventOverlay> = {}): EventOverlay {
  return { id, slug: id, startsAt: T0 - DAY, endsAt: T0 + 2 * DAY, featured: [], drops: [], missions: [], ...patch }
}

function live(events: EventOverlay[], patch: ContentPatch = {}): EngineContext {
  return createEngineContext(resolveContent(patch, events, {}))
}

const gen: WaveGenParams = { focus: 1, trainerLevel: 10, soundDominant: null, teamTypes: [], typeWeightMults: {}, syncNature: null }

/** Session → claim → a few throws (and a reroll when there is a charge): everything the engine produced. */
function playthrough(ctx: EngineContext, seed: number, minutes: number, weather: PlayerState['profile']['weather'] = null, rerollCharges = 0) {
  const team = [makeMon('pikachu', 20, { uid: 'a' }, ctx), makeMon('geodude', 18, { uid: 'b' }, ctx), makeMon('bulbasaur', 15, { uid: 'c' }, ctx)]
  const start = makePlayer(team, {}, ctx)
  const { result, state } = runSession(start, minutes, seed, { weather }, ctx)
  const applied = applySessionResult(state, result, ctx)
  if (!applied.ok) throw new Error(applied.error)
  let s: PlayerState = applied.value.state
  if (s.encounter && rerollCharges > 0) {
    const extra = Array.from({ length: rerollCharges }, (_, i) => ({ id: `x${i}`, kind: 'reroll' as const, sourceUid: 'a', source: 'test' }))
    s = { ...s, encounter: { ...s.encounter, charges: [...s.encounter.charges, ...extra] } }
  }
  const log: unknown[] = []
  const rng = createRng(`throws-${seed}`)
  for (let i = 0; i < 6 && s.encounter; i++) {
    const enc = s.encounter
    const wi = enc.waves[enc.currentWave]?.wilds.findIndex((w) => w.outcome === 'pending') ?? -1
    if (wi < 0) break
    const charge = enc.charges.find((c) => c.kind === 'reroll')
    if (charge) {
      const r = rerollWild(s, charge.id, { waveIndex: enc.currentWave, wildIndex: wi }, rng, ctx)
      log.push(r.ok ? 'reroll' : r.error)
      if (r.ok) s = r.value
    }
    const r = throwBall(s, { waveIndex: enc.currentWave, wildIndex: wi }, 'great-ball', rng, T0 + 3 * HOUR, ctx)
    log.push(r.ok ? r.value.outcome : r.error)
    if (!r.ok) break
    s = r.value.state
  }
  return { result, events: applied.value.events, log, state: s }
}

const RUNS = [
  [1, 25],
  [7, 50],
  [42, 90],
  [99, 120],
] as const

describe('golden: hooks without live content change nothing', () => {
  it('empty events (no featured, shiny, legendary, drops or missions) are bit-identical to the base', () => {
    const ctx = live([ev('empty')])
    expect(ctx.events).toHaveLength(1)
    for (const [seed, minutes] of RUNS) {
      const a = playthrough(ctx, seed, minutes)
      const b = playthrough(base, seed, minutes)
      expect(a).toStrictEqual(b)
    }
  })

  it('drops use a derived RNG: everything but `eventItems` and the inventory matches the base', () => {
    const ctx = live([ev('drops', { drops: [{ item: 'rare-candy', perWaveChance: 0.5, max: 3 }] })])
    let dropped = 0
    for (const [seed, minutes] of RUNS) {
      const a = playthrough(ctx, seed, minutes)
      const b = playthrough(base, seed, minutes)
      const { eventItems, ...rest } = a.result
      expect(rest).toStrictEqual(b.result)
      expect(a.log).toStrictEqual(b.log)
      dropped += eventItems?.['rare-candy'] ?? 0
      expect(a.state.inventory['rare-candy'] ?? 0).toBe((b.state.inventory['rare-candy'] ?? 0) + (eventItems?.['rare-candy'] ?? 0))
    }
    expect(dropped).toBeGreaterThan(0)
  })

  it('hooks return the plain config values with no live content', () => {
    const sp = base.speciesBySlug.get('pikachu')!
    expect(shinyChanceFor(sp, base)).toBe(base.config.encounters.shinyChance)
    expect(legendaryChanceFor(base)).toBe(base.config.encounters.legendaryChance)
    expect(rollEventDrops('s1', 4, base)).toEqual({})
    const p = { waveIndex: 0, gen, activeConditionTypes: [] }
    expect(speciesWeight(sp, p, live([ev('empty')]))).toBe(speciesWeight(sp, p, base))
  })
})

describe('spawn rule (shared with the content validator)', () => {
  it('hour windows, weather tags and unknown values', () => {
    expect(hourInWindow(23, [22, 4])).toBe(true)
    expect(hourInWindow(4, [22, 4])).toBe(false)
    expect(spawnWeatherOf(undefined)).toBe(null)
    expect(spawnWeatherOf({ rain: false, sun: false, snow: true, tempC: -2 })).toBe('snow')
    const env = { hour: 10, weather: 'clear' as const, trainerLevel: 3 }
    expect(spawnRuleMult(undefined, env)).toBe(1)
    expect(spawnRuleMult({ weightMult: 2, enabled: true, hours: [[6, 12]] }, env)).toBe(2)
    expect(spawnRuleMult({ weightMult: 2, enabled: true, hours: [[6, 12]] }, { ...env, hour: null })).toBe(0)
    expect(spawnRuleMult({ weightMult: 2, enabled: true, weather: ['clear'] }, { ...env, weather: null })).toBe(0)
    expect(spawnRuleMult({ weightMult: 2, enabled: true, minTrainerLevel: 4 }, env)).toBe(0)
    expect(spawnRuleMult({ weightMult: 2, enabled: false }, env)).toBe(0)
  })

  it('the content coverage check uses the engine rule (no copy)', async () => {
    const coverage = await import('../game/content/coverage')
    expect(coverage.spawnRuleMult).toBe(spawnRuleMult)
    expect(coverage.hourInWindow).toBe(hourInWindow)
    expect(coverage.spawnWeatherOf).toBe(spawnWeatherOf)
  })
})

describe('waves: featured species and admin spawn rules', () => {
  const geodude = base.speciesBySlug.get('geodude')!

  it('speciesWeight multiplies by the rule only for species that have one', () => {
    const ctx = live([ev('rocks', { featured: [{ species: 'geodude', weightMult: 4 }] })], { species: { geodude: { spawn: { weightMult: 1.5 } } } })
    expect(isFeatured('geodude', ctx)).toBe(true)
    expect(spawnMultiplier('geodude', { hour: 10, weather: null, trainerLevel: 1 }, ctx)).toBe(6)
    const p = { waveIndex: 0, gen, activeConditionTypes: [] }
    expect(speciesWeight(geodude, p, ctx)).toBeCloseTo(speciesWeight(geodude, p, base) * 6, 9)
  })

  it('a featured species appears far more often', () => {
    const count = (ctx: EngineContext) => {
      const rng = createRng('featured')
      let n = 0
      for (let i = 0; i < 400; i++) if (rollWild(rng, { waveIndex: 0, gen, activeConditionTypes: [], contributions: [] }, ctx).speciesSlug === 'geodude') n++
      return n
    }
    const plain = count(base)
    const boosted = count(live([ev('rocks', { featured: [{ species: 'geodude', weightMult: 10 }] })]))
    expect(boosted).toBeGreaterThan(plain * 3)
  })

  it('hour and weather rules read the roll env (unknown env = restricted species ruled out)', () => {
    const onlyGeodudeInRain: ContentPatch = {
      species: Object.fromEntries(
        base.data.species
          .filter((s) => !isLegendarySpecies(s))
          .map((s) => [s.slug, { spawn: s.slug === 'geodude' ? { weather: ['rain' as const], hours: [[8, 12] as [number, number]] } : { enabled: false } }]),
      ),
    }
    const ctx = live([], onlyGeodudeInRain)
    const roll = (env?: { localHour: number; weather: PlayerState['profile']['weather'] }) => {
      const rng = createRng('env')
      const out = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const w = rollWild(rng, { waveIndex: 0, gen, activeConditionTypes: [], contributions: [], ...(env && { env }) }, ctx)
        if (!w.isLegendary) out.add(w.speciesSlug)
      }
      return out
    }
    expect([...roll({ localHour: 10, weather: { rain: true, sun: false, tempC: 10 } })]).toEqual(['geodude'])
    // No species is allowed (wrong hour / no env): waves.ts falls back to the first species of the pool.
    expect(roll({ localHour: 20, weather: { rain: true, sun: false, tempC: 10 } }).has('geodude')).toBe(false)
    expect(roll().has('geodude')).toBe(false)
  })

  it('the session and the reroll charge pass the session hour and weather', () => {
    const onlyGeodudeInRain: ContentPatch = {
      species: Object.fromEntries(
        base.data.species.filter((s) => !isLegendarySpecies(s)).map((s) => [s.slug, { spawn: s.slug === 'geodude' ? { weather: ['rain' as const] } : { enabled: false } }]),
      ),
    }
    const ctx = live([], onlyGeodudeInRain)
    let rerolls = 0
    for (const [seed, minutes] of RUNS) {
      const run = playthrough(ctx, seed, minutes, { rain: true, sun: false, tempC: 10 }, 3)
      const wilds = run.result.waves.flatMap((w) => w.wilds).filter((w) => !w.isLegendary && !w.isRoaming)
      expect(new Set(wilds.map((w) => w.speciesSlug))).toEqual(new Set(['geodude']))
      const after = (run.state.encounter?.waves ?? []).flatMap((w) => w.wilds).filter((w) => !w.isLegendary && !w.isRoaming)
      for (const w of after) expect(w.speciesSlug).toBe('geodude')
      rerolls += run.log.filter((x) => x === 'reroll').length
    }
    expect(rerolls).toBeGreaterThan(0)
  })
})

describe('waves: event shiny and legendary odds', () => {
  it('shinyChanceFor: the highest event chance that covers the species, never below the base', () => {
    const pikachu = base.speciesBySlug.get('pikachu')!
    const geodude = base.speciesBySlug.get('geodude')!
    const b = base.config.encounters.shinyChance
    const featured = live([ev('f', { featured: [{ species: 'geodude', weightMult: 2 }], shiny: { chance: 0.05, scope: 'featured' } })])
    expect(shinyChanceFor(geodude, featured)).toBe(0.05)
    expect(shinyChanceFor(pikachu, featured)).toBe(b)
    const all = live([ev('a', { shiny: { chance: 0.02, scope: 'all' } }), ev('low', { shiny: { chance: b / 2, scope: 'all' } })])
    expect(shinyChanceFor(pikachu, all)).toBe(Math.max(b, 0.02))
  })

  it('a shiny event makes every wild shiny at chance 1', () => {
    const ctx = live([ev('a', { shiny: { chance: 1, scope: 'all' } })])
    const rng = createRng('shiny')
    for (let i = 0; i < 20; i++) expect(rollWild(rng, { waveIndex: 0, gen, activeConditionTypes: [], contributions: [] }, ctx).isShiny).toBe(true)
  })

  it('legendaryChanceFor multiplies every active event', () => {
    const ctx = live([ev('a', { legendaryChanceMult: 2 }), ev('b', { legendaryChanceMult: 3 })])
    expect(legendaryChanceFor(ctx)).toBeCloseTo(base.config.encounters.legendaryChance * 6, 12)
    const big = live([ev('a', { legendaryChanceMult: 1e6 })])
    const rng = createRng('leg')
    for (let i = 0; i < 10; i++) expect(rollWild(rng, { waveIndex: 0, gen, activeConditionTypes: [], contributions: [] }, big).isLegendary).toBe(true)
  })

  it('legendaries follow the spawn rules when some legendary has one', () => {
    const ctx = live([ev('a', { legendaryChanceMult: 1e6 })], { species: { articuno: { spawn: { enabled: false } }, zapdos: { spawn: { enabled: false } }, moltres: { spawn: { enabled: false } }, mewtwo: { spawn: { enabled: false } } } })
    const rng = createRng('leg-rule')
    for (let i = 0; i < 10; i++) expect(rollWild(rng, { waveIndex: 0, gen, activeConditionTypes: [], contributions: [] }, ctx).speciesSlug).toBe('mew')
    const none = live([ev('a', { legendaryChanceMult: 1e6 })], {
      species: Object.fromEntries(base.data.species.filter(isLegendarySpecies).map((s) => [s.slug, { spawn: { enabled: false } }])),
    })
    // Every legendary ruled out: the roll falls through to a normal wild.
    expect(rollWild(createRng('x'), { waveIndex: 0, gen, activeConditionTypes: [], contributions: [] }, none).isLegendary).toBe(false)
  })
})

describe('event drops', () => {
  it('derived per session and event, capped by max per session', () => {
    const ctx = live([ev('a', { drops: [{ item: 'candy-a', perWaveChance: 1, max: 2 }, { item: 'candy-b', perWaveChance: 0.5, max: 10 }] })])
    const d = rollEventDrops('s1', 4, ctx)
    expect(d['candy-a']).toBe(2)
    expect(rollEventDrops('s1', 4, ctx)).toEqual(d)
    expect(rollEventDrops('s1', 0, ctx)).toEqual({})
    let other = false
    for (let i = 2; i < 20 && !other; i++) other = rollEventDrops(`s${i}`, 4, ctx)['candy-b'] !== d['candy-b']
    expect(other).toBe(true)
  })
})

describe('event missions', () => {
  const m = (id: string, kind: EventMissionDef['kind'], target: number, extra: Partial<EventMissionDef> = {}): EventMissionDef => ({
    id,
    period: 'event',
    kind,
    target,
    title: { es: `E ${id}`, en: `E ${id}` },
    description: { es: '{n}', en: '{n}' },
    rewards: [{ items: { 'rare-candy': 1 }, dust: 50 }],
    ...extra,
  })
  const event = ev('fest', { missions: [m('study', 'studyMinutes', 30), m('two', 'sessions', 2), m('pro', 'sessions', 1, { minTrainerLevel: 50 })] })
  const ctx = live([event])
  const player = () => makePlayer([makeMon('pikachu', 20, { uid: 'a' })], {}, ctx)

  it('refresh creates the fixed list (trainer level permitting), with no change without events', () => {
    const s = refreshMissions(player(), T0, ctx)
    const g = s.missions?.event?.['fest']
    expect(g?.slots.map((x) => x.id)).toEqual([eventMissionId('fest', 'study'), eventMissionId('fest', 'two')])
    expect(refreshMissions(s, T0 + MIN, ctx)).toBe(s)
    // No events: no `event` key at all (the base state shape).
    expect(refreshMissions(makePlayer([makeMon('pikachu', 20, { uid: 'a' })], {}, base), T0, base).missions).not.toHaveProperty('event')
    // Level 50 later: the missing mission is added, progress kept.
    const leveled = refreshMissions({ ...s, trainer: { level: 50, exp: 0 } }, T0 + MIN, ctx)
    expect(leveled.missions?.event?.['fest']?.slots.map((x) => x.defId)).toEqual(['study', 'two', 'pro'])
  })

  it('progress only while the event is in the context, claim, view and grace period', () => {
    let s = refreshMissions(player(), T0, ctx)
    s = recordMissionEvent(s, { kind: 'session', minutes: 40, dayKey: '2026-11-03', techniques: 0 }, T0 + HOUR, ctx)
    s = recordMissionEvent(s, { kind: 'session', minutes: 40, dayKey: '2026-11-03', techniques: 0 }, T0 + HOUR, base)
    const slots = s.missions?.event?.['fest']?.slots ?? []
    expect(slots.map((x) => x.progress)).toEqual([30, 1])

    // The view keeps the group after the event ends (from the stored def), until the grace period is over.
    const after = event.endsAt + DAY
    const v = missionsView(s, after, base)
    expect(v.event).toHaveLength(1)
    expect(v.event[0]).toMatchObject({ eventId: 'fest', active: false })
    expect(v.event[0]?.missions[0]).toMatchObject({ id: 'e:fest:study', period: 'event', eventId: 'fest', completed: true, title: { en: 'E study' } })
    expect(v.claimable).toBeGreaterThanOrEqual(1)

    expect(claimMission(s, 'e:fest:two', after, base)).toEqual({ ok: false, error: 'not_completed' })
    const c = claimMission(s, 'e:fest:study', after, base)
    if (!c.ok) throw new Error(c.error)
    expect(c.value.reward).toEqual({ items: { 'rare-candy': 1 }, dust: 50, typeCandies: {} })
    expect(c.value.state.inventory['rare-candy']).toBe((s.inventory['rare-candy'] ?? 0) + 1)
    expect(claimMission(c.value.state, 'e:fest:study', after, base)).toEqual({ ok: false, error: 'already_claimed' })

    const gone = refreshMissions(c.value.state, event.endsAt + EVENT_MISSION_GRACE_MS, base)
    expect(gone.missions).not.toHaveProperty('event')
    expect(claimMission(c.value.state, 'e:fest:two', event.endsAt + EVENT_MISSION_GRACE_MS, base)).toEqual({ ok: false, error: 'unknown_mission' })
  })

  it('a claimed session pinned to the event advances its missions', () => {
    const start = player()
    const { result, state } = runSession(start, 50, 3, {}, ctx)
    const applied = applySessionResult(state, result, ctx)
    if (!applied.ok) throw new Error(applied.error)
    const slots = applied.value.state.missions?.event?.['fest']?.slots ?? []
    expect(slots.find((x) => x.defId === 'study')?.progress).toBe(30)
    expect(slots.find((x) => x.defId === 'two')?.progress).toBe(1)
  })
})
