/** Pure summary of a multi-release: what the confirmation dialog shows (candies per line, warnings). */
import { defaultContext, releaseCandyGain, type EngineContext, type PlayerState, type Species } from '../../../engine'
import { lineRoot } from '../shared/EvoLine'

/** From this level up a Pokémon gets a "high level" warning before being released. */
export const HIGH_LEVEL_RELEASE = 30

export interface ReleaseChainLine {
  chainId: string
  /** Species slug of the root of the line (its name and icon). */
  rootSlug: string
  /** How many of the selection belong to this line. */
  count: number
  candies: number
}

export type ReleaseWarningKind = 'shiny' | 'legendary' | 'nickname' | 'highLevel' | 'preset'

export interface ReleaseWarning {
  kind: ReleaseWarningKind
  /** uids that trigger it, in selection order. */
  uids: string[]
}

export interface ReleaseSummary {
  /** Selected uids that exist and are not in the team, in selection order. */
  uids: string[]
  count: number
  totalCandies: number
  /** One row per evolution line, most candies first. */
  chains: ReleaseChainLine[]
  /** Only the kinds that apply, in a fixed order (shiny first). */
  warnings: ReleaseWarning[]
  /** Selected uids that cannot be released now (team member or gone): the request would fail with them. */
  blocked: string[]
}

const ORDER: ReleaseWarningKind[] = ['shiny', 'legendary', 'preset', 'nickname', 'highLevel']

export function releaseSummary(player: PlayerState, selected: readonly string[], ctx: EngineContext = defaultContext()): ReleaseSummary {
  const uids: string[] = []
  const blocked: string[] = []
  const chains = new Map<string, ReleaseChainLine>()
  const flags: Record<ReleaseWarningKind, string[]> = { shiny: [], legendary: [], nickname: [], highLevel: [], preset: [] }
  const inPreset = new Set((player.teamPresets ?? []).flatMap((p) => p.uids))
  let totalCandies = 0
  for (const uid of new Set(selected)) {
    const p = player.pokemon[uid]
    const sp: Species | undefined = p ? ctx.speciesBySlug.get(p.speciesSlug) : undefined
    if (!p || !sp || player.team.includes(uid)) {
      blocked.push(uid)
      continue
    }
    uids.push(uid)
    const { chainId, gain } = releaseCandyGain(p.speciesSlug, ctx)
    const line = chains.get(chainId) ?? { chainId, rootSlug: lineRoot(sp).slug, count: 0, candies: 0 }
    line.count++
    line.candies += gain
    chains.set(chainId, line)
    totalCandies += gain
    if (p.isShiny) flags.shiny.push(uid)
    if (sp.isLegendary || sp.isMythical) flags.legendary.push(uid)
    if (p.nickname) flags.nickname.push(uid)
    if (p.level >= HIGH_LEVEL_RELEASE) flags.highLevel.push(uid)
    if (inPreset.has(uid)) flags.preset.push(uid)
  }
  return {
    uids,
    count: uids.length,
    totalCandies,
    chains: [...chains.values()].sort((a, b) => b.candies - a.candies || a.chainId.localeCompare(b.chainId, 'en', { numeric: true })),
    warnings: ORDER.filter((k) => flags[k].length > 0).map((kind) => ({ kind, uids: flags[kind] })),
    blocked,
  }
}
