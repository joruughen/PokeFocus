/** Experiments: build contexts, run the profile matrix, the reference leveling run and species values. */
import { createEngineContext, type EngineContext, type GameConfigOverrides, type GameData, type Species } from '../../src/engine/index.ts'
import { gameData } from '../../src/data/index.ts'
import { aggregateProfile, type ProfileAgg } from './aggregate.ts'
import { PROFILE_IDS, type ProfileId } from './profiles.ts'
import { runPlayer } from './run.ts'
import { allSpeciesValues, type SpeciesValue } from './species-value.ts'
import type { PlayerMetrics } from './types.ts'

export type SpeciesPatch = Record<string, { baseStats?: Partial<Species['baseStats']>; captureRate?: number } & Record<string, unknown>>

/** Engine context with config overrides and (optionally) species base-stat patches applied in memory. */
export function makeContext(config?: GameConfigOverrides, speciesPatch?: SpeciesPatch): EngineContext {
  let data: GameData | undefined
  if (speciesPatch && Object.keys(speciesPatch).length > 0) {
    const species = gameData.species.map((s) => {
      const p = speciesPatch[s.slug]
      if (!p || (!p.baseStats && p.captureRate === undefined)) return s
      return { ...s, baseStats: { ...s.baseStats, ...(p.baseStats ?? {}) }, captureRate: p.captureRate ?? s.captureRate }
    })
    data = { ...gameData, species }
  }
  return createEngineContext({ config, data })
}

export interface MatrixOptions {
  ctx: EngineContext
  profiles: readonly ProfileId[]
  seeds: number
  /** Override the number of seeds of some profiles (e.g. more of the constant one, which most KPIs are about). */
  seedsByProfile?: Partial<Record<ProfileId, number>>
  weeks: number
  missions: boolean
  onProgress?: (label: string, done: number, total: number) => void
}

export function runMatrix(o: MatrixOptions): Record<ProfileId, ProfileAgg> {
  const out = {} as Record<ProfileId, ProfileAgg>
  const nOf = (p: ProfileId) => o.seedsByProfile?.[p] ?? o.seeds
  const total = o.profiles.reduce((a, p) => a + nOf(p), 0)
  let done = 0
  for (const profile of o.profiles) {
    const runs: PlayerMetrics[] = []
    for (let s = 1; s <= nOf(profile); s++) {
      runs.push(runPlayer({ profile, seed: s, weeks: o.weeks, ctx: o.ctx, missions: o.missions, captures: true, candies: true, soloStarter: false, detail: true }))
      o.onProgress?.(profile, ++done, total)
    }
    out[profile] = aggregateProfile(profile, runs)
  }
  return out
}

/** Reference leveling run (GDD §12.1): the starter alone, always in the team, no candies, no captures. */
export function runReferenceLeveling(ctx: EngineContext, weeks: number, seeds: number): PlayerMetrics[] {
  const runs: PlayerMetrics[] = []
  for (let s = 1; s <= seeds; s++) {
    runs.push(runPlayer({ profile: 'constant', seed: `ref${s}`, weeks, ctx, missions: false, captures: false, candies: false, soloStarter: true, detail: false }))
  }
  return runs
}

export const SPECIES_LEVELS = [30, 50] as const

export function runSpeciesValues(ctx: EngineContext, weeks: number, onProgress?: (d: number, t: number) => void): SpeciesValue[] {
  return allSpeciesValues(ctx, [...SPECIES_LEVELS], weeks, onProgress)
}

export { PROFILE_IDS }
