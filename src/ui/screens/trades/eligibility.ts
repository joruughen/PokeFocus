/**
 * Trades (GDD §12.8), pure UI logic: which friends can trade, which of my
 * Pokémon can be offered (and why not), and the warnings before confirming.
 * The server re-checks everything; this only explains it up front.
 */
import {
  defaultContext,
  inSavedTeam,
  isLegendaryOrMythical,
  levelCap,
  tradeBlock,
  tradeCost,
  tradeEvolution,
  tradesToday,
  type EngineContext,
  type IndividualCore,
  type PlayerState,
  type TradeBlock,
} from '../../../engine'
import type { FriendSummary, TradeOfferView, TradePokemonView, TradesResponse } from '../../../game/protocol'

const DAY_MS = 86_400_000

export type FriendTradeState = { ok: true } | { ok: false; reason: 'not_friend' } | { ok: false; reason: 'too_new'; readyAt: number }

/** Can I trade with this friend now? Needs `trade.minFriendshipDays` of accepted friendship. */
export function friendTradeState(f: FriendSummary, now: number, ctx: EngineContext = defaultContext()): FriendTradeState {
  if (f.status !== 'friend' || f.friendsSince === undefined) return { ok: false, reason: 'not_friend' }
  const readyAt = f.friendsSince + ctx.config.trade.minFriendshipDays * DAY_MS
  return now >= readyAt ? { ok: true } : { ok: false, reason: 'too_new', readyAt }
}

export type OfferBlock = TradeBlock | 'in_offer'

export interface OfferOption {
  uid: string
  /** Why it cannot be offered, or null. */
  block: OfferBlock | null
  /** Saved teams it is in (it can be offered; it will show as missing there). */
  savedTeams: string[]
}

/** Every Pokémon of mine with whether it can be offered (or given back) right now. */
export function offerOptions(player: PlayerState, lockedUids: readonly string[], ctx: EngineContext = defaultContext()): OfferOption[] {
  const locked = new Set(lockedUids)
  return Object.keys(player.pokemon).map((uid) => {
    const block = tradeBlock(player, uid, ctx) ?? (locked.has(uid) ? 'in_offer' : null)
    return { uid, block, savedTeams: inSavedTeam(player, uid) }
  })
}

export type TradeWarning =
  | { kind: 'evolves'; to: string }
  | { kind: 'overLevelCap'; cap: number }
  | { kind: 'legendaryOnce' }
  | { kind: 'savedTeam'; teams: string[] }
  | { kind: 'notEnoughDust'; cost: number; have: number }
  | { kind: 'dailyLimit'; limit: number }

/**
 * Warnings for me before confirming a trade where I give `give` (one of my uids, optional while
 * picking) and receive `get`. `blocking` ones make the server refuse it.
 */
export function tradeWarnings(
  player: PlayerState,
  get: Pick<TradePokemonView, 'speciesSlug' | 'level' | 'isShiny'>,
  give: string | null,
  now: number,
  ctx: EngineContext = defaultContext(),
): { warnings: TradeWarning[]; blocking: boolean } {
  const out: TradeWarning[] = []
  let blocking = false
  const to = tradeEvolution(get.speciesSlug, ctx)
  if (to) out.push({ kind: 'evolves', to })
  const cap = levelCap(player, ctx)
  if (get.level > cap) {
    out.push({ kind: 'overLevelCap', cap })
    blocking = true
  }
  const mine = give ? player.pokemon[give] : undefined
  if (isLegendaryOrMythical(get.speciesSlug, ctx) || (mine && isLegendaryOrMythical(mine.speciesSlug, ctx))) out.push({ kind: 'legendaryOnce' })
  if (give) {
    const teams = inSavedTeam(player, give)
    if (teams.length > 0) out.push({ kind: 'savedTeam', teams })
  }
  if (mine) {
    const cost = tradeCost(mine, get, ctx)
    if (player.dust < cost) {
      out.push({ kind: 'notEnoughDust', cost, have: player.dust })
      blocking = true
    }
  }
  const limit = ctx.config.trade.dailyLimit
  if (tradesToday(player, now) >= limit) {
    out.push({ kind: 'dailyLimit', limit })
    blocking = true
  }
  return { warnings: out, blocking }
}

/** Dust each side pays (the dearer of the two). */
export function previewCost(a: Pick<IndividualCore, 'speciesSlug' | 'isShiny'>, b: Pick<IndividualCore, 'speciesSlug' | 'isShiny'>, ctx: EngineContext = defaultContext()): number {
  return tradeCost(a, b, ctx)
}

/** Offers waiting for me (badge): received and not answered, or my offers with a counter to confirm. */
export function pendingCount(r: Pick<TradesResponse, 'incoming' | 'outgoing'> | null): number {
  if (!r) return 0
  return [...r.incoming, ...r.outgoing].filter((o: TradeOfferView) => o.myTurn).length
}
