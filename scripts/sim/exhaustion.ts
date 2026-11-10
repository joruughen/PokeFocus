/**
 * "Sessions until exhausted" (GDD §5.3 target: ~4–6). One Pokémon studies 25-min sessions back to back,
 * without breaks, Box time or potions. Per session it spends what the engine charges for its actions
 * (a real `completeSession` from full Energy: Speed → actions, level → cost per action) plus one
 * counterattack for its attack on the wave (GDD §11.4: assigning is an attack and the wild strikes
 * back), against a wild of its own level with neutral effectiveness. IVs 15, neutral nature, default
 * technique load, no ability effects.
 *
 *   sessions = max Energy ÷ (session cost + counterattack)
 */
import {
  computeStats,
  counterDamage,
  defaultContext,
  energyCostPerAction,
  type EngineContext,
} from '../../src/engine/index.ts'
import { isLegendarySpecies } from '../../src/engine/individual.ts'
import { makeMon, makePlayer, runSession } from '../../src/engine/test-helpers.ts'

export interface ExhaustionRow {
  level: number
  /** Over every non-legendary species that can be that level. */
  median: number
  p10: number
  p90: number
  /** Same, sessions alone (no counterattack). */
  medianNoCounter: number
  /** Medians of the parts (Energy). */
  sessionCost: number
  counter: number
  maxEnergy: number
  /** Median actions per 25-min session. */
  actions: number
  /** Break (+breakRecoverPct of max) in sessions of cost. */
  breakSessions: number
  /** Potion (+20) and Super Potion (+50) in sessions of cost. */
  potionSessions: number
  superPotionSessions: number
}

function q(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  if (s.length === 0) return NaN
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))
  return s[i] as number
}

export function sessionsToExhaust(ctx: EngineContext = defaultContext(), levels: readonly number[] = [10, 20, 30, 50]): ExhaustionRow[] {
  const cfg = ctx.config
  const species = ctx.data.species.filter((sp) => !isLegendarySpecies(sp))
  return levels.map((level) => {
    const total: number[] = []
    const noCounter: number[] = []
    const costs: number[] = []
    const counters: number[] = []
    const maxes: number[] = []
    const actions: number[] = []
    for (const sp of species) {
      const mon = makeMon(sp.slug, level, { uid: 'm' }, ctx)
      const player = makePlayer([mon], {}, ctx)
      const { result } = runSession(player, 25, `x-${sp.slug}-${level}`, {}, ctx)
      const m = result.members[0]
      if (!m) continue
      const st = computeStats(mon, ctx)
      // Cost if it never ran dry: actions × cost per action (energySpent caps at what it had).
      const cost = Math.max(m.energySpent, m.actions * energyCostPerAction(level, cfg))
      const counter = counterDamage(st.hp, level, st.defense, level, 1, false, cfg)
      total.push(st.hp / (cost + counter))
      noCounter.push(st.hp / cost)
      costs.push(cost)
      counters.push(counter)
      maxes.push(st.hp)
      actions.push(m.actions)
    }
    const cost = q(costs, 0.5)
    const pot = cfg.energy as unknown as { potions?: Record<string, number> }
    const potions = pot.potions ?? { potion: 20, 'super-potion': 50 }
    return {
      level,
      median: q(total, 0.5),
      p10: q(total, 0.1),
      p90: q(total, 0.9),
      medianNoCounter: q(noCounter, 0.5),
      sessionCost: cost,
      counter: q(counters, 0.5),
      maxEnergy: q(maxes, 0.5),
      actions: q(actions, 0.5),
      breakSessions: (cfg.energy.breakRecoverPct * q(maxes, 0.5)) / (cost + q(counters, 0.5)),
      potionSessions: (potions.potion ?? 20) / (cost + q(counters, 0.5)),
      superPotionSessions: (potions['super-potion'] ?? 50) / (cost + q(counters, 0.5)),
    }
  })
}

// `npx tsx scripts/sim/exhaustion.ts [config.json]`: print the table.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs')
  const { createEngineContext } = await import('../../src/engine/index.ts')
  const over = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : undefined
  const ctx = over ? createEngineContext({ config: over }) : defaultContext()
  const f = (x: number) => x.toFixed(1)
  console.log('level | sessions (p10–p90) | no counter | cost/session | counter | max | actions | break | potion | super')
  for (const r of sessionsToExhaust(ctx)) {
    console.log(`${r.level} | ${f(r.median)} (${f(r.p10)}–${f(r.p90)}) | ${f(r.medianNoCounter)} | ${f(r.sessionCost)} | ${f(r.counter)} | ${f(r.maxEnergy)} | ${f(r.actions)} | ${f(r.breakSessions)} | ${f(r.potionSessions)} | ${f(r.superPotionSessions)}`)
  }
}
