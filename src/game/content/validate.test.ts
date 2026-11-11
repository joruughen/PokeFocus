// tsconfig.server.json (which also type-checks src/game) has no vite/client types.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { baseContent, baseContext, createEngineContext } from '../../engine/context'
import { resolveContent, type ContentPatch, type EventOverlay } from '../../engine/content'
import { EFFECT_KINDS } from '../../engine/effect-types'
import type { MissionDef } from '../../engine/missions'
import { hourInWindow, spawnCoverageGaps, spawnRuleMult, spawnWeatherOf } from './coverage'
import { CONFIG_LIMITS, CONFIG_LIST_LIMITS, CONFIG_TABLE_LIMITS, EDITABLE_CONFIG_PATHS } from './limits'
import { abilitySchema, contentPatchSchema, effectSchemas, missionDefSchema, techniqueSchema } from './schema'
import { bigChangeWarnings, smokeTest, validateContentPatch, validateEventOverlay } from './validate'

const NO_SMOKE = { smoke: false } as const
const base = baseContext()
const basePool = baseContent().missions.pool

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

function codes(r: { errors: { code: string }[] }): string[] {
  return r.errors.map((e) => e.code)
}

function nested(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  let out: unknown = value
  for (let i = keys.length - 1; i >= 0; i--) out = { [keys[i] as string]: out }
  return out as Record<string, unknown>
}

function event(over: Partial<EventOverlay> = {}): EventOverlay {
  return {
    id: 'ev1',
    slug: 'spring-fest',
    startsAt: Date.UTC(2026, 11, 1),
    endsAt: Date.UTC(2026, 11, 8),
    featured: [{ species: 'pikachu', weightMult: 2 }],
    drops: [],
    missions: [],
    ...over,
  }
}

describe('limits', () => {
  it('every whitelisted path exists in the base config with the right shape', () => {
    for (const l of CONFIG_LIMITS) {
      expect(typeof get(base.config, l.path), l.path).toBe('number')
      const v = get(base.config, l.path) as number
      expect(v, `${l.path} base inside its range`).toBeGreaterThanOrEqual(l.min)
      expect(v, `${l.path} base inside its range`).toBeLessThanOrEqual(l.max)
      expect(l.min).toBeLessThan(l.max)
    }
    for (const l of [...CONFIG_LIST_LIMITS, ...CONFIG_TABLE_LIMITS]) expect(Array.isArray(get(base.config, l.path)), l.path).toBe(true)
    expect(new Set(EDITABLE_CONFIG_PATHS).size).toBe(EDITABLE_CONFIG_PATHS.length)
  })

  it('includes the phase A keys (counter damage, energy cost)', () => {
    for (const p of ['capture.counter.damageMult', 'energy.costBase', 'energy.costLevelDivisor', 'energy.breakRecoverPct']) {
      expect(EDITABLE_CONFIG_PATHS).toContain(p)
    }
  })

  it('the base config passes the config schema with every editable value', () => {
    const cfg: Record<string, unknown> = {}
    for (const p of EDITABLE_CONFIG_PATHS) {
      const n = nested(p, get(base.config, p))
      mergeInto(cfg, n)
    }
    expect(contentPatchSchema.safeParse({ config: cfg }).success).toBe(true)
  })
})

function mergeInto(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const t = (target[k] ??= {}) as Record<string, unknown>
      mergeInto(t, v as Record<string, unknown>)
    } else target[k] = v
  }
}

describe('schemas', () => {
  it('has one effect schema per effect kind', () => {
    expect(Object.keys(effectSchemas).sort()).toEqual([...EFFECT_KINDS].sort())
  })

  it('accepts every shipped technique, ability and mission', () => {
    for (const [slug, t] of Object.entries(base.techniques)) expect(techniqueSchema.safeParse(t).success, slug).toBe(true)
    for (const [slug, a] of Object.entries(base.abilities)) expect(abilitySchema.safeParse(a).success, slug).toBe(true)
    for (const m of basePool) expect(missionDefSchema.safeParse(m).success, m.id).toBe(true)
  })

  it('rejects unknown effect kinds and out-of-range effect values', () => {
    const t = Object.values(base.techniques)[0]!
    expect(techniqueSchema.safeParse({ ...t, effects: [{ kind: 'nope' }] }).success).toBe(false)
    expect(techniqueSchema.safeParse({ ...t, effects: [{ kind: 'ballMult', mult: 50 }] }).success).toBe(false)
    expect(techniqueSchema.safeParse({ ...t, effects: [{ kind: 'ballMult', mult: 1.2, extra: 1 }] }).success).toBe(false)
    expect(techniqueSchema.safeParse({ ...t, category: 'activable', baseChance: undefined }).success).toBe(false)
  })
})

describe('validateContentPatch: shape', () => {
  it('an empty patch is valid, with no warnings, smoke test included', () => {
    const r = validateContentPatch({})
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.requiresConfirm).toBe(false)
    expect(r.value).toEqual({})
  })

  it('rejects unknown top-level and nested keys', () => {
    expect(codes(validateContentPatch({ foo: 1 }, NO_SMOKE))).toContain('unknown_key')
    const r = validateContentPatch({ config: { encounters: { shinyChance: 0.001, bogus: 1 } } }, NO_SMOKE)
    expect(r.errors.map((e) => e.path)).toContain('config.encounters.bogus')
  })

  it('rejects non-editable config paths', () => {
    for (const p of ['session.waveMinutes', 'focus.screenshotsPerSession', 'progression.ivMax', 'progression.maxLevel', 'statCurves.hp.k', 'historyLimit', 'leagues.weeklyThresholds.base']) {
      const r = validateContentPatch({ config: nested(p, 1) }, NO_SMOKE)
      expect(r.ok, p).toBe(false)
      expect(codes(r), p).toContain('unknown_key')
    }
    expect(validateContentPatch({ config: { starters: ['pikachu'] } }, NO_SMOKE).ok).toBe(false)
  })

  it('enforces the ranges of every scalar limit (min, max, int, NaN)', () => {
    for (const l of CONFIG_LIMITS) {
      expect(validateContentPatch({ config: nested(l.path, l.max + 1) }, NO_SMOKE).ok, `${l.path} above max`).toBe(false)
      expect(validateContentPatch({ config: nested(l.path, l.min - 1) }, NO_SMOKE).ok, `${l.path} below min`).toBe(false)
      expect(contentPatchSchema.safeParse({ config: nested(l.path, Number.NaN) }).success, `${l.path} NaN`).toBe(false)
      expect(contentPatchSchema.safeParse({ config: nested(l.path, '1') }).success, `${l.path} string`).toBe(false)
      if (l.kind === 'int') expect(contentPatchSchema.safeParse({ config: nested(l.path, l.min + 0.5) }).success, `${l.path} int`).toBe(false)
      expect(contentPatchSchema.safeParse({ config: nested(l.path, l.max) }).success, `${l.path} at max`).toBe(true)
    }
    expect(codes(validateContentPatch({ config: { encounters: { shinyChance: 0.5 } } }, NO_SMOKE))).toContain('out_of_range')
  })

  it('validates species, moves and spawn rules', () => {
    expect(validateContentPatch({ species: { pikachu: { captureRate: 0 } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ species: { pikachu: { captureRate: 300 } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ species: { pikachu: { spawn: { hours: [[5, 5]] } } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ species: { pikachu: { spawn: { hours: [[24, 3]] } } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ species: { pikachu: { spawn: { weather: ['rain', 'rain'] } } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ species: { pikachu: { spawn: { weather: ['fog'] } } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ species: { pikachu: { spawn: { hours: [[22, 4]], weather: ['rain', 'clear'], weightMult: 2 } } } }, NO_SMOKE).ok).toBe(true)
    expect(codes(validateContentPatch({ species: { missingno: { captureRate: 10 } } }, NO_SMOKE))).toContain('unknown_species')
    expect(codes(validateContentPatch({ moves: { 'not-a-move': { power: 50 } } }, NO_SMOKE))).toContain('unknown_move')
    expect(validateContentPatch({ moves: { tackle: { power: 0 } } }, NO_SMOKE).ok).toBe(false)
  })

  it('a move cannot switch between damage and status', () => {
    const status = base.data.moves.find((m) => m.power === null)!
    const damage = base.data.moves.find((m) => m.power !== null)!
    expect(codes(validateContentPatch({ moves: { [status.slug]: { power: 40 } } }, NO_SMOKE))).toContain('move_power_kind')
    expect(codes(validateContentPatch({ moves: { [damage.slug]: { power: null } } }, NO_SMOKE))).toContain('move_power_kind')
    expect(validateContentPatch({ moves: { [damage.slug]: { power: (damage.power ?? 40) + 10, accuracy: null } } }, NO_SMOKE).ok).toBe(true)
  })

  it('techniques and abilities: only existing slugs, warned as live', () => {
    const [slug, t] = Object.entries(base.techniques)[0]!
    const r = validateContentPatch({ techniques: { [slug]: t } }, NO_SMOKE)
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.code)).toContain('live_owned')
    expect(codes(validateContentPatch({ techniques: { 'brand-new': t } }, NO_SMOKE))).toContain('unknown_technique')
    const [aslug, a] = Object.entries(base.abilities)[0]!
    expect(validateContentPatch({ abilities: { [aslug]: a } }, NO_SMOKE).ok).toBe(true)
    expect(codes(validateContentPatch({ abilities: { 'brand-new': a } }, NO_SMOKE))).toContain('unknown_ability')
  })
})

describe('validateContentPatch: config rules', () => {
  it('league thresholds must strictly increase', () => {
    const r = validateContentPatch({ config: { leagues: { weeklyThresholds: { ultra: 5000 } } } }, NO_SMOKE)
    expect(codes(r)).toContain('thresholds_not_increasing')
    const ok = validateContentPatch({ config: { leagues: { weeklyThresholds: { super: 7000 } } } }, NO_SMOKE)
    expect(ok.ok).toBe(true)
    expect(ok.warnings.map((w) => w.code)).toContain('live_league_week')
  })

  it('wild level table: sorted, starts at 1, min ≤ max', () => {
    const rows = base.config.encounters.wildLevelByTrainerLevel
    const swapped = [rows[1], rows[0], ...rows.slice(2)]
    expect(codes(validateContentPatch({ config: { encounters: { wildLevelByTrainerLevel: swapped } } }, NO_SMOKE))).toContain('table_not_sorted')
    const noOne = rows.map((r, i) => (i === 0 ? { ...r, trainerLevel: 2 } : r))
    expect(codes(validateContentPatch({ config: { encounters: { wildLevelByTrainerLevel: noOne } } }, NO_SMOKE))).toContain('table_first_row')
    const inverted = rows.map((r, i) => (i === 0 ? { ...r, min: 12, max: 10 } : r))
    expect(codes(validateContentPatch({ config: { encounters: { wildLevelByTrainerLevel: inverted } } }, NO_SMOKE))).toContain('min_above_max')
    expect(validateContentPatch({ config: { encounters: { wildLevelByTrainerLevel: [{ trainerLevel: 1, min: 2, max: 10, extra: 1 }] } } }, NO_SMOKE).ok).toBe(false)
  })

  it('level caps table: sorted by species', () => {
    const caps = base.config.progression.levelCaps
    expect(codes(validateContentPatch({ config: { progression: { levelCaps: [...caps].reverse() } } }, NO_SMOKE))).toContain('table_not_sorted')
  })

  it('wave sizes: league max ≥ minWaveSize', () => {
    const r = validateContentPatch({ config: { encounters: { minWaveSize: 7 } } }, NO_SMOKE)
    expect(codes(r)).toContain('wave_size_range')
  })

  it('lists: length and item ranges', () => {
    expect(validateContentPatch({ config: { encounters: { longSessionRareBoost: [] } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ config: { encounters: { longSessionRareBoost: [1, 9] } } }, NO_SMOKE).ok).toBe(false)
    expect(validateContentPatch({ config: { encounters: { longSessionRareBoost: [1, 1.2] } } }, NO_SMOKE).ok).toBe(true)
  })
})

describe('validateContentPatch: missions', () => {
  const pool = (): MissionDef[] => basePool.map((d) => ({ ...d }))

  it('the base pool as a patch is valid', () => {
    expect(validateContentPatch({ missions: { pool: pool() } }, NO_SMOKE).ok).toBe(true)
  })

  it('ids are immutable: no removal, no kind change', () => {
    expect(codes(validateContentPatch({ missions: { pool: pool().slice(1) } }, NO_SMOKE))).toContain('mission_removed')
    const changed = pool().map((d, i) => (i === 1 ? { ...d, kind: 'sessions' as const } : d))
    expect(codes(validateContentPatch({ missions: { pool: changed } }, NO_SMOKE))).toContain('mission_kind_changed')
    const retired = pool().map((d, i) => (i === 0 ? { ...d, weight: 0 } : d))
    expect(validateContentPatch({ missions: { pool: retired } }, NO_SMOKE).ok).toBe(true)
  })

  it('a mission added by the previous published version cannot be removed', () => {
    const extra: MissionDef = { ...pool()[0]!, id: 'daily-extra' }
    const previous: ContentPatch = { missions: { pool: [...pool(), extra] } }
    expect(codes(validateContentPatch({ missions: { pool: pool() } }, { ...NO_SMOKE, previous }))).toContain('mission_removed')
    expect(validateContentPatch({ missions: { pool: [...pool(), { ...extra, weight: 0 }] } }, { ...NO_SMOKE, previous }).ok).toBe(true)
  })

  it('duplicate ids, unknown reward items, unsorted tiers', () => {
    expect(codes(validateContentPatch({ missions: { pool: [...pool(), pool()[0]!] } }, NO_SMOKE))).toContain('duplicate_id')
    const badItem = pool().map((d, i) => (i === 0 ? { ...d, rewards: [{ items: { 'golden-banana': 1 } }] } : d))
    expect(codes(validateContentPatch({ missions: { pool: badItem } }, NO_SMOKE))).toContain('unknown_item')
    const unsorted = pool().map((d, i) => (i === 0 ? { ...d, rewards: [{ minTrainerLevel: 5, dust: 1 }, { minTrainerLevel: 1, dust: 1 }] } : d))
    expect(codes(validateContentPatch({ missions: { pool: unsorted } }, NO_SMOKE))).toContain('reward_tiers_order')
    const placeholder = pool().map((d, i) => (i === 0 ? { ...d, rewards: [{ items: { 'golden-banana': 1 } }] } : d))
    const withItem = { missions: { pool: placeholder, placeholderItems: { 'golden-banana': { names: { es: 'Plátano', en: 'Banana' } } } } }
    expect(validateContentPatch(withItem, NO_SMOKE).ok).toBe(true)
  })

  it('kind-specific fields', () => {
    const long = pool().find((d) => d.kind === 'longSession')!
    expect(missionDefSchema.safeParse({ ...long, minMinutes: undefined }).success).toBe(false)
    const sessions = pool().find((d) => d.kind === 'sessions')!
    expect(missionDefSchema.safeParse({ ...sessions, type: 'fire' }).success).toBe(false)
    expect(missionDefSchema.safeParse({ ...sessions, title: { es: ' ', en: 'x' } }).success).toBe(false)
    expect(missionDefSchema.safeParse({ ...sessions, title: { es: 'x'.repeat(81), en: 'x' } }).success).toBe(false)
  })

  it('each period keeps enough drawable missions for its slots', () => {
    expect(codes(validateContentPatch({ missions: { dailyCount: 6, pool: pool() } }, NO_SMOKE))).toEqual(
      basePool.filter((d) => d.period === 'daily' && (d.weight ?? 1) > 0 && (d.minTrainerLevel ?? 1) <= 1).length < 6 ? ['mission_pool_short'] : [],
    )
    const allZero = pool().map((d) => (d.period === 'weekly' ? { ...d, weight: 0 } : d))
    expect(codes(validateContentPatch({ missions: { pool: allZero } }, NO_SMOKE))).toContain('mission_pool_short')
  })
})

describe('spawn coverage', () => {
  it('helpers', () => {
    expect(hourInWindow(23, [22, 4])).toBe(true)
    expect(hourInWindow(3, [22, 4])).toBe(true)
    expect(hourInWindow(4, [22, 4])).toBe(false)
    expect(hourInWindow(10, [6, 12])).toBe(true)
    expect(spawnWeatherOf(null)).toBe(null)
    expect(spawnWeatherOf({ rain: false, sun: false, tempC: 10 })).toBe('clear')
    expect(spawnWeatherOf({ rain: true, sun: false, tempC: 10 })).toBe('rain')
    const env = { hour: 10, weather: null, trainerLevel: 1 }
    expect(spawnRuleMult(undefined, env)).toBe(1)
    expect(spawnRuleMult({ weightMult: 2, enabled: false }, env)).toBe(0)
    expect(spawnRuleMult({ weightMult: 2, enabled: true, weather: ['rain'] }, env)).toBe(0)
    expect(spawnRuleMult({ weightMult: 2, enabled: true, minTrainerLevel: 5 }, env)).toBe(0)
    expect(spawnRuleMult({ weightMult: 2, enabled: true, hours: [[6, 12]] }, env)).toBe(2)
  })

  it('the base content has no gaps', () => {
    expect(spawnCoverageGaps(base)).toEqual([])
  })

  it('disabling almost every species is an error', () => {
    const species = Object.fromEntries(base.data.species.slice(3).map((s) => [s.slug, { spawn: { enabled: false } }]))
    const r = validateContentPatch({ species }, NO_SMOKE)
    expect(codes(r)).toContain('spawn_coverage')
  })

  it('restricting everything to the night leaves the day uncovered', () => {
    const species = Object.fromEntries(base.data.species.map((s) => [s.slug, { spawn: { hours: [[20, 6]] as [number, number][] } }]))
    const r = validateContentPatch({ species }, NO_SMOKE)
    const cov = r.errors.filter((e) => e.code === 'spawn_coverage')
    expect(cov.length).toBeGreaterThan(0)
    const slots = cov[0]!.params!.slots as { hour: number }[]
    expect(slots.every((s) => s.hour >= 6 && s.hour < 20)).toBe(true)
  })

  it('restricting everything to rain leaves unknown weather uncovered', () => {
    const species = Object.fromEntries(base.data.species.map((s) => [s.slug, { spawn: { weather: ['rain'] as const } }]))
    const cov = validateContentPatch({ species }, NO_SMOKE).errors.filter((e) => e.code === 'spawn_coverage')
    const weathers = new Set(cov.flatMap((e) => (e.params!.slots as { weather: string | null }[]).map((s) => s.weather)))
    expect(weathers).toEqual(new Set(['sun', 'snow', 'clear', null]))
  })

  it('a high minTrainerLevel on most species leaves the first band uncovered', () => {
    const species = Object.fromEntries(base.data.species.map((s) => [s.slug, { spawn: { minTrainerLevel: 10 } }]))
    const cov = validateContentPatch({ species }, NO_SMOKE).errors.filter((e) => e.code === 'spawn_coverage')
    expect(cov.map((e) => e.params!.trainerLevel)).toEqual([1])
  })
})

describe('big-change guard', () => {
  it('×3 on a number or ×5 on a probability needs confirmation', () => {
    const r = validateContentPatch({ config: { rewards: { dustPerMinute: base.config.rewards.dustPerMinute * 4 } } }, NO_SMOKE)
    expect(r.ok).toBe(true)
    expect(r.requiresConfirm).toBe(true)
    expect(r.warnings[0]).toMatchObject({ code: 'big_change', path: 'config.rewards.dustPerMinute', requiresConfirm: true })
    // ×4 on a probability is fine, ×6 is not.
    const sc = base.config.encounters.shinyChance
    expect(validateContentPatch({ config: { encounters: { shinyChance: sc * 4 } } }, NO_SMOKE).requiresConfirm).toBe(false)
    expect(validateContentPatch({ config: { encounters: { shinyChance: sc * 6 } } }, NO_SMOKE).requiresConfirm).toBe(true)
    // Dividing counts too, and dropping to 0.
    expect(validateContentPatch({ config: { rewards: { dustPerMinute: base.config.rewards.dustPerMinute / 4 } } }, NO_SMOKE).requiresConfirm).toBe(true)
    expect(validateContentPatch({ config: { rewards: { dustPerMinute: 0 } } }, NO_SMOKE).requiresConfirm).toBe(true)
    expect(validateContentPatch({ config: { rewards: { dustPerMinute: base.config.rewards.dustPerMinute * 2 } } }, NO_SMOKE).requiresConfirm).toBe(false)
  })

  it('covers capture rates, spawn weights, move power and lists', () => {
    const pika = base.speciesBySlug.get('pikachu')!
    const w = bigChangeWarnings({
      species: { pikachu: { captureRate: Math.min(255, pika.captureRate * 4), spawn: { weightMult: 5 } } },
      config: { encounters: { longSessionLegendaryMult: [1, 5] } },
    })
    expect(w.map((x) => x.path)).toEqual(expect.arrayContaining(['species.pikachu.spawn.weightMult', 'config.encounters.longSessionLegendaryMult.1']))
    if (pika.captureRate * 4 <= 255) expect(w.map((x) => x.path)).toContain('species.pikachu.captureRate')
    expect(bigChangeWarnings({})).toEqual([])
  })
})

describe('big-change guard against the version in force', () => {
  const sc = base.config.encounters.shinyChance
  const live = { config: { encounters: { shinyChance: sc * 6 } } }

  it('does not warn again for a value that is already live and that the draft keeps', () => {
    expect(bigChangeWarnings(live, base).map((w) => w.path)).toContain('config.encounters.shinyChance') // vs the base
    expect(bigChangeWarnings(live, base, live)).toEqual([])
    const r = validateContentPatch({ config: { ...live.config, rewards: { dustPerMinute: base.config.rewards.dustPerMinute * 2 } } }, { ...NO_SMOKE, previous: live })
    expect(r.requiresConfirm).toBe(false)
  })

  it('warns about what really changes: further from live, or a value dropped back to the base', () => {
    const w = bigChangeWarnings({ config: { encounters: { shinyChance: sc * 6 * 2 } } }, base, { config: { encounters: { shinyChance: sc } } })
    expect(w.map((x) => x.path)).toEqual(['config.encounters.shinyChance'])
    expect(w[0]!.params).toMatchObject({ base: sc, value: sc * 12, factor: 5, kind: 'prob', from: 'live' })
    const dropped = bigChangeWarnings({}, base, live)
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toMatchObject({ path: 'config.encounters.shinyChance', requiresConfirm: true, params: { base: sc * 6, value: sc, from: 'live' } })
  })

  it('covers species, moves and lists against the live patch; an empty live patch is the base', () => {
    const livePika = { species: { pikachu: { spawn: { weightMult: 5 } } }, config: { encounters: { longSessionLegendaryMult: [1, 5] } } }
    expect(bigChangeWarnings(livePika, base, livePika)).toEqual([])
    expect(bigChangeWarnings(livePika, base, {}).map((x) => x.params?.from)).toEqual(['base', 'base'])
    const more = bigChangeWarnings({ species: { pikachu: { spawn: { weightMult: 20 } } } }, base, livePika)
    expect(more.map((x) => x.path)).toEqual(expect.arrayContaining(['species.pikachu.spawn.weightMult']))
  })

  it('an event edit only warns about the values it changes', () => {
    const ev = { id: 'e', slug: 'e', startsAt: 1, endsAt: 2, featured: [{ species: 'pikachu', weightMult: 8 }], shiny: { chance: sc * 8, scope: 'all' as const }, legendaryChanceMult: 5, drops: [], missions: [] }
    const paths = (r: ReturnType<typeof validateEventOverlay>) => r.warnings.filter((w) => w.requiresConfirm).map((w) => w.path)
    expect(paths(validateEventOverlay(ev, { smoke: false }))).toEqual(['featured.0.weightMult', 'shiny.chance', 'legendaryChanceMult'])
    expect(paths(validateEventOverlay(ev, { smoke: false, previous: ev }))).toEqual([])
    expect(paths(validateEventOverlay({ ...ev, legendaryChanceMult: 6 }, { smoke: false, previous: ev }))).toEqual(['legendaryChanceMult'])
  })
})

describe('smoke test', () => {
  it('passes on the base context (deterministic)', () => {
    expect(smokeTest(base, { sessions: 30 })).toEqual([])
  })

  it('passes at the edges of the limits', () => {
    const r = validateContentPatch(
      {
        config: {
          encounters: { legendaryChance: 0.05, shinyChance: 0.02 },
          capture: { counter: { damageMult: 5, basePct: 0.5 }, captureDamageScale: 0.5 },
          energy: { costBase: 5 },
          actions: { maxActivationChance: 0.9 },
        },
      },
      { smoke: { sessions: 20 } },
    )
    expect(r.errors).toEqual([])
    expect(r.requiresConfirm).toBe(true)
  })

  it('reports engine failures as errors', () => {
    const ctx = createEngineContext(resolveContent({ config: { encounters: { baseWaveSize: 3 } } }, [], {}))
    // A context the schema would never allow: a NaN scale must be caught.
    const broken = { ...ctx, config: { ...ctx.config, capture: { ...ctx.config.capture, captureDamageScale: Number.NaN } } }
    const issues = smokeTest(broken, { sessions: 3 })
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]!.code).toBe('smoke_failed')
  })
})

describe('validateEventOverlay', () => {
  it('a simple event is valid', () => {
    const r = validateEventOverlay(event(), { smoke: { sessions: 6 } })
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('shape: dates, unknown keys, ranges', () => {
    expect(validateEventOverlay(event({ endsAt: Date.UTC(2026, 10, 1) }), NO_SMOKE).ok).toBe(false)
    expect(validateEventOverlay({ ...event(), config: {} }, NO_SMOKE).ok).toBe(false)
    expect(validateEventOverlay(event({ featured: [{ species: 'pikachu', weightMult: 50 }] }), NO_SMOKE).ok).toBe(false)
    expect(validateEventOverlay(event({ shiny: { chance: 0.5, scope: 'all' } }), NO_SMOKE).ok).toBe(false)
    expect(validateEventOverlay(event({ endsAt: Date.UTC(2027, 5, 1) }), NO_SMOKE).ok).toBe(false)
  })

  it('references: species, drops and event items', () => {
    expect(codes(validateEventOverlay(event({ featured: [{ species: 'missingno', weightMult: 2 }] }), NO_SMOKE))).toContain('unknown_species')
    expect(codes(validateEventOverlay(event({ drops: [{ item: 'golden-banana', perWaveChance: 0.2, max: 3 }] }), NO_SMOKE))).toContain('unknown_item')
    const own = event({
      drops: [{ item: 'golden-banana', perWaveChance: 0.2, max: 3 }],
      items: { 'golden-banana': { names: { es: 'Plátano dorado', en: 'Golden banana' } } },
    })
    expect(validateEventOverlay(own, NO_SMOKE).ok).toBe(true)
    expect(codes(validateEventOverlay(event({ items: { 'poke-ball': { names: { es: 'x', en: 'x' } } } }), NO_SMOKE))).toContain('item_shadows_base')
    expect(codes(validateEventOverlay(event({ shiny: { chance: 0.01, scope: 'featured' }, featured: [] }), NO_SMOKE))).toContain('shiny_no_featured')
  })

  it('event missions: period event, unique ids, known items', () => {
    const m = { ...basePool[0]!, period: 'event' as const, id: 'ev-sessions' }
    const { weight: _w, ...noWeight } = m
    expect(validateEventOverlay(event({ missions: [noWeight] }), NO_SMOKE).ok).toBe(true)
    expect(validateEventOverlay(event({ missions: [{ ...noWeight, period: 'daily' as never }] }), NO_SMOKE).ok).toBe(false)
    expect(codes(validateEventOverlay(event({ missions: [noWeight, noWeight] }), NO_SMOKE))).toContain('duplicate_id')
  })

  it('big boosts need confirmation', () => {
    const sc = base.config.encounters.shinyChance
    expect(validateEventOverlay(event({ shiny: { chance: sc * 3, scope: 'all' } }), NO_SMOKE).requiresConfirm).toBe(false)
    expect(validateEventOverlay(event({ shiny: { chance: sc * 10, scope: 'all' } }), NO_SMOKE).requiresConfirm).toBe(true)
    expect(validateEventOverlay(event({ legendaryChanceMult: 5 }), NO_SMOKE).requiresConfirm).toBe(true)
    expect(validateEventOverlay(event({ featured: [{ species: 'pikachu', weightMult: 8 }] }), NO_SMOKE).requiresConfirm).toBe(true)
  })
})

describe('client chunk safety', () => {
  it('src/game/content imports no server or node modules', () => {
    const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5)
    for (const [f, src] of Object.entries(sources)) {
      const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1] as string)
      for (const s of specs) {
        expect(s.startsWith('node:') || s.includes('server') || s.includes('/ui/'), `${f}: ${s}`).toBe(false)
        expect(s === 'zod' || s.startsWith('.'), `${f}: ${s}`).toBe(true)
      }
    }
  })
})
