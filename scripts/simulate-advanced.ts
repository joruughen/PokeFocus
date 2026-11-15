/**
 * F4 economy check: how many advanced items (Tera Shards, TMs, Mints, Bottle Caps, Ability Capsules)
 * each simulated profile earns, and when its trainer level unlocks them.
 *
 *   npx tsx scripts/simulate-advanced.ts [--weeks 12] [--seeds 2] [--profile casual,grinder]
 *
 * Runs the normal simulator player (`scripts/sim/run.ts`, missions claimed) and reads the final
 * inventory: the sim never spends these items, so the counts are what a player would have to use.
 */
import { defaultContext, mintNatureOf } from '../src/engine/index.ts'
import { PROFILE_IDS, type ProfileId } from './sim/profiles.ts'
import { runPlayer } from './sim/run.ts'

const args = process.argv.slice(2)
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : def
}
const weeks = Number(arg('weeks', '12'))
const seeds = Number(arg('seeds', '2'))
const profiles = (arg('profile', 'all') === 'all' ? PROFILE_IDS : arg('profile', '').split(',')) as ProfileId[]
const ctx = defaultContext()
const UNLOCKS = [10, 20, 25, 30]

const rows: string[] = []
rows.push(`| Perfil | Nivel entr. final | Semana nv 10 / 20 / 25 / 30 | Teralitos | MT | Mentas | Chapas | Cápsulas |`)
rows.push('|---|---|---|---|---|---|---|---|')
for (const profile of profiles) {
  const acc = { level: 0, tera: 0, tm: 0, mint: 0, cap: 0, capsule: 0, reach: UNLOCKS.map(() => [] as number[]) }
  for (let seed = 1; seed <= seeds; seed++) {
    const m = runPlayer({ profile, seed, weeks, ctx, missions: true, captures: true, candies: true, soloStarter: false, detail: false })
    const inv = m.finalBalls
    const last = m.days[m.days.length - 1]
    acc.level += last?.trainerLevel ?? 1
    acc.tera += inv['tera-shard'] ?? 0
    acc.tm += inv['technical-machine'] ?? 0
    acc.cap += inv['bottle-cap'] ?? 0
    acc.capsule += inv['ability-capsule'] ?? 0
    acc.mint += Object.entries(inv).filter(([k]) => mintNatureOf(k, ctx)).reduce((n, [, v]) => n + v, 0)
    UNLOCKS.forEach((lvl, i) => {
      const d = m.days.find((x) => x.trainerLevel >= lvl)
      if (d) acc.reach[i]!.push(d.day / 7)
    })
  }
  const avg = (n: number) => (n / seeds).toFixed(1)
  const reach = acc.reach.map((r) => (r.length === seeds ? (r.reduce((a, b) => a + b, 0) / r.length + 1).toFixed(1) : r.length ? `${r.length}/${seeds}` : '—')).join(' / ')
  rows.push(`| ${profile} | ${avg(acc.level)} | ${reach} | ${avg(acc.tera)} | ${avg(acc.tm)} | ${avg(acc.mint)} | ${avg(acc.cap)} | ${avg(acc.capsule)} |`)
}
console.log(`Objetos avanzados tras ${weeks} semanas (${seeds} semillas por perfil; media por jugador; la semana es 1-based)\n`)
console.log(rows.join('\n'))
