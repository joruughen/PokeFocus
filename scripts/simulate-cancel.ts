/**
 * Cancel probe (GDD §3.4): does cancelling a long session ever pay more than completing it?
 *
 *   npx tsx scripts/simulate-cancel.ts [--seeds N] [--weeks N]
 *
 * Same schedules (profile, seed) played four ways: never cancelling (the normal simulator path),
 * cancelling every long session at 40 % / 60 % / 90 % of it, and cancelling at 50 % then starting a
 * new session for the rest right away (cancel + restart). Two controls complete the same pieces as
 * planned sessions (a 90 % session; two half sessions), to tell the cost of cancelling from the
 * effect of the session length itself. Prints the mean weekly points, Polvo,
 * waves and catches per profile, relative to never cancelling. Profiles without sessions longer
 * than 25 min (casual, irregular) never cancel anything and must come out identical.
 *
 * Claims are on time in every variant (`onTimeClaims`): someone who cancels at minute 45 is there,
 * and could as well wait and claim on time. `--as-planned` keeps the schedules' late claims in the
 * baseline instead (then cancelling looks better only because the baseline was half-paid).
 */
import { makeContext } from './sim/experiments.ts'
import { PROFILE_IDS } from './sim/profiles.ts'
import { runPlayer } from './sim/run.ts'
import type { RunOptions } from './sim/types.ts'

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : def
}
const seeds = arg('seeds', 8)
const weeks = arg('weeks', 4)
const ctx = makeContext()
/** `--as-planned`: keep the schedules' claim delays (late claims) in the "completa" row; by default everyone claims on time. */
const onTimeClaims = !process.argv.includes('--as-planned')

const variants: { name: string; cancel?: RunOptions['cancel'] }[] = [
  { name: 'completa' },
  { name: 'cancela 40 %', cancel: { atFraction: 0.4, restart: false } },
  { name: 'cancela 60 %', cancel: { atFraction: 0.6, restart: false } },
  { name: 'cancela 90 %', cancel: { atFraction: 0.9, restart: false } },
  { name: 'cancela 50 % + reinicia', cancel: { atFraction: 0.5, restart: true } },
  // Controls: the same pieces planned and completed, no cancel at all.
  { name: '(control) completa 90 %', cancel: { atFraction: 0.9, restart: false, planned: true } },
  { name: '(control) 2 sesiones de 50 %', cancel: { atFraction: 0.5, restart: true, planned: true } },
]

interface Agg {
  points: number
  dust: number
  waves: number
  caught: number
  minutes: number
}

function run(profile: (typeof PROFILE_IDS)[number], cancel: RunOptions['cancel']): Agg {
  const a: Agg = { points: 0, dust: 0, waves: 0, caught: 0, minutes: 0 }
  for (let seed = 1; seed <= seeds; seed++) {
    const m = runPlayer({ profile, seed, weeks, ctx, missions: true, captures: true, candies: true, soloStarter: false, detail: false, onTimeClaims, ...(cancel ? { cancel } : {}) })
    a.points += m.weeklyPoints.reduce((x, y) => x + y, 0) / weeks / seeds
    a.minutes += m.weeklyMinutes.reduce((x, y) => x + y, 0) / weeks / seeds
    a.dust += m.tally.dustEarned / weeks / seeds
    a.waves += m.tally.wavesTotal / weeks / seeds
    a.caught += m.tally.catchesTotal / weeks / seeds
  }
  return a
}

const pct = (x: number, base: number) => (base === 0 ? '—' : `${x >= base ? '+' : ''}${(((x - base) / base) * 100).toFixed(1)} %`)
console.log(`Cancel probe: ${seeds} seeds × ${weeks} weeks (means per week), claims ${onTimeClaims ? 'on time' : 'as planned'}\n`)
console.log('| Perfil | Variante | Min/sem | Puntos/sem | Δ puntos | Polvo/sem | Oleadas/sem | Capturas/sem |')
console.log('|---|---|---:|---:|---:|---:|---:|---:|')
let worst = -Infinity
for (const profile of PROFILE_IDS) {
  let base: Agg | null = null
  for (const v of variants) {
    const r = run(profile, v.cancel)
    if (!base) base = r
    else if (v.cancel && !v.cancel.planned) worst = Math.max(worst, base.points > 0 ? (r.points - base.points) / base.points : 0)
    console.log(
      `| ${profile} | ${v.name} | ${r.minutes.toFixed(0)} | ${r.points.toFixed(0)} | ${pct(r.points, base.points)} | ${r.dust.toFixed(0)} | ${r.waves.toFixed(1)} | ${r.caught.toFixed(1)} |`,
    )
  }
}
console.log(`\nMayor Δ de puntos al cancelar frente a completar la sesión entera: ${(worst * 100).toFixed(1)} %.`)
