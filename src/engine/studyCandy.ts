/**
 * Partner candies (GDD §12.2): studying with a team gives candies of the lines of its Pokémon, so a line that
 * almost never shows up in the wild (a starter) still gets the candies to evolve.
 *
 * The first `perDay` valid sessions of a local day of at least `minMinutes` give every distinct evolution line
 * of the session team `amount` candies; the line of the leader (slot 0) gets `amount + leaderBonus`. Two
 * Pokémon of the same line count once (the larger amount), so stacking duplicates gains nothing.
 */
import { defaultContext, getSpecies, type EngineContext } from './context'
import type { PlayerState } from './state'

export interface StudyCandyGrant {
  /** Evolution chain id (key of `candies.chains`). */
  chainId: string
  /** Species of the first team member of that line (for the name and sprite). */
  speciesSlug: string
  amount: number
  /** The line of the team leader. */
  leader: boolean
}

/** What the session of `result` earns today, given how many sessions of the day already did (`state.days`). */
export function studyCandyDue(
  state: PlayerState,
  result: { valid: boolean; minutes: number; rewardFactor: number; dayKey: string },
  ctx: EngineContext = defaultContext(),
): boolean {
  const sc = ctx.config.progression.studyCandy
  if (sc.amount <= 0 && sc.leaderBonus <= 0) return false
  if (!result.valid || result.rewardFactor <= 0 || result.minutes < sc.minMinutes) return false
  return (state.days[result.dayKey]?.candySessions ?? 0) < sc.perDay
}

/** Candies per evolution line of the team (leader first). Members that no longer exist are skipped. */
export function studyCandyGrants(state: PlayerState, teamUids: readonly string[], ctx: EngineContext = defaultContext()): StudyCandyGrant[] {
  const sc = ctx.config.progression.studyCandy
  const byChain = new Map<string, StudyCandyGrant>()
  const leaderUid = teamUids[0]
  for (const uid of teamUids) {
    const p = state.pokemon[uid]
    if (!p) continue
    const chainId = String(getSpecies(p.speciesSlug, ctx).evolutionChainId)
    const isLeader = uid === leaderUid
    const amount = sc.amount + (isLeader ? sc.leaderBonus : 0)
    const have = byChain.get(chainId)
    if (!have) byChain.set(chainId, { chainId, speciesSlug: p.speciesSlug, amount, leader: isLeader })
    else if (amount > have.amount) byChain.set(chainId, { ...have, amount, leader: have.leader || isLeader })
  }
  return [...byChain.values()].filter((g) => g.amount > 0)
}
