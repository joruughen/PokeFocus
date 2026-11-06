/**
 * Capture-phase policy of the simulated player: charges (reroll / status),
 * Study Ball, and Poké / Great / Ultra Ball throws, wave by wave.
 */
import {
  advanceWave,
  applyStatusCharge,
  assignDamage,
  autoAssignDamage,
  damageTokens,
  estimateTokenDamage,
  isManualWave,
  ballCovers,
  BALL_ORDER,
  getSpecies,
  rerollWild,
  throwBall,
  wildCatchChance,
  encounterModifiers,
  hpFractionAfter,
  wildLevelRange,
  type BallSlug,
  type Wave,
  type EngineContext,
  type PlayerState,
  type Rng,
  type ThrowBall,
  type ThrowOutcome,
  type WildPokemon,
} from '../../src/engine/index.ts'
import type { LegendaryEncounter, Tally } from './types.ts'

/**
 * How the simulated player splits the damage tokens of a wave (docs/session-depth-plan.md §A).
 * - `auto`: the "Auto" preference (claims in automatic mode: the engine's maxHp-weighted split).
 * - `concentrate-valuable`: every token on one wild: legendary > shiny > species not caught yet > highest level.
 * - `type-smart`: each token on the wild it damages most (absolute damage, type effectiveness included).
 * - `concentrate-status`: a skilled concentrator: every token on the most valuable wild that the Study
 *   Ball will not take anyway, the best status charge (sleep first) on that same wild, and sleep /
 *   paralysis charges kept for a legendary or shiny of a later wave of the encounter.
 * - `smart`: a realistic good player: `concentrate-status` when the wave has a legendary, a shiny or a
 *   species not caught yet; otherwise the "Auto" split (status charges are still kept for later targets).
 * - `best-ev`: an upper bound for skill: tokens one by one (biggest first) on the wild where they add the
 *   most expected captured value (value × P(caught before it flees)), status handled as `concentrate-status`.
 */
export type DamagePolicy = 'auto' | 'concentrate-valuable' | 'type-smart' | 'concentrate-status' | 'smart' | 'best-ev'
export const DAMAGE_POLICIES: readonly DamagePolicy[] = ['auto', 'concentrate-valuable', 'type-smart', 'concentrate-status', 'smart', 'best-ev']
/** Policies that aim status charges at the concentration target and keep them for later legendaries / shinies. */
const STATUS_SMART: ReadonlySet<DamagePolicy> = new Set(['concentrate-status', 'smart', 'best-ev'])

export interface CaptureCtx {
  /** Damage split policy (default `auto`). */
  damagePolicy?: DamagePolicy
  rng: Rng
  now: number
  ctx: EngineContext
  tally: Tally
  /** Collects damage/maxHp of every wild seen. */
  ratios: number[]
  /** Collects the throws at each legendary. */
  legendary: LegendaryEncounter[]
}

function ownedCounts(state: PlayerState): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of Object.values(state.pokemon)) m.set(p.speciesSlug, (m.get(p.speciesSlug) ?? 0) + 1)
  return m
}

/** How much the player wants a wild: new species, stage, rarity, shiny, legendary. Duplicates fade. */
function wildValue(state: PlayerState, w: WildPokemon, counts: Map<string, number>, ctx: EngineContext): number {
  const sp = getSpecies(w.speciesSlug, ctx)
  let v = sp.stage * 8 + (255 - sp.captureRate) / 30 + w.level / 5
  if (!state.pokedex.caught.includes(sp.slug)) v += 40
  else v += Math.max(0, 9 - 3 * (counts.get(sp.slug) ?? 0))
  if (w.isShiny) v += 60
  if (w.isLegendary) v += 80
  return v
}

function classOf(captureRate: number): 'common' | 'mid' | 'rare' {
  return captureRate >= 150 ? 'common' : captureRate >= 75 ? 'mid' : 'rare'
}

function wildAt(state: PlayerState, wave: number, idx: number): WildPokemon | undefined {
  return state.encounter?.waves[wave]?.wilds[idx]
}

function pendingIdx(state: PlayerState, wave: number): number[] {
  const wilds = state.encounter?.waves[wave]?.wilds ?? []
  return wilds.map((w, i) => (w.outcome === 'pending' ? i : -1)).filter((i) => i >= 0)
}

/** Best ball the policy is willing to use on this wild, or null if none is available. */
function chooseBall(state: PlayerState, w: WildPokemon, value: number): BallSlug | null {
  const inv = state.inventory
  const has = (b: BallSlug) => (inv[b] ?? 0) > 0
  if (w.guaranteedBall) {
    for (const b of BALL_ORDER) if (has(b) && ballCovers(b, w.guaranteedBall)) return b
  }
  if (w.isLegendary || w.guaranteedBall) {
    for (const b of [...BALL_ORDER].reverse()) if (has(b)) return b
    return null
  }
  if (value >= 45 && (inv['great-ball'] ?? 0) > 2) return 'great-ball'
  if (has('poke-ball')) return 'poke-ball'
  if (has('great-ball')) return 'great-ball'
  return null
}

/** Play every wave of the current encounter, then clear it. */
export function playEncounter(state: PlayerState, c: CaptureCtx): PlayerState {
  let s = state
  while (s.encounter) {
    const enc = s.encounter
    const wi = enc.currentWave
    const last = wi === enc.waves.length - 1
    const alloc = allocateDamage(s, wi, c)
    s = alloc.state
    registerWave(s, wi, c)
    s = useRerolls(s, wi, c)
    s = useStatuses(s, wi, last, c, alloc.target)
    s = throwStudyBall(s, wi, c)
    s = throwRest(s, wi, c)
    s = advanceWave(s, c.ctx)
  }
  return s
}

/** A legendary, a shiny without a guarantee or a species not caught yet: worth concentrating on. */
function isPrize(s: PlayerState, w: WildPokemon): boolean {
  return w.isLegendary || (w.isShiny && !w.guaranteedBall) || !s.pokedex.caught.includes(w.speciesSlug)
}

/** Most valuable pending wild: legendary > shiny > species not caught yet > highest level. */
function concentrateTarget(s: PlayerState, wave: Wave, pending: number[], exclude = -1): number {
  const rank = (w: WildPokemon) => [w.isLegendary ? 1 : 0, w.isShiny ? 1 : 0, s.pokedex.caught.includes(w.speciesSlug) ? 0 : 1, w.level]
  const better = (a: number[], b: number[]) => {
    for (let k = 0; k < a.length; k++) if ((a[k] as number) !== (b[k] as number)) return (a[k] as number) > (b[k] as number)
    return false
  }
  const cands = pending.length > 1 ? pending.filter((i) => i !== exclude) : pending
  let target = cands[0] as number
  for (const i of cands) if (better(rank(wave.wilds[i] as WildPokemon), rank(wave.wilds[target] as WildPokemon))) target = i
  return target
}

/** P(caught before it flees) with the ball the policy would use, for a given HP fraction. */
function catchWithin(s: PlayerState, w: WildPokemon, hp: number, v: number, throws: number, c: CaptureCtx): number {
  if (w.guaranteedBall) return 1
  const ball = chooseBall(s, w, v) ?? 'poke-ball'
  const p = wildCatchChance(s, { ...w, hpFraction: hp }, ball, c.ctx)
  return 1 - Math.pow(1 - p, throws)
}

/**
 * Assign the wave's damage tokens with the policy (manual waves only; automatic ones are already split).
 * Returns the wild the policy concentrated on (for the status charges), or -1.
 */
function allocateDamage(state: PlayerState, wi: number, c: CaptureCtx): { state: PlayerState; target: number } {
  const wave = state.encounter?.waves[wi]
  if (!wave || !isManualWave(wave) || wave.damageLocked) return { state, target: -1 }
  const policy = c.damagePolicy ?? 'auto'
  const pending = pendingIdx(state, wi)
  let s = state
  let target = -1
  const assignAll = (to: number) => {
    for (const tk of damageTokens(wave)) {
      const r = assignDamage(s, { waveIndex: wi, uid: tk.uid, wildIndex: to }, c.ctx)
      if (r.ok) s = r.value
    }
  }
  if (pending.length > 0) {
    // The Study Ball takes one eligible wild for sure: a skilled player does not spend damage on it.
    const study = wave.studyBall === 'available' ? studyBallTarget(s, wi, ownedCounts(s), c) : -1
    if (policy === 'concentrate-valuable') {
      target = concentrateTarget(s, wave, pending)
      assignAll(target)
    } else if (policy === 'concentrate-status' || (policy === 'smart' && pending.some((i) => i !== study && isPrize(s, wave.wilds[i] as WildPokemon)))) {
      target = concentrateTarget(s, wave, pending, study)
      assignAll(target)
    } else if (policy === 'type-smart') {
      for (const tk of damageTokens(wave)) {
        let best = pending[0] as number
        let bestDmg = -1
        for (const i of pending) {
          const d = estimateTokenDamage(tk, wave.wilds[i] as WildPokemon, c.ctx).damage
          if (d > bestDmg) {
            bestDmg = d
            best = i
          }
        }
        const r = assignDamage(s, { waveIndex: wi, uid: tk.uid, wildIndex: best }, c.ctx)
        if (r.ok) s = r.value
      }
    } else if (policy === 'best-ev') {
      const counts = ownedCounts(s)
      const throws = encounterModifiers(s, c.ctx).maxFailedThrows
      const cands = pending.length > 1 ? pending.filter((i) => i !== study) : pending
      const values = new Map(cands.map((i) => [i, wildValue(s, wave.wilds[i] as WildPokemon, counts, c.ctx)]))
      const dmg = new Map(cands.map((i) => [i, 0]))
      const tokens = damageTokens(wave)
        .map((tk) => ({ tk, est: new Map(cands.map((i) => [i, estimateTokenDamage(tk, wave.wilds[i] as WildPokemon, c.ctx).damage])) }))
        .sort((a, b) => Math.max(...b.est.values()) - Math.max(...a.est.values()))
      const cfg = c.ctx.config
      for (const { tk, est } of tokens) {
        let best = cands[0] as number
        let bestGain = -Infinity
        for (const i of cands) {
          const w = wave.wilds[i] as WildPokemon
          const v = values.get(i) as number
          const d0 = dmg.get(i) as number
          const d1 = d0 + (est.get(i) as number)
          const gain = v * (catchWithin(s, w, hpFractionAfter(d1, w.maxHp, cfg), v, throws, c) - catchWithin(s, w, hpFractionAfter(d0, w.maxHp, cfg), v, throws, c))
          if (gain > bestGain) {
            bestGain = gain
            best = i
          }
        }
        dmg.set(best, (dmg.get(best) as number) + (est.get(best) as number))
        const r = assignDamage(s, { waveIndex: wi, uid: tk.uid, wildIndex: best }, c.ctx)
        if (r.ok) s = r.value
      }
      // Status target: the most valuable wild that is not guaranteed.
      let bestV = -1
      for (const i of cands) {
        const w = wave.wilds[i] as WildPokemon
        const v = values.get(i) as number
        if (!w.guaranteedBall && v > bestV) {
          bestV = v
          target = i
        }
      }
    }
  }
  // Anything left (and the whole wave under `auto`) takes the automatic split.
  const r = autoAssignDamage(s, wi, c.ctx)
  return { state: r.ok ? r.value : s, target: STATUS_SMART.has(policy) ? target : -1 }
}

/** Non-legendary wild in the top quarter of the wild level range for the trainer level. */
function isHighLevel(s: PlayerState, w: WildPokemon, c: CaptureCtx): boolean {
  if (w.isLegendary) return false
  const r = wildLevelRange(s.trainer.level, c.ctx.config)
  return w.level >= r.min + 0.75 * (r.max - r.min)
}

/** Non-legendary final evolution (stage ≥ 2 with no evolution left). */
function isFinalEvo(w: WildPokemon, c: CaptureCtx): boolean {
  if (w.isLegendary) return false
  const sp = getSpecies(w.speciesSlug, c.ctx)
  return sp.stage >= 2 && sp.evolutions.length === 0
}

/** Prize wilds (legendary / shiny without guarantee) of later waves of the encounter. */
function laterPrizes(s: PlayerState, wi: number): number {
  const enc = s.encounter
  if (!enc) return 0
  let n = 0
  for (const wave of enc.waves) if (wave.index > wi) for (const w of wave.wilds) if (w.outcome === 'pending' && w.status === null && (w.isLegendary || (w.isShiny && !w.guaranteedBall))) n++
  return n
}

function registerWave(s: PlayerState, wi: number, c: CaptureCtx): void {
  const enc = s.encounter
  const wave = enc?.waves[wi]
  if (!enc || !wave) return
  const t = c.tally
  t.wavesSeen++
  if (wi === 0) {
    t.statusCharges += enc.charges.filter((x) => x.kind === 'status').length
    t.rerollCharges += enc.charges.filter((x) => x.kind === 'reroll').length
  }
  const floor = c.ctx.config.capture.minHpFraction
  for (const w of wave.wilds) {
    t.wildsSeen++
    c.ratios.push(w.maxHp > 0 ? w.damage / w.maxHp : 0)
    if (w.maxHp > 0) {
      t.dmgFrac += w.damage / w.maxHp
      t.dmgFracWasted += Math.max(0, w.damage / w.maxHp - (1 - floor))
    }
    if (isHighLevel(s, w, c)) t.highSeen++
    if (isFinalEvo(w, c)) t.finalSeen++
    if (w.hpFraction <= c.ctx.config.capture.minHpFraction + 1e-9) t.wildsAtHpFloor++
    if (w.isLegendary) {
      t.legendaryHpSum += w.hpFraction
      t.legendarySeen++
      if (w.isRoaming) t.legendaryRoamingSeen++
    }
    if (w.isShiny) t.shinySeen++
  }
}

function useRerolls(state: PlayerState, wi: number, c: CaptureCtx): PlayerState {
  let s = state
  for (;;) {
    const enc = s.encounter
    const charge = enc?.charges.find((x) => x.kind === 'reroll')
    if (!enc || !charge) return s
    const counts = ownedCounts(s)
    let worst = -1
    let worstV = Infinity
    for (const i of pendingIdx(s, wi)) {
      const w = wildAt(s, wi, i) as WildPokemon
      const v = wildValue(s, w, counts, c.ctx)
      if (v < worstV) {
        worstV = v
        worst = i
      }
    }
    if (worst < 0 || worstV >= 16) return s
    const r = rerollWild(s, charge.id, { waveIndex: wi, wildIndex: worst }, c.rng, c.ctx)
    if (!r.ok) return s
    s = r.value
    const fresh = wildAt(s, wi, worst)
    if (fresh) {
      c.tally.wildsSeen++
      if (fresh.isLegendary) c.tally.legendarySeen++
      if (fresh.isShiny) c.tally.shinySeen++
      if (isHighLevel(s, fresh, c)) c.tally.highSeen++
      if (isFinalEvo(fresh, c)) c.tally.finalSeen++
    }
    c.tally.rerollChargesUsed++
  }
}

function useStatuses(state: PlayerState, wi: number, last: boolean, c: CaptureCtx, target = -1): PlayerState {
  let s = state
  const smart = STATUS_SMART.has(c.damagePolicy ?? 'auto')
  let aimed = false
  for (;;) {
    const enc = s.encounter
    if (!enc) return s
    const charges = enc.charges.filter((x) => x.kind === 'status')
    const charge = [...charges].sort((a, b) => (a.status === 'sleep' ? 0 : 1) - (b.status === 'sleep' ? 0 : 1))[0]
    if (!charge) return s
    if (smart) {
      // Prize wilds of this wave (legendary / shiny without guarantee) and the concentration target first.
      const prizes = pendingIdx(s, wi).filter((i) => {
        const w = wildAt(s, wi, i) as WildPokemon
        return w.status === null && (w.isLegendary || (w.isShiny && !w.guaranteedBall))
      })
      const t0 = wildAt(s, wi, target)
      // The concentration target only gets a charge that is not kept for a later legendary / shiny.
      const spare = charges.length > laterPrizes(s, wi)
      const first = prizes[0] ?? (spare && !aimed && t0 && t0.outcome === 'pending' && t0.status === null && !t0.guaranteedBall ? target : -1)
      if (first >= 0) {
        aimed = true
        const r = applyStatusCharge(s, charge.id, { waveIndex: wi, wildIndex: first })
        if (!r.ok) return s
        s = r.value
        c.tally.statusChargesUsed++
        continue
      }
      // Keep one charge per legendary / shiny of a later wave.
      if (charges.length <= laterPrizes(s, wi)) return s
    }
    const counts = ownedCounts(s)
    // The Study Ball target is already safe; do not waste a status on it.
    const studyTarget = enc.waves[wi]?.studyBall === 'available' ? studyBallTarget(s, wi, counts, c) : -1
    let best = -1
    let bestScore = 0
    for (const i of pendingIdx(s, wi)) {
      const w = wildAt(s, wi, i) as WildPokemon
      if (w.status !== null || i === studyTarget || w.guaranteedBall) continue
      const v = wildValue(s, w, counts, c.ctx)
      const ball = chooseBall(s, w, v) ?? 'poke-ball'
      const score = v * (1 - wildCatchChance(s, w, ball, c.ctx))
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    const worth = bestScore >= 20 || (last && bestScore > 0)
    if (best < 0 || !worth) return s
    const r = applyStatusCharge(s, charge.id, { waveIndex: wi, wildIndex: best })
    if (!r.ok) return s
    s = r.value
    c.tally.statusChargesUsed++
  }
}

/** Study-eligible wild with the most to lose if it had to be caught with a Poké Ball. */
function studyBallTarget(s: PlayerState, wi: number, counts: Map<string, number>, c: CaptureCtx): number {
  let best = -1
  let bestScore = -1
  for (const i of pendingIdx(s, wi)) {
    const w = wildAt(s, wi, i) as WildPokemon
    if (!w.studyBallEligible) continue
    const v = wildValue(s, w, counts, c.ctx)
    const score = v * (1 - wildCatchChance(s, w, 'poke-ball', c.ctx)) + 0.01 * v
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

function recordThrow(s: PlayerState, ball: ThrowBall, w: WildPokemon, outcome: ThrowOutcome, leaderBefore: string | undefined, c: CaptureCtx): void {
  const t = c.tally
  t.throws[ball]++
  const cls = w.isLegendary ? 'legendary' : classOf(getSpecies(w.speciesSlug, c.ctx).captureRate)
  if (ball !== 'study-ball') t.throwsByClass[cls]++
  if (w.isLegendary) {
    t.legendaryThrows++
    if (w.status !== null) t.legendaryPrepared++
    if (ball !== 'ultra-ball') t.legendaryThrowsNoUltra++
  }
  if (outcome.kind === 'caught') {
    if (isHighLevel(s, w, c)) t.highCaught++
    if (isFinalEvo(w, c)) t.finalCaught++
    t.catches[ball]++
    if (ball !== 'study-ball') t.catchesByClass[cls]++
    t.catchesTotal++
    if (outcome.guaranteed === 'shiny') t.shinyGuaranteedCatches++
    if (w.isLegendary) {
      t.legendaryCaught++
      if (!w.isRoaming) t.legendaryFreshCaught++
    }
    if (w.isShiny) t.shinyCaught++
    t.candiesFromCatch += c.ctx.config.progression.candiesOnCatch
    return
  }
  if (outcome.counter && outcome.counter.damage > 0) {
    t.counterHits++
    t.counterEnergyLost += outcome.counter.damage
    if (outcome.counter.targetUid === leaderBefore) t.counterOnLeader++
  }
  if (outcome.kind === 'fled') {
    t.fled++
    if (w.isLegendary) t.legendaryFled++
  }
}

function throwStudyBall(state: PlayerState, wi: number, c: CaptureCtx): PlayerState {
  const wave = state.encounter?.waves[wi]
  if (!wave || wave.studyBall !== 'available') return state
  const idx = studyBallTarget(state, wi, ownedCounts(state), c)
  if (idx < 0) return state
  const w = wildAt(state, wi, idx) as WildPokemon
  const wasNew = !state.pokedex.caught.includes(w.speciesSlug)
  const r = throwBall(state, { waveIndex: wi, wildIndex: idx }, 'study-ball', c.rng, c.now, c.ctx)
  if (!r.ok) return state
  recordThrow(state, 'study-ball', w, r.value.outcome, state.team[0], c)
  if (r.value.outcome.kind === 'caught' && wasNew) c.tally.newSpecies++
  return r.value.state
}

function throwRest(state: PlayerState, wi: number, c: CaptureCtx): PlayerState {
  let s = state
  const counts = ownedCounts(s)
  const order = pendingIdx(s, wi)
    .map((i) => ({ i, v: wildValue(s, wildAt(s, wi, i) as WildPokemon, counts, c.ctx) }))
    .sort((a, b) => b.v - a.v)
  for (const { i, v } of order) {
    const mults: number[] = []
    let logged = false
    for (let guard = 0; guard < 12; guard++) {
      const w = wildAt(s, wi, i)
      if (!w || w.outcome !== 'pending') break
      const stock = (s.inventory['poke-ball'] ?? 0) + (s.inventory['great-ball'] ?? 0) + (s.inventory['ultra-ball'] ?? 0)
      if (stock <= 0) break
      const ball = chooseBall(s, w, v)
      if (!ball) break
      // Skip low-value wilds unless balls are piling up.
      if (!w.isLegendary && !w.guaranteedBall && v < 14 && stock < 8) break
      const p = wildCatchChance(s, w, ball, c.ctx)
      if (!w.isLegendary && !w.guaranteedBall && p < 0.04) break
      const wasNew = !s.pokedex.caught.includes(w.speciesSlug)
      const maxThrows = encounterModifiers(s, c.ctx).maxFailedThrows
      const r = throwBall(s, { waveIndex: wi, wildIndex: i }, ball, c.rng, c.now, c.ctx)
      if (!r.ok) break
      recordThrow(s, ball, w, r.value.outcome, s.team[0], c)
      if (r.value.outcome.kind === 'caught' && wasNew) c.tally.newSpecies++
      if (w.isLegendary) {
        const rate = getSpecies(w.speciesSlug, c.ctx).captureRate
        const reff = Math.max(rate, c.ctx.config.capture.legendaryMinCaptureRate)
        mults.push((p * 255) / reff)
        if (r.value.outcome.kind !== 'failed') {
          logged = true
          c.legendary.push({ fresh: !w.isRoaming, slug: w.speciesSlug, rate, mults: [...mults], maxThrows, caught: r.value.outcome.kind === 'caught' })
        }
      }
      s = r.value.state
    }
    // Out of balls with the legendary still there: it counts as not caught.
    const left = wildAt(s, wi, i)
    if (!logged && mults.length > 0 && left?.isLegendary) c.legendary.push({ fresh: !left.isRoaming, slug: left.speciesSlug, rate: getSpecies(left.speciesSlug, c.ctx).captureRate, mults, maxThrows: encounterModifiers(s, c.ctx).maxFailedThrows, caught: false })
  }
  return s
}
