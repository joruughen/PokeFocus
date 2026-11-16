/**
 * Long-term report (52–104 weeks): runs the profile matrix and renders docs/longterm-report.md.
 * Pure consumer of the simulator: it changes no rule; only reads the per-day records of `runPlayer`.
 */
import { leagueForPoints, type EngineContext, type LeagueId } from '../../src/engine/index.ts'
import { runPlayer } from './run.ts'
import { type ProfileId, PROFILE_DESC } from './profiles.ts'
import type { DayRec, PlayerMetrics } from './types.ts'
import { mdTable, mean, median, n0, n1, pct } from './util.ts'

export const SAMPLE_WEEKS = [4, 8, 12, 26, 39, 52, 78, 104] as const
const LEAGUE_ES: Record<LeagueId, string> = { base: 'Base', super: 'Super', ultra: 'Ultra', master: 'Master' }
const NAME: Record<ProfileId, string> = {
  casual: 'casual',
  constant: 'constante',
  marathoner: 'maratonista',
  'night-owl': 'noctámbulo',
  irregular: 'irregular',
  grinder: 'grinder',
  'casual-real': 'casual real',
  exams: 'exámenes',
  dropout: 'abandono',
}

export interface LongtermOptions {
  ctx: EngineContext
  profiles: readonly ProfileId[]
  seeds: number
  weeks: number
  missions: boolean
  command: string
  /** Text shown in the header about the config variant (path of --config / --species), if any. */
  variant?: string
  progress?: (label: string, done: number, total: number) => void
}

export interface LongtermRuns {
  byProfile: Map<ProfileId, PlayerMetrics[]>
  seconds: number
}

/** Runs every (profile, seed). Heavy per-session arrays are dropped as soon as a player finishes (memory). */
export function runLongterm(o: LongtermOptions): LongtermRuns {
  const t0 = Date.now()
  const byProfile = new Map<ProfileId, PlayerMetrics[]>()
  const total = o.profiles.length * o.seeds
  let done = 0
  for (const profile of o.profiles) {
    const runs: PlayerMetrics[] = []
    for (let s = 1; s <= o.seeds; s++) {
      const m = runPlayer({ profile, seed: s, weeks: o.weeks, ctx: o.ctx, missions: o.missions, captures: true, candies: true, soloStarter: false, detail: false })
      m.sessions = []
      m.dmgRatioByWeek = []
      m.legendaryEncounters = []
      runs.push(m)
      o.progress?.(profile, ++done, total)
    }
    byProfile.set(profile, runs)
  }
  return { byProfile, seconds: (Date.now() - t0) / 1000 }
}

const dayAt = (r: PlayerMetrics, week: number): DayRec => r.days[Math.min(week * 7 - 1, r.days.length - 1)] as DayRec
const med = (runs: PlayerMetrics[], f: (d: DayRec) => number, week: number) => median(runs.map((r) => f(dayAt(r, week))))
const wk = (day: number) => Math.ceil(day / 7)

/** Median day (1-based) at which a per-day metric first reaches `target`, with the share of players that get there. */
function crossing(runs: PlayerMetrics[], f: (d: DayRec) => number, target: number): { day: number | null; share: number } {
  const ds = runs.map((r) => {
    const d = r.days.find((x) => f(x) >= target)
    return d ? d.day + 1 : Infinity
  })
  const m = median(ds)
  return { day: Number.isFinite(m) ? m : null, share: ds.filter(Number.isFinite).length / Math.max(1, ds.length) }
}

function crossCell(c: { day: number | null; share: number }): string {
  if (c.day === null) return c.share > 0 ? `no (${pct(c.share)} lo logra)` : 'no'
  return `día ${n0(c.day)} (sem. ${wk(c.day)})${c.share < 1 ? ` · ${pct(c.share)}` : ''}`
}

export function renderLongterm(res: LongtermRuns, o: LongtermOptions): string {
  const { ctx } = o
  const cfg = ctx.config
  const nSpecies = ctx.data.species.length
  const nLegend = ctx.data.species.filter((s) => s.isLegendary || s.isMythical).length
  const th = cfg.leagues.weeklyThresholds
  const caps = cfg.progression.levelCaps
  const out: string[] = []
  const P = (s = '') => out.push(s)
  const samples = SAMPLE_WEEKS.filter((w) => w <= o.weeks)
  if (!samples.includes(o.weeks as never)) samples.push(o.weeks as never)

  P('# Informe de progresión a largo plazo')
  P()
  P(`> Generado por \`${o.command}\`. Las tablas se regeneran con \`npm run simulate -- --longterm\` (no editarlas a mano); la sección final «Lectura» es manual y hay que revisarla si se regenera.`)
  P()
  P(`- Horizonte: **${o.weeks} semanas**; **${o.seeds} semillas** por perfil (las mismas semillas 1..${o.seeds} en cada ejecución, así que dos configuraciones se comparan en pareado); misiones del motor reclamadas: ${o.missions ? 'sí' : 'no'}.`)
  P(`- Configuración: ${o.variant ?? 'la actual del juego (`src/data/game/custom-game-config.json`)'}.`)
  P(`- Pack: **${nSpecies} especies** (${nLegend} legendarias/míticas). Topes de nivel por Pokédex: ${caps.map((c) => `${c.species} especies → nv. ${c.cap}`).join(', ')}. Nivel máximo: ${cfg.progression.maxLevel}.`)
  P(`- Ligas semanales (puntos): Super ≥ ${n0(th.super)}, Ultra ≥ ${n0(th.ultra)}, Master ≥ ${n0(th.master)}.`)
  P(`- Tiempo de cálculo: ${n0(res.seconds)} s.`)
  P()
  P('Las cifras son **medianas entre semillas** salvo que se indique. «Nivel EXP máx.» es el nivel que daría la EXP del mejor miembro sin tope; «Nivel máx.» es el real (limitado por el tope de Pokédex). «Pts/sem» es la media de las 4 semanas hasta la muestra (las semanas en blanco cuentan 0) y la liga se calcula con esa media.')
  P()
  P('## Perfiles')
  P()
  for (const p of o.profiles) P(`- **${NAME[p]}**: ${PROFILE_DESC[p]}.`)
  P()

  const findings: string[] = []
  const runsOf = (p: ProfileId) => res.byProfile.get(p) as PlayerMetrics[]

  for (const p of o.profiles) {
    const runs = runsOf(p)
    P(`## ${NAME[p]}`)
    P()
    const rows = samples.map((w) => {
      const last4 = mean(runs.map((r) => mean(r.weeklyPoints.slice(Math.max(0, w - 4), w))))
      const lg = leagueForPoints(last4, 'week', ctx)
      return [
        w,
        n1(med(runs, (d) => d.meanTeamLevel, w)),
        n0(med(runs, (d) => d.maxLevel, w)),
        n0(med(runs, (d) => d.maxExpLevel, w)),
        n0(med(runs, (d) => d.cap, w)),
        n0(med(runs, (d) => d.caught, w)),
        n0(med(runs, (d) => d.trainerLevel, w)),
        n0(med(runs, (d) => d.dustTotal, w)),
        n0(med(runs, (d) => d.dust, w)),
        n0(last4),
        LEAGUE_ES[lg],
        n1(mean(runs.map((r) => dayAt(r, w).legendariesCaught))),
      ]
    })
    P(
      mdTable(
        ['Sem.', 'Nivel medio equipo', 'Nivel máx.', 'Nivel EXP máx.', 'Tope Pokédex', 'Especies', 'Entrenador', 'Polvo acum.', 'Polvo sin gastar', 'Pts/sem', 'Liga', 'Legend. (media)'],
        rows,
        ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l', 'r'],
      ),
    )
    P()
    const lvl = [30, 36, 40, 50, 60].map((t) => [`nivel ${t} (real)`, crossCell(crossing(runs, (d) => d.maxLevel, t)), crossCell(crossing(runs, (d) => d.maxExpLevel, t))])
    const spec = [...caps.map((c) => c.species).filter((s) => s > 0), nSpecies].map((t) => [`${t} especies`, crossCell(crossing(runs, (d) => d.caught, t)), ''])
    const leg = [1, 3, nLegend].map((t) => [`${t} legendario${t === 1 ? '' : 's'}`, crossCell(crossing(runs, (d) => d.legendariesCaught, t)), ''])
    P('Hitos (mediana de los jugadores que llegan; «· X %» = proporción que llega; «no» = menos de la mitad llega):')
    P()
    P(mdTable(['Hito', 'Cuándo', 'Por EXP sin tope'], [...lvl.map((r) => [r[0] as string, r[1] as string, r[2] as string]), ...spec, ...leg.map((r) => [r[0] as string, r[1] as string, '–'])]))
    P()

    // Findings inputs.
    const all = crossing(runs, (d) => d.caught, nSpecies)
    const c60 = crossing(runs, (d) => d.maxLevel, 60)
    const lastW = o.weeks
    const dTot = med(runs, (d) => d.dustTotal, lastW)
    const dLeft = med(runs, (d) => d.dust, lastW)
    findings.push(
      `**${NAME[p]}**: Pokédex completa (${nSpecies}) ${crossCell(all)}; nivel 60 ${crossCell(c60)}; a la semana ${lastW} lleva ${n0(med(runs, (d) => d.caught, lastW))} especies, nivel máx. ${n0(med(runs, (d) => d.maxLevel, lastW))} (por EXP ${n0(med(runs, (d) => d.maxExpLevel, lastW))}), Polvo acumulado ${n0(dTot)} de los que sobran ${n0(dLeft)} (${pct(dLeft / Math.max(1, dTot))}).`,
    )
  }

  P('## Hallazgos (calculados de esta ejecución)')
  P()
  for (const f of findings) P(`- ${f}`)
  P()
  return out.join('\n')
}
