/**
 * Manual damage split (docs/session-depth-plan.md §A).
 *
 * Every team member that acted during a wave's 25-min block is a **damage
 * token**: all of its hits of that block (`Wave.hits`, grouped by move). In
 * manual mode the player sends each token to one wild; until the first ball of
 * the wave is thrown the split can change freely. The first throw locks the
 * wave and every token still unassigned takes today's automatic split (the
 * maxHp-weighted targets already rolled in `Wave.hits`).
 *
 * Damage per wild is always derived from the hits that reach its slot with the
 * same formulas as before (`hitDamage`, `hpFractionAfter`): damage below
 * `capture.minHpFraction` is wasted.
 */
import type { GameConfig } from './config'
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { TypeSlug } from './data-types'
import { err, ok, type DamageAssignment, type EncounterState, type PlayerState, type Result, type Wave, type WaveHit, type WildPokemon } from './state'
import { computeStats } from './stats'
import { damageFromHits, hitDamage, hpFractionAfter, typeEffectiveness } from './waves'

export interface DamageTokenMove {
  /** Move slug, or null for the no-damage-move Normal hit. */
  move: string | null
  type: TypeSlug
  power: number
  damageClass: 'physical' | 'special'
  /** Shown count ("×N"): Σ max(1, round(units)) of the hit groups, as the wave cards always counted. */
  hits: number
  /** All hits of this member with this move, merged (target is meaningless here). */
  hit: WaveHit
}

export interface DamageToken {
  uid: string
  /** Total shown count of the token (sum of its moves). */
  hits: number
  moves: DamageTokenMove[]
  /** Current assignment, or null = not assigned yet (deals no damage until assigned or locked). */
  assigned: DamageAssignment | null
}

/** The wave uses the manual split (claimed with `autoDamage` off, and it has hits). */
export function isManualWave(wave: Pick<Wave, 'assignments' | 'hits'>): boolean {
  return wave.assignments !== undefined && Boolean(wave.hits)
}

/** Damage tokens of a wave, in order of first appearance in `Wave.hits` (empty for legacy waves). */
export function damageTokens(wave: Pick<Wave, 'hits' | 'assignments'>): DamageToken[] {
  const tokens = new Map<string, DamageToken>()
  for (const h of wave.hits ?? []) {
    let tk = tokens.get(h.uid)
    if (!tk) {
      tk = { uid: h.uid, hits: 0, moves: [], assigned: wave.assignments?.[h.uid] ?? null }
      tokens.set(h.uid, tk)
    }
    const n = Math.max(1, Math.round(h.units))
    tk.hits += n
    let m = tk.moves.find((x) => x.move === h.move)
    if (!m) {
      m = { move: h.move, type: h.type, power: h.power, damageClass: h.damageClass, hits: 0, hit: { ...h, units: 0, unitsVsLegendary: 0 } }
      tk.moves.push(m)
    }
    m.hits += n
    m.hit.units += h.units
    m.hit.unitsVsLegendary += h.unitsVsLegendary
  }
  for (const tk of tokens.values()) tk.moves.sort((a, b) => b.hits - a.hits)
  return [...tokens.values()]
}

/**
 * The hits that actually reach the wilds: in manual mode each member's hits go
 * to its assigned slot (`'auto'` keeps the rolled target); unassigned members
 * deal nothing. Automatic / legacy waves: `Wave.hits` as stored.
 */
export function effectiveHits(wave: Pick<Wave, 'hits' | 'assignments'>): WaveHit[] {
  const hits = wave.hits ?? []
  const a = wave.assignments
  if (!a) return hits
  const out: WaveHit[] = []
  for (const h of hits) {
    const to = a[h.uid]
    if (to === undefined) continue
    out.push(to === 'auto' ? h : { ...h, target: to })
  }
  return out
}

/** Recompute `damage` / `hpFraction` of the pending wilds from the effective hits (manual waves only). */
export function recomputeWaveDamage(wave: Wave, ctx: EngineContext = defaultContext()): Wave {
  if (!isManualWave(wave)) return wave
  const hits = effectiveHits(wave)
  return {
    ...wave,
    wilds: wave.wilds.map((w, slot) => {
      if (w.outcome !== 'pending') return w
      const damage = damageFromHits(hits, slot, w, w.isLegendary, ctx)
      return { ...w, damage, hpFraction: hpFractionAfter(damage, w.maxHp, ctx.config) }
    }),
  }
}

/** Turn a freshly rolled wave (automatic hits) into a manual one: nothing assigned, wilds at full HP. */
export function toManualWave(wave: Wave, ctx: EngineContext = defaultContext()): Wave {
  if (!wave.hits) return wave
  return recomputeWaveDamage({ ...wave, assignments: {}, damageLocked: false }, ctx)
}

/** Lock a manual wave (first ball): unassigned tokens take the automatic split. No-op when automatic or already locked. */
export function lockWaveDamage(wave: Wave, ctx: EngineContext = defaultContext()): Wave {
  if (!isManualWave(wave) || wave.damageLocked) return wave
  const assignments = { ...wave.assignments }
  for (const tk of damageTokens(wave)) if (assignments[tk.uid] === undefined) assignments[tk.uid] = 'auto'
  return recomputeWaveDamage({ ...wave, assignments, damageLocked: true }, ctx)
}

/** Damage above what can be dealt (HP never drops below `capture.minHpFraction`): wasted. */
export function wastedDamage(wild: Pick<WildPokemon, 'damage' | 'maxHp'>, cfg: GameConfig): number {
  return Math.max(0, wild.damage - (1 - cfg.capture.minHpFraction) * wild.maxHp)
}

export interface TokenEstimate {
  /** Total damage the token would deal to this wild. */
  damage: number
  /** Same, as a fraction of the wild's max HP. */
  fraction: number
  moves: { move: string | null; type: TypeSlug; hits: number; damage: number; effectiveness: number }[]
}

/** What a token would do to a wild (tooltip / preview). Same formula as the real damage. */
export function estimateTokenDamage(token: DamageToken, wild: WildPokemon, ctx: EngineContext = defaultContext()): TokenEstimate {
  const stats = computeStats(wild, ctx)
  const types = getSpecies(wild.speciesSlug, ctx).types
  let total = 0
  const moves = token.moves.map((m) => {
    const damage = hitDamage(m.hit, stats, wild.level, types, wild.isLegendary, ctx)
    total += damage
    return { move: m.move, type: m.type, hits: m.hits, damage, effectiveness: typeEffectiveness(m.type, types, ctx.chart, m.hit.effectivenessFloors) }
  })
  return { damage: total, fraction: wild.maxHp > 0 ? total / wild.maxHp : 0, moves }
}

/** The wave as it would look with `uid` assigned to `wildIndex` (null = unassigned). For live previews. */
export function previewAssignment(wave: Wave, uid: string, wildIndex: number | null, ctx: EngineContext = defaultContext()): Wave {
  if (!isManualWave(wave) || wave.damageLocked) return wave
  const assignments = { ...wave.assignments }
  if (wildIndex === null) delete assignments[uid]
  else assignments[uid] = wildIndex
  return recomputeWaveDamage({ ...wave, assignments }, ctx)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type DamageError =
  | 'no_encounter'
  | 'session_active'
  | 'unknown_wave'
  | 'wave_passed'
  | 'damage_auto'
  | 'damage_locked'
  | 'unknown_token'
  | 'unknown_wild'
  | 'wild_resolved'

function editableWave(state: PlayerState, waveIndex: number): Result<{ enc: EncounterState; wave: Wave }, DamageError> {
  const enc = state.encounter
  if (!enc) return err('no_encounter')
  if (state.activeSession) return err('session_active')
  const wave = enc.waves[waveIndex]
  if (!wave) return err('unknown_wave')
  if (waveIndex < enc.currentWave) return err('wave_passed')
  if (!isManualWave(wave)) return err('damage_auto')
  if (wave.damageLocked) return err('damage_locked')
  return ok({ enc, wave })
}

function withWave(state: PlayerState, enc: EncounterState, wave: Wave): PlayerState {
  return { ...state, encounter: { ...enc, waves: enc.waves.map((w) => (w.index === wave.index ? wave : w)) } }
}

/** Send all of a member's damage of a wave to one wild (`wildIndex`), or take it back (`null`). Only before the wave locks. */
export function assignDamage(
  state: PlayerState,
  input: { waveIndex: number; uid: string; wildIndex: number | null },
  ctx: EngineContext = defaultContext(),
): Result<PlayerState, DamageError> {
  const r = editableWave(state, input.waveIndex)
  if (!r.ok) return r
  const { enc, wave } = r.value
  if (!damageTokens(wave).some((tk) => tk.uid === input.uid)) return err('unknown_token')
  const assignments = { ...wave.assignments }
  if (input.wildIndex === null) {
    delete assignments[input.uid]
  } else {
    const wild = wave.wilds[input.wildIndex]
    if (!wild) return err('unknown_wild')
    if (wild.outcome !== 'pending') return err('wild_resolved')
    assignments[input.uid] = input.wildIndex
  }
  return ok(withWave(state, enc, recomputeWaveDamage({ ...wave, assignments }, ctx)))
}

/** "Auto" button: every token still unassigned takes the automatic split (it can still be reassigned until the lock). */
export function autoAssignDamage(state: PlayerState, waveIndex: number, ctx: EngineContext = defaultContext()): Result<PlayerState, DamageError> {
  const r = editableWave(state, waveIndex)
  if (!r.ok) return r
  const { enc, wave } = r.value
  const assignments = { ...wave.assignments }
  for (const tk of damageTokens(wave)) if (assignments[tk.uid] === undefined) assignments[tk.uid] = 'auto'
  return ok(withWave(state, enc, recomputeWaveDamage({ ...wave, assignments }, ctx)))
}

/** Preference for the next claims. An encounter already claimed keeps its `damageMode`. */
export function setAutoDamage(state: PlayerState, value: boolean): PlayerState {
  return { ...state, autoDamage: value }
}
