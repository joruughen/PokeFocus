/**
 * Outlier detection over species values (GDD §20.1, layer 3) and analytic stat
 * patches that bring outliers back into the band.
 */
import { effectiveBase, statValue, type EngineContext, type Species } from '../../src/engine/index.ts'
import { perActionCore, type SpeciesValue } from './species-value.ts'
import { median, quantile } from './util.ts'

export type Group = 's1' | 's2' | 's3' | 'legend'

export const GROUP_LABEL: Record<Group, string> = { s1: 'Etapa 1', s2: 'Etapa 2', s3: 'Etapa 3', legend: 'Legendarios' }

/** A species is flagged when it is further than this from its stage median. */
export const OUTLIER_BAND = 0.4
/** Hard outliers are patched towards this deviation (inside the band, with a margin). */
export const PATCH_TARGET = 0.3
/** Finals below the p25 and this far under the median are raised to LOW_FINAL_TARGET. */
export const LOW_FINAL_TRIGGER = -0.25
export const LOW_FINAL_TARGET = -0.2
export const LEGEND_MIN_RATIO = 1.0
export const LEGEND_MAX_RATIO = 1.6
/** A species that evolves by level before this level is never played at it. */
export const TRANSIENT_BELOW = 30

export interface SpeciesRow {
  slug: string
  species: Species
  group: Group
  isFinal: boolean
  /** Evolves by level before nv. 30: its nv. 30/50 value is hypothetical. */
  transient: boolean
  v30: SpeciesValue
  v50: SpeciesValue
  /** ptsDay / median of its group − 1 (for legendaries: vs the finals' median). */
  dev30: number
  dev50: number
  flags: string[]
  hard: boolean
}

export interface SpeciesAnalysis {
  rows: SpeciesRow[]
  medians: Record<Group, { 30: number; 50: number }>
  finalsMedian: { 30: number; 50: number }
  finalsP25: { 30: number; 50: number }
  /** Lines where an evolution does not beat its previous stage by ≥ 10 %. */
  weakEvolutions: { from: string; to: string; level: number; ratio: number }[]
}

export function groupOf(sp: Species): Group {
  return sp.isLegendary || sp.isMythical ? 'legend' : sp.stage === 1 ? 's1' : sp.stage === 2 ? 's2' : 's3'
}

export function transientLevel(sp: Species): number | null {
  const lv = sp.evolutions.filter((e) => e.trigger === 'level' && e.minLevel !== undefined && e.minLevel < TRANSIENT_BELOW).map((e) => e.minLevel as number)
  return lv.length ? Math.min(...lv) : null
}

interface Pt {
  30: number
  50: number
}

const pc = (d: number) => `${d >= 0 ? '+' : ''}${Math.round(d * 100)}%`

/** Medians, finals p25 and per-species deviations for a table of points/day. */
function evaluate(species: Species[], pts: Map<string, Pt>) {
  const medians = {} as Record<Group, Pt>
  const finals = species.filter((s) => groupOf(s) !== 'legend' && s.evolutions.length === 0)
  const f = (list: Species[], l: 30 | 50) => list.map((s) => (pts.get(s.slug) as Pt)[l])
  const finalsMedian: Pt = { 30: median(f(finals, 30)), 50: median(f(finals, 50)) }
  const finalsP25: Pt = { 30: quantile(f(finals, 30), 0.25), 50: quantile(f(finals, 50), 0.25) }
  for (const g of ['s1', 's2', 's3', 'legend'] as Group[]) {
    const list = species.filter((s) => groupOf(s) === g)
    medians[g] = g === 'legend' ? finalsMedian : { 30: median(f(list, 30)), 50: median(f(list, 50)) }
  }
  const per = new Map<string, { dev30: number; dev50: number; flags: string[]; hard: boolean; isFinal: boolean }>()
  for (const sp of species) {
    const g = groupOf(sp)
    const p = pts.get(sp.slug) as Pt
    const dev30 = p[30] / medians[g][30] - 1
    const dev50 = p[50] / medians[g][50] - 1
    const isFinal = g !== 'legend' && sp.evolutions.length === 0
    const flags: string[] = []
    let hard = false
    if (g === 'legend') {
      const lo = Math.min(dev30, dev50)
      const hi = Math.max(dev30, dev50)
      if (lo < LEGEND_MIN_RATIO - 1) {
        flags.push(`legendario bajo los finales (${pc(lo)})`)
        hard = true
      }
      if (hi > LEGEND_MAX_RATIO - 1) {
        flags.push(`legendario sobre el techo (${pc(hi)})`)
        hard = true
      }
    } else {
      if (dev30 > OUTLIER_BAND || dev50 > OUTLIER_BAND) {
        flags.push(`alto ${pc(Math.max(dev30, dev50))}`)
        hard = true
      }
      if (dev30 < -OUTLIER_BAND || dev50 < -OUTLIER_BAND) {
        flags.push(`bajo ${pc(Math.min(dev30, dev50))}`)
        hard = true
      }
      if (isFinal && (p[30] < finalsP25[30] || p[50] < finalsP25[50])) flags.push('final < p25')
    }
    const tl = transientLevel(sp)
    if (tl !== null && hard) flags.push(`transitoria: evoluciona a nv. ${tl}`)
    per.set(sp.slug, { dev30, dev50, flags, hard, isFinal })
  }
  return { medians, finalsMedian, finalsP25, per }
}

export function analyseSpecies(ctx: EngineContext, values: SpeciesValue[]): SpeciesAnalysis {
  const at = (slug: string, level: number) => values.find((v) => v.slug === slug && v.level === level) as SpeciesValue
  const species = ctx.data.species
  const pts = new Map<string, Pt>(species.map((s) => [s.slug, { 30: at(s.slug, 30).ptsDay, 50: at(s.slug, 50).ptsDay }]))
  const ev = evaluate(species, pts)
  const rows: SpeciesRow[] = species.map((sp) => {
    const e = ev.per.get(sp.slug) as NonNullable<ReturnType<typeof ev.per.get>>
    return { slug: sp.slug, species: sp, group: groupOf(sp), isFinal: e.isFinal, transient: transientLevel(sp) !== null, v30: at(sp.slug, 30), v50: at(sp.slug, 50), dev30: e.dev30, dev50: e.dev50, flags: e.flags, hard: e.hard }
  })
  const weakEvolutions: SpeciesAnalysis['weakEvolutions'] = []
  for (const sp of species) {
    for (const e of sp.evolutions) {
      const to = ctx.speciesById.get(e.to)
      if (!to) continue
      for (const level of [30, 50] as const) {
        const ratio = (pts.get(to.slug) as Pt)[level] / (pts.get(sp.slug) as Pt)[level]
        if (ratio < 1.1) weakEvolutions.push({ from: sp.slug, to: to.slug, level, ratio })
      }
    }
  }
  return { rows, medians: ev.medians, finalsMedian: ev.finalsMedian, finalsP25: ev.finalsP25, weakEvolutions }
}

export interface SpeciesSuggestion {
  slug: string
  from: number
  to: number
  /** Worse deviation of the two levels vs the group median, before and after all patches. */
  devBefore: number
  devAfter: number
  reason: string
  /** The change moves Rendimiento by more than 30 points: look for another lever. */
  large: boolean
  /** Equivalent change on Ritmo (Speed) when the species is not energy-limited, for large changes. */
  alt: string | null
}

/**
 * Analytic patches on the base Sp. Atk (Rendimiento). With the same dice the
 * points of a day are exactly proportional to the per-action points
 * `5 + SpAtk/4`, so the new base follows from the ratio needed and the medians
 * can be recomputed without simulating again. Three passes — lows, highs, both —
 * so that raising weak species can bring a "high" one back into the band by
 * itself. Species that evolve by level before nv. 30 are left alone.
 */
export function suggestSpeciesPatches(ctx: EngineContext, a: SpeciesAnalysis): SpeciesSuggestion[] {
  const species = ctx.data.species
  const orig = new Map(a.rows.map((r) => [r.slug, { 30: r.v30.ptsDay, 50: r.v50.ptsDay, base: r.species.baseStats.specialAttack }]))
  const work = new Map<string, Pt>(a.rows.map((r) => [r.slug, { 30: r.v30.ptsDay, 50: r.v50.ptsDay }]))
  const base = new Map(a.rows.map((r) => [r.slug, r.species.baseStats.specialAttack]))
  const scale = (slug: string, newBase: number): Pt => {
    const o = orig.get(slug) as { 30: number; 50: number; base: number }
    return { 30: (o[30] * perActionCore(ctx, newBase, 30)) / perActionCore(ctx, o.base, 30), 50: (o[50] * perActionCore(ctx, newBase, 50)) / perActionCore(ctx, o.base, 50) }
  }
  for (const mode of ['low', 'high', 'both'] as const) {
    const ev = evaluate(species, work)
    for (const sp of species) {
      if (transientLevel(sp) !== null) continue
      const e = ev.per.get(sp.slug) as NonNullable<ReturnType<typeof ev.per.get>>
      const g = groupOf(sp)
      const mean = (e.dev30 + e.dev50) / 2
      let target: number | null = null
      if (g === 'legend') {
        if (e.hard) target = mean < 0 ? LEGEND_MIN_RATIO - 1 + 0.1 : LEGEND_MAX_RATIO - 1 - 0.1
      } else if (e.hard) target = mean > 0 ? PATCH_TARGET : -PATCH_TARGET
      else if (e.flags.includes('final < p25') && mean < LOW_FINAL_TRIGGER) target = LOW_FINAL_TARGET
      if (target === null) continue
      if (mode === 'low' && mean >= 0) continue
      if (mode === 'high' && mean <= 0) continue
      const cur = base.get(sp.slug) as number
      const curPts = work.get(sp.slug) as Pt
      // The worse of the two levels must land on the target (lows: the lower one; highs: the higher one).
      const high = mean > 0
      const extreme = (d30: number, d50: number) => (high ? Math.max(d30, d50) : Math.min(d30, d50))
      let best = cur
      let bestErr = Infinity
      for (let b = 20; b <= 135; b++) {
        const sc = scale(sp.slug, b)
        const err = Math.abs(extreme((1 + e.dev30) * (sc[30] / curPts[30]) - 1, (1 + e.dev50) * (sc[50] / curPts[50]) - 1) - target) + (b % 5 === 0 ? 0 : 0.004)
        if (err < bestErr) {
          bestErr = err
          best = b
        }
      }
      if (best === cur) continue
      base.set(sp.slug, best)
      work.set(sp.slug, scale(sp.slug, best))
    }
  }
  const final = evaluate(species, work)
  const out: SpeciesSuggestion[] = []
  for (const r of a.rows) {
    const to = base.get(r.slug) as number
    const from = r.species.baseStats.specialAttack
    if (to === from) continue
    const f = final.per.get(r.slug) as NonNullable<ReturnType<typeof final.per.get>>
    const high = r.dev30 + r.dev50 > 0
    const ext = (a: number, b: number) => (high ? Math.max(a, b) : Math.min(a, b))
    const devBefore = ext(r.dev30, r.dev50)
    const devAfter = ext(f.dev30, f.dev50)
    const ref = r.group === 'legend' ? 'los finales' : GROUP_LABEL[r.group].toLowerCase()
    const large = Math.abs(to - from) > 30
    out.push({
      slug: r.slug,
      from,
      to,
      devBefore,
      devAfter,
      large,
      alt: large ? speedAlternative(ctx, r, (1 + devAfter) / (1 + devBefore)) : null,
      reason: `${pc(devBefore)} frente a la mediana de ${ref}; Rendimiento (Atq. Esp.) ${from}→${to} lo deja en ${pc(devAfter)}`,
    })
  }
  return out
}

/**
 * Same effect through Ritmo: while not energy-limited, actions per day are
 * proportional to 60 + the Speed stat, so the base that scales the actions by
 * `need` is found by scanning.
 */
function speedAlternative(ctx: EngineContext, r: SpeciesRow, need: number): string | null {
  if (Math.max(r.v30.exhaustedShare, r.v50.exhaustedShare) >= 0.2) return null
  const cur = r.species.baseStats.speed
  const act = (b: number, level: number) => 60 + statValue('speed', effectiveBase('speed', b, ctx.config), 15, level, 1)
  let best = cur
  let bestErr = Infinity
  for (let b = 20; b <= 150; b++) {
    const k = (act(b, 30) / act(cur, 30) + act(b, 50) / act(cur, 50)) / 2
    const err = Math.abs(k - need)
    if (err < bestErr) {
      bestErr = err
      best = b
    }
  }
  return best === cur ? null : `Ritmo (Vel.) ${cur}→${best}`
}
