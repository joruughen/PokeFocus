import { afterEach, describe, expect, it } from 'vitest'
import { throwBall } from './capture'
import { resolveContent, type ContentPatch, type EventOverlay } from './content'
import { baseContext, createEngineContext, defaultContext, setDefaultContext, type EngineContext } from './context'
import { createRng } from './rng'
import { applySessionResult } from './session'
import type { PlayerState } from './state'
import { makeMon, makePlayer, runSession, T0 } from './test-helpers'

afterEach(() => setDefaultContext(null))

const HOUR = 3_600_000

function ev(id: string, startsAt: number, patch: Partial<EventOverlay> = {}): EventOverlay {
  return { id, slug: id, startsAt, endsAt: startsAt + 48 * HOUR, featured: [], drops: [], missions: [], ...patch }
}

/** Session → claim → throw every pending wild of the first waves; everything the engine produced. */
function playthrough(ctx: EngineContext, seed: number, minutes: number) {
  const team = [makeMon('pikachu', 20, { uid: 'a' }, ctx), makeMon('geodude', 18, { uid: 'b' }, ctx), makeMon('bulbasaur', 15, { uid: 'c' }, ctx)]
  const start = makePlayer(team, {}, ctx)
  const { result, state } = runSession(start, minutes, seed, {}, ctx)
  const applied = applySessionResult(state, result, ctx)
  if (!applied.ok) throw new Error(applied.error)
  let s: PlayerState = applied.value.state
  const throws: unknown[] = []
  const rng = createRng(`throws-${seed}`)
  for (let i = 0; i < 6 && s.encounter; i++) {
    const enc = s.encounter
    const wi = enc.waves[enc.currentWave]?.wilds.findIndex((w) => w.outcome === 'pending') ?? -1
    if (wi < 0) break
    const r = throwBall(s, { waveIndex: enc.currentWave, wildIndex: wi }, 'great-ball', rng, T0 + 2 * HOUR, ctx)
    throws.push(r.ok ? r.value.outcome : r.error)
    if (!r.ok) break
    s = r.value.state
  }
  return { result, events: applied.value.events, throws, state: s }
}

describe('resolveContent: golden invariant (empty patch = base)', () => {
  it('resolves to no options at all', () => {
    expect(resolveContent({}, [], {})).toEqual({})
    // Empty sub-objects change nothing either.
    expect(resolveContent({ config: {}, species: {}, moves: {}, techniques: {}, abilities: {}, missions: {} }, [], {})).toEqual({})
  })

  it('builds a context deeply equal to the base one, with neutral live fields', () => {
    const resolved = createEngineContext(resolveContent({}, [], {}))
    const base = createEngineContext()
    expect(resolved).toStrictEqual(base)
    expect(base.contentHash).toBe('base')
    expect(base.spawn.size).toBe(0)
    expect(base.events).toEqual([])
    expect(base.warnings).toEqual([])
  })

  it('gives bit-identical session, claim and capture results', () => {
    const resolved = createEngineContext(resolveContent({}, [], {}))
    let throws = 0
    for (const [seed, minutes] of [[1, 25], [7, 50], [42, 90], [99, 120]] as const) {
      const run = playthrough(resolved, seed, minutes)
      expect(run).toStrictEqual(playthrough(baseContext(), seed, minutes))
      throws += run.throws.length
    }
    expect(throws).toBeGreaterThan(0) // the capture path was exercised
  })
})

describe('defaultContext / setDefaultContext', () => {
  it('returns the active context, and the memoized base one after a reset', () => {
    const base = defaultContext()
    expect(base).toBe(baseContext())
    const live = createEngineContext(resolveContent({ config: { rewards: { dustPerMinute: 99 } } }, [], {}, { hash: 'h1' }))
    setDefaultContext(live)
    expect(defaultContext()).toBe(live)
    expect(defaultContext().config.rewards.dustPerMinute).toBe(99)
    expect(baseContext()).toBe(base)
    setDefaultContext(null)
    expect(defaultContext()).toBe(base)
  })

  it('functions without an explicit ctx use the active one', () => {
    const live = createEngineContext({ config: { rewards: { dustPerMinute: 0 } } })
    setDefaultContext(live)
    const team = [makeMon('pikachu', 20, { uid: 'a' })]
    const { result } = runSession(makePlayer(team), 25, 3)
    expect(result.dust).toBe(0)
  })
})

describe('resolveContent: admin patch layer', () => {
  it('patches config, capture rates and moves without mutating the base', () => {
    const base = baseContext()
    const pikaRate = base.speciesBySlug.get('pikachu')!.captureRate
    const tackle = base.movesBySlug.get('tackle')!
    const opts = resolveContent(
      {
        config: { encounters: { shinyChance: 0.01 } },
        species: { pikachu: { captureRate: 3 } },
        moves: { tackle: { power: 77 } },
      },
      [],
      {},
    )
    const ctx = createEngineContext(opts)
    expect(ctx.config.encounters.shinyChance).toBe(0.01)
    expect(ctx.config.rewards).toEqual(base.config.rewards)
    expect(ctx.speciesBySlug.get('pikachu')!.captureRate).toBe(3)
    expect(ctx.movesBySlug.get('tackle')).toEqual({ ...tackle, power: 77 })
    // Untouched entries are shared, touched ones are copies.
    expect(ctx.speciesBySlug.get('bulbasaur')).toBe(base.speciesBySlug.get('bulbasaur'))
    expect(base.speciesBySlug.get('pikachu')!.captureRate).toBe(pikaRate)
    expect(base.movesBySlug.get('tackle')!.power).toBe(tackle.power)
    expect(ctx.contentHash).toBe('unhashed')
    expect(createEngineContext(resolveContent({ species: { pikachu: { captureRate: 3 } } }, [], {}, { hash: 'abc' })).contentHash).toBe('abc')
  })

  it('replaces techniques and abilities by slug and missions fields', () => {
    const base = baseContext()
    const [techSlug, tech] = Object.entries(base.techniques)[0]!
    const newTech = { ...tech, baseChance: 0.5 }
    const ctx = createEngineContext(
      resolveContent({ techniques: { [techSlug]: newTech }, missions: { dailyCount: 5, placeholderItems: { 'gold-leaf': { names: { es: 'Hoja', en: 'Leaf' } } } } }, [], {}),
    )
    expect(ctx.techniques[techSlug]).toEqual(newTech)
    expect(Object.keys(ctx.techniques)).toEqual(Object.keys(base.techniques))
    expect(ctx.missions.dailyCount).toBe(5)
    expect(ctx.missions.weeklyCount).toBe(base.missions.weeklyCount)
    expect(ctx.missions.pool).toBe(base.missions.pool)
    expect(ctx.missions.placeholderItems['gold-leaf']?.names.en).toBe('Leaf')
    for (const k of Object.keys(base.missions.placeholderItems)) expect(ctx.missions.placeholderItems[k]).toBeDefined()
  })

  it('resolves admin spawn rules with neutral defaults', () => {
    const ctx = createEngineContext(
      resolveContent({ species: { pikachu: { spawn: { hours: [[20, 4]], weather: ['rain'] } }, squirtle: { spawn: { enabled: false, weightMult: 2, minTrainerLevel: 10 } } } }, [], {}),
    )
    expect(ctx.spawn.get('pikachu')).toEqual({ weightMult: 1, enabled: true, hours: [[20, 4]], weather: ['rain'] })
    expect(ctx.spawn.get('squirtle')).toEqual({ weightMult: 2, enabled: false, minTrainerLevel: 10 })
    expect(ctx.spawn.has('bulbasaur')).toBe(false)
  })

  it('reports unknown slugs as warnings instead of applying them', () => {
    const ctx = createEngineContext(
      resolveContent({ species: { missingno: { captureRate: 1, spawn: { weightMult: 2 } } }, moves: { 'no-move': { power: 1 } } }, [], {}),
    )
    expect(ctx.warnings).toEqual(expect.arrayContaining(['patch: unknown species missingno', 'patch: unknown move no-move', 'spawn missingno: no such species']))
    expect(ctx.speciesBySlug.has('missingno')).toBe(false)
  })
})

describe('resolveContent: event overlays', () => {
  it('orders active events by (startsAt, id)', () => {
    const opts = resolveContent({}, [ev('b', T0 + HOUR), ev('z', T0), ev('a', T0 + HOUR)], {})
    expect(opts.events!.map((e) => e.id)).toEqual(['z', 'a', 'b'])
    expect(createEngineContext(opts).events.map((e) => e.id)).toEqual(['z', 'a', 'b'])
  })

  it('multiplies the admin weight by every featured multiplier, keeping the admin rules', () => {
    const patch: ContentPatch = { species: { pikachu: { spawn: { weightMult: 2, hours: [[8, 20]] } }, eevee: { spawn: { enabled: false } } } }
    const events = [
      ev('e1', T0, { featured: [{ species: 'pikachu', weightMult: 3 }, { species: 'eevee', weightMult: 4 }] }),
      ev('e2', T0 + HOUR, { featured: [{ species: 'pikachu', weightMult: 1.5 }, { species: 'charmander', weightMult: 5 }] }),
    ]
    const ctx = createEngineContext(resolveContent(patch, events, {}))
    expect(ctx.spawn.get('pikachu')).toEqual({ weightMult: 9, enabled: true, hours: [[8, 20]] })
    expect(ctx.spawn.get('eevee')).toEqual({ weightMult: 4, enabled: false })
    expect(ctx.spawn.get('charmander')).toEqual({ weightMult: 5, enabled: true })
    expect(ctx.warnings).toEqual([])
  })

  it('adds the items of all published events (and active ones) to placeholderItems', () => {
    const past = { 'old-badge': { names: { es: 'Insignia', en: 'Badge' } } }
    const live = ev('e1', T0, { items: { 'pumpkin': { names: { es: 'Calabaza', en: 'Pumpkin' } } } })
    const ctx = createEngineContext(resolveContent({}, [live], past))
    expect(ctx.missions.placeholderItems['old-badge']?.names.en).toBe('Badge')
    expect(ctx.missions.placeholderItems['pumpkin']?.names.en).toBe('Pumpkin')
    // Past events alone (no active one) still keep their item names.
    const after = createEngineContext(resolveContent({}, [], past))
    expect(after.missions.placeholderItems['old-badge']).toBeDefined()
    expect(after.events).toEqual([])
  })

  it('keeps shiny, legendary and drop overlays on ctx.events without touching config', () => {
    const e = ev('e1', T0, { shiny: { chance: 0.05, scope: 'featured' }, legendaryChanceMult: 2, drops: [{ item: 'pumpkin', perWaveChance: 0.2, max: 3 }] })
    const ctx = createEngineContext(resolveContent({}, [e], {}))
    expect(ctx.config).toEqual(baseContext().config)
    expect(ctx.events[0]).toEqual(e)
  })

  it('rejects unknown overlay and patch keys (type error; ignored with a warning at runtime)', () => {
    const bad = {
      ...ev('e1', T0),
      // @ts-expect-error events cannot change arbitrary config
      config: { rewards: { dustPerMinute: 1000 } },
    } satisfies EventOverlay
    const patch = {
      missions: {},
      // @ts-expect-error not a patch layer
      items: {},
    } satisfies ContentPatch
    const ctx = createEngineContext(resolveContent(patch, [bad], {}))
    expect(ctx.config.rewards).toEqual(baseContext().config.rewards)
    expect(ctx.warnings).toEqual(['patch: unknown key items (ignored)', 'event e1: unknown key config (ignored)'])
  })
})
