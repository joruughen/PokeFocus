/**
 * Support grants (docs/admin-plan.md §4, delivery E11). A pure reducer on the game doc, deliberately NOT
 * part of the client-facing `GameAction` union: only `POST /api/admin/players/:id/grant` can reach it.
 * Positive amounts only (a grant never takes anything away), with hard per-request caps.
 */
import { defaultContext, type EngineContext } from '../engine'
import { GIFT_MESSAGE_MAX, type GameDoc, type LocalizedNote } from './protocol'

/** Per-request caps. Generous for a lost-reward fix, too small to mint an account. */
export const ADMIN_GRANT_LIMITS = {
  /** Different item kinds in one request. */
  maxItemKinds: 10,
  /** Units of one item. */
  maxPerItem: 50,
  /** Dust in one request. */
  maxDust: 5_000,
  reasonMin: 5,
  reasonMax: 280,
  /** Gift messages a player can have waiting at once (older ones go first). */
  maxPendingGifts: 10,
} as const

export interface AdminGrant {
  /** Item slug → units (balls, potions, stones…). */
  items?: Record<string, number>
  dust?: number
  /** A short plain-text message the player sees in a window (`PlayerState.pendingGifts`). Needs `at`. */
  message?: LocalizedNote
  /** When the gift was made (epoch ms): the clock is the caller's, the reducer never reads it. */
  at?: number
}

export type AdminGrantError = 'no_player' | 'empty_grant' | 'unknown_item' | 'invalid_amount' | 'too_many_items' | 'amount_too_large' | 'invalid_message'

export type AdminGrantResult = { ok: true; doc: GameDoc; applied: { items: Record<string, number>; dust: number } } | { ok: false; error: AdminGrantError }

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

/** Check a grant against the caps and the item catalogue (no doc needed). `null` = acceptable. */
export function checkAdminGrant(grant: AdminGrant, ctx: EngineContext = defaultContext()): AdminGrantError | null {
  const entries = Object.entries(grant.items ?? {})
  if (entries.length === 0 && grant.dust === undefined) return 'empty_grant'
  if (entries.length > ADMIN_GRANT_LIMITS.maxItemKinds) return 'too_many_items'
  const known = new Set(ctx.data.items.map((i) => i.slug))
  for (const [slug, n] of entries) {
    if (!known.has(slug)) return 'unknown_item'
    if (!isCount(n)) return 'invalid_amount'
    if (n > ADMIN_GRANT_LIMITS.maxPerItem) return 'amount_too_large'
  }
  if (grant.dust !== undefined) {
    if (!isCount(grant.dust)) return 'invalid_amount'
    if (grant.dust > ADMIN_GRANT_LIMITS.maxDust) return 'amount_too_large'
  }
  if (grant.message !== undefined && !isGiftMessage(grant.message)) return 'invalid_message'
  return null
}

const okText = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= GIFT_MESSAGE_MAX && !/[<>\u0000-\u001f\u007f]/.test(s)
/** At least one of es/en, each plain text within the limit (no `<`, `>` or control characters), nothing else. */
const isGiftMessage = (m: LocalizedNote): boolean => {
  const keys = Object.keys(m)
  return keys.length > 0 && keys.every((k) => (k === 'es' || k === 'en') && okText((m as Record<string, unknown>)[k]))
}

/** Add the granted items and dust to the player's state. Never reads the clock or the RNG. */
export function applyAdminGrant(doc: GameDoc, grant: AdminGrant, ctx: EngineContext = defaultContext()): AdminGrantResult {
  const p = doc.player
  if (!p) return { ok: false, error: 'no_player' }
  const error = checkAdminGrant(grant, ctx)
  if (error) return { ok: false, error }
  const items = grant.items ?? {}
  const dust = grant.dust ?? 0
  const inventory = { ...p.inventory }
  for (const [slug, n] of Object.entries(items)) inventory[slug] = (inventory[slug] ?? 0) + n
  // With a message the gift also queues a window; without one it is silent (as always).
  const gifts = grant.message ? [...(p.pendingGifts ?? []), { items: { ...items }, dust, message: { ...grant.message }, at: grant.at ?? 0 }].slice(-ADMIN_GRANT_LIMITS.maxPendingGifts) : p.pendingGifts
  return { ok: true, doc: { ...doc, player: { ...p, inventory, dust: p.dust + dust, ...(gifts && { pendingGifts: gifts }) } }, applied: { items: { ...items }, dust } }
}
