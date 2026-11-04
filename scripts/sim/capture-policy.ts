/**
 * Capture-phase policy of the simulated player: charges (reroll / status),
 * Study Ball, and Poké / Great / Ultra Ball throws, wave by wave.
 */
import {
  advanceWave,
  applyStatusCharge,
  ballCovers,
  BALL_ORDER,
  getSpecies,
  rerollWild,
  throwBall,
  wildCatchChance,
  encounterModifiers,
  type BallSlug,
  type EngineContext,
  type PlayerState,
  type Rng,
  type ThrowBall,
  type ThrowOutcome,
  type WildPokemon,
} from '../../src/engine/index.ts'
import type { LegendaryEncounter, Tally } from './types.ts'

export interface CaptureCtx {
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
    registerWave(s, wi, c)
    s = useRerolls(s, wi, c)
    s = useStatuses(s, wi, last, c)
    s = throwStudyBall(s, wi, c)
    s = throwRest(s, wi, c)
    s = advanceWave(s, c.ctx)
  }
  return s
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
  for (const w of wave.wilds) {
    t.wildsSeen++
    c.ratios.push(w.maxHp > 0 ? w.damage / w.maxHp : 0)
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
    }
    c.tally.rerollChargesUsed++
  }
}

function useStatuses(state: PlayerState, wi: number, last: boolean, c: CaptureCtx): PlayerState {
  let s = state
  for (;;) {
    const enc = s.encounter
    if (!enc) return s
    const charges = enc.charges.filter((x) => x.kind === 'status')
    const charge = [...charges].sort((a, b) => (a.status === 'sleep' ? 0 : 1) - (b.status === 'sleep' ? 0 : 1))[0]
    if (!charge) return s
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

function recordThrow(ball: ThrowBall, w: WildPokemon, outcome: ThrowOutcome, leaderBefore: string | undefined, c: CaptureCtx): void {
  const t = c.tally
  t.throws[ball]++
  const cls = w.isLegendary ? 'legendary' : classOf(getSpecies(w.speciesSlug, c.ctx).captureRate)
  if (ball !== 'study-ball') t.throwsByClass[cls]++
  if (w.isLegendary) {
    t.legendaryThrows++
    if (w.status !== null) t.legendaryPrepared++
  }
  if (outcome.kind === 'caught') {
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
  recordThrow('study-ball', w, r.value.outcome, state.team[0], c)
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
      recordThrow(ball, w, r.value.outcome, s.team[0], c)
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
