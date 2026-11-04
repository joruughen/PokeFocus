/**
 * Calibration helper for `capture.captureDamageScale` (GDD §11.3): median wild
 * HP remaining (before the 5 % floor) when the wave appears, by week.
 *
 *   npx tsx scripts/sim/calibrate-damage.ts [scale ...] [--seeds N] [--weeks N] [--profile constant]
 *                                           [--sync ratio,gap | off] [--ref-speed N | off]
 */
import { makeContext } from './experiments.ts'
import { runPlayer } from './run.ts'
import type { ProfileId } from './profiles.ts'
import { quantile } from './util.ts'

const args = process.argv.slice(2)
const opt = (name: string, def: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? (args.splice(i, 2)[1] ?? def) : def
}
const seeds = Number(opt('--seeds', '6'))
const weeks = Number(opt('--weeks', '12'))
const profile = opt('--profile', 'constant') as ProfileId
const sync = opt("--sync", "")
const refSpeed = opt("--ref-speed", "")
const targeting = opt("--targeting", "")
const levelSync = sync === "off" ? null : sync ? { ratio: Number(sync.split(",")[0]), gap: Number(sync.split(",")[1]) } : undefined
const scales = args.length ? args.map(Number) : [makeContext().config.capture.captureDamageScale]

for (const scale of scales) {
  const ctx = makeContext({ capture: { captureDamageScale: scale, ...(sync ? { levelSync } : {}), ...(refSpeed ? { damageReferenceSpeed: refSpeed === "off" ? null : Number(refSpeed) } : {}), ...(targeting ? { hitTargeting: targeting as "uniform" | "maxHp" } : {}) } })
  const byWeek: number[][] = Array.from({ length: weeks }, () => [])
  const legendary: number[] = []
  let legHp = 0
  let legN = 0
  for (let s = 0; s < seeds; s++) {
    const m = runPlayer({ profile, seed: s, weeks, ctx, missions: true, captures: true, candies: true, soloStarter: false, detail: false })
    m.dmgRatioByWeek.forEach((r, w) => byWeek[w]?.push(...r.map((x) => 1 - x)))
    legHp += m.tally.legendaryHpSum
    legN += m.tally.legendarySeen
    legendary.push(...m.legendaryEncounters.filter((e) => e.fresh).map((e) => (e.caught ? 1 : 0)))
  }
  const row = byWeek.map((xs) => (xs.length ? `${Math.round(quantile(xs, 0.5) * 100)}%` : '—'))
  const floor = byWeek.map((xs) => (xs.length ? `${Math.round((xs.filter((x) => x <= 0.05).length / xs.length) * 100)}` : '—'))
  const leg = legendary.length ? `${Math.round((legendary.reduce((a, b) => a + b, 0) / legendary.length) * 100)}% of ${legendary.length}` : '—'
  const steady = byWeek.slice(3).flat()
  const st = steady.length ? `${Math.round(quantile(steady, 0.5) * 100)}% (p25 ${Math.round(quantile(steady, 0.25) * 100)}%, p75 ${Math.round(quantile(steady, 0.75) * 100)}%)` : '—'
  console.log(`scale ${scale}: median remaining by week ${row.join(' ')} | weeks 4+ ${st} | % at floor ${floor.join(' ')} | legendary 1st ${leg}, mean HP ${legN ? Math.round((legHp / legN) * 100) : '—'}%`)
}
