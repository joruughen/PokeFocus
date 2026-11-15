/**
 * /api/trades — trades between friends (GDD §12.8). Contract: src/game/protocol.ts «Trades».
 *
 * Flow: A offers one Pokémon to B (`offered`) → B picks one to give back
 * (`countered`, B's confirmation) → A accepts (`completed`) or rejects. Either
 * side can close an open offer (A cancels, B rejects) and an open offer lapses
 * `trade.offerTtlHours` after it was made or countered (`expired`, swept lazily).
 *
 * Rules are re-checked at every step and again, all of them, when the trade
 * completes. Completing changes two player docs: both are locked `FOR UPDATE` in
 * user-id order (no deadlocks; the other routes lock at most one doc, always
 * before the offer row), then the offer row; both sides are applied or none.
 * Every change publishes `{ type: 'trade' }` to both players (and `game` on completion).
 */
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { and, desc, eq, inArray, lte, or } from 'drizzle-orm'
import {
  applyTrade,
  createRng,
  defaultContext,
  equippableMoves,
  normalizeTradeMessage,
  receiveBlock,
  tradeBlock,
  tradeCost,
  tradesToday,
  type EngineContext,
  type OwnedPokemon,
  type PlayerState,
} from '../../src/engine'
import type { GameDoc, ServerEvent, TradeOfferView, TradePokemonView, TradesResponse, TradeStatus } from '../../src/game/protocol'
import type { Db, Tx } from '../db/client'
import { isUniqueViolation } from '../db/client'
import { friendships, playerDocs, tradeOffers, users, type TradeOfferRow } from '../db/schema'
import { ApiError, gameTime, readBody, requireAuth, UUID_RE, type AppEnv, type Ctx, type Deps } from '../http'
import { localeOf } from '../push'
import { RULES } from '../rate-limit'
import { tradeCounterBody, tradeOfferBody } from '../validation'

const OPEN: TradeStatus[] = ['offered', 'countered']
const HISTORY_SIZE = 50
const DAY_MS = 86_400_000

type Ex = Db | Tx
type Side = 'me' | 'partner'
type Pending = { to: string; event: ServerEvent }

/** The other player's view of a Pokémon (no nickname). */
export function tradeSnapshot(p: OwnedPokemon, ctx: EngineContext = defaultContext()): TradePokemonView {
  const v: TradePokemonView = {
    uid: p.uid,
    speciesSlug: p.speciesSlug,
    level: p.level,
    ivs: { ...p.ivs },
    nature: p.nature,
    ability: p.ability,
    isShiny: p.isShiny,
    equippedMoves: [...p.equippedMoves],
    moves: equippableMoves(p, ctx),
    moveMasteryMinutes: { ...p.moveMasteryMinutes },
  }
  if (p.traded) v.traded = { ...p.traded }
  return v
}

/** Accepted friendship between two users: since when (ms), or null if they are not friends. */
export async function friendsSince(ex: Ex, a: string, b: string): Promise<number | null> {
  const [r] = await ex
    .select({ status: friendships.status, createdAt: friendships.createdAt, acceptedAt: friendships.acceptedAt })
    .from(friendships)
    .where(or(and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)), and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a))))
  if (!r || r.status !== 'accepted') return null
  return (r.acceptedAt ?? r.createdAt).getTime()
}

/** Close every open offer between two users (they stopped being friends). Returns the events to publish. */
export async function cancelTradesBetween(ex: Ex, a: string, b: string, now: number, actor: { id: string; trainerName: string }): Promise<Pending[]> {
  const rows = await ex
    .update(tradeOffers)
    .set({ status: 'cancelled', closedBy: actor.id, updatedAt: new Date(now) })
    .where(
      and(
        inArray(tradeOffers.status, OPEN),
        or(and(eq(tradeOffers.fromUserId, a), eq(tradeOffers.toUserId, b)), and(eq(tradeOffers.fromUserId, b), eq(tradeOffers.toUserId, a))),
      ),
    )
    .returning()
  return rows.flatMap((r) => eventsFor(r, actor))
}

function eventsFor(r: TradeOfferRow, actor: { id: string; trainerName: string }): Pending[] {
  const event: ServerEvent = { type: 'trade', offerId: r.id, status: r.status, userId: actor.id, trainerName: actor.trainerName }
  return [
    { to: r.fromUserId, event },
    { to: r.toUserId, event },
  ]
}

export function tradeRoutes(deps: Deps) {
  const { db, bus, limiter } = deps
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth(deps))
  const cfg = () => defaultContext().config.trade

  const limit = (c: Ctx, rule: (typeof RULES)[keyof typeof RULES], key: string) => {
    const r = limiter.hit(key, rule)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      throw new ApiError(429, 'rate_limited', { retryAfter: r.retryAfter })
    }
  }
  const offerId = (c: Ctx): string => {
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found')
    return id
  }
  const fail = (code: string, side?: Side): never => {
    throw new ApiError(409, code, side ? { side } : undefined)
  }
  const publish = (events: Pending[]) => {
    for (const e of events) bus.publish(e.to, e.event)
  }
  /** Best-effort Web Push to the player whose turn it is (no-op without VAPID keys or subscriptions). */
  const pushTurn = (to: string, doc: GameDoc | null, who: string, kind: 'offered' | 'countered') => {
    if (!deps.push.enabled) return
    const es = localeOf(doc) === 'es'
    const body =
      kind === 'offered'
        ? es
          ? `${who} te ofrece un intercambio.`
          : `${who} offers you a trade.`
        : es
          ? `${who} eligió qué darte a cambio. Confirma el intercambio.`
          : `${who} picked what to give you back. Confirm the trade.`
    void deps.push
      .sendToUser(to, { type: 'trade', title: es ? 'Intercambio' : 'Trade', body, tag: 'pokefocus-trade', url: '/#/trades' })
      .catch(() => {})
  }

  /** Lock a player doc row (FOR UPDATE) and return its player (409 no_player if none). */
  const lockPlayer = async (tx: Tx, userId: string, side: Side) => {
    const [row] = await tx.select().from(playerDocs).where(eq(playerDocs.userId, userId)).for('update')
    if (!row?.doc.player) fail('no_player', side)
    return row!
  }
  const readPlayer = async (ex: Ex, userId: string): Promise<PlayerState | null> => {
    const [row] = await ex.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, userId))
    return row?.doc.player ?? null
  }
  const lockOffer = async (tx: Tx, id: string): Promise<TradeOfferRow> => {
    const [r] = await tx.select().from(tradeOffers).where(eq(tradeOffers.id, id)).for('update')
    if (!r) throw new ApiError(404, 'not_found')
    return r
  }
  /** The friendship must exist and be old enough. */
  const checkFriendship = async (ex: Ex, a: string, b: string, now: number) => {
    const since = await friendsSince(ex, a, b)
    if (since === null) fail('not_friends')
    if (now - since! < cfg().minFriendshipDays * DAY_MS) throw new ApiError(409, 'friendship_too_new', { readyAt: since! + cfg().minFriendshipDays * DAY_MS })
  }
  /** Is this uid of `userId` already in an open offer (as offer or counter)? */
  const inOpenOffer = async (ex: Ex, userId: string, uid: string): Promise<boolean> => {
    const rows = await ex
      .select({ id: tradeOffers.id })
      .from(tradeOffers)
      .where(
        or(
          and(eq(tradeOffers.fromUserId, userId), eq(tradeOffers.offerUid, uid), inArray(tradeOffers.status, OPEN)),
          and(eq(tradeOffers.toUserId, userId), eq(tradeOffers.counterUid, uid), eq(tradeOffers.status, 'countered')),
        ),
      )
      .limit(1)
    return rows.length > 0
  }
  /** Mark the caller's lapsed open offers `expired` (lazy sweep, its own statement) and notify both sides. */
  const sweep = async (me: { id: string; trainerName: string }, now: number) => {
    const rows = await db
      .update(tradeOffers)
      .set({ status: 'expired', updatedAt: new Date(now) })
      .where(and(inArray(tradeOffers.status, OPEN), lte(tradeOffers.expiresAt, new Date(now)), or(eq(tradeOffers.fromUserId, me.id), eq(tradeOffers.toUserId, me.id))))
      .returning()
    publish(rows.flatMap((r) => eventsFor(r, me)))
  }
  const namesOf = async (ex: Ex, ids: string[]) => {
    const list = [...new Set(ids)]
    if (list.length === 0) return new Map<string, string>()
    const rows = await ex.select({ id: users.id, name: users.trainerName }).from(users).where(inArray(users.id, list))
    return new Map(rows.map((r) => [r.id, r.name]))
  }

  /**
   * View of an offer for `me`. Open offers show the Pokémon as they are now in their owners' docs
   * (`players`), with `missing` when one is gone; closed ones show the stored snapshots.
   */
  const view = (r: TradeOfferRow, me: string, names: Map<string, string>, players?: Map<string, PlayerState | null>): TradeOfferView => {
    const sender = r.fromUserId === me
    const partnerId = sender ? r.toUserId : r.fromUserId
    const open = OPEN.includes(r.status)
    const live = (userId: string, uid: string | null, snap: TradePokemonView | null): TradePokemonView | null => {
      if (!snap) return null
      if (!open || !players || !uid) return snap
      const p = players.get(userId)?.pokemon[uid]
      return p ? tradeSnapshot(p) : { ...snap, missing: true }
    }
    const offer = live(r.fromUserId, r.offerUid, r.offerSnapshot)!
    const counter = live(r.toUserId, r.counterUid, r.counterSnapshot ?? null)
    return {
      id: r.id,
      status: r.status,
      role: sender ? 'sender' : 'receiver',
      partner: { userId: partnerId, trainerName: names.get(partnerId) ?? '?' },
      offer,
      counter,
      message: r.message,
      dustCost: r.dustCost ?? (counter ? tradeCost(offer, counter) : null),
      offerEvolvedTo: r.offerEvolvedTo,
      counterEvolvedTo: r.counterEvolvedTo,
      myTurn: (r.status === 'offered' && !sender) || (r.status === 'countered' && sender),
      closedByMe: r.closedBy === me,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      expiresAt: r.expiresAt.getTime(),
      completedAt: r.completedAt ? r.completedAt.getTime() : null,
    }
  }
  /** One offer's view for the caller after a write. */
  const viewOne = async (r: TradeOfferRow, me: string) => {
    const names = await namesOf(db, [r.fromUserId, r.toUserId])
    const players = new Map<string, PlayerState | null>([
      [r.fromUserId, await readPlayer(db, r.fromUserId)],
      [r.toUserId, await readPlayer(db, r.toUserId)],
    ])
    return view(r, me, names, players)
  }

  app.get('/', async (c) => {
    const me = c.get('user')
    const now = gameTime(deps, c)
    await sweep(me, now)
    const mine = or(eq(tradeOffers.fromUserId, me.id), eq(tradeOffers.toUserId, me.id))
    const open = await db.select().from(tradeOffers).where(and(mine, inArray(tradeOffers.status, OPEN))).orderBy(desc(tradeOffers.updatedAt))
    const closed = await db
      .select()
      .from(tradeOffers)
      .where(and(mine, inArray(tradeOffers.status, ['completed', 'rejected', 'cancelled', 'expired'])))
      .orderBy(desc(tradeOffers.updatedAt))
      .limit(HISTORY_SIZE)
    const others = [...open, ...closed].map((r) => (r.fromUserId === me.id ? r.toUserId : r.fromUserId))
    const names = await namesOf(db, others)
    const ids = [...new Set([me.id, ...open.map((r) => (r.fromUserId === me.id ? r.toUserId : r.fromUserId))])]
    const docs = await db.select({ userId: playerDocs.userId, doc: playerDocs.doc }).from(playerDocs).where(inArray(playerDocs.userId, ids))
    const players = new Map<string, PlayerState | null>(docs.map((d) => [d.userId, d.doc.player]))
    const myPlayer = players.get(me.id) ?? null
    const lockedUids = open.flatMap((r) => (r.fromUserId === me.id ? [r.offerUid] : r.status === 'countered' && r.counterUid ? [r.counterUid] : []))
    const body: TradesResponse = {
      incoming: open.filter((r) => r.toUserId === me.id).map((r) => view(r, me.id, names, players)),
      outgoing: open.filter((r) => r.fromUserId === me.id).map((r) => view(r, me.id, names, players)),
      history: closed.map((r) => view(r, me.id, names)),
      lockedUids,
      today: myPlayer ? tradesToday(myPlayer, now) : 0,
      dailyLimit: cfg().dailyLimit,
      serverNow: now,
    }
    return c.json(body)
  })

  // A offers one of their Pokémon to friend B.
  app.post('/', async (c) => {
    const me = c.get('user')
    limit(c, RULES.tradeOfferUser, `trade-offer:user:${me.id}`)
    const body = await readBody(c, tradeOfferBody)
    const now = gameTime(deps, c)
    const msg = normalizeTradeMessage(body.message ?? null, cfg().messageMax)
    if (!msg.ok) throw new ApiError(400, 'invalid_body', { fields: ['message'], reason: msg.error })
    if (body.toUserId === me.id) fail('not_friends')
    await sweep(me, now)
    let row: TradeOfferRow
    try {
      row = await db.transaction(async (tx) => {
        const mine = await lockPlayer(tx, me.id, 'me')
        const player = mine.doc.player!
        await checkFriendship(tx, me.id, body.toUserId, now)
        const ctx = (await deps.content.current(now, tx)).ctx
        const block = tradeBlock(player, body.uid, ctx)
        if (block) fail(block, 'me')
        if (await inOpenOffer(tx, me.id, body.uid)) fail('pokemon_in_offer', 'me')
        const sent = await tx
          .select({ id: tradeOffers.id })
          .from(tradeOffers)
          .where(and(eq(tradeOffers.fromUserId, me.id), inArray(tradeOffers.status, OPEN)))
        if (sent.length >= cfg().maxOpenSent) fail('too_many_offers', 'me')
        if (tradesToday(player, now) >= cfg().dailyLimit) fail('daily_limit', 'me')
        const mon = player.pokemon[body.uid]!
        // Early feedback (re-checked on completion): the friend must be able to receive it.
        const theirs = await readPlayer(tx, body.toUserId)
        if (!theirs) fail('no_player', 'partner')
        if (receiveBlock(theirs!, mon, ctx)) fail('over_level_cap', 'partner')
        const [r] = await tx
          .insert(tradeOffers)
          .values({
            fromUserId: me.id,
            toUserId: body.toUserId,
            status: 'offered',
            offerUid: body.uid,
            offerSnapshot: tradeSnapshot(mon, ctx),
            message: msg.value,
            createdAt: new Date(now),
            updatedAt: new Date(now),
            expiresAt: new Date(now + cfg().offerTtlHours * 3_600_000),
          })
          .returning()
        return r!
      })
    } catch (e) {
      if (isUniqueViolation(e)) fail('pokemon_in_offer', 'me')
      throw e
    }
    publish(eventsFor(row, me))
    const [their] = await db.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, row.toUserId))
    pushTurn(row.toUserId, their?.doc ?? null, me.trainerName, 'offered')
    return c.json(await viewOne(row, me.id), 201)
  })

  // B picks the Pokémon to give back (B's confirmation).
  app.post('/:id/counter', async (c) => {
    const me = c.get('user')
    limit(c, RULES.tradeWriteUser, `trade-write:user:${me.id}`)
    const id = offerId(c)
    const body = await readBody(c, tradeCounterBody)
    const now = gameTime(deps, c)
    await sweep(me, now)
    let row: TradeOfferRow
    try {
      row = await db.transaction(async (tx) => {
        const mine = await lockPlayer(tx, me.id, 'me')
        const player = mine.doc.player!
        const r = await lockOffer(tx, id)
        if (r.toUserId !== me.id && r.fromUserId !== me.id) throw new ApiError(404, 'not_found')
        if (!OPEN.includes(r.status)) fail('offer_closed')
        if (r.toUserId !== me.id || r.status !== 'offered') fail('not_your_turn')
        if (r.expiresAt.getTime() <= now) fail('offer_expired')
        await checkFriendship(tx, me.id, r.fromUserId, now)
        const ctx = (await deps.content.current(now, tx)).ctx
        const block = tradeBlock(player, body.uid, ctx)
        if (block) fail(block, 'me')
        if (await inOpenOffer(tx, me.id, body.uid)) fail('pokemon_in_offer', 'me')
        const mon = player.pokemon[body.uid]!
        // Early feedback on both sides (everything is re-checked on completion).
        const theirs = await readPlayer(tx, r.fromUserId)
        const offered = theirs?.pokemon[r.offerUid]
        if (!theirs || !offered) fail('pokemon_changed', 'partner')
        if (receiveBlock(player, offered!, ctx)) fail('over_level_cap', 'me')
        if (receiveBlock(theirs!, mon, ctx)) fail('over_level_cap', 'partner')
        if (tradesToday(player, now) >= cfg().dailyLimit) fail('daily_limit', 'me')
        if (player.dust < tradeCost(offered!, mon, ctx)) fail('not_enough_dust', 'me')
        const [u] = await tx
          .update(tradeOffers)
          .set({
            status: 'countered',
            counterUid: body.uid,
            counterSnapshot: tradeSnapshot(mon, ctx),
            offerSnapshot: tradeSnapshot(offered!, ctx),
            updatedAt: new Date(now),
            // The sender gets a full window to answer.
            expiresAt: new Date(now + cfg().offerTtlHours * 3_600_000),
          })
          .where(eq(tradeOffers.id, id))
          .returning()
        return u!
      })
    } catch (e) {
      if (isUniqueViolation(e)) fail('pokemon_in_offer', 'me')
      throw e
    }
    publish(eventsFor(row, me))
    const [their] = await db.select({ doc: playerDocs.doc }).from(playerDocs).where(eq(playerDocs.userId, row.fromUserId))
    pushTurn(row.fromUserId, their?.doc ?? null, me.trainerName, 'countered')
    return c.json(await viewOne(row, me.id))
  })

  // A accepts the counteroffer: the trade completes (both docs, all or nothing).
  app.post('/:id/accept', async (c) => {
    const me = c.get('user')
    limit(c, RULES.tradeWriteUser, `trade-write:user:${me.id}`)
    const id = offerId(c)
    const now = gameTime(deps, c)
    await sweep(me, now)
    const [peek] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id))
    if (!peek || (peek.fromUserId !== me.id && peek.toUserId !== me.id)) throw new ApiError(404, 'not_found')
    const partnerId = peek.toUserId
    const out = await db.transaction(async (tx) => {
      // Both docs in user-id order, then the offer row.
      const [first, second] = [me.id, partnerId].sort()
      const rows = new Map<string, Awaited<ReturnType<typeof lockPlayer>>>()
      for (const uid of [first!, second!]) rows.set(uid, await lockPlayer(tx, uid, uid === me.id ? 'me' : 'partner'))
      const r = await lockOffer(tx, id)
      if (!OPEN.includes(r.status)) fail('offer_closed')
      if (r.fromUserId !== me.id || r.status !== 'countered' || !r.counterUid || !r.counterSnapshot) fail('not_your_turn')
      if (r.expiresAt.getTime() <= now) fail('offer_expired')
      await checkFriendship(tx, me.id, partnerId, now)
      const ctx = (await deps.content.current(now, tx)).ctx
      const mineRow = rows.get(me.id)!
      const theirRow = rows.get(partnerId)!
      const a = mineRow.doc.player!
      const b = theirRow.doc.player!
      const give = a.pokemon[r.offerUid]
      const get = b.pokemon[r.counterUid!]
      // What both players agreed on must still be there (same species and shininess).
      const same = (p: OwnedPokemon | undefined, s: TradePokemonView) => !!p && p.speciesSlug === s.speciesSlug && p.isShiny === s.isShiny
      if (!same(give, r.offerSnapshot)) fail('pokemon_changed', 'me')
      if (!same(get, r.counterSnapshot!)) fail('pokemon_changed', 'partner')
      const names = await namesOf(tx, [me.id, partnerId])
      const myName = names.get(me.id) ?? me.trainerName
      const theirName = names.get(partnerId) ?? '?'
      const dust = tradeCost(give!, get!, ctx)
      const seed = randomBytes(16).toString('hex')
      const ra = applyTrade(a, { give: r.offerUid, receive: get!, partnerName: theirName, selfName: myName, dust }, now, createRng(`${seed}:a`), ctx)
      if (!ra.ok) fail(ra.error, 'me')
      const rb = applyTrade(b, { give: r.counterUid!, receive: give!, partnerName: myName, selfName: theirName, dust }, now, createRng(`${seed}:b`), ctx)
      if (!rb.ok) fail(rb.error, 'partner')
      if (!ra.ok || !rb.ok) throw new Error('unreachable')
      const updatedAt = new Date(deps.clock())
      const versions = new Map<string, number>()
      for (const [uid, row, player] of [
        [me.id, mineRow, ra.value.state],
        [partnerId, theirRow, rb.value.state],
      ] as const) {
        const version = row.version + 1
        versions.set(uid, version)
        await tx.update(playerDocs).set({ doc: { ...row.doc, player }, version, updatedAt }).where(eq(playerDocs.userId, uid))
      }
      const [done] = await tx
        .update(tradeOffers)
        .set({
          status: 'completed',
          offerSnapshot: tradeSnapshot(give!, ctx),
          counterSnapshot: tradeSnapshot(get!, ctx),
          dustCost: dust,
          // The sender's Pokémon arrives at the receiver (rb) and vice versa.
          offerEvolvedTo: rb.value.evolvedTo,
          counterEvolvedTo: ra.value.evolvedTo,
          updatedAt: new Date(now),
          completedAt: new Date(now),
        })
        .where(eq(tradeOffers.id, id))
        .returning()
      return { row: done!, versions }
    })
    for (const [uid, version] of out.versions) bus.publish(uid, { type: 'game', version })
    publish(eventsFor(out.row, me))
    return c.json(await viewOne(out.row, me.id))
  })

  /** Close an open offer: `reject` (receiver any time, sender when countered) or `cancel` (sender). */
  const close = (kind: 'rejected' | 'cancelled') => async (c: Ctx) => {
    const me = c.get('user')
    limit(c, RULES.tradeWriteUser, `trade-write:user:${me.id}`)
    const id = offerId(c)
    const now = gameTime(deps, c)
    await sweep(me, now)
    const row = await db.transaction(async (tx) => {
      const r = await lockOffer(tx, id)
      if (r.toUserId !== me.id && r.fromUserId !== me.id) throw new ApiError(404, 'not_found')
      if (!OPEN.includes(r.status)) fail('offer_closed')
      const sender = r.fromUserId === me.id
      const allowed = kind === 'cancelled' ? sender : !sender || r.status === 'countered'
      if (!allowed) fail('not_your_turn')
      const [u] = await tx
        .update(tradeOffers)
        .set({ status: kind, closedBy: me.id, updatedAt: new Date(now) })
        .where(eq(tradeOffers.id, id))
        .returning()
      return u!
    })
    publish(eventsFor(row, me))
    return c.json(await viewOne(row, me.id))
  }
  app.post('/:id/reject', close('rejected'))
  app.post('/:id/cancel', close('cancelled'))

  return app
}
