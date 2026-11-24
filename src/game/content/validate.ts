/**
 * Live content validation (docs/admin-plan.md §2): shape (zod, schema.ts),
 * references and cross-field rules on the resolved context, spawn coverage,
 * the big-change guard and an engine smoke test.
 *
 * The server validates on every draft save and publish (422 with `errors`);
 * the admin client runs the same code live (deferred chunk: no server deps).
 * Errors block saving/publishing; warnings with `requiresConfirm` need the
 * admin to tick «confirm» before publishing.
 *
 * Messages are English; the UI translates by `code` and `params`. `path` is
 * dotted (`config.encounters.shinyChance`, `species.pikachu.spawn.hours.0`)
 * so the UI can link to the field.
 */
import type { z } from 'zod'
import { createNewPlayer, setTeam } from '../../engine/box'
import { advanceWave, throwBall } from '../../engine/capture'
import { buildConfig, type GameConfig, type LeagueId } from '../../engine/config'
import { baseContent, baseContext, createEngineContext, type EngineContext } from '../../engine/context'
import { resolveContent, type ContentItem, type ContentPatch, type EventOverlay } from '../../engine/content'
import { createIndividual, isLegendarySpecies, toOwnedPokemon } from '../../engine/individual'
import { weeklyLadderOf } from '../../engine/league'
import type { MissionDef, MissionRewardDef, PokedexMilestoneDef } from '../../engine/missions'
import { createRng } from '../../engine/rng'
import { applySessionResult, completeSession, startSession } from '../../engine/session'
import type { PlayerState, WeatherInput } from '../../engine/state'
import { MINUTE_MS } from '../../engine/time'
import { spawnCoverageGaps } from './coverage'
import {
  BIG_CHANGE_FACTOR,
  BIG_CHANGE_FACTOR_PROB,
  CONFIG_LIMITS,
  CONFIG_LIST_LIMITS,
  CONFIG_TABLE_LIMITS,
  MIN_SPAWN_SPECIES,
  type LimitKind,
} from './limits'
import { contentPatchSchema, eventOverlaySchema } from './schema'
import { FEATURED_REACH_TRAINER_LEVEL, speciesReach } from './spawnOdds'

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  /** Stable machine code (UI i18n key suffix). */
  code: string
  /** Dotted path of the field ('' = whole document). */
  path: string
  /** English message for logs and fallbacks. */
  message: string
  params?: Record<string, unknown>
  /** Warning that needs an explicit «confirm» to publish. */
  requiresConfirm?: boolean
}

export interface ValidationResult<T> {
  /** No errors (warnings may remain). */
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** Some warning needs «confirm» before publishing. */
  requiresConfirm: boolean
  /** The parsed value (only when the shape is valid). */
  value?: T
}

export interface SmokeOptions {
  /** Synthetic sessions (default 200, ~0.3 s). */
  sessions?: number
  /** Stop after this many errors (default 5). */
  maxErrors?: number
}

export interface ValidateContentOptions {
  /** Patch of the published version this draft replaces (mission id/kind immutability). */
  previous?: ContentPatch | null
  /** Events active with this patch (resolved together for coverage and the smoke test). */
  events?: readonly EventOverlay[]
  /** Items of every published event (known item slugs). */
  allEventItems?: Record<string, ContentItem>
  /** Run the engine smoke test (default true). `false` for cheap live validation while typing. */
  smoke?: boolean | SmokeOptions
}

export interface ValidateEventOptions {
  /** The admin patch the event runs on top of (default: none). */
  patch?: ContentPatch
  /** Items of every published event (other events' items are known slugs). */
  allEventItems?: Record<string, ContentItem>
  /** Other events active at the same time (resolved together in the smoke test). */
  otherEvents?: readonly EventOverlay[]
  /**
   * The published version of this same event, when it is being edited: the big-change guard only fires for
   * values the edit changes, not for ones that were already confirmed when the event was published.
   */
  previous?: EventOverlay | null
  smoke?: boolean | SmokeOptions
}

class Issues {
  errors: ValidationIssue[] = []
  warnings: ValidationIssue[] = []
  error(code: string, path: string, message: string, params?: Record<string, unknown>): void {
    this.errors.push({ code, path, message, ...(params && { params }) })
  }
  warn(code: string, path: string, message: string, params?: Record<string, unknown>, requiresConfirm = false): void {
    this.warnings.push({ code, path, message, ...(params && { params }), ...(requiresConfirm && { requiresConfirm }) })
  }
  result<T>(value?: T): ValidationResult<T> {
    return {
      ok: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      requiresConfirm: this.warnings.some((w) => w.requiresConfirm),
      ...(value !== undefined && { value }),
    }
  }
}

function joinPath(prefix: string, path: readonly PropertyKey[]): string {
  return [prefix, ...path.map(String)].filter((p) => p !== '').join('.')
}

function zodIssues(issues: Issues, error: z.ZodError, prefix = ''): void {
  for (const i of error.issues) {
    const code = i.code === 'unrecognized_keys' ? 'unknown_key' : i.code === 'too_big' || i.code === 'too_small' ? 'out_of_range' : 'invalid'
    const keys = i.code === 'unrecognized_keys' ? (i as { keys: string[] }).keys : undefined
    if (keys) for (const k of keys) issues.error('unknown_key', joinPath(prefix, [...i.path, k]), `unknown or non-editable key ${k}`)
    else issues.error(code, joinPath(prefix, i.path), i.message)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function hasPath(obj: unknown, path: string): boolean {
  return getPath(obj, path) !== undefined
}

/** Item slugs known to the inventory UI: data items + mission placeholders + event items. */
function knownItems(ctx: EngineContext, extra: Record<string, ContentItem> = {}): Set<string> {
  return new Set([
    ...ctx.data.items.map((i) => i.slug),
    ...Object.keys(ctx.missions.placeholderItems).filter((k) => !k.startsWith('_')),
    ...Object.keys(extra),
  ])
}

function checkRewards(issues: Issues, rewards: readonly MissionRewardDef[], path: string, items: Set<string>): void {
  let prev = 0
  rewards.forEach((r, i) => {
    const p = `${path}.${i}`
    const lvl = r.minTrainerLevel ?? 1
    if (lvl < prev) issues.error('reward_tiers_order', `${p}.minTrainerLevel`, 'reward tiers must be sorted by minTrainerLevel', { prev, lvl })
    prev = lvl
    for (const slug of Object.keys(r.items ?? {})) if (!items.has(slug)) issues.error('unknown_item', `${p}.items.${slug}`, `unknown item ${slug}`, { item: slug })
    for (const slug of r.randomItem?.pool ?? []) if (!items.has(slug)) issues.error('unknown_item', `${p}.randomItem.pool`, `unknown item ${slug}`, { item: slug })
    const empty = !r.dust && !r.typeCandies && !r.randomItem && Object.keys(r.items ?? {}).length === 0
    if (empty) issues.warn('empty_reward', p, 'reward tier gives nothing')
  })
  if (rewards.length > 0 && (rewards[0]?.minTrainerLevel ?? 1) > 1) issues.warn('reward_no_base_tier', `${path}.0.minTrainerLevel`, 'no reward below the first tier level')
}

function checkMissionDefs(issues: Issues, defs: readonly (Pick<MissionDef, 'id' | 'kind' | 'type' | 'rewards'> & { period: string })[], path: string, items: Set<string>): void {
  const seen = new Set<string>()
  defs.forEach((d, i) => {
    if (seen.has(d.id)) issues.error('duplicate_id', `${path}.${i}.id`, `duplicate mission id ${d.id}`, { id: d.id })
    seen.add(d.id)
    if (d.kind === 'catchType' && d.type === undefined) issues.warn('catch_type_random', `${path}.${i}.type`, 'catchType without type draws a random one')
    checkRewards(issues, d.rewards, `${path}.${i}.rewards`, items)
  })
}

// ---------------------------------------------------------------------------
// Big-change guard
// ---------------------------------------------------------------------------

function bigChange(base: number, next: number, kind: LimitKind): boolean {
  if (base === next || base < 0 || next < 0 || base === 0) return false
  if (next === 0) return true
  const r = Math.max(next / base, base / next)
  return r > (kind === 'prob' ? BIG_CHANGE_FACTOR_PROB : BIG_CHANGE_FACTOR)
}

function guard(issues: Issues, path: string, ref: unknown, next: unknown, kind: LimitKind, from: 'base' | 'live'): void {
  if (typeof ref !== 'number' || typeof next !== 'number') return
  if (!bigChange(ref, next, kind)) return
  const factor = kind === 'prob' ? BIG_CHANGE_FACTOR_PROB : BIG_CHANGE_FACTOR
  issues.warn('big_change', path, `changes more than ×${factor} vs ${from === 'live' ? 'the live content' : 'base'} (${ref} → ${next})`, { base: ref, value: next, factor, kind, from }, true)
}

/**
 * Warnings (with `requiresConfirm`) for every number that moves more than ×3
 * (probabilities ×5) away from what is in force, or drops to 0. Exported for
 * the admin form (per-field badge).
 *
 * The reference is the patch of the version in force (`active`, what really
 * changes when this one is published), so a draft made «from live» does not
 * ask again for values that are already live and that it leaves alone. With no
 * `active` (a plain draft check, no server context) the reference is the base.
 * A value the draft drops (back to the base) counts as a change too.
 */
export function bigChangeWarnings(patch: ContentPatch, base: EngineContext = baseContext(), active?: ContentPatch | null): ValidationIssue[] {
  const issues = new Issues()
  if (active && Object.keys(active).length === 0) active = null
  const from = active ? 'live' : 'base'
  const cfg = patch.config ?? {}
  const acfg = active?.config ?? {}
  /** The value a patch gives a config path, else the base one. */
  const val = (c: object, path: string) => (hasPath(c, path) ? getPath(c, path) : getPath(base.config, path))
  for (const l of CONFIG_LIMITS) guard(issues, `config.${l.path}`, val(acfg, l.path), val(cfg, l.path), l.kind, from)
  for (const l of CONFIG_LIST_LIMITS) {
    const next = val(cfg, l.path)
    const prev = val(acfg, l.path)
    if (Array.isArray(next) && Array.isArray(prev)) next.forEach((v, i) => guard(issues, `config.${l.path}.${i}`, prev[i], v, l.item.kind, from))
  }
  const slugs = (a: object | undefined, b: object | undefined) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
  for (const slug of slugs(patch.species, active?.species)) {
    const sp = base.speciesBySlug.get(slug)
    const next = patch.species?.[slug]
    const prev = active?.species?.[slug]
    if (sp) guard(issues, `species.${slug}.captureRate`, prev?.captureRate ?? sp.captureRate, next?.captureRate ?? sp.captureRate, 'int', from)
    guard(issues, `species.${slug}.spawn.weightMult`, prev?.spawn?.weightMult ?? 1, next?.spawn?.weightMult ?? 1, 'mult', from)
  }
  for (const slug of slugs(patch.moves, active?.moves)) {
    const m = base.movesBySlug.get(slug)
    const next = patch.moves?.[slug]?.power ?? m?.power
    const prev = active?.moves?.[slug]?.power ?? m?.power
    if (m && m.power != null) guard(issues, `moves.${slug}.power`, prev, next, 'int', from)
  }
  for (const slug of slugs(patch.techniques, active?.techniques)) {
    const b = base.techniques[slug]?.baseChance
    if (b === undefined) continue
    guard(issues, `techniques.${slug}.baseChance`, active?.techniques?.[slug]?.baseChance ?? b, patch.techniques?.[slug]?.baseChance ?? b, 'prob', from)
  }
  return issues.warnings
}

// ---------------------------------------------------------------------------
// Cross-field config rules (on the merged config)
// ---------------------------------------------------------------------------

function checkConfig(issues: Issues, cfg: GameConfig, touched: ContentPatch['config']): void {
  const t = touched ?? {}
  const th = cfg.leagues.weeklyThresholds
  const order: LeagueId[] = cfg.leagues.order
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1] as LeagueId
    const b = order[i] as LeagueId
    if (!(th[b] > th[a])) issues.error('thresholds_not_increasing', `config.leagues.weeklyThresholds.${b}`, `${b} threshold must be above ${a}`, { league: b })
  }
  const rows = cfg.encounters.wildLevelByTrainerLevel
  rows.forEach((r, i) => {
    const p = `config.encounters.wildLevelByTrainerLevel.${i}`
    if (r.min > r.max) issues.error('min_above_max', p, 'wild min level above max', { row: i })
    const prev = rows[i - 1]
    if (prev && r.trainerLevel <= prev.trainerLevel) issues.error('table_not_sorted', `${p}.trainerLevel`, 'trainer levels must be strictly increasing', { row: i })
    if (prev && (r.min < prev.min || r.max < prev.max)) issues.warn('wild_levels_decrease', p, 'wild levels go down with trainer level', { row: i })
  })
  if (rows[0] && rows[0].trainerLevel !== 1) issues.error('table_first_row', 'config.encounters.wildLevelByTrainerLevel.0.trainerLevel', 'first row must start at trainer level 1')
  const caps = cfg.progression.levelCaps
  caps.forEach((c, i) => {
    const prev = caps[i - 1]
    if (prev && (c.species <= prev.species || c.cap < prev.cap)) issues.error('table_not_sorted', `config.progression.levelCaps.${i}`, 'level caps must be sorted by species, caps not decreasing', { row: i })
  })
  if (caps[0] && caps[0].species !== 0) issues.error('table_first_row', 'config.progression.levelCaps.0.species', 'first level cap must start at 0 species')
  const e = cfg.encounters
  for (const l of order) {
    const q = e.leagueQuality?.[l]
    if (q && q.ivFloor.to < q.ivFloor.from) issues.error('quality_range', `config.encounters.leagueQuality.${l}.ivFloor.to`, 'the IV floor goes down inside the league', { league: l })
    const w = e.leagueWaveSize[l]
    if (w.to < w.from) issues.error('wave_size_range', `config.encounters.leagueWaveSize.${l}.to`, 'wave size goes down inside the league', { league: l })
  }
  // The whole ladder must grow: the generated thresholds depend on the league starts, the second rung and the top.
  const ladder = weeklyLadderOf(cfg)
  if ((cfg.leagues.secondRankPoints ?? 0) >= (th[order[1] as LeagueId] ?? Infinity)) {
    issues.error('thresholds_not_increasing', 'config.leagues.secondRankPoints', 'the second rung must be below the second league', {})
  }
  const last = order[order.length - 1] as LeagueId
  if ((cfg.leagues.topRankPoints ?? Infinity) <= th[last]) issues.error('thresholds_not_increasing', 'config.leagues.topRankPoints', 'the top rung must be above the last league', { league: last })
  if (ladder.some((r, i) => i > 0 && r.points <= (ladder[i - 1] as (typeof ladder)[number]).points)) {
    issues.error('thresholds_not_increasing', 'config.leagues.weeklyThresholds', 'ladder thresholds must grow', {})
  }
  const balls = cfg.capture.balls
  if (!(balls['poke-ball'].mult <= balls['great-ball'].mult && balls['great-ball'].mult <= balls['ultra-ball'].mult)) {
    issues.warn('balls_order', 'config.capture.balls', 'better balls should not have a lower multiplier')
  }
  // Non-pinnable changes (docs/admin-plan.md §1 «Riesgos»).
  for (const l of [...CONFIG_LIMITS, ...CONFIG_LIST_LIMITS, ...CONFIG_TABLE_LIMITS]) {
    if (!l.impact || !hasPath(t, l.path)) continue
    if (l.impact === 'leagueWeek') issues.warn('live_league_week', `config.${l.path}`, 'applies to the current league week; consider scheduling it for Monday 00:00')
    else issues.warn('live_owned', `config.${l.path}`, 'applies at once to Pokémon already caught')
  }
}

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------

/** 2026-11-02 (Monday) 00:00 UTC. */
const SMOKE_T0 = Date.UTC(2026, 10, 2, 0, 0)
const SMOKE_WEATHERS: (WeatherInput | null)[] = [
  null,
  { rain: true, sun: false, tempC: 14 },
  { rain: false, sun: true, tempC: 30 },
  { rain: false, sun: false, snow: true, tempC: -2 },
  { rain: false, sun: false, tempC: 18 },
]
const SMOKE_BALLS = ['poke-ball', 'great-ball', 'ultra-ball'] as const

/** First non-finite number (NaN/±Infinity) inside `v`, as a dotted path. */
function findNonFinite(v: unknown, path = '', depth = 0): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : path || '(root)'
  if (depth > 12 || typeof v !== 'object' || v === null) return null
  for (const [k, x] of Object.entries(v)) {
    const hit = findNonFinite(x, path ? `${path}.${k}` : k, depth + 1)
    if (hit) return hit
  }
  return null
}

function smokeSession(i: number, ctx: EngineContext): string | null {
  const cfg = ctx.config
  const rows = cfg.encounters.wildLevelByTrainerLevel
  const row = rows[i % rows.length] ?? { trainerLevel: 1, min: 2, max: 10 }
  const starters = cfg.starters
  const starter = starters[i % starters.length] ?? 'bulbasaur'
  const rng = createRng(`content-smoke|${i}`)
  const now = SMOKE_T0 + i * 7 * 3_600_000 + (i % 4) * 15 * MINUTE_MS
  const created = createNewPlayer({ trainerName: 'Smoke', locale: 'en', starterSlug: starter, now: now - 120 * MINUTE_MS, timezone: 0 }, rng, ctx)
  if (!created.ok) return `createNewPlayer: ${created.error}`
  let s: PlayerState = created.value
  // A team of non-legendary species around the band's levels.
  const pool = ctx.data.species.filter((sp) => !isLegendarySpecies(sp))
  const uids: string[] = [...s.team]
  const level = Math.max(1, Math.min(100, row.max))
  for (let k = 0; k < 2 + (i % 4); k++) {
    const sp = pool[(i * 7 + k * 13) % pool.length]
    if (!sp) break
    const uid = `smoke${k}`
    const core = createIndividual(sp.slug, Math.max(1, level - k * 3), rng, {}, ctx)
    s = { ...s, pokemon: { ...s.pokemon, [uid]: toOwnedPokemon(core, uid, now - 120 * MINUTE_MS, 'poke-ball', ctx) } }
    uids.push(uid)
  }
  const team = setTeam(s, uids.slice(0, 6), now - 60 * MINUTE_MS, ctx)
  if (!team.ok) return `setTeam: ${team.error}`
  s = { ...team.value, trainer: { ...team.value.trainer, level: row.trainerLevel }, inventory: { 'poke-ball': 30, 'great-ball': 10, 'ultra-ball': 10 } }
  const presets = cfg.session.presets
  const minutes = presets[i % presets.length] ?? 25
  const st = startSession(s, { plannedMinutes: minutes, startedAt: now }, ctx)
  if (!st.ok) return `startSession: ${st.error}`
  const endedAt = now + minutes * MINUTE_MS
  const late = i % 5 === 4
  const res = completeSession(
    st.value.state,
    st.value.session,
    {
      endedAt,
      claimedAt: endedAt + (late ? (cfg.session.claimWindowMinutes + 5) * MINUTE_MS : MINUTE_MS),
      pausedSeconds: 0,
      focusInputs: { screenshotLabels: i % 3 === 0 ? null : ['studying'], missedCaptures: 0 },
      weather: SMOKE_WEATHERS[i % SMOKE_WEATHERS.length] ?? null,
      soundProfile: null,
    },
    rng,
    ctx,
  )
  if (!res.ok) return `completeSession: ${res.error}`
  const bad = findNonFinite(res.value)
  if (bad) return `non-finite number in session result at ${bad}`
  const applied = applySessionResult(st.value.state, res.value, ctx)
  if (!applied.ok) return `applySessionResult: ${applied.error}`
  s = applied.value.state
  let t = endedAt + 2 * MINUTE_MS
  // Throw at every wild of every wave (bounded), then move on.
  for (let guardSteps = 0; s.encounter && guardSteps < 400; guardSteps++) {
    const enc = s.encounter
    const wave = enc.waves[enc.currentWave]
    const wi = wave ? wave.wilds.findIndex((w) => w.outcome === 'pending') : -1
    if (!wave || wi < 0) {
      s = advanceWave(s, ctx)
      continue
    }
    const ball = SMOKE_BALLS[(i + guardSteps) % SMOKE_BALLS.length] as (typeof SMOKE_BALLS)[number]
    const r = throwBall(s, { waveIndex: enc.currentWave, wildIndex: wi }, ball, rng, t, ctx)
    if (!r.ok) {
      if (r.error === 'no_ball') s = { ...s, inventory: { ...s.inventory, [ball]: 10 } }
      else return `throwBall: ${r.error}`
    } else {
      const o = r.value.outcome
      if (!(o.chance >= 0 && o.chance <= 1)) return `catch chance out of range: ${o.chance}`
      s = r.value.state
    }
    t += MINUTE_MS
  }
  if (s.encounter) return 'encounter did not finish'
  const badState = findNonFinite({ pokemon: s.pokemon, trainer: s.trainer, dust: s.dust, inventory: s.inventory, league: s.league })
  if (badState) return `non-finite number in player state at ${badState}`
  return null
}

/**
 * Deterministic synthetic sessions with the engine (start → complete → apply →
 * throw at every wild): no exceptions, no NaN/Infinity. Varies starters, team
 * size, trainer level bands, durations, weather, late claims and balls.
 */
export function smokeTest(ctx: EngineContext, opts: SmokeOptions = {}): ValidationIssue[] {
  const n = opts.sessions ?? 200
  const maxErrors = opts.maxErrors ?? 5
  const out: ValidationIssue[] = []
  for (let i = 0; i < n && out.length < maxErrors; i++) {
    let msg: string | null
    try {
      msg = smokeSession(i, ctx)
    } catch (e) {
      msg = `exception: ${e instanceof Error ? e.message : String(e)}`
    }
    if (msg) out.push({ code: 'smoke_failed', path: '', message: `smoke session ${i}: ${msg}`, params: { session: i } })
  }
  return out
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** One error per trainer-level band with gaps (with the failing hour/weather slots). */
export function coverageIssues(ctx: EngineContext): ValidationIssue[] {
  const byBand = new Map<number, ReturnType<typeof spawnCoverageGaps>>()
  for (const g of spawnCoverageGaps(ctx)) {
    const list = byBand.get(g.trainerLevel) ?? []
    list.push(g)
    byBand.set(g.trainerLevel, list)
  }
  return [...byBand.entries()].map(([trainerLevel, gaps]) => {
    const first = gaps[0]!
    return {
      code: 'spawn_coverage',
      path: 'species',
      message: `trainer level ${trainerLevel} (wild lv ${first.wildLevel}): fewer than ${MIN_SPAWN_SPECIES} species in ${gaps.length} hour×weather slot(s), e.g. ${first.hour}h/${first.weather ?? 'unknown'} has ${first.species}`,
      params: { trainerLevel, wildLevel: first.wildLevel, slots: gaps.map((g) => ({ hour: g.hour, weather: g.weather, species: g.species })) },
    }
  })
}

// ---------------------------------------------------------------------------
// ContentPatch
// ---------------------------------------------------------------------------

function smokeOpts(o: boolean | SmokeOptions | undefined): SmokeOptions | null {
  if (o === false) return null
  return o === true || o === undefined ? {} : o
}

function contextIssues(issues: Issues, ctx: EngineContext): void {
  const baseWarnings = new Set(baseContext().warnings)
  for (const w of ctx.warnings) if (!baseWarnings.has(w)) issues.error('context_warning', '', w)
}

function checkMissions(issues: Issues, patch: ContentPatch, previous: ContentPatch | null | undefined, ctx: EngineContext, extraItems: Record<string, ContentItem>): void {
  const mp = patch.missions
  if (!mp) return
  const items = knownItems(ctx, extraItems)
  const base = baseContent().missions
  if (mp.pool) {
    checkMissionDefs(issues, mp.pool, 'missions.pool', items)
    // Ids are immutable: a def of the base or of the published version cannot disappear or change kind.
    const refs = new Map<string, MissionDef>()
    for (const d of [...base.pool, ...(previous?.missions?.pool ?? [])]) refs.set(d.id, d)
    const next = new Map(mp.pool.map((d) => [d.id, d]))
    for (const [id, ref] of refs) {
      const d = next.get(id)
      if (!d) issues.error('mission_removed', 'missions.pool', `mission ${id} cannot be removed (set weight 0)`, { id })
      else if (d.kind !== ref.kind) issues.error('mission_kind_changed', `missions.pool.${mp.pool.indexOf(d)}.kind`, `mission ${id} cannot change kind`, { id })
      else if (d.period !== ref.period) issues.warn('mission_period_changed', `missions.pool.${mp.pool.indexOf(d)}.period`, `mission ${id} changes period`, { id })
    }
  }
  if (mp.pokedex) {
    const seen = new Set<string>()
    mp.pokedex.forEach((m: PokedexMilestoneDef, i) => {
      if (seen.has(m.id)) issues.error('duplicate_id', `missions.pokedex.${i}.id`, `duplicate milestone id ${m.id}`, { id: m.id })
      seen.add(m.id)
      if (m.species > ctx.data.species.length) issues.warn('milestone_unreachable', `missions.pokedex.${i}.species`, 'more species than exist')
      checkRewards(issues, m.rewards, `missions.pokedex.${i}.rewards`, items)
    })
    const next = new Set(mp.pokedex.map((m) => m.id))
    for (const m of [...base.pokedex, ...(previous?.missions?.pokedex ?? [])]) {
      if (!next.has(m.id)) issues.warn('milestone_removed', 'missions.pokedex', `milestone ${m.id} removed`, { id: m.id })
    }
  }
  // Each period must still fill its slots at trainer level 1 with drawable defs (weight > 0).
  const m = ctx.missions
  for (const period of ['daily', 'weekly'] as const) {
    const count = period === 'daily' ? m.dailyCount : m.weeklyCount
    const drawable = m.pool.filter((d) => d.period === period && (d.minTrainerLevel ?? 1) <= 1 && (d.weight ?? 1) > 0).length
    if (drawable < count) issues.error('mission_pool_short', `missions.${period}Count`, `${period}: ${drawable} drawable missions at trainer level 1 for ${count} slots`, { period, drawable, count })
  }
}

/**
 * Validate an admin `ContentPatch` (unknown JSON). Shape first; if it is
 * valid, references and rules on the resolved context, coverage, the
 * big-change guard and (unless `smoke: false`) the engine smoke test.
 */
export function validateContentPatch(input: unknown, opts: ValidateContentOptions = {}): ValidationResult<ContentPatch> {
  const issues = new Issues()
  const parsed = contentPatchSchema.safeParse(input)
  if (!parsed.success) {
    zodIssues(issues, parsed.error)
    return issues.result()
  }
  const patch = parsed.data as ContentPatch
  const base = baseContext()

  // References: the patch only modifies existing entries.
  for (const slug of Object.keys(patch.species ?? {})) if (!base.speciesBySlug.has(slug)) issues.error('unknown_species', `species.${slug}`, `unknown species ${slug}`)
  for (const [slug, p] of Object.entries(patch.moves ?? {})) {
    const m = base.movesBySlug.get(slug)
    if (!m) issues.error('unknown_move', `moves.${slug}`, `unknown move ${slug}`)
    else if (p.power !== undefined && (p.power === null) !== (m.power === null)) {
      issues.error('move_power_kind', `moves.${slug}.power`, 'power cannot switch between a damage move and a status move')
    }
  }
  for (const [slug, s] of Object.entries(patch.species ?? {})) {
    if (s.spawn?.minTrainerLevel !== undefined && s.spawn.minTrainerLevel > buildConfig().trainer.maxLevel) {
      issues.warn('spawn_unreachable', `species.${slug}.spawn.minTrainerLevel`, 'above the max trainer level: never spawns')
    }
    if (s.spawn?.enabled === false && base.config.starters.includes(slug)) issues.warn('starter_disabled', `species.${slug}.spawn.enabled`, 'a starter will not spawn in the wild')
  }
  for (const slug of Object.keys(patch.techniques ?? {})) {
    if (!(slug in base.techniques)) issues.error('unknown_technique', `techniques.${slug}`, `unknown technique ${slug} (new techniques are not supported yet)`)
    else issues.warn('live_owned', `techniques.${slug}`, 'applies at once to Pokémon already caught')
  }
  for (const slug of Object.keys(patch.abilities ?? {})) {
    if (!(slug in base.abilities)) issues.error('unknown_ability', `abilities.${slug}`, `unknown ability ${slug} (new abilities are not supported yet)`)
    else issues.warn('live_owned', `abilities.${slug}`, 'applies at once to Pokémon already caught')
  }
  if (issues.errors.length > 0) return issues.result(patch)

  // Resolve and check the context.
  let ctx: EngineContext
  try {
    ctx = createEngineContext(resolveContent(patch, opts.events ?? [], opts.allEventItems ?? {}))
  } catch (e) {
    issues.error('resolve_failed', '', `could not resolve the content: ${e instanceof Error ? e.message : String(e)}`)
    return issues.result(patch)
  }
  contextIssues(issues, ctx)
  checkConfig(issues, ctx.config, patch.config)
  checkMissions(issues, patch, opts.previous, ctx, opts.allEventItems ?? {})
  for (const i of coverageIssues(ctx)) issues.errors.push(i)
  issues.warnings.push(...bigChangeWarnings(patch, base, opts.previous))

  const smoke = smokeOpts(opts.smoke)
  if (smoke && issues.errors.length === 0) issues.errors.push(...smokeTest(ctx, smoke))
  return issues.result(patch)
}

// ---------------------------------------------------------------------------
// EventOverlay
// ---------------------------------------------------------------------------

/**
 * Validate a live event (`EventOverlay`, unknown JSON): shape, references
 * (featured species, drop and reward items), id uniqueness, the big-change
 * guard (shiny ×5 vs base, legendary/featured ×3) and, unless `smoke: false`,
 * the smoke test with the event resolved over `opts.patch`.
 */
export function validateEventOverlay(input: unknown, opts: ValidateEventOptions = {}): ValidationResult<EventOverlay> {
  const issues = new Issues()
  const parsed = eventOverlaySchema.safeParse(input)
  if (!parsed.success) {
    zodIssues(issues, parsed.error)
    return issues.result()
  }
  const ev = parsed.data as EventOverlay
  const patch = opts.patch ?? {}
  let ctx: EngineContext
  try {
    ctx = createEngineContext(resolveContent(patch, [...(opts.otherEvents ?? []), ev], opts.allEventItems ?? {}))
  } catch (e) {
    issues.error('resolve_failed', '', `could not resolve the content: ${e instanceof Error ? e.message : String(e)}`)
    return issues.result(ev)
  }
  const items = knownItems(ctx, { ...(opts.allEventItems ?? {}), ...(ev.items ?? {}) })
  const baseItems = new Set(baseContext().data.items.map((i) => i.slug))

  const featured = new Set<string>()
  ev.featured.forEach((f, i) => {
    const p = `featured.${i}`
    const sp = ctx.speciesBySlug.get(f.species)
    if (!sp) issues.error('unknown_species', `${p}.species`, `unknown species ${f.species}`)
    else if (isLegendarySpecies(sp)) issues.warn('featured_legendary', `${p}.species`, 'featuring a legendary only changes which legendary appears, not how often (use legendaryChanceMult)')
    else {
      // A featured species that low-level players cannot meet at all: the admin should know before publishing.
      const reach = speciesReach(ctx, sp)
      if (reach.kind === 'evolution') issues.warn('featured_evolution_only', `${p}.species`, `${f.species} never appears in the wild (evolution only): featuring it changes nothing`, { species: f.species, wildLevel: reach.wildLevel })
      else if (reach.kind === 'wild') {
        const trainerLevel = Math.max(reach.trainerLevel, ctx.spawn.get(f.species)?.minTrainerLevel ?? 1)
        if (trainerLevel > FEATURED_REACH_TRAINER_LEVEL) {
          issues.warn('featured_high_level', `${p}.species`, `${f.species} only appears in the wild from trainer level ${trainerLevel} (wild level ${reach.wildLevel})`, { species: f.species, trainerLevel, wildLevel: reach.wildLevel, below: FEATURED_REACH_TRAINER_LEVEL })
        }
      }
    }
    if (featured.has(f.species)) issues.error('duplicate_featured', `${p}.species`, `${f.species} featured twice`)
    featured.add(f.species)
    const was = opts.previous?.featured.find((x) => x.species === f.species)?.weightMult
    if (f.weightMult > BIG_CHANGE_FACTOR && f.weightMult !== was) issues.warn('big_change', `${p}.weightMult`, `featured weight ×${f.weightMult}`, { value: f.weightMult, factor: BIG_CHANGE_FACTOR }, true)
  })
  if (ev.shiny) {
    const base = ctx.config.encounters.shinyChance
    if (ev.shiny.scope === 'featured' && ev.featured.length === 0) issues.error('shiny_no_featured', 'shiny.scope', 'shiny scope "featured" without featured species')
    if (ev.shiny.chance <= base) issues.warn('shiny_not_higher', 'shiny.chance', 'event shiny chance not above the base one (no effect)')
    else if (base > 0 && ev.shiny.chance / base > BIG_CHANGE_FACTOR_PROB && ev.shiny.chance !== opts.previous?.shiny?.chance) {
      issues.warn('big_change', 'shiny.chance', `shiny chance ×${(ev.shiny.chance / base).toFixed(1)} vs base`, { base, value: ev.shiny.chance, factor: BIG_CHANGE_FACTOR_PROB }, true)
    }
  }
  if (ev.legendaryChanceMult !== undefined && ev.legendaryChanceMult > BIG_CHANGE_FACTOR && ev.legendaryChanceMult !== opts.previous?.legendaryChanceMult) {
    issues.warn('big_change', 'legendaryChanceMult', `legendary chance ×${ev.legendaryChanceMult}`, { value: ev.legendaryChanceMult, factor: BIG_CHANGE_FACTOR }, true)
  }
  const dropItems = new Set<string>()
  ev.drops.forEach((d, i) => {
    if (!items.has(d.item)) issues.error('unknown_item', `drops.${i}.item`, `unknown item ${d.item}`, { item: d.item })
    if (dropItems.has(d.item)) issues.error('duplicate_drop', `drops.${i}.item`, `${d.item} dropped twice`)
    dropItems.add(d.item)
  })
  for (const slug of Object.keys(ev.items ?? {})) {
    if (baseItems.has(slug)) issues.error('item_shadows_base', `items.${slug}`, `item ${slug} already exists in the game data`)
  }
  checkMissionDefs(issues, ev.missions, 'missions', items)
  const poolIds = new Set(ctx.missions.pool.map((d) => d.id))
  ev.missions.forEach((m, i) => {
    if (poolIds.has(m.id)) issues.warn('event_mission_id_shared', `missions.${i}.id`, `id ${m.id} is also a daily/weekly mission id`)
  })
  contextIssues(issues, ctx)

  const smoke = smokeOpts(opts.smoke)
  if (smoke && issues.errors.length === 0) issues.errors.push(...smokeTest(ctx, smoke))
  return issues.result(ev)
}
