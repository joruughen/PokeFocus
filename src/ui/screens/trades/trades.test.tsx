/** Trades UI: eligibility logic (pure) and the markup of the screen parts in ES and EN (no raw keys). */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { makeMon, makePlayer, T0 } from '../../../engine/test-helpers'
import type { FriendSummary, TradeOfferView, TradePokemonView, TradesResponse } from '../../../game/protocol'
import { TradeArrivalBody } from '../../trades/TradeArrival'
import { friendTradeState, offerOptions, pendingCount, tradeWarnings } from './eligibility'
import { HistoryRow, TodayMeter, TradesView } from './Trades'
import { TradeStage } from './TradeParts'

const DAY = 86_400_000
const RAW_KEY = /\b(trades|errors|common)\.[a-zA-Z]+\.[a-zA-Z_]+\b(?![^<]*>)/

function player() {
  const p = makePlayer([makeMon('pidgey', 10, { uid: 'lead' })], { dust: 300 })
  p.pokemon.c1 = makeMon('caterpie', 8, { uid: 'c1' })
  p.pokemon.m1 = makeMon('mewtwo', 20, { uid: 'm1', traded: { originalTrainer: 'Ash', receivedFrom: 'Ash', receivedAt: T0, count: 1 } })
  p.pokemon.a1 = makeMon('abra', 9, { uid: 'a1' })
  p.teamPresets = [{ id: 't', name: 'Gym', uids: ['lead', 'a1'] }]
  return p
}

function view(slug: string, level: number, extra: Partial<TradePokemonView> = {}): TradePokemonView {
  const m = makeMon(slug, level, { uid: slug })
  return { uid: slug, speciesSlug: slug, level, ivs: m.ivs, nature: m.nature, ability: m.ability, isShiny: false, equippedMoves: m.equippedMoves, moves: [], moveMasteryMinutes: { [m.equippedMoves[0] ?? 'x']: 180 }, ...extra }
}

const offer = (over: Partial<TradeOfferView> = {}): TradeOfferView => ({
  id: 'o1',
  status: 'offered',
  role: 'receiver',
  partner: { userId: 'u2', trainerName: 'Misty' },
  offer: view('kadabra', 20, { traded: { originalTrainer: 'Brock', receivedFrom: 'Brock', receivedAt: T0, count: 1 } }),
  counter: null,
  message: '¿Cambiamos?',
  dustCost: null,
  offerEvolvedTo: null,
  counterEvolvedTo: null,
  myTurn: true,
  closedByMe: false,
  createdAt: T0,
  updatedAt: T0,
  expiresAt: T0 + 72 * 3_600_000,
  completedAt: null,
  ...over,
})

const data = (over: Partial<TradesResponse> = {}): TradesResponse => ({ incoming: [], outgoing: [], history: [], lockedUids: [], today: 1, dailyLimit: 3, serverNow: T0, ...over })

describe('eligibility', () => {
  it('a friend can trade after 3 days of friendship', () => {
    const f: FriendSummary = { userId: 'u', trainerName: 'A', country: 'PE', friendCode: 'X', status: 'friend', friendsSince: T0 }
    expect(friendTradeState(f, T0 + 2 * DAY)).toEqual({ ok: false, reason: 'too_new', readyAt: T0 + 3 * DAY })
    expect(friendTradeState(f, T0 + 3 * DAY)).toEqual({ ok: true })
    expect(friendTradeState({ ...f, status: 'incoming' }, T0 + 9 * DAY)).toEqual({ ok: false, reason: 'not_friend' })
  })

  it('explains why each Pokémon can or cannot be offered', () => {
    const opts = Object.fromEntries(offerOptions(player(), ['c1']).map((o) => [o.uid, o]))
    expect(opts.lead?.block).toBe('in_team')
    expect(opts.c1?.block).toBe('in_offer')
    expect(opts.m1?.block).toBe('legendary_traded')
    expect(opts.a1).toEqual({ uid: 'a1', block: null, savedTeams: ['Gym'] })
  })

  it('warns about evolution, level cap, legendaries, saved teams, Dust and the daily limit', () => {
    const p = player()
    const w = (get: TradePokemonView, give: string | null, pp = p) => tradeWarnings(pp, get, give, T0)
    expect(w(view('kadabra', 20), 'c1')).toEqual({ warnings: [{ kind: 'evolves', to: 'alakazam' }], blocking: false })
    expect(w(view('kadabra', 31), 'c1').warnings).toContainEqual({ kind: 'overLevelCap', cap: 30 })
    expect(w(view('kadabra', 31), 'c1').blocking).toBe(true)
    expect(w(view('mew', 5), 'c1').warnings).toContainEqual({ kind: 'notEnoughDust', cost: 1000, have: 300 })
    expect(w(view('mew', 5), 'c1').warnings).toContainEqual({ kind: 'legendaryOnce' })
    expect(w(view('caterpie', 5), 'a1').warnings).toEqual([{ kind: 'savedTeam', teams: ['Gym'] }])
    const full = { ...p, trades: { dayKey: '2026-11-03', count: 3 } }
    expect(w(view('caterpie', 5), 'c1', full)).toEqual({ warnings: [{ kind: 'dailyLimit', limit: 3 }], blocking: true })
  })

  it('counts the offers waiting for me', () => {
    expect(pendingCount(null)).toBe(0)
    expect(pendingCount({ incoming: [offer(), offer({ myTurn: false })], outgoing: [offer({ role: 'sender', myTurn: true })] })).toBe(2)
  })
})

describe('markup (ES + EN)', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`${lng}: empty state, offers, history, stage and arrival have no raw keys`, async () => {
      await i18n.changeLanguage(lng)
      const p = player()
      const empty = renderToStaticMarkup(<TradesView data={data()} error={null} player={p} />)
      expect(empty).toContain(i18n.t('trades.empty.title'))
      expect(empty).toContain('href="#/friends"')

      const full = renderToStaticMarkup(
        <TradesView
          data={data({
            incoming: [offer()],
            outgoing: [offer({ id: 'o2', role: 'sender', status: 'countered', counter: view('caterpie', 5, { isShiny: true }), dustCost: 500, myTurn: true })],
            history: [offer({ id: 'o3', status: 'completed', completedAt: T0, dustCost: 100, counter: view('abra', 5), offerEvolvedTo: 'alakazam' })],
          })}
          error={null}
          player={p}
        />,
      )
      expect(full).toContain('Misty')
      expect(full).toContain('¿Cambiamos?')
      expect(full).toContain(i18n.t('trades.card.pick'))
      expect(full).not.toMatch(RAW_KEY)

      const stage = renderToStaticMarkup(
        <TradeStage left={{ label: 'A', mon: view('caterpie', 5, { mintNature: 'modest', bottleCapped: ['speed'] }) }} right={{ label: 'B', mon: null, pending: 'wait' }} />,
      )
      expect(stage).toContain('wait')
      expect(stage).not.toMatch(RAW_KEY)

      const hist = renderToStaticMarkup(<HistoryRow offer={offer({ status: 'rejected', closedByMe: true })} />)
      expect(hist).toContain(i18n.t('trades.status.rejectedMe'))
      expect(renderToStaticMarkup(<TodayMeter used={1} limit={3} />)).toContain(lng === 'es' ? 'de hoy: 1 de 3' : 'trades: 1 of 3')

      const arrival = renderToStaticMarkup(<TradeArrivalBody arrival={{ uid: 'p9', fromSpecies: 'kadabra', toSpecies: 'alakazam', shiny: false, partnerName: 'Misty', at: T0 }} />)
      expect(arrival).toContain(i18n.t('trades.arrival.note'))
      expect(arrival).not.toMatch(RAW_KEY)
    })
  }
})
