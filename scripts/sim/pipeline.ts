/**
 * The full run: baseline → recommendations → verification.
 *
 *   1. Baseline: every profile × seeds × weeks with the config as given.
 *   2. Reference leveling (starter alone, no candies) and species values.
 *   3. Stage 1 proposal (leveling speed, legendary frequency and catch rate,
 *      daily diminishing returns, species patches), simulated.
 *   4. Stage 2 proposal from stage-1 data (league thresholds, Pokédex level caps).
 *   5. Verification run with everything applied.
 */
import { deepMerge, type GameConfig, type GameConfigOverrides, type EngineContext } from '../../src/engine/index.ts'
import { minWildLevel, wildLevelRange } from '../../src/engine/index.ts'
import type { ProfileAgg } from './aggregate.ts'
import { crossingDays, LEVEL_TARGETS, legendaryShareAt, proposeThresholds, rewardedSessions, thresholdsOf } from './analysis.ts'
import {
  makeContext,
  runMatrix,
  runReferenceLeveling,
  runSpeciesValues,
  type SpeciesPatch,
} from './experiments.ts'
import type { ProfileId } from './profiles.ts'
import { analyseSpecies, suggestSpeciesPatches, type SpeciesAnalysis, type SpeciesSuggestion } from './species-analysis.ts'
import type { SpeciesValue } from './species-value.ts'
import type { PlayerMetrics } from './types.ts'
import { mean, median, n1, n2, pct, sum } from './util.ts'

export interface Rec {
  path: string
  current: string
  proposed: string
  reason: string
}

export interface PipelineOptions {
  seeds: number
  weeks: number
  levelWeeks: number
  profiles: readonly ProfileId[]
  config?: GameConfigOverrides
  speciesPatch?: SpeciesPatch
  missions: boolean
  speciesWeeks: number
  /** Run the proposal stages (stage 1, stage 2, verification). */
  propose: boolean
  /** Seeds for the proposal stages. */
  proposeSeeds: number
  /** Run the species-value harness. */
  species: boolean
  log?: (msg: string) => void
  progress?: (label: string, done: number, total: number) => void
}

export interface Verification {
  matrix: Record<ProfileId, ProfileAgg>
  reference: PlayerMetrics[]
  cfg: GameConfig
  seeds: number
  speciesAfter: SpeciesAnalysis | null
}

export interface Results {
  opts: PipelineOptions
  ctx: EngineContext
  cfg: GameConfig
  baseline: Record<ProfileId, ProfileAgg>
  noMissions: ProfileAgg | null
  reference: PlayerMetrics[]
  speciesValues: SpeciesValue[]
  species: SpeciesAnalysis | null
  suggestions: SpeciesSuggestion[]
  /** First-encounter legendary catch share replayed for several minimum capture rates (constant profile). */
  legendaryScan: { R: number; share: number; n: number }[] | null
  legendaryScanTarget: number
  recs: Rec[]
  /** Overrides vs the shipped config (input `--config` merged with the new recommendations). */
  proposedConfig: GameConfigOverrides
  /** Species patches to apply in data/overrides/species.json. */
  proposedSpecies: SpeciesPatch
  /** Findings about the engine or design that no config value can fix. */
  stage1: Record<ProfileId, ProfileAgg> | null
  verify: Verification | null
  unreachable: { slug: string; share: number; why: string }[]
  seconds: number
}

export const STEADY_FROM = 4
/** The grinder (14 h/day) may earn up to this many times the marathoner's points before the daily tiers are tightened. */
export const GRINDER_LIMIT = 4.5

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur = obj
  keys.slice(0, -1).forEach((k) => {
    cur[k] = typeof cur[k] === 'object' && cur[k] !== null ? { ...(cur[k] as object) } : {}
    cur = cur[k] as Record<string, unknown>
  })
  cur[keys[keys.length - 1] as string] = value
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

const show = (v: unknown): string => (typeof v === 'object' ? JSON.stringify(v) : String(v))

function legendarySeenMean(a: ProfileAgg): number {
  return mean(a.runs.map((r) => r.tally.legendarySeen - r.tally.legendaryRoamingSeen))
}

export function runPipeline(o: PipelineOptions): Results {
  const t0 = Date.now()
  const log = o.log ?? (() => {})
  const prog = o.progress ?? (() => {})
  const baseConfig: GameConfigOverrides = o.config ?? {}
  const ctx = makeContext(baseConfig, o.speciesPatch)
  const cfg = ctx.config

  log(`Línea base: ${o.profiles.length} perfiles × ${o.seeds} semillas × ${o.weeks} semanas`)
  const baseline = runMatrix({ ctx, profiles: o.profiles, seeds: o.seeds, weeks: o.weeks, missions: o.missions, onProgress: (l, d, t) => prog(`línea base (${l})`, d, t) })
  let noMissions: ProfileAgg | null = null
  if (o.missions && o.profiles.includes('constant')) {
    const r = runMatrix({ ctx, profiles: ['constant'], seeds: o.seeds, weeks: o.weeks, missions: false })
    noMissions = r.constant
  }
  log('Nivelado de referencia')
  const reference = runReferenceLeveling(ctx, o.levelWeeks, Math.min(5, o.seeds))

  let speciesValues: SpeciesValue[] = []
  let species: SpeciesAnalysis | null = null
  let suggestions: SpeciesSuggestion[] = []
  if (o.species) {
    log('Valor de estudio de las especies')
    speciesValues = runSpeciesValues(ctx, o.speciesWeeks, (d, t) => prog('especies', d, t))
    species = analyseSpecies(ctx, speciesValues)
    suggestions = suggestSpeciesPatches(ctx, species)
  }

  const recs: Rec[] = []
  const stage1Overrides: Record<string, unknown> = {}
  const propose = (path: string, proposed: unknown, reason: string, into: Record<string, unknown> = stage1Overrides) => {
    recs.push({ path, current: show(getPath(cfg, path)), proposed: show(proposed), reason })
    setPath(into, path, proposed)
  }

  const proposedSpecies: SpeciesPatch = {}
  for (const s of suggestions) {
    proposedSpecies[s.slug] = { baseStats: { specialAttack: s.to }, _note: s.reason }
  }

  let legendaryScan: Results['legendaryScan'] = null
  const legendaryScanTarget = 0.55
  let stage1: Record<ProfileId, ProfileAgg> | null = null
  let verify: Verification | null = null
  let proposedConfig: GameConfigOverrides = baseConfig

  if (o.propose && baseline.constant && baseline.casual) {
    log('Propuesta (ritmo de nivel, topes por Pokédex, legendarios, rendimientos decrecientes, especies)')
    const constant = baseline.constant
    const horizon = o.weeks * 7

    // B. Leveling speed (GDD §12.1) from the reference run.
    const cross = crossingDays(reference, (d) => d.starterExpLevel, [10, 30, 50])
    const d30 = cross[1]?.day
    const d50 = cross[2]?.day
    const ratios: number[] = []
    if (d30) ratios.push(d30 / (LEVEL_TARGETS[1] as { day: number }).day)
    if (d50) ratios.push(d50 / (LEVEL_TARGETS[2] as { day: number }).day)
    let speedUp = 1
    if (ratios.length > 0) {
      const k = mean(ratios)
      if (Math.abs(k - 1) > 0.12) {
        const cur = cfg.rewards.expPerMinute
        const next = Math.round(cur * k)
        speedUp = next / cur
        propose(
          'rewards.expPerMinute',
          next,
          `con Foco real (~${n2(mean(rewardedSessions(constant).map((s) => s.focus)))}) el Pokémon de referencia llega a nv. 30 en el día ${d30 ? Math.round(d30) : '—'} (objetivo 21) y a nv. 50 en el día ${d50 ? Math.round(d50) : '—'} (objetivo ~91); la EXP por minuto debe subir ×${n2(k)} (el GDD §12.1 calcula con Foco 1.0; si se prefiere conservar ese cálculo, dejarlo como está y asumir que el ritmo real va un ${Math.round((k - 1) * 100)} % más lento)`,
        )
      }
    }

    // C. Pokédex level caps: open them before the median team's EXP catches up (timeline scaled by B).
    {
      const lc = cfg.progression.levelCaps
      const exp = crossingDays(constant.runs, (d) => d.medTeamExpLevel, [30, 40])
      const e30 = (exp[0]?.day ?? horizon * 0.5) / speedUp
      const e40 = (exp[1]?.day ?? horizon * 0.85) / speedUp
      const speciesAt = (day: number) => median(constant.runs.map((r) => (r.days[Math.max(0, Math.min(r.days.length - 1, Math.round(day * speedUp) - 1))] as PlayerMetrics['days'][number]).caught))
      const caps = lc.map((c) => ({ species: c.species, cap: c.cap }))
      const c40 = caps.find((c) => c.cap === 40)
      const c50 = caps.find((c) => c.cap === 50)
      if (c40) {
        const want = Math.max(10, Math.min(c40.species, Math.floor(speciesAt(e30 - 3))))
        if (c40.species - want >= 3) {
          recs.push({ path: 'progression.levelCaps[1].species', current: String(c40.species), proposed: String(want), reason: `el equipo constante llega a nv. 30 por EXP hacia el día ${Math.round(e30)}; el tope 40 debe estar abierto para entonces (${want} especies es lo que lleva en ese momento)` })
          c40.species = want
        }
      }
      if (c50 && c40) {
        const want = Math.max(c40.species + 8, Math.min(c50.species, Math.floor(speciesAt(e40 - 3))))
        if (c50.species - want >= 3) {
          recs.push({ path: 'progression.levelCaps[2].species', current: String(c50.species), proposed: String(want), reason: `el equipo constante llega a nv. 40 por EXP hacia el día ${Math.round(e40)}; con ${c50.species} especies el tope 50 sigue cerrado (mediana a la semana ${o.weeks}: ${speciesAt(horizon / speedUp)}); ${want} es lo que lleva a ese ritmo` })
          c50.species = want
        }
      }
      if (caps.some((c, i) => c.species !== (lc[i] as { species: number }).species)) setPath(stage1Overrides, 'progression.levelCaps', caps)
    }

    // D. Legendary frequency for the constant profile (target 1–3 in 12 weeks, centred on 2).
    const seen = legendarySeenMean(constant) * (12 / o.weeks)
    if (seen > 2.5 || seen < 1.5) {
      const cur = cfg.encounters.legendaryChance
      const next = Number((cur * (2 / Math.max(0.3, seen))).toPrecision(2))
      propose('encounters.legendaryChance', next, `el perfil constante se cruza con ${n1(seen)} legendarios nuevos en 12 semanas (objetivo 1–3, centrado en 2)`)
    }

    // H. Daily diminishing returns: the grinder (14 h/day) must not outrun the marathoner absurdly.
    const g = baseline.grinder
    const mar = baseline.marathoner
    if (g && mar) {
      const ratio = steadyMean(g) / Math.max(1, steadyMean(mar))
      if (ratio > GRINDER_LIMIT) {
        const eqG = mean(g.runs.map((r) => sum(r.sessions.map((s) => s.minutes * s.rewardFactor)))) / horizon
        const full = cfg.session.dailyFullRewardMinutes
        const half = cfg.session.dailyHalfRewardMinutes
        const need = (eqG * GRINDER_LIMIT) / ratio
        const f = Math.max(0, Math.min(cfg.session.dailyHalfRewardFactor, Math.round(((need - full) / Math.max(1, half - full)) * 20) / 20))
        if (f < cfg.session.dailyHalfRewardFactor) {
          propose(
            'session.dailyHalfRewardFactor',
            f,
            `el grinder (14 h/día) saca ${n1(ratio)}× los puntos del maratonista (límite ${GRINDER_LIMIT}×) con ${eqG.toFixed(0)} min "pagados"/día; recortar el tramo 360–600 min`,
          )
        }
      }
    }

    // Species patches (they change the points scale a little). Mew (mythical) has capture_rate 45, above any
    // sensible legendary minimum: it would stay the easy legendary.
    const mew = ctx.speciesBySlug.get('mew')
    if (mew && mew.captureRate > 3) {
      const note = 'Mew (mítico) tiene capture_rate 45: sale más fácil que los demás legendarios (mínimo 30 en la config). 3 = como Articuno/Mewtwo.'
      proposedSpecies.mew = { ...(proposedSpecies.mew ?? {}), captureRate: 3, _note: [proposedSpecies.mew?._note, note].filter(Boolean).join(' | ') }
    }
    const patchedSpecies: SpeciesPatch = { ...(o.speciesPatch ?? {}), ...proposedSpecies }

    // E. Legendary first-encounter catch share (target ≈ 55 % with the player's preparation). The odds of every
    // recorded encounter are replayed with other minimum capture rates (same balls, status and HP as played).
    const rateOverride: Record<string, number> = {}
    for (const [slug, p] of Object.entries(patchedSpecies)) if (p.captureRate !== undefined) rateOverride[slug] = p.captureRate
    legendaryScan = [30, 24, 20, 16, 12, 9, 6].map((R) => ({ R, ...legendaryShareAt(constant.runs, R, rateOverride) }))
    const curShare = legendaryShareAt(constant.runs, cfg.capture.legendaryMinCaptureRate, rateOverride)
    if (curShare.n >= 8 && Math.abs(curShare.share - legendaryScanTarget) > 0.12) {
      let bestR = cfg.capture.legendaryMinCaptureRate
      let bestErr = Infinity
      for (let R = 3; R <= 60; R++) {
        const err = Math.abs(legendaryShareAt(constant.runs, R, rateOverride).share - legendaryScanTarget)
        if (err < bestErr - 1e-9) {
          bestErr = err
          bestR = R
        }
      }
      propose(
        'capture.legendaryMinCaptureRate',
        bestR,
        `en el primer encuentro se captura el ${pct(curShare.share)} de los legendarios (n = ${curShare.n}; con la preparación del jugador simulado: Ball Ultra/Super y dormido/paralizado); objetivo ≈ ${pct(legendaryScanTarget)}. Misma partida con otro mínimo: ${legendaryScan.map((x) => `R=${x.R}→${pct(x.share)}`).join(', ')}`,
      )
    }
    const stage1Cfg = deepMerge(baseConfig as Record<string, unknown>, stage1Overrides) as GameConfigOverrides

    // Stage 1: simulate everything so far. League thresholds only change wave-size caps, so this run
    // doubles as the verification run: league reach is re-evaluated on the same points.
    log('Simulación con la propuesta')
    const ctx1 = makeContext(stage1Cfg, patchedSpecies)
    const seeds1 = Math.min(o.seeds, o.proposeSeeds)
    stage1 = runMatrix({ ctx: ctx1, profiles: o.profiles, seeds: seeds1, seedsByProfile: { constant: Math.min(o.seeds, seeds1 * 2) }, weeks: o.weeks, missions: o.missions, onProgress: (l, d, t) => prog(`propuesta (${l})`, d, t) })

    // A. League thresholds from the proposal's own steady-state points.
    const s1c = stage1.constant
    const s1k = stage1.casual
    const stage2Overrides: Record<string, unknown> = {}
    if (s1c && s1k) {
      const cur = thresholdsOf(cfg)
      const prop = proposeThresholds(s1k, s1c)
      if (prop.super !== cur.super) propose('leagues.weeklyThresholds.super', prop.super, `el casual (≈ ${s1k.minutesPerDay.toFixed(0)} min/día) la alcanza en ~65% de las semanas estables (percentil 35 de sus puntos semanales), hacia el final de la semana`, stage2Overrides)
      if (prop.ultra !== cur.ultra) propose('leagues.weeklyThresholds.ultra', prop.ultra, 'el constante (100 min/día) la alcanza en ~85% de las semanas estables, hacia el viernes (percentil 15 de sus puntos semanales)', stage2Overrides)
      if (prop.master !== cur.master) propose('leagues.weeklyThresholds.master', prop.master, 'el cuartil superior del constante (percentil 75 semanal) la alcanza; maratonistas y noctámbulos la superan con holgura', stage2Overrides)
    }

    proposedConfig = deepMerge(deepMerge(baseConfig as Record<string, unknown>, stage1Overrides), stage2Overrides) as GameConfigOverrides
    if (Object.keys(stage1Overrides).length + Object.keys(stage2Overrides).length > 0 || Object.keys(proposedSpecies).length > 0) {
      const ctxF = makeContext(proposedConfig, patchedSpecies)
      let speciesAfter: SpeciesAnalysis | null = null
      if (o.species) {
        log('Especies con los parches propuestos')
        speciesAfter = analyseSpecies(ctxF, runSpeciesValues(ctxF, o.speciesWeeks))
      }
      verify = { matrix: stage1, reference: runReferenceLeveling(ctxF, o.levelWeeks, Math.min(5, o.seeds)), cfg: ctxF.config, seeds: seeds1, speciesAfter }
    }
  }

  return {
    opts: o,
    ctx,
    cfg,
    baseline,
    noMissions,
    reference,
    speciesValues,
    species,
    suggestions,
    legendaryScan,
    legendaryScanTarget,
    recs,
    proposedConfig,
    proposedSpecies,
    stage1,
    verify,
    unreachable: unreachableSpecies(baseline.constant, ctx),
    seconds: (Date.now() - t0) / 1000,
  }
}

/** Mean weekly points over steady-state weeks (4+), pooled over seeds. */
export function steadyMean(a: ProfileAgg): number {
  return mean(a.steadyPool)
}

/** Species that fewer than half of the constant runs caught within the horizon, with the likely reason. */
function unreachableSpecies(constant: ProfileAgg | undefined, ctx: EngineContext): { slug: string; share: number; why: string }[] {
  if (!constant) return []
  const out: { slug: string; share: number; why: string }[] = []
  const trainerLevel = Math.round(median(constant.runs.map((r) => r.days[r.days.length - 1]?.trainerLevel ?? 1)))
  const range = wildLevelRange(trainerLevel, ctx.config)
  for (const sp of ctx.data.species) {
    const n = constant.runs.filter((r) => sp.slug in r.speciesFirstCaughtDay).length
    const share = n / constant.runs.length
    if (share >= 0.5) continue
    let why: string
    if (sp.isLegendary || sp.isMythical) why = 'legendario'
    else {
      const minL = minWildLevel(sp, ctx)
      why = minL > range.max ? `nivel salvaje mínimo ${minL} > máximo ${range.max} (entrenador nv. ${trainerLevel})` : `poco frecuente (peso de captura ${sp.captureRate})`
    }
    out.push({ slug: sp.slug, share, why })
  }
  return out.sort((a, b) => a.share - b.share)
}

