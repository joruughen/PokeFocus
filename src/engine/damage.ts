/**
 * Damage split and attacks (docs/session-depth-plan.md §A, GDD §11.4).
 *
 * Every team member that acted during a wave's 25-min block is a **damage
 * token**: all of its hits of that block (`Wave.hits`, grouped by move). In
 * manual mode the player sends each token to one wild. **Assigning is an
 * attack and is irreversible**: the wild strikes back at the attacker right
 * away (recorded in `Wave.attacks`), unless a status technique worked on it
 * (asleep or paralyzed: no counterattack). An exhausted member (0 Energy)
 * cannot attack. The Auto button attacks with every token left (automatic
 * split: its hits keep their rolled maxHp-weighted targets, and the wild that
 * takes most of its damage strikes back). The first ball of a wave (manual or
 * automatic mode) does the same for whoever has not attacked and locks the
 * wave; tokens of exhausted members stay unassigned and deal nothing.
 *
 * Damage per wild is always derived from the hits that reach its slot with the
 * same formulas as before (`hitDamage`, `hpFractionAfter`): damage below
 * `capture.minHpFraction` is wasted.
 */
import type { GameConfig } from './config'
import { defaultContext, getSpecies, type EngineContext } from './context'
import { resolveCounterOn, wildCanStrikeBack } from './counter'
import type { TypeSlug } from './data-types'
import type { Rng } from './rng'
import { err, ok, type DamageAssignment, type EncounterState, type PlayerState, type Result, type Wave, type WaveAttack, type WaveHit, type WildPokemon } from './state'
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
      // counterReflect losses are not hits: keep them on top of the recomputed damage.
      return { ...w, damage, hpFraction: hpFractionAfter(damage + (w.extraHpLoss ?? 0) * w.maxHp, w.maxHp, ctx.config) }
    }),
  }
}

/** Turn a freshly rolled wave (automatic hits) into a manual one: nothing assigned, wilds at full HP. */
export function toManualWave(wave: Wave, ctx: EngineContext = defaultContext()): Wave {
  if (!wave.hits) return wave
  return recomputeWaveDamage({ ...wave, assignments: {}, damageLocked: false }, ctx)
}

/**
 * The wave as the first ball will lock it (pure preview, no counterattacks): every token not
 * assigned yet whose member can still attack (`canAttackUid`, default: everyone) takes the
 * automatic split. Automatic-mode waves become all-`'auto'`. No-op when already locked or
 * without hits (legacy).
 */
export function lockWaveDamage(wave: Wave, ctx: EngineContext = defaultContext(), canAttackUid: (uid: string) => boolean = () => true): Wave {
  if (!wave.hits || wave.damageLocked) return wave
  const assignments = { ...(wave.assignments ?? {}) }
  for (const tk of damageTokens(wave)) if (assignments[tk.uid] === undefined && canAttackUid(tk.uid)) assignments[tk.uid] = 'auto'
  return recomputeWaveDamage({ ...wave, assignments, damageLocked: true }, ctx)
}

/** Has Energy left to attack (GDD §5.3: an exhausted Pokémon does not act). */
export function canAttack(state: PlayerState, uid: string): boolean {
  return (state.pokemon[uid]?.energy.current ?? 0) > 0
}

/**
 * The wild that strikes back at a token's attack: its assigned slot, or (automatic split) the
 * pending wild that takes most of its damage. null when none is pending.
 */
export function attackTarget(wave: Wave, uid: string, ctx: EngineContext = defaultContext()): number | null {
  const a = wave.assignments?.[uid]
  if (typeof a === 'number') return wave.wilds[a]?.outcome === 'pending' ? a : null
  const by = new Map<number, number>()
  for (const h of effectiveHits(wave)) {
    if (h.uid !== uid) continue
    const w = wave.wilds[h.target]
    if (!w || w.outcome !== 'pending') continue
    by.set(h.target, (by.get(h.target) ?? 0) + hitDamage(h, computeStats(w, ctx), w.level, getSpecies(w.speciesSlug, ctx).types, w.isLegendary, ctx))
  }
  let best: number | null = null
  let bestDmg = -1
  for (const [slot, d] of by) {
    if (d > bestDmg) {
      best = slot
      bestDmg = d
    }
  }
  return best
}

/**
 * `uid` attacks: it is assigned `to` in wave `waveIndex` (irreversible), the damage is recomputed
 * and the target wild strikes back at it (`wildCanStrikeBack`). Records `Wave.attacks[uid]`.
 * No validation: callers check the rules.
 */
function attackWith(state: PlayerState, waveIndex: number, uid: string, to: DamageAssignment, rng: Rng, ctx: EngineContext): PlayerState {
  const enc = state.encounter as EncounterState
  const before = enc.waves[waveIndex] as Wave
  let wave = recomputeWaveDamage({ ...before, assignments: { ...(before.assignments ?? {}), [uid]: to } }, ctx)
  const slot = attackTarget(wave, uid, ctx)
  let record: WaveAttack = { wildIndex: slot, counter: null, skipped: null }
  let pokemon = state.pokemon
  const wild = slot === null ? undefined : wave.wilds[slot]
  if (slot !== null && wild) {
    const can = wildCanStrikeBack(wild)
    if (!can.ok) {
      record = { ...record, skipped: can.why }
    } else {
      const s0: PlayerState = { ...state, encounter: { ...enc, waves: enc.waves.map((w) => (w.index === waveIndex ? wave : w)) } }
      const r = resolveCounterOn(s0, uid, wild, rng, ctx)
      if (r) {
        record = { ...record, counter: r.counter }
        pokemon = { ...pokemon, [uid]: r.target }
        const hit = r.wild
        wave = { ...wave, wilds: wave.wilds.map((w, i) => (i === slot ? hit : w)) }
      }
    }
  }
  const done = { ...wave, attacks: { ...(wave.attacks ?? {}), [uid]: record } }
  return { ...state, pokemon, encounter: { ...enc, waves: enc.waves.map((w) => (w.index === waveIndex ? done : w)) } }
}

/** Every token not assigned yet whose member has Energy attacks with the automatic split (team order first). */
function attackWithRest(state: PlayerState, waveIndex: number, rng: Rng, ctx: EngineContext): PlayerState {
  const wave = state.encounter?.waves[waveIndex]
  if (!wave) return state
  const order = (uid: string) => {
    const i = state.team.indexOf(uid)
    return i < 0 ? 99 : i
  }
  const uids = damageTokens(wave)
    .map((tk) => tk.uid)
    .filter((uid) => wave.assignments?.[uid] === undefined)
    .sort((a, b) => order(a) - order(b))
  let s = state
  for (const uid of uids) if (canAttack(s, uid)) s = attackWith(s, waveIndex, uid, 'auto', rng, ctx)
  return s
}

/**
 * First ball of a wave: whoever has not attacked (and has Energy) attacks with the automatic
 * split, then the wave locks. Automatic-mode waves become all-`'auto'` assignments here. No-op
 * when already locked or without hits (legacy saves).
 */
export function lockWaveAttacks(state: PlayerState, waveIndex: number, rng: Rng, ctx: EngineContext = defaultContext()): PlayerState {
  const enc = state.encounter
  const wave = enc?.waves[waveIndex]
  if (!enc || !wave || !wave.hits || wave.damageLocked) return state
  const start: PlayerState = wave.assignments
    ? state
    : { ...state, encounter: { ...enc, waves: enc.waves.map((w) => (w.index === waveIndex ? recomputeWaveDamage({ ...w, assignments: {} }, ctx) : w)) } }
  const s = attackWithRest(start, waveIndex, rng, ctx)
  const e = s.encounter as EncounterState
  return { ...s, encounter: { ...e, waves: e.waves.map((w) => (w.index === waveIndex ? { ...w, damageLocked: true } : w)) } }
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
  | 'already_attacked'
  | 'attacker_exhausted'

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

/**
 * Attack: send all of a member's damage of a wave to one wild (`wildIndex`). Irreversible: the
 * wild strikes back at the attacker at once (unless asleep or paralyzed). Exhausted
 * members cannot attack. Allowed on the current or a later wave until its first ball.
 */
export function assignDamage(
  state: PlayerState,
  input: { waveIndex: number; uid: string; wildIndex: number },
  rng: Rng,
  ctx: EngineContext = defaultContext(),
): Result<PlayerState, DamageError> {
  const r = editableWave(state, input.waveIndex)
  if (!r.ok) return r
  const { wave } = r.value
  if (!damageTokens(wave).some((tk) => tk.uid === input.uid)) return err('unknown_token')
  if (wave.assignments?.[input.uid] !== undefined) return err('already_attacked')
  if (!canAttack(state, input.uid)) return err('attacker_exhausted')
  const wild = wave.wilds[input.wildIndex]
  if (!wild) return err('unknown_wild')
  if (wild.outcome !== 'pending') return err('wild_resolved')
  return ok(attackWith(state, input.waveIndex, input.uid, input.wildIndex, rng, ctx))
}

/** "Auto" button: every member that has not attacked (and has Energy) attacks with the automatic split. Irreversible. */
export function autoAssignDamage(state: PlayerState, waveIndex: number, rng: Rng, ctx: EngineContext = defaultContext()): Result<PlayerState, DamageError> {
  const r = editableWave(state, waveIndex)
  if (!r.ok) return r
  return ok(attackWithRest(state, waveIndex, rng, ctx))
}

/** Preference for the next claims. An encounter already claimed keeps its `damageMode`. */
export function setAutoDamage(state: PlayerState, value: boolean): PlayerState {
  return { ...state, autoDamage: value }
}
