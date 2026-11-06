/**
 * Damage-split balance study (docs/session-depth-plan.md "Balance (después de A)").
 *
 *   npm run simulate:damage -- matrix --policy smart --seeds 40 --out /tmp/smart.json
 *   npm run simulate:damage -- replay --seeds 40 --reps 60 --out /tmp/replay.json
 *   npm run simulate:damage -- report /tmp/*.json            (markdown tables on stdout)
 *
 * Flags: --config file.json (game-config overrides) · --weeks N (12) · --profile a,b | all
 *
 * `matrix` plays every profile × seed for 12 weeks with one damage policy and stores one summary per
 * player. `replay` is the focused legendary experiment: it plays the `auto` matrix, keeps the state
 * right before the captures of every encounter that holds a legendary, and replays that whole
 * encounter `reps` times with every policy (same random streams across policies: paired comparison).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRng, toManualWave, type GameConfigOverrides, type PlayerState } from '../src/engine/index.ts'
import { DAMAGE_POLICIES, playEncounter, type DamagePolicy } from './sim/capture-policy.ts'
import { makeContext } from './sim/experiments.ts'
import { PROFILE_IDS, type ProfileId } from './sim/profiles.ts'
import { runPlayer } from './sim/run.ts'
import { emptyTally, type PlayerMetrics } from './sim/types.ts'

interface RunSummary {
  profile: ProfileId
  seed: number
  freshLegendaries: number
  freshCaught: number
  legendaryCaught: number
  legendaryHpSum: number
  legendarySeen: number
  legendaryThrows: number
  legendaryPrepared: number
  legendaryThrowsNoUltra: number
  highSeen: number
  highCaught: number
  finalSeen: number
  finalCaught: number
  catches: number
  wildsSeen: number
  fled: number
  dmgFrac: number
  dmgFracWasted: number
  throws: Record<string, number>
  ultraFromMissions: number
  greatFromMissions: number
  finalBalls: Record<string, number>
  statusCharges: number
  statusUsed: number
  /** Species caught at the end of each week. */
  dexByWeek: number[]
  trainerLevel: number
}

interface ReplayRow {
  profile: ProfileId
  seed: number
  /** Fresh legendaries of the encounter and whether a roaming one is also there. */
  fresh: number
  policy: DamagePolicy
  reps: number
  /** Σ fresh legendaries caught over the reps. */
  caught: number
  /** Σ HP fraction of the fresh legendaries after the split (over reps × fresh). */
  hpSum: number
  /** Throws at prepared (asleep / paralyzed) legendaries ÷ throws at legendaries. */
  prepared: number
  throws: number
  /** Σ other (non-legendary) wilds caught over the reps. */
  others: number
}

function summarize(m: PlayerMetrics): RunSummary {
  const t = m.tally
  const last = m.days[m.days.length - 1]
  return {
    profile: m.profile,
    seed: Number(m.seed),
    freshLegendaries: t.legendarySeen - t.legendaryRoamingSeen,
    freshCaught: t.legendaryFreshCaught,
    legendaryCaught: t.legendaryCaught,
    legendaryHpSum: t.legendaryHpSum,
    legendarySeen: t.legendarySeen,
    legendaryThrows: t.legendaryThrows,
    legendaryPrepared: t.legendaryPrepared,
    legendaryThrowsNoUltra: t.legendaryThrowsNoUltra,
    highSeen: t.highSeen,
    highCaught: t.highCaught,
    finalSeen: t.finalSeen,
    finalCaught: t.finalCaught,
    catches: t.catchesTotal,
    wildsSeen: t.wildsSeen,
    fled: t.fled,
    dmgFrac: t.dmgFrac,
    dmgFracWasted: t.dmgFracWasted,
    throws: { ...t.throws },
    ultraFromMissions: t.ultraBallsFromMissions,
    greatFromMissions: t.greatBallsFromMissions,
    finalBalls: m.finalBalls,
    statusCharges: t.statusCharges,
    statusUsed: t.statusChargesUsed,
    dexByWeek: m.weeklyCaught,
    trainerLevel: last?.trainerLevel ?? 0,
  }
}

interface Cli {
  mode: 'matrix' | 'replay' | 'report'
  policy: DamagePolicy
  seeds: number
  reps: number
  weeks: number
  profiles: ProfileId[]
  config?: GameConfigOverrides
  out?: string
  inputs: string[]
}

function parse(argv: string[]): Cli {
  const cli: Cli = { mode: argv[0] as Cli['mode'], policy: 'auto', seeds: 40, reps: 60, weeks: 12, profiles: [...PROFILE_IDS], inputs: [] }
  if (!['matrix', 'replay', 'report'].includes(cli.mode)) throw new Error('First argument: matrix | replay | report')
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] as string
    const v = () => argv[++i] as string
    if (a === '--policy') {
      cli.policy = v() as DamagePolicy
      if (!DAMAGE_POLICIES.includes(cli.policy)) throw new Error(`Unknown policy ${cli.policy}`)
    } else if (a === '--seeds') cli.seeds = Number(v())
    else if (a === '--reps') cli.reps = Number(v())
    else if (a === '--weeks') cli.weeks = Number(v())
    else if (a === '--profile') {
      const p = v()
      cli.profiles = p === 'all' ? [...PROFILE_IDS] : (p.split(',') as ProfileId[])
    } else if (a === '--config') cli.config = JSON.parse(readFileSync(resolve(v()), 'utf8')) as GameConfigOverrides
    else if (a === '--out') cli.out = v()
    else if (a.startsWith('--')) throw new Error(`Unknown flag ${a}`)
    else cli.inputs.push(a)
  }
  return cli
}

function matrix(cli: Cli): RunSummary[] {
  const ctx = makeContext(cli.config)
  const out: RunSummary[] = []
  for (const profile of cli.profiles)
    for (let seed = 1; seed <= cli.seeds; seed++) {
      const m = runPlayer({ profile, seed, weeks: cli.weeks, ctx, missions: true, captures: true, candies: true, soloStarter: false, detail: false, damagePolicy: cli.policy })
      out.push(summarize(m))
      process.stderr.write(`\r${cli.policy} ${profile} ${seed}/${cli.seeds}   `)
    }
  process.stderr.write('\n')
  return out
}

/** The encounter as claimed with the "Auto" preference off (same rolled hits, nothing assigned yet). */
function asManual(state: PlayerState): PlayerState {
  const enc = state.encounter
  if (!enc || enc.damageMode === 'manual') return state
  return { ...state, encounter: { ...enc, damageMode: 'manual', waves: enc.waves.map((w) => toManualWave(w)) } }
}

function replay(cli: Cli): ReplayRow[] {
  const ctx = makeContext(cli.config)
  const rows: ReplayRow[] = []
  for (const profile of cli.profiles)
    for (let seed = 1; seed <= cli.seeds; seed++) {
      const snaps: { state: PlayerState; now: number }[] = []
      runPlayer({
        profile, seed, weeks: cli.weeks, ctx, missions: true, captures: true, candies: true, soloStarter: false, detail: false, damagePolicy: 'auto',
        onLegendaryEncounter: (state, now) => snaps.push({ state, now }),
      })
      snaps.forEach((snap, si) => {
        const enc = snap.state.encounter
        if (!enc) return
        const fresh = enc.waves.flatMap((w) => w.wilds).filter((w) => w.isLegendary && !w.isRoaming).map((w) => w.speciesSlug)
        if (fresh.length === 0) return
        const count = (s: PlayerState, slug: string) => Object.values(s.pokemon).filter((p) => p.speciesSlug === slug).length
        const before = Object.keys(snap.state.pokemon).length
        for (const policy of DAMAGE_POLICIES) {
          const row: ReplayRow = { profile, seed, fresh: fresh.length, policy, reps: cli.reps, caught: 0, hpSum: 0, prepared: 0, throws: 0, others: 0 }
          const start = policy === 'auto' ? snap.state : asManual(snap.state)
          for (let k = 0; k < cli.reps; k++) {
            const tally = emptyTally()
            const end = playEncounter(start, { damagePolicy: policy, rng: createRng(`replay|${profile}|${seed}|${si}|${k}`), now: snap.now, ctx, tally, ratios: [], legendary: [] })
            let legCaught = 0
            for (const slug of new Set(fresh)) legCaught += Math.min(fresh.filter((x) => x === slug).length, count(end, slug) - count(snap.state, slug))
            row.caught += legCaught
            row.others += Object.keys(end.pokemon).length - before - (tally.legendaryCaught)
            row.hpSum += tally.legendaryHpSum - 0 // includes roaming ones in the same encounter (rare)
            row.prepared += tally.legendaryPrepared
            row.throws += tally.legendaryThrows
          }
          rows.push(row)
        }
      })
      process.stderr.write(`\rreplay ${profile} ${seed}/${cli.seeds} (${rows.length} rows)   `)
    }
  process.stderr.write('\n')
  return rows
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—')
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—')
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
function ci(xs: number[]): string {
  const m = meanOf(xs)
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1))
  return `${f1(m)} ± ${f1((1.96 * sd) / Math.sqrt(Math.max(1, xs.length)))}`
}
/** Pooled ratio Σnum/Σden with a 95 % Wilson interval on the pooled counts. */
function ratio(num: number, den: number): string {
  if (den <= 0) return '—'
  const p = num / den
  const z = 1.96
  const c = (p + (z * z) / (2 * den)) / (1 + (z * z) / den)
  const h = (z * Math.sqrt((p * (1 - p)) / den + (z * z) / (4 * den * den))) / (1 + (z * z) / den)
  return `${pct(p)} (${pct(Math.max(0, c - h))}–${pct(Math.min(1, c + h))})`
}
const sumOf = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i === 0 || i === 1 ? '---' : '---:')).join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

function report(cli: Cli): string {
  const runs: (RunSummary & { policy: DamagePolicy })[] = []
  let replays: ReplayRow[] = []
  for (const f of cli.inputs) {
    const j = JSON.parse(readFileSync(resolve(f), 'utf8')) as { mode: string; policy?: DamagePolicy; rows: unknown[] }
    if (j.mode === 'matrix') runs.push(...(j.rows as RunSummary[]).map((r) => ({ ...r, policy: j.policy as DamagePolicy })))
    else replays = replays.concat(j.rows as ReplayRow[])
  }
  const out: string[] = []
  const policies = DAMAGE_POLICIES.filter((p) => runs.some((r) => r.policy === p))
  for (const profile of PROFILE_IDS) {
    const rowsP = policies
      .map((policy) => ({ policy, rs: runs.filter((r) => r.profile === profile && r.policy === policy) }))
      .filter((x) => x.rs.length > 0)
    if (rowsP.length === 0) continue
    out.push(`\n**${profile}** (${rowsP[0]?.rs.length} jugadores por política, 12 semanas; media ± IC 95 %)\n`)
    out.push(
      table(
        ['Política', 'Leg. nuevos', '1.er enc.', 'Al final', 'Vida leg.', '% prep.', 'Nv. alto', 'Evo. final', 'Capturas', 'Pokédex s4/s8/s12', 'Nv. entr.', 'Daño perdido', 'Ultra lanz. / sin Ultra'],
        rowsP.map(({ policy, rs }) => {
          const fresh = sumOf(rs, (r) => r.freshLegendaries)
          const dex = (w: number) => f1(meanOf(rs.map((r) => r.dexByWeek[w] ?? 0)))
          return [
            policy,
            f1(fresh / rs.length),
            ratio(sumOf(rs, (r) => r.freshCaught), fresh),
            pct(Math.min(1, sumOf(rs, (r) => r.legendaryCaught) / Math.max(1, fresh))),
            pct(sumOf(rs, (r) => r.legendaryHpSum) / Math.max(1, sumOf(rs, (r) => r.legendarySeen))),
            pct(sumOf(rs, (r) => r.legendaryPrepared) / Math.max(1, sumOf(rs, (r) => r.legendaryThrows))),
            ratio(sumOf(rs, (r) => r.highCaught), sumOf(rs, (r) => r.highSeen)),
            ratio(sumOf(rs, (r) => r.finalCaught), sumOf(rs, (r) => r.finalSeen)),
            ci(rs.map((r) => r.catches)),
            `${dex(3)} / ${dex(7)} / ${dex(11)}`,
            f1(meanOf(rs.map((r) => r.trainerLevel))),
            pct(sumOf(rs, (r) => r.dmgFracWasted) / Math.max(1e-9, sumOf(rs, (r) => r.dmgFrac))),
            `${f1(meanOf(rs.map((r) => r.throws['ultra-ball'] ?? 0)))} / ${f1(meanOf(rs.map((r) => r.legendaryThrowsNoUltra)))}`,
          ]
        }),
      ),
    )
  }
  if (replays.length) {
    const encounters = replays.filter((r) => r.policy === 'auto')
    const reps = encounters[0]?.reps ?? 0
    out.push(`\n**Experimento de legendarios** (${encounters.length} encuentros con legendario nuevo, ${sumOf(encounters, (r) => r.fresh)} legendarios, ${reps} repeticiones por encuentro y política, mismas semillas aleatorias en todas: comparación pareada)\n`)
    const pols = DAMAGE_POLICIES.filter((p) => replays.some((r) => r.policy === p))
    const byProfile = (rows: ReplayRow[]) =>
      pols.map((policy) => {
        const rs = rows.filter((r) => r.policy === policy)
        const den = sumOf(rs, (r) => r.fresh * r.reps)
        // Encounter-level CI: per-encounter catch share, then mean ± 1.96 SE.
        const shares = rs.map((r) => r.caught / (r.fresh * r.reps))
        const m = meanOf(shares)
        const sd = Math.sqrt(shares.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, shares.length - 1))
        const se = sd / Math.sqrt(Math.max(1, shares.length))
        return [
          policy,
          `${pct(sumOf(rs, (r) => r.caught) / Math.max(1, den))} ± ${Math.round(196 * se)} pp`,
          pct(sumOf(rs, (r) => r.hpSum) / Math.max(1, den)),
          pct(sumOf(rs, (r) => r.prepared) / Math.max(1, sumOf(rs, (r) => r.throws))),
          f1(sumOf(rs, (r) => r.others) / Math.max(1, sumOf(rs, (r) => r.reps))),
        ]
      })
    out.push(table(['Política', 'Captura 1.er enc.', 'Vida leg. al lanzar', '% lanz. preparados', 'Otros capturados / encuentro'], byProfile(replays)))
    for (const profile of PROFILE_IDS) {
      const rs = replays.filter((r) => r.profile === profile)
      if (!rs.length) continue
      out.push(`\n${profile}: ${rs.filter((r) => r.policy === 'auto').length} encuentros\n`)
      out.push(table(['Política', 'Captura 1.er enc.', 'Vida leg. al lanzar', '% lanz. preparados', 'Otros capturados / encuentro'], byProfile(rs)))
    }
  }
  return out.join('\n')
}

function main(): void {
  const cli = parse(process.argv.slice(2))
  if (cli.mode === 'report') {
    console.log(report(cli))
    return
  }
  const rows = cli.mode === 'matrix' ? matrix(cli) : replay(cli)
  const json = JSON.stringify({ mode: cli.mode, policy: cli.mode === 'matrix' ? cli.policy : undefined, seeds: cli.seeds, weeks: cli.weeks, rows })
  if (cli.out) writeFileSync(resolve(cli.out), json)
  else console.log(json)
}

main()
