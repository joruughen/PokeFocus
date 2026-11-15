/** Integration tests for trades between friends (/api/trades, GDD §12.8). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createIndividual, createRng, toOwnedPokemon, type OwnedPokemon, type PlayerState } from '../src/engine'
import type { GameAction, GameSnapshot, PublicUser, ServerEvent, TradeOfferView, TradesResponse } from '../src/game/protocol'
import { createApp } from './app'
import { openDatabase, type Database } from './db/client'
import { playerDocs, tradeOffers } from './db/schema'
import { loadEnv } from './env'
import { EventBus } from './events'

const ORIGIN = 'http://localhost:5173'
const T0 = Date.UTC(2026, 10, 4, 15, 0)
const HOUR = 3_600_000
const DAY = 24 * HOUR

let database: Database
let now = T0
const clock = () => now
let app: ReturnType<typeof createApp>
let bus: EventBus

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' })
  bus = new EventBus()
  app = createApp({ env: loadEnv({ NODE_ENV: 'test', TRUST_PROXY: '1', APP_ORIGIN: ORIGIN, DEV_TOOLS: '0' }), db: database.db, clock, bus })
}, 60_000)

afterAll(async () => {
  await database?.close()
})

let ipSeq = 0
async function call(method: string, path: string, cookie: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.2.0.${++ipSeq % 250}` }
  if (method !== 'GET') {
    headers.origin = ORIGIN
    headers['content-type'] = 'application/json'
  }
  if (cookie) headers.cookie = `pf_session=${cookie}`
  const res = await app.app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, res }
}

interface U {
  user: PublicUser
  cookie: string
  events: ServerEvent[]
}

let seq = 0
async function newUser(): Promise<U> {
  const n = ++seq
  const r = await call('POST', '/api/auth/register', null, { email: `t${n}@test.dev`, password: 'correct horse', trainerName: `Trader ${n}`, country: 'PE' })
  expect(r.status).toBe(201)
  const cookie = r.res.headers.get('set-cookie')!.match(/pf_session=([^;]*)/)![1]!
  const u: U = { user: (r.json as { user: PublicUser }).user, cookie, events: [] }
  bus.subscribe({ userId: u.user.id, sessionId: 's', send: (e) => u.events.push(e), close: () => {} })
  expect((await act(u, { type: 'createPlayer', locale: 'es', timezone: 0, starterSlug: 'bulbasaur' })).status).toBe(200)
  return u
}

const act = (u: U, a: GameAction) => call('POST', '/api/game/action', u.cookie, a)
const game = async (u: U) => (await call('GET', '/api/game', u.cookie)).json as unknown as GameSnapshot
const trades = async (u: U) => (await call('GET', '/api/trades', u.cookie)).json as unknown as TradesResponse
const tradeEvents = (u: U) => u.events.filter((e): e is Extract<ServerEvent, { type: 'trade' }> => e.type === 'trade')

async function befriend(a: U, b: U) {
  expect((await call('POST', '/api/friends/request', a.cookie, { friendCode: b.user.friendCode })).status).toBe(201)
  expect((await call('POST', `/api/friends/${a.user.id}/accept`, b.cookie)).status).toBe(204)
}

/** Edit a player's doc straight in the database (test setup). */
async function editPlayer(u: U, fn: (p: PlayerState) => PlayerState) {
  const [row] = await database.db.select().from(playerDocs).where(eq(playerDocs.userId, u.user.id))
  await database.db
    .update(playerDocs)
    .set({ doc: { ...row!.doc, player: fn(row!.doc.player!) }, version: row!.version + 1 })
    .where(eq(playerDocs.userId, u.user.id))
}

function mon(slug: string, level: number, uid: string, extra: Partial<OwnedPokemon> = {}): OwnedPokemon {
  const core = createIndividual(slug, level, createRng(`${slug}${uid}`))
  return { ...toOwnedPokemon(core, uid, T0, 'poke-ball'), ...extra }
}

/** Give a player box Pokémon and Dust. */
async function stock(u: U, mons: OwnedPokemon[], dust = 1000) {
  await editPlayer(u, (p) => {
    const pokemon = { ...p.pokemon }
    for (const m of mons) pokemon[m.uid] = m
    return { ...p, pokemon, dust }
  })
}

/** Two players, friends for 3 days by `now`. */
async function pair(): Promise<[U, U]> {
  now = T0
  const a = await newUser()
  const b = await newUser()
  await befriend(a, b)
  now = T0 + 3 * DAY
  a.events.length = 0
  b.events.length = 0
  return [a, b]
}

async function offer(from: U, to: U, uid: string, message?: string) {
  return call('POST', '/api/trades', from.cookie, { toUserId: to.user.id, uid, message })
}
async function okOffer(from: U, to: U, uid: string, message?: string): Promise<TradeOfferView> {
  const r = await offer(from, to, uid, message)
  expect(r.status, JSON.stringify(r.json)).toBe(201)
  return r.json as unknown as TradeOfferView
}
const counter = (u: U, id: string, uid: string) => call('POST', `/api/trades/${id}/counter`, u.cookie, { uid })
const accept = (u: U, id: string) => call('POST', `/api/trades/${id}/accept`, u.cookie)

describe('trades', () => {
  it('full flow: offer (SSE) → counter → accept: both sides swap, evolve, pay Dust and see the history', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('kadabra', 20, 'k1', { bondMinutes: 500, nickname: 'Spoon' })])
    await stock(b, [mon('caterpie', 8, 'c1')])
    const o = await okOffer(a, b, 'k1', '  ¿Me das tu Caterpie?  ')
    expect(o).toMatchObject({ status: 'offered', role: 'sender', myTurn: false, message: '¿Me das tu Caterpie?', counter: null, dustCost: null })
    expect(o.offer).toMatchObject({ uid: 'k1', speciesSlug: 'kadabra', level: 20 })
    expect(o.offer).not.toHaveProperty('nickname')
    expect(tradeEvents(b)).toMatchObject([{ offerId: o.id, status: 'offered', userId: a.user.id }])

    const tb = await trades(b)
    expect(tb.incoming).toHaveLength(1)
    expect(tb.incoming[0]).toMatchObject({ id: o.id, role: 'receiver', myTurn: true, partner: { userId: a.user.id, trainerName: a.user.trainerName } })
    expect((await trades(a)).lockedUids).toEqual(['k1'])

    const cr = await counter(b, o.id, 'c1')
    expect(cr.status, JSON.stringify(cr.json)).toBe(200)
    expect(cr.json).toMatchObject({ status: 'countered', myTurn: false, dustCost: 100, counter: { uid: 'c1', speciesSlug: 'caterpie' } })
    expect(tradeEvents(a).map((e) => e.status)).toEqual(['offered', 'countered'])
    expect((await trades(b)).lockedUids).toEqual(['c1'])
    expect((await trades(a)).outgoing[0]).toMatchObject({ myTurn: true, status: 'countered' })

    const vA = (await game(a)).version
    const vB = (await game(b)).version
    const done = await accept(a, o.id)
    expect(done.status, JSON.stringify(done.json)).toBe(200)
    expect(done.json).toMatchObject({ status: 'completed', dustCost: 100, offerEvolvedTo: 'alakazam', counterEvolvedTo: null })

    const ga = await game(a)
    const gb = await game(b)
    expect(ga.version).toBe(vA + 1)
    expect(gb.version).toBe(vB + 1)
    const pa = ga.doc.player!
    const pb = gb.doc.player!
    expect(pa.pokemon.k1).toBeUndefined()
    expect(pb.pokemon.c1).toBeUndefined()
    expect(pa.dust).toBe(900)
    expect(pb.dust).toBe(900)
    const gotA = Object.values(pa.pokemon).find((p) => p.speciesSlug === 'caterpie')!
    const gotB = Object.values(pb.pokemon).find((p) => p.speciesSlug === 'alakazam')!
    expect(gotB).toMatchObject({ level: 20, bondMinutes: 0, traded: { originalTrainer: a.user.trainerName, receivedFrom: a.user.trainerName, receivedAt: now, count: 1 } })
    expect(gotB.nickname).toBeUndefined()
    expect(gotA.traded?.originalTrainer).toBe(b.user.trainerName)
    expect(pb.pokedex.caught).toEqual(expect.arrayContaining(['kadabra', 'alakazam']))
    expect(pa.pokedex.caught).toContain('caterpie')
    expect(pb.pendingTrades).toMatchObject([{ fromSpecies: 'kadabra', toSpecies: 'alakazam', partnerName: a.user.trainerName }])
    expect(pa.trades?.count).toBe(1)
    expect(a.events.some((e) => e.type === 'game')).toBe(true)
    expect(b.events.some((e) => e.type === 'game')).toBe(true)

    const ha = await trades(a)
    expect(ha.incoming).toEqual([])
    expect(ha.outgoing).toEqual([])
    expect(ha.lockedUids).toEqual([])
    expect(ha.today).toBe(1)
    expect(ha.history[0]).toMatchObject({ id: o.id, status: 'completed', completedAt: now })
    // The arrival window is closed with ackTrade.
    expect((await act(b, { type: 'ackTrade' })).status).toBe(200)
    expect((await game(b)).doc.player!.pendingTrades).toBeUndefined()
  })

  it('needs an accepted friendship of at least 3 days', async () => {
    now = T0
    const a = await newUser()
    const b = await newUser()
    const c = await newUser()
    await stock(a, [mon('caterpie', 5, 'c1')])
    expect((await offer(a, b, 'c1')).json).toMatchObject({ error: 'not_friends' })
    await befriend(a, b)
    now = T0 + 2 * DAY
    const r = await offer(a, b, 'c1')
    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({ error: 'friendship_too_new', readyAt: T0 + 3 * DAY })
    now = T0 + 3 * DAY
    expect((await offer(a, b, 'c1')).status).toBe(201)
    expect((await offer(a, c, 'c1')).json).toMatchObject({ error: 'not_friends' })
    // The friend list tells since when they are friends.
    const friends = (await call('GET', '/api/friends', a.cookie)).json as { friends: { userId: string; friendsSince?: number }[] }
    expect(friends.friends.find((f) => f.userId === b.user.id)?.friendsSince).toBe(T0)
  })

  it('permissions and turns: only the receiver counters, only the sender accepts, strangers get 404', async () => {
    const [a, b] = await pair()
    const c = await newUser()
    await stock(a, [mon('caterpie', 5, 'c1')])
    await stock(b, [mon('caterpie', 5, 'c2')])
    const o = await okOffer(a, b, 'c1')
    expect((await counter(a, o.id, 'c1')).json).toMatchObject({ error: 'not_your_turn' })
    expect((await accept(a, o.id)).json).toMatchObject({ error: 'not_your_turn' })
    expect((await counter(c, o.id, 'c1')).status).toBe(404)
    expect((await accept(c, o.id)).status).toBe(404)
    expect((await call('POST', `/api/trades/${o.id}/reject`, c.cookie)).status).toBe(404)
    expect((await call('POST', `/api/trades/${o.id}/cancel`, b.cookie)).json).toMatchObject({ error: 'not_your_turn' })
    expect((await call('POST', `/api/trades/${o.id}/reject`, a.cookie)).json).toMatchObject({ error: 'not_your_turn' })
    expect((await counter(b, o.id, 'c2')).status).toBe(200)
    expect((await accept(b, o.id)).json).toMatchObject({ error: 'not_your_turn' })
    // The sender may reject the counteroffer.
    const rj = await call('POST', `/api/trades/${o.id}/reject`, a.cookie)
    expect(rj.json).toMatchObject({ status: 'rejected', closedByMe: true })
    expect((await accept(a, o.id)).json).toMatchObject({ error: 'offer_closed' })
    expect((await trades(b)).history[0]).toMatchObject({ status: 'rejected', closedByMe: false })
    // Both Pokémon are free again.
    expect((await trades(a)).lockedUids).toEqual([])
    expect((await call('GET', '/api/trades/not-a-uuid', a.cookie)).status).toBe(404)
  })

  it('blocks team members, the last Pokémon, a Pokémon already in an open offer and a long message', async () => {
    const [a, b] = await pair()
    expect((await offer(a, b, 'p1')).json).toMatchObject({ error: 'last_pokemon', side: 'me' })
    await stock(a, [mon('caterpie', 5, 'c1')])
    expect((await offer(a, b, 'p1')).json).toMatchObject({ error: 'in_team', side: 'me' })
    expect((await offer(a, b, 'nope')).json).toMatchObject({ error: 'unknown_pokemon' })
    expect((await offer(a, b, 'c1', 'x'.repeat(81))).status).toBe(400)
    const o = await okOffer(a, b, 'c1')
    expect((await offer(a, b, 'c1')).json).toMatchObject({ error: 'pokemon_in_offer' })
    // The same uid cannot be the counter of another offer either.
    await stock(b, [mon('caterpie', 5, 'x1'), mon('caterpie', 5, 'x2')])
    const o2 = await okOffer(b, a, 'x1')
    expect((await counter(a, o2.id, 'c1')).json).toMatchObject({ error: 'pokemon_in_offer' })
    expect((await call('POST', `/api/trades/${o.id}/cancel`, a.cookie)).json).toMatchObject({ status: 'cancelled' })
    expect((await counter(a, o2.id, 'c1')).status).toBe(200)
    expect((await offer(a, b, 'c1')).json).toMatchObject({ error: 'pokemon_in_offer' })
  })

  it('cannot receive a Pokémon above the level cap', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('machop', 35, 'm1'), mon('caterpie', 5, 'c1')])
    await stock(b, [mon('caterpie', 5, 'c2'), mon('machop', 31, 'm2')])
    expect((await offer(a, b, 'm1')).json).toMatchObject({ error: 'over_level_cap', side: 'partner' })
    const o = await okOffer(a, b, 'c1')
    expect((await counter(b, o.id, 'm2')).json).toMatchObject({ error: 'over_level_cap', side: 'partner' })
  })

  it('Dust: checked at the counter and again on completion, which fails cleanly', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('caterpie', 5, 'c1', { isShiny: true })], 1000)
    await stock(b, [mon('caterpie', 5, 'c2')], 499)
    const o = await okOffer(a, b, 'c1')
    expect((await counter(b, o.id, 'c2')).json).toMatchObject({ error: 'not_enough_dust', side: 'me' })
    await editPlayer(b, (p) => ({ ...p, dust: 500 }))
    expect((await counter(b, o.id, 'c2')).json).toMatchObject({ dustCost: 500 })
    // A spends Dust meanwhile.
    await editPlayer(a, (p) => ({ ...p, dust: 100 }))
    const before = [await game(a), await game(b)]
    expect((await accept(a, o.id)).json).toMatchObject({ error: 'not_enough_dust', side: 'me' })
    await editPlayer(a, (p) => ({ ...p, dust: 600 }))
    await editPlayer(b, (p) => ({ ...p, dust: 10 }))
    expect((await accept(a, o.id)).json).toMatchObject({ error: 'not_enough_dust', side: 'partner' })
    // Nothing moved; the offer is still open.
    const after = [await game(a), await game(b)]
    expect(after[0]!.doc.player!.pokemon.c1).toBeDefined()
    expect(after[1]!.doc.player!.pokemon.c2).toBeDefined()
    expect(after[0]!.version).toBe(before[0]!.version + 1)
    expect((await trades(a)).outgoing[0]?.status).toBe('countered')
  })

  it('daily limit: 3 completed trades per local day', async () => {
    const [a, b] = await pair()
    const mk = (p: string) => Array.from({ length: 4 }, (_, i) => mon('caterpie', 5, `${p}${i}`))
    await stock(a, mk('a'))
    await stock(b, mk('b'))
    for (let i = 0; i < 3; i++) {
      const o = await okOffer(a, b, `a${i}`)
      expect((await counter(b, o.id, `b${i}`)).status).toBe(200)
      expect((await accept(a, o.id)).status).toBe(200)
    }
    expect((await offer(a, b, 'a3')).json).toMatchObject({ error: 'daily_limit', side: 'me' })
    expect((await offer(b, a, 'b3')).json).toMatchObject({ error: 'daily_limit', side: 'me' })
    expect((await trades(a)).today).toBe(3)
    // The next local day (UTC here) the counter restarts.
    now += DAY
    expect((await trades(a)).today).toBe(0)
    const o = await okOffer(b, a, 'b3')
    expect((await counter(a, o.id, 'a3')).status).toBe(200)
    expect((await accept(b, o.id)).status).toBe(200)
  })

  it('a legendary or mythical can only be traded once', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('mewtwo', 20, 'mw')], 5000)
    await stock(b, [mon('caterpie', 5, 'c2'), mon('caterpie', 5, 'c3')], 5000)
    const o = await okOffer(a, b, 'mw')
    expect((await counter(b, o.id, 'c2')).json).toMatchObject({ dustCost: 1000 })
    expect((await accept(a, o.id)).status).toBe(200)
    const pb = (await game(b)).doc.player!
    expect(pb.dust).toBe(4000)
    const uid = Object.values(pb.pokemon).find((p) => p.speciesSlug === 'mewtwo')!.uid
    expect((await offer(b, a, uid)).json).toMatchObject({ error: 'legendary_traded', side: 'me' })
  })

  it('open offers expire after 72 h (a counter restarts the window)', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('caterpie', 5, 'c1'), mon('caterpie', 5, 'c9')])
    await stock(b, [mon('caterpie', 5, 'c2')])
    const o = await okOffer(a, b, 'c1')
    now += 71 * HOUR
    expect((await counter(b, o.id, 'c2')).status).toBe(200)
    now += 71 * HOUR
    expect((await trades(a)).outgoing).toHaveLength(1)
    now += 2 * HOUR
    b.events.length = 0
    expect((await accept(a, o.id)).json).toMatchObject({ error: 'offer_closed' })
    expect(tradeEvents(b)).toMatchObject([{ offerId: o.id, status: 'expired' }])
    expect((await trades(b)).history[0]).toMatchObject({ id: o.id, status: 'expired' })
    // The Pokémon can be offered again.
    expect((await offer(a, b, 'c1')).status).toBe(201)
  })

  it('unfriending closes the open offers between them', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('caterpie', 5, 'c1')])
    const o = await okOffer(a, b, 'c1')
    expect((await call('DELETE', `/api/friends/${a.user.id}`, b.cookie)).status).toBe(204)
    expect((await trades(a)).history[0]).toMatchObject({ id: o.id, status: 'cancelled' })
    expect(tradeEvents(a).at(-1)).toMatchObject({ status: 'cancelled', userId: b.user.id })
  })

  it('concurrent accepts complete the trade once (both docs locked, all or nothing)', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('caterpie', 5, 'c1')])
    await stock(b, [mon('caterpie', 5, 'c2')])
    const o = await okOffer(a, b, 'c1')
    expect((await counter(b, o.id, 'c2')).status).toBe(200)
    const rs = await Promise.all([accept(a, o.id), accept(a, o.id), accept(a, o.id)])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409])
    const pa = (await game(a)).doc.player!
    const pb = (await game(b)).doc.player!
    expect(pa.dust).toBe(900)
    expect(pb.dust).toBe(900)
    expect(Object.keys(pa.pokemon)).toHaveLength(2)
    expect(Object.keys(pb.pokemon)).toHaveLength(2)
    expect(pa.trades?.count).toBe(1)
    const rows = await database.db.select().from(tradeOffers).where(eq(tradeOffers.id, o.id))
    expect(rows[0]?.status).toBe('completed')
  })

  it('a Pokémon released or evolved after the counter makes the trade fail cleanly', async () => {
    const [a, b] = await pair()
    await stock(a, [mon('caterpie', 5, 'c1')])
    await stock(b, [mon('caterpie', 5, 'c2')])
    const o = await okOffer(a, b, 'c1')
    expect((await counter(b, o.id, 'c2')).status).toBe(200)
    expect((await act(b, { type: 'release', uid: 'c2' })).status).toBe(200)
    expect((await trades(a)).outgoing[0]?.counter).toMatchObject({ uid: 'c2', missing: true })
    expect((await accept(a, o.id)).json).toMatchObject({ error: 'pokemon_changed', side: 'partner' })
    expect((await game(a)).doc.player!.pokemon.c1).toBeDefined()
  })

  it('rate limits new offers', async () => {
    const [a, b] = await pair()
    for (let i = 0; i < 20; i++) expect((await offer(a, b, 'nope')).status).toBe(409)
    expect((await offer(a, b, 'nope')).status).toBe(429)
  })
})
