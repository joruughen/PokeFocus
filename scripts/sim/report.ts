/** Markdown report (Spanish) from the pipeline results. */
import type { GameConfig, LeagueId, TypeSlug } from '../../src/engine/index.ts'
import { coverage, STEADY_FROM_WEEK, type ProfileAgg } from './aggregate.ts'
import {
  atDays,
  crossingDays,
  fmtReach,
  LEVEL_TARGETS,
  leagueReach,
  legendaryFigures,
  ratiosOfWeek,
  rewardedSessions,
  steadyRatios,
  thresholdsOf,
  type Thresholds,
} from './analysis.ts'
import { GRINDER_LIMIT, type Results } from './pipeline.ts'
import { PROFILE_DESC, PROFILE_IDS, type ProfileId } from './profiles.ts'
import { GROUP_LABEL, LEGEND_MAX_RATIO, OUTLIER_BAND } from './species-analysis.ts'
import type { PlayerMetrics } from './types.ts'
import { mdTable, mean, median, n0, n1, n2, pct, quantile, sum } from './util.ts'

const PN: Record<ProfileId, string> = {
  casual: 'casual',
  constant: 'constante',
  marathoner: 'maratonista',
  'night-owl': 'noctámbulo',
  irregular: 'irregular',
  grinder: 'grinder',
}

const k = (x: number) => `${(x / 1000).toFixed(x >= 100_000 ? 0 : 1)}k`
const sgn = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`

interface Ctx {
  r: Results
  profs: ProfileId[]
  base: Record<ProfileId, ProfileAgg>
  cfg: GameConfig
  weeks: number
}

function present(r: Results): ProfileId[] {
  return PROFILE_IDS.filter((p) => r.baseline[p])
}

// ---------------------------------------------------------------------------
// KPIs (also used for the before / after table)
// ---------------------------------------------------------------------------

interface Kpi {
  label: string
  objective: string
  value: string
}

function gradeWeek(a: ProfileAgg | undefined, f: (r: PlayerMetrics) => number): number {
  return a ? mean(a.runs.map(f)) : NaN
}

export function kpis(m: Record<ProfileId, ProfileAgg>, cfg: GameConfig, reference: PlayerMetrics[], weeks: number, thresholds: Thresholds = thresholdsOf(cfg)): Kpi[] {
  const out: Kpi[] = []
  const reach = (p: ProfileId) => (m[p] ? leagueReach(m[p].runs, thresholds, STEADY_FROM_WEEK) : null)
  const rc = reach('casual')
  const rk = reach('constant')
  const rm = reach('marathoner')
  if (rc) out.push({ label: `Casual alcanza Super (sem. ${STEADY_FROM_WEEK}–${weeks})`, objective: '55–75 %, hacia vie–dom', value: fmtReach(rc.super) })
  if (rk) out.push({ label: 'Constante alcanza Ultra', objective: '≥ 85 %, hacia jue–vie', value: fmtReach(rk.ultra) })
  if (rk) out.push({ label: 'Constante alcanza Maestra', objective: '20–35 % (cuartil superior)', value: fmtReach(rk.master) })
  if (rm) out.push({ label: 'Maratonista alcanza Maestra', objective: '≥ 85 %', value: fmtReach(rm.master) })
  const g = m.grinder
  const mar = m.marathoner
  if (g && mar) out.push({ label: 'Grinder ÷ maratonista (puntos semanales estables)', objective: `≤ ${GRINDER_LIMIT}× (aviso)`, value: `${n1(mean(g.steadyPool) / Math.max(1, mean(mar.steadyPool)))}×` })
  const ref = crossingDays(reference, (d) => d.starterExpLevel, [30, 50])
  out.push({
    label: 'Referencia (sin caramelos): nv. 30 / nv. 50',
    objective: 'día 21 / día ~91',
    value: `día ${ref[0]?.day ? Math.round(ref[0].day) : '—'} / día ${ref[1]?.day ? Math.round(ref[1].day) : '—'}`,
  })
  const c = m.constant
  if (c) {
    const lf = legendaryFigures(c.tallyMean)
    const nEnc = c.runs.reduce((a, r) => a + r.tally.legendarySeen - r.tally.legendaryRoamingSeen, 0)
    out.push({ label: 'Constante: legendarios nuevos en 12 sem.', objective: '1–3', value: n1(lf.fresh * (12 / weeks)) })
    out.push({ label: 'Constante: % capturado en el 1.er encuentro', objective: '≈ 50 %', value: Number.isNaN(lf.firstShare) ? '—' : `${pct(lf.firstShare)} (n = ${nEnc})` })
    const last = (r: PlayerMetrics) => r.days[r.days.length - 1] as PlayerMetrics['days'][number]
    out.push({ label: `Constante: especies / tope de nivel a la sem. ${weeks}`, objective: 'tope 50 abierto hacia la sem. 9', value: `${median(c.runs.map((r) => last(r).caught))} / nv. ${median(c.runs.map((r) => last(r).cap))}` })
    const capCross = crossingDays(c.runs, (d) => d.cap, [50])
    out.push({ label: 'Constante: día en que se abre el tope 50', objective: '≤ día 63', value: capCross[0]?.day ? `día ${Math.round(capCross[0].day)} (${pct(capCross[0].reached)} de semillas)` : 'nunca' })
    const earned = gradeWeek(c, (r) => r.tally.dustEarned)
    out.push({ label: 'Constante: Polvo gastado', objective: '≥ 90 %', value: pct(gradeWeek(c, (r) => r.tally.dustSpent) / Math.max(1, earned)) })
  }
  if (mar) {
    const ss = rewardedSessions(mar)
    out.push({ label: 'Maratonista: sesiones con algún agotado', objective: 'rotación moderada (30–60 %)', value: pct(ss.filter((s) => s.exhausted > 0).length / Math.max(1, ss.length)) })
  }
  return out
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function sec1(c: Ctx): string {
  const { base, profs, weeks, cfg, r } = c
  const rows = Array.from({ length: weeks }, (_, w) => [
    String(w + 1),
    ...profs.map((p) => {
      const q = (base[p] as ProfileAgg).weekly[w]
      return q ? `${k(q.p50)} (${k(q.p25)}–${k(q.p75)})` : '—'
    }),
  ])
  const steady = profs.map((p) => {
    const a = base[p] as ProfileAgg
    const s = a.steadyPool
    return [PN[p], n0(a.minutesPerDay), k(quantile(s, 0.1)), k(quantile(s, 0.25)), k(quantile(s, 0.5)), k(quantile(s, 0.75)), k(quantile(s, 0.9))]
  })
  const cur = thresholdsOf(cfg)
  const reachRows = (th: Thresholds) =>
    profs.map((p) => {
      const rr = leagueReach((base[p] as ProfileAgg).runs, th, STEADY_FROM_WEEK)
      return [PN[p], fmtReach(rr.super), fmtReach(rr.ultra), fmtReach(rr.master)]
    })
  let proposedBlock = ''
  const propT = proposedThresholds(r)
  if (propT) {
    proposedBlock = `\nCon los umbrales propuestos (Super ${n0(propT.super)} / Ultra ${n0(propT.ultra)} / Maestra ${n0(propT.master)}), medido sobre estos mismos jugadores:\n\n${mdTable(['Perfil', 'Super', 'Ultra', 'Maestra'], reachRows(propT))}\n`
  }
  const g = base.grinder
  const mar = base.marathoner
  const kcon = base.constant
  let grinder = ''
  if (g && mar && kcon) {
    const eq = (a: ProfileAgg) => mean(a.runs.map((x) => sum(x.sessions.map((s) => s.minutes * s.rewardFactor)))) / (weeks * 7)
    const raw = (a: ProfileAgg) => mean(a.runs.map((x) => sum(x.sessions.map((s) => s.minutes)))) / (weeks * 7)
    const pt = (a: ProfileAgg) => mean(a.steadyPool)
    grinder = `\n**Antitrampas (rendimiento decreciente diario, GDD §3.3).** Semanas estables (${STEADY_FROM_WEEK}–${weeks}):\n\n${mdTable(
      ['Perfil', 'Min/día (sesiones)', 'Min "pagados"/día', 'Puntos/semana', 'Puntos por min pagado', '× constante', '× maratonista'],
      [kcon, mar, g].map((a) => [PN[a.profile], n0(raw(a)), n0(eq(a)), k(pt(a)), n1(pt(a) / (eq(a) * 7)), `${n1(pt(a) / pt(kcon))}×`, `${n1(pt(a) / pt(mar))}×`]),
    )}\n\nEl tramo 360–600 min paga ${pct(cfg.session.dailyHalfRewardFactor)} y lo que pasa de 600 min no paga. El grinder estudia ${n0(raw(g))} min/día pero cobra ${n0(eq(g))} (${pct(eq(g) / raw(g))}); su ventaja sobre el maratonista (${n1(pt(g) / pt(mar))}× en puntos frente a ${n1(eq(g) / eq(mar))}× en minutos pagados) viene de rotar un banquillo grande y de subir de nivel con ${n1(mean(g.runs.map((x) => x.tally.dustEarned)) / Math.max(1, mean(mar.runs.map((x) => x.tally.dustEarned))))}× el Polvo. Veredicto: ${pt(g) / pt(mar) > GRINDER_LIMIT ? 'se escapa (ver 8.1)' : 'acotado: gana menos que proporcional a sus minutos reales y la ventaja se explica por los minutos pagados y la rotación'} (límite de aviso: ${GRINDER_LIMIT}× el maratonista).\n`
  }
  return `## 1. Puntos semanales y ligas

Mediana (p25–p75) de los Puntos de Equipo por semana, sobre ${c.profs.length ? (base[profs[0] as ProfileId] as ProfileAgg).n : 0} semillas por perfil:

${mdTable(['Sem.', ...profs.map((p) => PN[p])], rows)}

Los puntos crecen a medida que el equipo sube de nivel y se llena la Pokédex, y se estancan al chocar con los topes de nivel. Estado estable (semanas ${STEADY_FROM_WEEK}–${weeks}, todas las semillas juntas):

${mdTable(['Perfil', 'Min/día', 'p10', 'p25', 'p50', 'p75', 'p90'], steady)}

**Umbrales actuales** (Super ${n0(cur.super)} / Ultra ${n0(cur.ultra)} / Maestra ${n0(cur.master)}): porcentaje de semanas estables en que se alcanza cada liga (y día de la semana mediano):

${mdTable(['Perfil', 'Super', 'Ultra', 'Maestra'], reachRows(cur))}
${proposedBlock}
Regla usada para proponer: Super = percentil 35 semanal del casual (lo alcanza en ~65 % de las semanas, hacia el final); Ultra = percentil 15 del constante (lo alcanza en ~85 % de las semanas, hacia el viernes); Maestra = percentil 75 del constante (su cuartil superior; maratonistas y noctámbulos la superan sobrados).
${grinder}`
}

function proposedThresholds(r: Results): Thresholds | null {
  const p = r.proposedConfig.leagues?.weeklyThresholds as Partial<Record<LeagueId, number>> | undefined
  if (!p) return null
  const cur = thresholdsOf(r.cfg)
  return { super: p.super ?? cur.super, ultra: p.ultra ?? cur.ultra, master: p.master ?? cur.master }
}

function sec2(c: Ctx): string {
  const { r, base, weeks, cfg } = c
  const horizon = r.reference[0]?.days.length ?? 0
  const crossRef = crossingDays(r.reference, (d) => d.starterExpLevel, [10, 20, 30, 40, 50])
  const refRows = crossRef.map((x) => {
    const t = LEVEL_TARGETS.find((l) => l.level === x.target)
    const meas = x.day ? `día ${n0(x.day)}` : `> día ${horizon}`
    let verdict = ''
    if (t && x.day) verdict = Math.abs(x.day / t.day - 1) <= 0.15 || x.target === 10 ? 'en objetivo' : x.day > t.day ? `lento (×${n2(x.day / t.day)})` : `rápido (×${n2(x.day / t.day)})`
    return [`nv. ${x.target}`, t ? `día ${t.day} (${t.note})` : '—', meas, verdict]
  })
  const refAt = atDays(r.reference, (d) => d.starterExpLevel, [1, 2, 7, 14, 21, 28, 56, 84, 112].filter((d) => d <= horizon))
  const refDays = [1, 2, 7, 14, 21, 28, 56, 84, 112].filter((d) => d <= horizon)
  const kon = base.constant
  let full = ''
  if (kon) {
    const days = [7, 14, 21, 28, 42, 56, 70, 84].filter((d) => d <= weeks * 7)
    const rows = days.map((d) => [
      `día ${d}`,
      n1(atDays(kon.runs, (x) => x.medTeamExpLevel, [d])[0] as number),
      n1(atDays(kon.runs, (x) => x.medTeamLevel, [d])[0] as number),
      String(atDays(kon.runs, (x) => x.cap, [d])[0]),
      String(atDays(kon.runs, (x) => x.caught, [d])[0]),
      String(atDays(kon.runs, (x) => x.trainerLevel, [d])[0]),
    ])
    full = `\n**Perfil constante con la política completa** (caramelos, capturas, evoluciones; mediana del equipo):\n\n${mdTable(['Momento', 'Nivel por EXP', 'Nivel real', 'Tope', 'Especies', 'Entrenador'], rows)}\n\n"Nivel por EXP" ignora el tope por Pokédex; si supera al "Nivel real" el equipo está topado y la EXP sobrante se guarda sin usarse (Polvo y caramelos también quedan parados).\n`
  }
  const otherDays = [28, 56, 84].filter((d) => d <= weeks * 7)
  const others = c.profs
    .filter((p) => p !== 'constant')
    .map((p) => {
      const a = base[p] as ProfileAgg
      return [PN[p], ...otherDays.map((d) => n1(atDays(a.runs, (x) => x.medTeamLevel, [d])[0] as number)), String(atDays(a.runs, (x) => x.cap, [weeks * 7])[0])]
    })
  const dust = cfg.progression.candyDustBase
  return `## 2. Nivelado frente al GDD §12.1

**Referencia** (el inicial solo, siempre en el equipo, sin caramelos, perfil constante, Foco real ≈ ${n2(mean(rewardedSessions(base.constant ?? (Object.values(base)[0] as ProfileAgg)).map((s) => s.focus)))}, ${r.reference.length} semillas, ${horizon / 7} semanas). La curva actual es \`round(${cfg.progression.expCurve.coef}·L^${cfg.progression.expCurve.exponent})\` con ${cfg.rewards.expPerMinute} EXP/min:

${mdTable(['Nivel', 'Objetivo GDD', 'Medido (mediana)', 'Veredicto'], refRows)}

Nivel del inicial por EXP: ${refDays.map((d, i) => `día ${d}: nv. ${Math.round(refAt[i] as number)}`).join(' · ')}.
${full}
Nivel real medio del equipo en otros perfiles:

${mdTable(['Perfil', ...otherDays.map((d) => `día ${d}`), `Tope (sem. ${weeks})`], others)}

Caramelos: 1 caramelo = ${cfg.progression.candyExp} EXP a un coste de ${dust} + ${cfg.progression.candyDustPerLevel}·nivel Polvo. Con el Polvo de una sesión de 25 min (≈ ${n0(cfg.rewards.dustPerMinute * 25 * 0.9)}) y todo en un solo Pokémon a nv. 30 se obtienen ≈ ${n1((cfg.rewards.dustPerMinute * 25 * 0.9) / (dust + cfg.progression.candyDustPerLevel * 30))} caramelos ≈ ${n0(((cfg.rewards.dustPerMinute * 25 * 0.9) / (dust + cfg.progression.candyDustPerLevel * 30)) * cfg.progression.candyExp)} EXP, frente a ${n0(cfg.rewards.expPerMinute * 25 * 0.9)} EXP de la propia sesión (el GDD dice "como mucho duplican": se cumple solo si se concentra el Polvo).
`
}

function sec3(c: Ctx): string {
  const { base, profs, weeks, r } = c
  const t = (p: ProfileId) => (base[p] as ProfileAgg).tallyMean
  const balls = profs.map((p) => {
    const x = t(p)
    const earned = x.pokeBallsFromSessions + x.pokeBallsFromConverted + x.pokeBallsFromMissions
    const thrown = x.throws['poke-ball']
    const nonStudy = x.throws['poke-ball'] + x.throws['great-ball'] + x.throws['ultra-ball']
    const caughtNS = x.catches['poke-ball'] + x.catches['great-ball'] + x.catches['ultra-ball']
    const waves = Math.max(1, x.wavesSeen)
    return [
      PN[p],
      n0(x.pokeBallsFromSessions),
      n0(x.pokeBallsFromConverted),
      `${n0(thrown)} (${pct(thrown / Math.max(1, earned))})`,
      `${n0(x.greatBallsFromMissions)} / ${n0(x.throws['great-ball'])}`,
      `${n0(x.ultraBallsFromMissions)} / ${n0(x.throws['ultra-ball'])}`,
      pct(x.throws['study-ball'] / waves),
      pct(caughtNS / Math.max(1, nonStudy)),
      n0(x.catchesTotal),
      n1(x.catchesTotal / (weeks * 7)),
    ]
  })
  const dust = profs.map((p) => {
    const x = t(p)
    const a = base[p] as ProfileAgg
    return [
      PN[p],
      n0(x.dustEarned),
      n0(x.dustSpent),
      pct(x.dustSpent / Math.max(1, x.dustEarned)),
      n0(mean(a.runs.map((m) => m.finalDust))),
      n0(x.candiesFromCatch),
      n0(x.candiesFromRelease),
      n0(x.candiesSpent),
      n0(mean(a.runs.map((m) => m.finalCandies))),
      n0(x.released),
    ]
  })
  const cls = profs.map((p) => {
    const x = t(p)
    const f = (kk: 'common' | 'mid' | 'rare' | 'legendary') => (x.throwsByClass[kk] > 0.5 ? `${pct(x.catchesByClass[kk] / x.throwsByClass[kk])} (${n0(x.throwsByClass[kk])})` : '—')
    return [PN[p], f('common'), f('mid'), f('rare'), f('legendary')]
  })
  const wk = [1, 2, 3, 4, 6, 8, 10, 12].filter((w) => w <= weeks)
  const dex = wk.map((w) => [String(w), ...profs.map((p) => String(median((base[p] as ProfileAgg).runs.map((m) => m.weeklyCaught[w - 1] ?? 0))))])
  const capSp = r.cfg.progression.levelCaps.filter((x) => x.species > 0).map((x) => x.species)
  const sp1 = capSp[0] ?? 25
  const sp2 = capSp[1] ?? 45
  const pace = profs.map((p) => {
    const a = base[p] as ProfileAgg
    const cr = crossingDays(a.runs, (d) => d.caught, [sp1, sp2])
    const capped = mean(a.runs.map((m) => m.days.slice(STEADY_FROM_WEEK * 7 - 7).filter((d) => d.medTeamLevel >= d.cap).length / Math.max(1, m.days.length - (STEADY_FROM_WEEK * 7 - 7))))
    return [
      PN[p],
      cr[0]?.day ? `día ${Math.round(cr[0].day)}${cr[0].reached < 1 ? ` (${pct(cr[0].reached)})` : ''}` : 'no',
      cr[1]?.day ? `día ${Math.round(cr[1].day)}${cr[1].reached < 1 ? ` (${pct(cr[1].reached)})` : ''}` : `no (${pct(cr[1]?.reached ?? 0)} lo logra)`,
      pct(capped),
      pct(mean(a.runs.map((m) => m.tally.pokeBallsFromConverted)) / Math.max(1, t(p).wavesSeen)),
    ]
  })
  const unreach = r.unreachable.filter((u) => u.share < 0.5)
  const nm = r.noMissions
  const conNoM =
    nm && base.constant
      ? `\nSin misiones (solo las Poké Balls de sesión), el constante lanza ${n0(nm.tallyMean.throws['poke-ball'])} Poké Balls y captura ${n0(nm.tallyMean.catchesTotal)} Pokémon (con misiones: ${n0(t('constant').throws['poke-ball'] + t('constant').throws['great-ball'] + t('constant').throws['ultra-ball'])} lanzamientos, ${n0(t('constant').catchesTotal)} capturas).\n`
      : ''
  return `## 3. Economía

Misiones del motor (GDD §13, \`custom-missions.json\`): 3 diarias y 3 semanales sorteadas por día/semana, más los hitos de Pokédex; el jugador simulado reclama todo lo que completa. Los totales son por jugador en ${weeks} semanas (media de semillas).

**Balls.** "Estudio" = Balls de Estudio lanzadas por oleada; "Tasa" = capturas ÷ lanzamientos sin contar la Ball de Estudio (que siempre captura).

${mdTable(['Perfil', 'Poké (sesión)', 'Poké (conv.)', 'Poké lanzadas (% de las ganadas)', 'Super gan./lanz.', 'Ultra gan./lanz.', 'Estudio/oleada', 'Tasa', 'Capturas', 'Capt./día'], balls)}
${conNoM}
**Polvo y caramelos.**

${mdTable(['Perfil', 'Polvo ganado', 'Polvo gastado', '% gastado', 'Polvo final', 'Caram. captura', 'Caram. soltar', 'Caram. gastados', 'Caram. final', 'Soltados'], dust)}

**Tasa de captura por rareza** (lanzamientos entre paréntesis; sin Ball de Estudio; común = capture_rate ≥ 150, medio 75–149, raro < 75):

${mdTable(['Perfil', 'Común', 'Medio', 'Raro', 'Legendario'], cls)}

**Especies capturadas** (mediana al final de cada semana; Pack 1 tiene ${r.ctx.data.species.length}, de ellas 5 legendarias):

${mdTable(['Semana', ...profs.map((p) => PN[p])], dex)}

**Pokédex frente a los topes de nivel** (topes: ${r.cfg.progression.levelCaps.map((x) => `nv. ${x.cap} con ${x.species}`).join(', ')} especies). "Topado" = fracción de días de las semanas estables en que el nivel mediano del equipo está en el tope; "Study conv." = oleadas cuya Ball de Estudio se convirtió en Poké Ball por falta de salvajes elegibles.

${mdTable(['Perfil', `${sp1} especies`, `${sp2} especies`, 'Topado', 'Study conv.'], pace)}
${
  unreach.length > 0
    ? `\nEspecies que menos de la mitad de las semillas constantes llegó a capturar en ${weeks} semanas (${unreach.length}):\n\n${mdTable(
        ['Especie', '% de semillas', 'Motivo'],
        unreach.slice(0, 24).map((u) => [spName(r, u.slug), pct(u.share), u.why]),
        ['l', 'r', 'l'],
      )}${unreach.length > 24 ? `\n\n…y ${unreach.length - 24} más.` : ''}\n`
    : ''
}`
}

function spName(r: Results, slug: string): string {
  return r.ctx.speciesBySlug.get(slug)?.names.es ?? slug
}

function sec4(c: Ctx): string {
  const { base, profs, weeks, cfg, r } = c
  const t = (p: ProfileId) => (base[p] as ProfileAgg).tallyMean
  const scale = 12 / weeks
  const nm = r.noMissions
  const legRows = (a: ProfileAgg, label: string): string[] => {
    const f = legendaryFigures(a.tallyMean)
    const per = a.runs.map((m) => m.tally.legendarySeen - m.tally.legendaryRoamingSeen)
    const ge = (n: number) => pct(per.filter((v) => v >= n).length / per.length)
    const x = a.tallyMean
    return [
      label,
      n1(f.fresh * scale),
      n1(f.roaming * scale),
      n1(f.caught * scale),
      Number.isNaN(f.firstShare) ? '—' : pct(f.firstShare),
      Number.isNaN(f.finalShare) ? '—' : pct(f.finalShare),
      `${ge(1)} / ${ge(2)} / ${ge(4)}`,
      x.legendaryThrows > 0 ? pct(x.legendaryPrepared / x.legendaryThrows) : '—',
      n1(x.shinySeen * scale),
      n1(x.shinyCaught * scale),
    ]
  }
  const leg = profs.map((p) => legRows(base[p] as ProfileAgg, PN[p]))
  if (nm) leg.push(legRows(nm, 'constante sin misiones'))
  // Wave sizes by league (all rewarded sessions of every profile).
  const lg: LeagueId[] = ['base', 'super', 'ultra', 'master']
  const sizes: Record<LeagueId, number[]> = { base: [], super: [], ultra: [], master: [] }
  for (const p of profs) for (const s of rewardedSessions(base[p] as ProfileAgg)) sizes[s.league].push(...s.waveSizes)
  const waveRows = lg.map((l) => {
    const xs = sizes[l]
    const cap = cfg.encounters.leagueMaxWaveSize[l]
    return [l === 'base' ? 'Base' : l === 'super' ? 'Super' : l === 'ultra' ? 'Ultra' : 'Maestra', String(cap), n0(xs.length), xs.length ? n2(mean(xs)) : '—', xs.length ? pct(xs.filter((v) => v >= cap).length / xs.length) : '—', xs.length ? String(Math.max(...xs)) : '—']
  })
  const perProf = profs.map((p) => {
    const xs = rewardedSessions(base[p] as ProfileAgg).flatMap((s) => s.waveSizes)
    return [PN[p], n2(mean(xs)), `${Math.min(...xs)}–${Math.max(...xs)}`, n1(mean((base[p] as ProfileAgg).runs.map((m) => m.tally.wavesSeen)) / (weeks * 7)), n1(t(p).wildsSeen / Math.max(1, (base[p] as ProfileAgg).meanSessionsPerSeed))]
  })
  // Damage saturation.
  const kon = base.constant
  let dmg = ''
  if (kon) {
    const wkSel = [1, 2, 4, 8, 12].filter((w) => w <= weeks)
    const rows = wkSel.map((w) => {
      const xs = ratiosOfWeek(kon, w)
      return [String(w), n2(quantile(xs, 0.1)), n2(quantile(xs, 0.5)), n2(quantile(xs, 0.9)), pct(Math.max(cfg.capture.minHpFraction, 1 - quantile(xs, 0.5))), pct(xs.filter((v) => v >= 0.95).length / Math.max(1, xs.length))]
    })
    const sr = steadyRatios(kon)
    const atFloor = sr.filter((v) => v >= 0.95).length / Math.max(1, sr.length)
    dmg = `\n**Daño a los salvajes** (perfil constante; fórmula clásica por acción, GDD §11.3). "Daño ÷ PS" es el daño de la oleada recibido por el salvaje antes del mínimo del 5 % de vida; ≥ 0.95 deja al salvaje en el mínimo:\n\n${mdTable(['Semana', 'p10', 'mediana', 'p90', 'Vida restante (mediana)', '% en el mínimo (5 %)'], rows)}\n\nEn las semanas estables ${pct(atFloor)} de los salvajes llegan al mínimo de vida; la mediana del daño es ${n2(median(sr))}× sus PS (vida restante mediana ${pct(Math.max(cfg.capture.minHpFraction, 1 - median(sr)))}).${atFloor > 0.85 ? ' La barra de vida y el "preparar el daño" casi nunca importan.' : ''}\n`
  }
  const st = profs.map((p) => [PN[p], n1(t(p).statusCharges / Math.max(1, (base[p] as ProfileAgg).meanSessionsPerSeed)), pct(t(p).statusChargesUsed / Math.max(1, t(p).statusCharges)), n1(t(p).rerollCharges / Math.max(1, (base[p] as ProfileAgg).meanSessionsPerSeed)), pct(t(p).rerollChargesUsed / Math.max(1, t(p).rerollCharges))])
  return `## 4. Encuentros

**Tamaño de oleada por liga** (todas las sesiones recompensadas de todos los perfiles; "liga" = la que fija el máximo; base ${cfg.encounters.baseWaveSize} ± ${cfg.encounters.waveSizeJitter}, mín. ${cfg.encounters.minWaveSize}):

${mdTable(['Liga', 'Máx.', 'Oleadas', 'Tamaño medio', '% en el máximo', 'Mayor visto'], waveRows)}

${mdTable(['Perfil', 'Tamaño medio', 'Rango', 'Oleadas/día', 'Salvajes/sesión'], perProf)}
${dmg}
**Legendarios y shinies** en 12 semanas (por jugador). "Nuevos" = legendarios que aparecen por primera vez; "Reapar." = reapariciones de uno que escapó (GDD §10.4: ${pct(cfg.encounters.roamingChance)} por sesión durante ${cfg.encounters.roamingSessions} sesiones); "1.er enc." = % capturado en el primer encuentro; "Al final" = capturados ÷ nuevos, contando los reintentos; "% prep." = lanzamientos a legendarios con el salvaje dormido o paralizado; "P(≥1/≥2/≥4)" = fracción de jugadores que se cruza con al menos 1/2/4 nuevos.

${mdTable(['Perfil', 'Nuevos', 'Reapar.', 'Capturados', '1.er enc.', 'Al final', 'P(≥1 / ≥2 / ≥4)', '% prep.', 'Shiny vistos', 'Shiny capt.'], leg)}

**Cargas de estado y de sustitución** (por sesión, Hipnosis/Onda Trueno… y Rugido/Remolino con la carga de técnicas por defecto):

${mdTable(['Perfil', 'Estado/sesión', 'Usadas', 'Sustituir/sesión', 'Usadas'], st)}
`
}

function sec5(c: Ctx): string {
  const { base, profs, cfg, weeks } = c
  const rows = profs.map((p) => {
    const ss = rewardedSessions(base[p] as ProfileAgg)
    const memberSessions = sum(ss.map((s) => s.active))
    return [
      PN[p],
      n0(ss.length),
      pct(ss.filter((s) => s.exhausted > 0).length / Math.max(1, ss.length)),
      n2(mean(ss.map((s) => s.exhausted))),
      pct(sum(ss.map((s) => s.exhausted)) / Math.max(1, memberSessions)),
      pct(ss.filter((s) => s.active > 0 && s.exhausted >= s.active).length / Math.max(1, ss.length)),
      pct(mean(ss.map((s) => s.endEnergyFrac))),
      pct(mean(ss.map((s) => s.asleep / Math.max(1, s.teamSize)))),
    ]
  })
  const counterRows = profs.map((p) => {
    const a = base[p] as ProfileAgg
    const t = a.tallyMean
    const sessions = rewardedSessions(a).length / Math.max(1, a.runs.length)
    return [
      PN[p],
      n1(t.counterHits),
      n2(t.counterHits / Math.max(1, sessions)),
      n0(t.counterEnergyLost),
      n1(t.counterEnergyLost / Math.max(1, t.counterHits)),
      pct(t.counterOnLeader / Math.max(1, t.counterHits)),
      n1(t.counterExhausted),
      n2(t.counterExhausted / Math.max(1, sessions)),
    ]
  })
  const ord = ['constant', 'marathoner', 'night-owl'].filter((p) => base[p as ProfileId]).map((p) => {
    const ss = rewardedSessions(base[p as ProfileAgg['profile']] as ProfileAgg)
    const cells = [0, 1, 2, 3].map((i) => {
      const xs = ss.filter((s) => (i === 3 ? s.ordinal >= 3 : s.ordinal === i))
      return xs.length > 20 ? pct(xs.filter((s) => s.exhausted > 0).length / xs.length) : '—'
    })
    return [PN[p as ProfileId], ...cells]
  })
  return `## 5. Energía

"Agotado" = un miembro despierto que llega a 0 de Energía durante la sesión. El equipo se elige cada vez con la política voraz (banquillo incluido), así que esto mide cuánto empuja cada perfil más allá de lo que rota.

${mdTable(['Perfil', 'Sesiones', '% con algún agotado', 'Agotados/sesión', '% miembros agotados', '% equipo entero agotado', 'Energía final media', 'Dormidos (Descanso)'], rows)}

Sesiones con algún agotado según el orden dentro del día:

${mdTable(['Perfil', '1.ª', '2.ª', '3.ª', '4.ª o más'], ord)}

**Contraataques** (lanzamientos fallidos, media por jugador en ${weeks} semanas; ×${n2(cfg.capture.counter.damageMult ?? 1)} \`capture.counter.damageMult\`). Cada salvaje contraataca a quien más daño le hizo; el líder solo si nadie le dañó o ese atacante está agotado. "Agotan" = contraataques que dejan a su objetivo a 0 de Energía.

${mdTable(['Perfil', 'Contraataques', 'Por sesión', 'Energía perdida', 'Por golpe', '% al líder', 'Agotan', 'Agotan/sesión'], counterRows)}
`
}

function sec6(c: Ctx): string {
  const { r } = c
  const a = r.species
  if (!a) return '## 6. Valor de estudio de las especies\n\n(No ejecutado: `--no-species`.)\n'
  const rows = [...a.rows].sort((x, y) => y.v30.ptsDay - x.v30.ptsDay)
  const note = (slug: string): string => speciesNotes[slug] ?? ''
  const table = rows.map((x) => {
    const ex = Math.max(x.v30.exhaustedShare, x.v50.exhaustedShare) >= 0.5 ? ' se agota' : ''
    const flags = [...x.flags, ...(ex ? [ex.trim()] : [])].join('; ')
    return [
      x.species.names.es,
      x.group === 'legend' ? 'leg.' : String(x.species.stage),
      x.species.role ?? '—',
      n0(x.v30.ptsSession),
      n0(x.v30.ptsDay),
      sgn(x.dev30),
      n0(x.v50.ptsSession),
      n0(x.v50.ptsDay),
      sgn(x.dev50),
      flags + (x.hard && note(x.slug) ? ` — nota: ${note(x.slug)}` : ''),
    ]
  })
  const med = (['s1', 's2', 's3', 'legend'] as const).map((g) => [GROUP_LABEL[g], n0(a.medians[g][30]), n0(a.medians[g][50])])
  const weak = a.weakEvolutions
  const hard = a.rows.filter((x) => x.hard)
  return `## 6. Valor de estudio de las especies

Un Pokémon solo, perfil constante (4 × 25 min/día con descansos, ${r.opts.speciesWeeks} semanas de días idénticos para todas las especies), IVs 15, naturaleza neutra, técnicas por nivel con la carga por defecto, habilidades promediadas según su probabilidad. Incluye condiciones de tipo, Vínculo 0 y la Energía diaria (se agota si no llega). "Pts/ses" = media de las 4 sesiones; "vs etapa" = diferencia con la mediana de su etapa (legendarios: con la mediana de los finales).

Medianas de referencia (pts/día):

${mdTable(['Grupo', 'nv. 30', 'nv. 50'], med)}

Finales (sin más evoluciones): mediana ${n0(a.finalsMedian[30])} / ${n0(a.finalsMedian[50])}, percentil 25 = ${n0(a.finalsP25[30])} / ${n0(a.finalsP25[50])}. Banda: ±${pct(OUTLIER_BAND)} de la mediana de su etapa; legendarios entre 1.0× y ${LEGEND_MAX_RATIO}× la mediana de los finales. Marcas: **${hard.length}** fuera de banda (${hard.filter((x) => x.transient).length} son transitorias: evolucionan por nivel antes de nv. 30), ${a.rows.filter((x) => x.flags.includes('final < p25')).length} finales bajo el p25.

${mdTable(['Especie', 'Etapa', 'Rol', 'Pts/ses 30', 'Pts/día 30', 'vs etapa', 'Pts/ses 50', 'Pts/día 50', 'vs etapa', 'Marcas'], table, ['l', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'l'])}

${
  weak.length > 0
    ? `Evoluciones que no mejoran al menos un 10 % a la forma anterior: ${weak.map((w) => `${spName(r, w.from)}→${spName(r, w.to)} nv. ${w.level} (×${n2(w.ratio)})`).join('; ')}.`
    : 'Todas las evoluciones superan en ≥ 10 % a su forma anterior (regla "las etapas se notan").'
}
`
}

// Notes from data/overrides/species.json (filled by the CLI).
let speciesNotes: Record<string, string> = {}
export function setSpeciesNotes(n: Record<string, string>): void {
  speciesNotes = n
}

function sec7(c: Ctx): string {
  const { base, profs, r } = c
  const cov = coverage(profs.map((p) => base[p] as ProfileAgg))
  const colProfs = profs.filter((p) => p !== 'grinder')
  const info: Partial<Record<TypeSlug, string>> = {
    normal: 'siempre activa (por diseño)',
    fire: 'sol/≥ 25 °C o 12–18 h',
    water: 'lluvia (25 % de los días en la simulación)',
    electric: 'sesión ≤ 25 min tras otra en ≤ 15 min',
    grass: '05–12 h',
    ice: '≤ 12 °C o nieve (15 % de los días)',
    fighting: 'sesión ≥ 50 min',
    poison: '+8 % por sesión previa del día',
    ground: 'sábado/domingo',
    flying: 'música+ruido ≥ 30 % (micrófono en 60 % de las sesiones)',
    psychic: '1.ª sesión del día o silencio ≥ 70 %',
    bug: '+7 % por Bicho en el equipo (activa solo con alguno)',
    rock: 'sin pausas (20 % de las sesiones pausan)',
    ghost: '20–05 h',
    dragon: 'racha ≥ 7 días',
    dark: '≥ 2 días sin estudiar',
    steel: 'inicio ±1 h del de ayer',
    fairy: 'amigo simultáneo (no hay amigos en el prototipo)',
  }
  const typeName = (ty: TypeSlug) => r.ctx.data.types.types.find((x) => x.slug === ty)?.names.es ?? ty
  const rows = cov.map((x) => {
    let flag = ''
    if (x.type !== 'normal') {
      if (x.active < 0.08) flag = 'casi nunca activa'
      else if (x.active > 0.75) flag = 'casi siempre activa'
      else {
        const always = colProfs.filter((p) => (x.byProfile[p] ?? 0) >= 0.9)
        if (always.length > 0) flag = `≥ 90 % en ${always.map((p) => PN[p]).join(', ')}`
      }
    }
    return [typeName(x.type), n2(x.mean), pct(x.active), ...colProfs.map((p) => (x.byProfile[p] === undefined ? '—' : pct(x.byProfile[p] as number))), info[x.type] ?? '', flag]
  })
  return `## 7. Cobertura de las condiciones de tipo

Multiplicador medio de la condición (1.00 = inactiva) y % de sesiones recompensadas en que está activa, por perfil (el grinder no se cuenta; los supuestos de clima, pausas y micrófono están en la cabecera). "Activa" aquí es "multiplicador > 1": para Bicho y Veneno depende del equipo y de las sesiones previas del día.

${mdTable(['Tipo', 'Mult. medio', '% activa', ...colProfs.map((p) => PN[p]), 'Condición', 'Marca'], rows, ['l', 'r', 'r', ...colProfs.map(() => 'r' as const), 'l', 'l'])}
`
}

function sec8(c: Ctx): string {
  const { r, cfg, weeks } = c
  const recRows = r.recs.map((x) => [`\`${x.path}\``, x.current, x.proposed, x.reason])
  const cfgBlock = r.recs.length > 0 ? mdTable(['Clave de config', 'Actual', 'Propuesto', 'Motivo'], recRows, ['l', 'l', 'l', 'l']) : 'Sin cambios de configuración propuestos: todos los objetivos medidos están dentro de banda.'
  const sug = r.suggestions
  const mewPatch = r.proposedSpecies.mew?.captureRate !== undefined
  const speciesPatchRows = [
    ...sug.map((s) => [spName(r, s.slug), `\`baseStats.specialAttack\` ${s.from} → ${s.to}`, s.reason + (s.large ? ` (cambio grande${s.alt ? `; alternativa con efecto parecido: ${s.alt}` : ': valorar otra palanca (Ritmo o Energía)'})` : '')]),
    ...(mewPatch ? [[spName(r, 'mew'), '`captureRate` 45 → 3', 'Mew (mítico) conserva 45 y sale 1.5× más fácil que el mínimo de legendarios (30); igualarlo a Articuno/Mewtwo']] : []),
  ]
  const speciesBlock = speciesPatchRows.length > 0 ? `${mdTable(['Especie', 'Cambio', 'Motivo'], speciesPatchRows, ['l', 'l', 'l'])}\n\nParches para \`data/overrides/species.json\` (se fusionan con lo que ya hay; también en \`docs/balance-proposed-species.json\`):\n\n\`\`\`json\n${JSON.stringify(r.proposedSpecies, null, 2)}\n\`\`\`` : 'Sin parches de especies: ninguna queda fuera de banda.'

  // Verification
  let verify = ''
  if (r.verify) {
    const baseK = kpis(r.baseline, cfg, r.reference, weeks)
    const propK = kpis(r.verify.matrix, r.verify.cfg, r.verify.reference, weeks)
    const rows = baseK.map((b, i) => [b.label, b.objective, b.value, propK[i]?.value ?? '—'])
    const sa = r.verify.speciesAfter
    verify = `### 8.4 Verificación: línea base frente a la propuesta

La propuesta completa (config + parches de especies) se volvió a simular con ${r.verify.seeds} semillas por perfil (${Math.min(r.opts.seeds, r.verify.seeds * 2)} en el constante; la línea base usa ${r.opts.seeds}). Las ligas se evalúan sobre los mismos puntos con los umbrales propuestos: los umbrales solo cambian el máximo de salvajes por oleada, no los puntos. n = legendarios nuevos observados.

${mdTable(['Indicador', 'Objetivo', 'Línea base', 'Propuesta'], rows, ['l', 'l', 'r', 'r'])}
${marginNote(r, baseK, propK)}${sa ? `\nEspecies fuera de banda (sin contar transitorias): ${r.species?.rows.filter((x) => x.hard && !x.transient).length ?? '—'} antes → **${sa.rows.filter((x) => x.hard && !x.transient).length}** después${sa.rows.some((x) => x.hard && !x.transient) ? ` (${sa.rows.filter((x) => x.hard && !x.transient).map((x) => `${x.species.names.es} ${x.flags[0] ?? ''}`).join(', ')})` : ''}. Finales bajo el p25 (marca informativa, ≈ 25 % por definición): ${sa.rows.filter((x) => x.flags.includes('final < p25')).length}.\n` : ''}`
  }

  const engine = engineNotes(c)
  return `## 8. Recomendaciones

### 8.1 Configuración

${cfgBlock}

La configuración completa propuesta está en \`docs/balance-proposed-config.json\`. Para repetir la simulación con ella: \`npm run simulate -- --config docs/balance-proposed-config.json\` (y \`--species docs/balance-proposed-species.json\` para los parches de especies).

### 8.2 Especies (\`data/overrides/species.json\`)

${speciesBlock}

### 8.3 Cambios de motor o de diseño (no se arreglan con un valor)

${engine}

${verify}`
}

/** Side effects of the proposal worth a line: indicators that moved out of their range. */
function marginNote(r: Results, baseK: Kpi[], propK: Kpi[]): string {
  const i = baseK.findIndex((x) => x.label.startsWith('Maratonista: sesiones con algún agotado'))
  if (i < 0 || !r.verify) return ''
  const v = Number.parseFloat(propK[i]?.value ?? '')
  const b = Number.parseFloat(baseK[i]?.value ?? '')
  if (Number.isNaN(v) || v <= 60 || v <= b) return ''
  return `\nEfecto secundario: subir la EXP y abrir antes los topes sube el nivel del equipo y con él el coste de Energía por acción (\`0.5 + nivel/25\`) más rápido que los PS, así que el maratonista rota más (${b.toFixed(0)} % → ${v.toFixed(0)} % de sesiones con algún agotado). Si se quiere mantenerlo en 30–60 %, subir \`energy.costLevelDivisor\` (p. ej. de ${r.cfg.energy.costLevelDivisor} a ${Math.round(r.cfg.energy.costLevelDivisor * 1.15)}) o dar PS a los maratonistas.\n`
}

function engineNotes(c: Ctx): string {
  const { base, profs, cfg, r, weeks } = c
  const notes: string[] = []
  // Wave size vs league
  const sizes: Record<LeagueId, number[]> = { base: [], super: [], ultra: [], master: [] }
  for (const p of profs) for (const s of rewardedSessions(base[p] as ProfileAgg)) sizes[s.league].push(...s.waveSizes)
  const m = (l: LeagueId) => (sizes[l].length > 50 ? mean(sizes[l]) : NaN)
  const lift = [m('super') - m('base'), m('ultra') - m('super'), m('master') - m('ultra')].filter(Number.isFinite)
  if (lift.length === 0 || Math.max(...lift) < 0.3) {
    notes.push(
      `**El máximo de salvajes por liga no tiene efecto.** El tamaño de la oleada es ${cfg.encounters.baseWaveSize} ± ${cfg.encounters.waveSizeJitter} (+1 con Dulce Aroma, −1 con Foco bajo), así que solo roza el tope de Base (${cfg.encounters.leagueMaxWaveSize.base}); los topes 6/7/8 de Super/Ultra/Maestra nunca se alcanzan y el tamaño medio es el mismo en todas las ligas (${profs.length ? n2(mean(Object.values(sizes).flat())) : '—'}). El GDD §14 busca que "las oleadas crezcan a medida que estudias". Propuesta de motor: sumar al tamaño un bono por liga antes de aplicar el tope (\`leagueWaveBonus: { base: 0, super: 1, ultra: 2, master: 3 }\` ⇒ medias 4/5/6/7).`,
    )
  }
  // Damage saturation
  const kon = base.constant
  if (kon) {
    const rs = steadyRatios(kon)
    const floor = rs.filter((v) => v >= 0.95).length / Math.max(1, rs.length)
    if (floor > 0.85) {
      const early = ratiosOfWeek(kon, 1)
      notes.push(
        `**La vida del salvaje casi nunca importa.** ${pct(floor)} de los salvajes quedan en el mínimo del 5 % en las semanas estables (mediana daño ÷ PS = ${n1(median(rs))}; en la semana 1 ya es ${n1(median(early))}). Cada salvaje recibe la Energía de toda la oleada de un equipo de 6, que crece con el cuadrado del nivel mientras los salvajes solo suben con el nivel de entrenador. Un único divisor no sirve (habría que dividir por ~${n0(median(rs))} al final, pero en la semana 1 dejaría a los salvajes sin tocar). Opciones de motor: repartir la Energía de la oleada entre sus salvajes (÷ ~4); normalizar por el nivel medio del equipo frente al del salvaje; o subir los niveles salvajes con el nivel real del equipo, no solo el de entrenador.`,
      )
    }
  }
  // Candies
  const cons = base.constant
  if (cons) {
    const t = cons.tallyMean
    const gained = t.candiesFromCatch + t.candiesFromRelease
    if (gained > t.candiesSpent * 3) {
      notes.push(
        `**Sobran caramelos; el límite es el Polvo** (como quiere el GDD §12.3, pero con mucho margen). El constante gana ${n0(gained)} caramelos en ${weeks} semanas (capturas ${n0(t.candiesFromCatch)} + soltar ${n0(t.candiesFromRelease)}) y solo puede pagar ${n0(t.candiesSpent)} (${pct(t.candiesSpent / Math.max(1, gained))}); los caramelos aportan ≈ ${pct((t.candiesSpent * cfg.progression.candyExp) / Math.max(1, t.candiesSpent * cfg.progression.candyExp + cfg.rewards.expPerMinute * 100 * weeks * 7 * 6 * 0.9))} de la EXP del equipo. Hoy capturar un duplicado casi no vale nada. Si se quiere que importe: bajar el coste en Polvo (\`progression.candyDustBase\` / \`candyDustPerLevel\`) o subir \`progression.candyExp\`; si se prefiere que el Polvo siga mandando, reducir \`candiesOnCatch\` es inocuo.`,
      )
    }
    if (t.dustSpent < t.dustEarned * 0.9) {
      notes.push(`**El Polvo se atasca en los topes de nivel.** El constante deja sin gastar el ${pct(1 - t.dustSpent / Math.max(1, t.dustEarned))} del Polvo (${n0(mean(cons.runs.map((x) => x.finalDust)))} al final): todo el equipo está en el tope y no hay en qué gastarlo. Conviene un destino (Pokémon de banquillo, intercambios, Teralitos) o abrir antes los topes (ver 8.1).`)
    }
  }
  // Study ball conversions
  const conv = profs.map((p) => ({ p, v: (base[p] as ProfileAgg).tallyMean.pokeBallsFromConverted / Math.max(1, (base[p] as ProfileAgg).tallyMean.wavesSeen) })).filter((x) => x.v > 0.1)
  if (conv.length > 0) {
    notes.push(`**La Ball de Estudio se queda sin objetivos con el nivel de entrenador.** Vale para base ≤ max(nv. ${cfg.encounters.studyBallMaxLevel}, mínimo del rango salvaje + ${cfg.encounters.studyBallLevelMargin}) y aun así se convierte en Poké Ball en ${conv.map((x) => `${pct(x.v)} de las oleadas del ${PN[x.p]}`).join(', ')}. Si molesta: subir \`encounters.studyBallLevelMargin\`.`)
  }
  // Evolutions
  const stuck = r.ctx.data.species.filter((s) => s.evolutions.some((e) => e.trigger === 'trade'))
  if (stuck.length > 0) {
    notes.push(`**Evoluciones por intercambio imposibles en el prototipo:** ${stuck.map((s) => `${s.names.es}→${r.ctx.speciesById.get(s.evolutions.find((e) => e.trigger === 'trade')?.to ?? 0)?.names.es ?? '?'}`).join(', ')}. Esos finales solo se consiguen salvajes (nivel salvaje mínimo = nivel de la etapa previa + ${cfg.encounters.nonLevelEvolutionLevelGap}). Dragonite (Dragonair nv. 55) queda sobre el tope de nivel 50: solo aparece como salvaje a nivel ≥ 55, fuera de todo rango.`)
  }
  // Rest
  const stuckAsleep = Math.max(0, ...profs.map((p) => (base[p] as ProfileAgg).tallyMean.sleepingStuckEnd))
  const restUses = Math.max(0, ...profs.map((p) => (base[p] as ProfileAgg).tallyMean.restSessions))
  if (restUses >= 1 && stuckAsleep >= 0.05) {
    notes.push(`**Descanso puede dejar dormido a un Pokémon de la caja indefinidamente:** \`asleepNextSession\` solo se limpia si el Pokémon está en el equipo durante una sesión (\`applySessionResult\`). El simulador mete a las estrellas dormidas en el equipo para despertarlas; aun así, al final de ${weeks} semanas quedan hasta ${n1(stuckAsleep)} dormidos en la caja de un jugador (Descanso se activó hasta ${n0(restUses)} veces por jugador). La UI debería limpiar el estado al sacarlo del equipo o al cambiar de día.`)
  }
  // Bug and fairy
  const bug = coverage(profs.map((p) => base[p] as ProfileAgg)).find((x) => x.type === 'bug')
  if (bug && bug.active < 0.1) {
    notes.push(`**Bicho no aporta nada** (activa en ${pct(bug.active)} de las sesiones, mult. medio ${n2(bug.mean)}): con un solo Bicho en el equipo es ×1.07 y llegar a ×1.42 exige 6 Bichos, cuando el Pack 1 solo tiene 3 especies Bicho. Propuesta de motor: ×(1 + 0.15 + 0.05 por Bicho adicional), tope ×1.40.`)
  }
  notes.push(`**Hada (×${cfg.conditions.fairy}) está muerta sin amigos** (0 % de sesiones): se activa en F2; hasta entonces su multiplicador no cuenta para ninguna comparación.`)
  return notes.map((x) => `- ${x}`).join('\n')
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

function summary(c: Ctx): string {
  const { r, base, weeks, cfg } = c
  const out: string[] = []
  const kon = base.constant
  const mar = base.marathoner
  const th = thresholdsOf(cfg)
  const typeName = (ty: TypeSlug) => r.ctx.data.types.types.find((x) => x.slug === ty)?.names.es ?? ty
  if (kon) {
    const w1 = kon.weekly[0]?.p50 ?? 0
    const wl = kon.weekly[weeks - 1]?.p50 ?? 0
    const firstMaster = kon.weekly.findIndex((w) => w.p50 >= th.master) + 1
    const reach = leagueReach(kon.runs, th, STEADY_FROM_WEEK)
    const head = firstMaster > 0 && firstMaster <= 4 ? 'Los umbrales de liga están muy por debajo de la escala real.' : reach.master.share < 0.05 ? 'Los umbrales de liga quedan por encima de lo que alcanza el constante.' : 'Los umbrales de liga encajan con la escala de puntos.'
    out.push(`**${head}** El constante pasa de ${k(w1)} puntos/semana (sem. 1) a ${k(wl)} (sem. ${weeks}), ×${n1(wl / Math.max(1, w1))}; con ${n0(th.super)}/${n0(th.ultra)}/${n0(th.master)} es Maestra ${firstMaster > 0 ? `desde la semana ${firstMaster} (en ${pct(reach.master.share)} de las semanas estables)` : 'nunca'}. Propuesta en 8.1.`)
  }
  const cross = crossingDays(r.reference, (d) => d.starterExpLevel, [30, 50])
  if (cross[0] && cross[1]) {
    const slow = (cross[0].day ?? 0) > 24 || (cross[1].day ?? 999) > 105
    out.push(`**Nivelado:** el Pokémon de referencia (sin caramelos) llega a nv. 30 el día ${cross[0].day ? Math.round(cross[0].day) : '—'} (objetivo 21) y a nv. 50 el día ${cross[1].day ? Math.round(cross[1].day) : '> ' + (r.reference[0]?.days.length ?? 0)} (objetivo ~91): con el Foco real (100 % a tiempo, 50 % tarde) la curva va ${slow ? 'lenta' : 'en objetivo'}.`)
  }
  if (kon) {
    const d = kon.runs.map((x) => x.days[x.days.length - 1] as PlayerMetrics['days'][number])
    const capCross = crossingDays(kon.runs, (x) => x.cap, [50])
    const unspent = 1 - kon.tallyMean.dustSpent / Math.max(1, kon.tallyMean.dustEarned)
    const brake = !capCross[0]?.day || unspent > 0.1
    out.push(`**Pokédex ${brake ? 'como freno' : 'sin frenar'}:** el constante lleva ${median(d.map((x) => x.caught))} especies a la semana ${weeks} (tope nv. ${median(d.map((x) => x.cap))}); el tope 50 (${cfg.progression.levelCaps[2]?.species} especies) ${capCross[0]?.day ? `se abre el día ${Math.round(capCross[0].day)}` : 'no se abre'}; deja sin gastar el ${pct(unspent)} del Polvo.`)
    const rs = steadyRatios(kon)
    const floor = rs.filter((v) => v >= 0.95).length / Math.max(1, rs.length)
    out.push(`**${floor > 0.85 ? 'La vida del salvaje no cuenta' : 'La vida del salvaje importa en parte'}:** ${pct(floor)} de los salvajes quedan en el mínimo de 5 % (mediana daño ÷ PS = ${n1(median(rs))}). La captura depende de la rareza, las cargas de estado (${n1(kon.tallyMean.statusCharges / Math.max(1, kon.meanSessionsPerSeed))} por sesión) y las Balls${floor > 0.85 ? ', no del daño' : ''}.`)
    const lf = legendaryFigures(kon.tallyMean)
    const lfN = r.noMissions ? legendaryFigures(r.noMissions.tallyMean) : null
    const marF = mar ? legendaryFigures(mar.tallyMean) : null
    out.push(`**Legendarios:** el constante se cruza con ${n1(lf.fresh * (12 / weeks))} nuevos en 12 semanas (objetivo 1–3) y captura el ${pct(lf.firstShare)} en el primer encuentro (objetivo ≈ 50 %; ${pct(lf.finalShare)} al final, con las reapariciones${lfN ? `; sin misiones: ${pct(lfN.firstShare)} en el primero` : ''})${marF ? `; el maratonista se cruza con ${n1(marF.fresh * (12 / weeks))} por la ventaja de las oleadas largas` : ''}.`)
  }
  if (mar) {
    const ss = rewardedSessions(mar)
    const sh = ss.filter((s) => s.exhausted > 0).length / Math.max(1, ss.length)
    const verdict = sh < 0.3 ? 'rotación baja: el maratón apenas cansa al equipo' : sh <= 0.6 ? 'rotación moderada, como se pretendía' : 'rotación alta: casi cada sesión larga agota a alguien'
    out.push(`**Energía:** el maratonista tiene algún agotado en ${pct(sh)} de sus sesiones (constante: ${kon ? pct(rewardedSessions(kon).filter((s) => s.exhausted > 0).length / Math.max(1, rewardedSessions(kon).length)) : '—'}); ${verdict}.`)
  }
  const g = base.grinder
  if (g && mar) {
    const ratio = mean(g.steadyPool) / Math.max(1, mean(mar.steadyPool))
    out.push(`**Antitrampas:** el grinder (14 h/día) cobra ${n0(mean(g.runs.map((x) => sum(x.sessions.map((s) => s.minutes * s.rewardFactor)))) / (weeks * 7))} min pagados/día de ${n0(mean(g.runs.map((x) => sum(x.sessions.map((s) => s.minutes)))) / (weeks * 7))} y saca ${n1(ratio)}× los puntos del maratonista${kon ? ` (${n1(mean(g.steadyPool) / Math.max(1, mean(kon.steadyPool)))}× el constante)` : ''}: ${ratio > GRINDER_LIMIT ? 'se escapa' : 'acotado'} (aviso a partir de ${GRINDER_LIMIT}×).`)
  }
  const sizes: Record<LeagueId, number[]> = { base: [], super: [], ultra: [], master: [] }
  for (const p of c.profs) for (const s of rewardedSessions(base[p] as ProfileAgg)) sizes[s.league].push(...s.waveSizes)
  const meansBy = (['base', 'super', 'ultra', 'master'] as LeagueId[]).filter((l) => sizes[l].length > 50).map((l) => mean(sizes[l]))
  if (meansBy.length > 1) {
    const flat = Math.max(...meansBy) - Math.min(...meansBy) < 0.3
    out.push(flat ? `**Oleadas:** el tamaño medio es el mismo en todas las ligas (${n2(Math.min(...meansBy))}–${n2(Math.max(...meansBy))}); los topes 6/7/8 no se alcanzan nunca (8.3).` : `**Oleadas:** el tamaño medio crece con la liga (${meansBy.map(n2).join(' → ')}).`)
  }
  if (r.species) {
    const hard = r.species.rows.filter((x) => x.hard && !x.transient)
    const tr = r.species.rows.filter((x) => x.hard && x.transient).length
    out.push(`**Especies:** ${hard.length} de ${r.species.rows.length} fuera de banda (±${pct(OUTLIER_BAND)} de la mediana de su etapa), más ${tr} transitorias${hard.length ? ': ' + hard.slice(0, 9).map((x) => `${x.species.names.es} (${x.flags[0]})`).join(', ') + (hard.length > 9 ? '…' : '') : ''}.`)
  }
  const cov = coverage(c.profs.map((p) => base[p] as ProfileAgg))
  const never = cov.filter((x) => x.type !== 'normal' && x.active < 0.08).map((x) => typeName(x.type))
  const always = cov.filter((x) => x.type !== 'normal' && x.active > 0.75).map((x) => typeName(x.type))
  out.push(`**Condiciones de tipo:** casi nunca activas: ${never.join(', ') || '—'}; casi siempre: ${always.join(', ') || '—'}.`)
  return out.map((x, i) => `${i + 1}. ${x}`).join('\n')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function renderReport(r: Results, command: string): string {
  const profs = present(r)
  const c: Ctx = { r, profs, base: r.baseline, cfg: r.cfg, weeks: r.opts.weeks }
  const date = new Date().toISOString().slice(0, 10)
  const prof = profs.map((p) => `- **${PN[p]}**: ${PROFILE_DESC[p]}`).join('\n')
  const o = r.opts
  return `# Informe de balance — PokeFocus (simulador F0)

> Generado el ${date} con \`${command}\` en ${n0(r.seconds)} s. ${o.seeds} semillas × ${o.weeks} semanas × ${profs.length} perfiles${o.config && Object.keys(o.config).length ? ' · config con overrides' : ' · config del repositorio'}${o.speciesPatch && Object.keys(o.speciesPatch).length ? ' · parches de especies' : ''} · reparto del daño: \`${o.damagePolicy ?? 'auto'}\`.
> Solo usa la API pública del motor, con semillas fijas: la misma orden da el mismo informe. Las políticas del jugador simulado están al principio de \`scripts/simulate.ts\`.

## Resumen

${summary(c)}

## Cómo leer este informe

Perfiles (zona horaria fija UTC−5; la semana empieza en lunes; clima por día: lluvia 25 %, sol 30 %, frío 15 %, resto despejado):

${prof}

Supuestos del simulador (no vienen del motor): Foco como en producción (sin etiquetas de captura: 100 % al reclamar a tiempo, 50 % en el 5 % de reclamaciones tardías; las etiquetas solo sirven al panel de desarrollo), 20 % de sesiones con una pausa, micrófono activo en el 60 % de las sesiones, sin amigos (Hada nunca activa) y las misiones del motor (reclamadas al completarlas). Todo jugador empieza con un inicial al azar. "Semanas estables" = ${STEADY_FROM_WEEK}–${o.weeks}. Cada (perfil, semilla) repite siempre el mismo calendario, clima y retrasos al reclamar aunque cambie la config, así que las comparaciones antes/después son pareadas.

Fuera del modelo: Pociones y Revivir y caramelos de tipo (se ganan con misiones pero no se usan), Teralitos y MT (sin uso aún), Tera, intercambios, amistad (Hada), Dominio elegido a mano (se usa la carga por defecto) y cualquier decisión estética del jugador. Los topes y umbrales propuestos dependen de que el jugador real capture con una eficiencia parecida a la simulada.

${sec1(c)}
${sec2(c)}
${sec3(c)}
${sec4(c)}
${sec5(c)}
${sec6(c)}
${sec7(c)}
${sec8(c)}
`
}
