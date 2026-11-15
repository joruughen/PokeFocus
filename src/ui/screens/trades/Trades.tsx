import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, tradeDustCostOf, type PlayerState } from '../../../engine'
import type { FriendSummary, TradeOfferView, TradesResponse } from '../../../game/protocol'
import { Button, EmptyState, Panel, PixelIcon, Tabs, TextField, toast } from '../../components'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { hrefTo, navigate, useRouteParams } from '../../router'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useFriends } from '../../store/social'
import { useTrades } from '../../store/trades'
import { friendTradeState, tradeWarnings } from './eligibility'
import { MonPicker, TradeMonCard, tradeErrorText, WarningList } from './TradeParts'

/**
 * Trades (`#/trades`, GDD §12.8): offers received and sent, and the history.
 * `#/trades/new/<friendId>` starts an offer to that friend. Updates live on the
 * SSE 'trade' event (store/trades.ts).
 */
export default function Trades() {
  const { t } = useTranslation()
  const params = useRouteParams()
  const data = useTrades((s) => s.data)
  const error = useTrades((s) => s.error)
  const load = useTrades((s) => s.load)
  const player = useGame((s) => s.player)
  const friends = useFriends((s) => s.friends)
  useEffect(() => {
    void load()
  }, [load])

  const newFor = params[0] === 'new' ? params[1] : undefined
  const friend = newFor ? friends?.find((f) => f.userId === newFor) : undefined

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">{t('trades.title')}</h1>
          <p className="mt-1 max-w-[60ch] text-mist-300">{t('trades.subtitle')}</p>
        </div>
        {data && (
          <p className="font-display text-base text-mist-300" aria-live="polite">
            {t('trades.today', { count: data.today, limit: data.dailyLimit })}
          </p>
        )}
      </header>
      {newFor && player && data && (friend ? <NewOffer friend={friend} player={player} data={data} /> : friends && <p className="text-cheek-400">{t('trades.new.notFriend')}</p>)}
      <TradesView data={data} error={error} player={player} onRetry={() => void load()} />
    </div>
  )
}

/** The three lists (server-renderable: everything comes in through props). */
export function TradesView({ data, error, player, onRetry }: { data: TradesResponse | null; error: string | null; player: PlayerState | null; onRetry?: () => void }) {
  const { t } = useTranslation()
  if (!data || !player) {
    return error ? (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-cheek-400">{errorText(error)}</p>
        {onRetry && (
          <Button size="sm" variant="secondary" icon="reroll" onClick={onRetry}>
            {t('auth.splash.retry')}
          </Button>
        )}
      </div>
    ) : (
      <p role="status" className="py-8 text-center font-display text-lg text-mist-400">
        {t('common.loading')}
      </p>
    )
  }
  const empty = (key: 'incoming' | 'outgoing' | 'history') => (
    <div className="bg-dusk-900 inset-shadow-well">
      <EmptyState pose="point" title={t(`trades.empty.${key}`)} body={key === 'history' ? undefined : t('trades.empty.how')} />
    </div>
  )
  const list = (offers: TradeOfferView[], key: 'incoming' | 'outgoing') =>
    offers.length === 0 ? (
      empty(key)
    ) : (
      <ul className="flex flex-col gap-4">
        {offers.map((o) => (
          <OfferCard key={o.id} offer={o} player={player} data={data} />
        ))}
      </ul>
    )
  const turn = (offers: TradeOfferView[]) => offers.filter((o) => o.myTurn).length
  return (
    <Tabs
      label={t('trades.tabs.label')}
      defaultValue={turn(data.outgoing) > turn(data.incoming) ? 'outgoing' : 'incoming'}
      items={[
        { value: 'incoming', label: t('trades.tabs.incoming', { count: data.incoming.length }), content: list(data.incoming, 'incoming') },
        { value: 'outgoing', label: t('trades.tabs.outgoing', { count: data.outgoing.length }), content: list(data.outgoing, 'outgoing') },
        {
          value: 'history',
          label: t('trades.tabs.history'),
          content:
            data.history.length === 0 ? (
              empty('history')
            ) : (
              <ul className="flex flex-col gap-2">
                {data.history.map((o) => (
                  <HistoryRow key={o.id} offer={o} />
                ))}
              </ul>
            ),
        },
      ]}
    />
  )
}

function useRun() {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      toast.add({ title: ok, type: 'success' })
      return true
    } catch (e) {
      toast.add({ title: tradeErrorText(e), type: 'danger' })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

/** Start an offer to a friend: pick my Pokémon, optional message, confirm. */
function NewOffer({ friend, player, data }: { friend: FriendSummary; player: PlayerState; data: TradesResponse }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const offer = useTrades((s) => s.offer)
  const [uid, setUid] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const { busy, run } = useRun()
  const max = defaultContext().config.trade.messageMax
  const state = friendTradeState(friend, now)
  const mine = uid ? player.pokemon[uid] : undefined
  const minCost = mine ? tradeDustCostOf(mine) : null
  const { warnings, blocking } = mine ? tradeWarnings(player, mine, uid, now) : { warnings: [], blocking: false }
  // Only the warnings about what I give apply before the friend picks (theirs come with the counteroffer).
  const mineOnly = warnings.filter((w) => w.kind === 'savedTeam' || w.kind === 'legendaryOnce' || w.kind === 'dailyLimit')
  return (
    <Panel title={t('trades.new.title', { name: friend.trainerName })} className="outline-2 -outline-offset-2 outline-volt-400/60">
      {!state.ok ? (
        <p className="text-cheek-400">
          {state.reason === 'too_new'
            ? t('trades.friend.tooNew', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(state.readyAt) })
            : t('trades.new.notFriend')}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-mist-300">{t('trades.new.how', { name: friend.trainerName })}</p>
          <MonPicker player={player} lockedUids={data.lockedUids} selected={uid} onSelect={setUid} />
          {mine && (
            <div className="flex flex-col gap-3">
              <p className="font-display text-base">{t('trades.new.giving', { name: names.pokemonFull(mine) })}</p>
              <WarningList warnings={mineOnly} />
              <p className="text-sm text-mist-300">{t('trades.new.cost', { cost: fmtInt(minCost ?? 0, i18n.language) })}</p>
            </div>
          )}
          <TextField
            label={t('trades.new.message')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={max * 2}
            hint={t('trades.new.messageHint', { max })}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              icon="check"
              disabled={!mine || busy || (blocking && mineOnly.some((w) => w.kind === 'dailyLimit'))}
              onClick={async () => {
                if (!uid) return
                const ok = await run(() => offer(friend.userId, uid, message.trim() || null), t('trades.new.sent', { name: friend.trainerName }))
                if (ok) navigate('trades')
              }}
            >
              {t('trades.new.send')}
            </Button>
            <Button variant="ghost" onClick={() => navigate('trades')}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

/** An open offer: what each side gives, the cost, the warnings and the buttons of whoever has to act. */
export function OfferCard({ offer: o, player, data }: { offer: TradeOfferView; player: PlayerState; data: Pick<TradesResponse, 'lockedUids'> }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const counter = useTrades((s) => s.counter)
  const accept = useTrades((s) => s.accept)
  const reject = useTrades((s) => s.reject)
  const cancel = useTrades((s) => s.cancel)
  const [picking, setPicking] = useState(false)
  const [uid, setUid] = useState<string | null>(null)
  const { busy, run } = useRun()
  const sender = o.role === 'sender'
  const partner = o.partner.trainerName
  const mineView = sender ? o.offer : o.counter
  const theirView = sender ? o.counter : o.offer
  const left = Math.max(0, o.expiresAt - now)
  const hours = Math.ceil(left / 3_600_000)

  // Receiver picking what to give back.
  const picked = uid ? player.pokemon[uid] : undefined
  const pickWarnings = !sender && o.status === 'offered' ? tradeWarnings(player, o.offer, uid, now) : null
  // Sender confirming the counteroffer.
  const confirmWarnings = sender && o.status === 'countered' && o.counter ? tradeWarnings(player, o.counter, o.offer.uid, now) : null

  return (
    <li className={cx('flex flex-col gap-3 bg-dusk-800 p-4 shadow-frame', o.myTurn && 'outline-2 -outline-offset-2 outline-volt-400/60')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-display text-lg leading-tight">
          {sender ? t('trades.card.toFriend', { name: partner }) : t('trades.card.fromFriend', { name: partner })}
        </p>
        <p className="text-sm text-mist-400">{t('trades.card.expires', { count: hours })}</p>
      </div>
      {o.message && (
        <blockquote className="border-l-4 border-dusk-600 pl-3 text-mist-100">
          <span className="sr-only">{t('trades.card.messageFrom', { name: sender ? t('trades.card.you') : partner })}</span>
          {o.message}
        </blockquote>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {mineView ? <TradeMonCard mon={mineView} title={t('trades.card.youGive')} /> : <Placeholder text={t('trades.card.youPick')} />}
        {theirView ? <TradeMonCard mon={theirView} title={t('trades.card.youGet')} /> : <Placeholder text={t('trades.card.theyPick', { name: partner })} />}
      </div>
      {o.dustCost !== null && <p className="text-sm text-mist-300">{t('trades.card.cost', { cost: fmtInt(o.dustCost, i18n.language) })}</p>}

      {/* Receiver: pick and send the counteroffer. */}
      {!sender && o.status === 'offered' && (
        <div className="flex flex-col gap-3">
          {picking ? (
            <>
              <MonPicker player={player} lockedUids={data.lockedUids} selected={uid} onSelect={setUid} />
              {picked && <p className="text-sm text-mist-300">{t('trades.card.cost', { cost: fmtInt(tradeWarningsCost(picked, o), i18n.language) })}</p>}
              {pickWarnings && <WarningList warnings={pickWarnings.warnings} />}
              <div className="flex flex-wrap gap-2">
                <Button
                  icon="check"
                  disabled={!picked || busy || pickWarnings?.blocking}
                  onClick={() => uid && void run(() => counter(o.id, uid), t('trades.card.countered', { name: partner }))}
                >
                  {t('trades.card.sendCounter', { name: picked ? names.pokemon(picked) : '…' })}
                </Button>
                <Button variant="ghost" onClick={() => setPicking(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <>
              {pickWarnings && <WarningList warnings={pickWarnings.warnings.filter((w) => w.kind !== 'savedTeam')} />}
              <div className="flex flex-wrap gap-2">
                <Button icon="box" disabled={busy || o.offer.missing} onClick={() => setPicking(true)}>
                  {t('trades.card.pick')}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void run(() => reject(o.id), t('trades.card.rejected'))}>
                  {t('trades.card.reject')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {!sender && o.status === 'countered' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-mist-300">{t('trades.card.waitingConfirm', { name: partner })}</p>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => reject(o.id), t('trades.card.withdrawn'))}>
            {t('trades.card.withdraw')}
          </Button>
        </div>
      )}

      {/* Sender: wait, or confirm the counteroffer. */}
      {sender && o.status === 'offered' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-mist-300">{t('trades.card.waitingPick', { name: partner })}</p>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => cancel(o.id), t('trades.card.cancelled'))}>
            {t('trades.card.cancel')}
          </Button>
        </div>
      )}
      {sender && o.status === 'countered' && (
        <div className="flex flex-col gap-3">
          {confirmWarnings && <WarningList warnings={confirmWarnings.warnings} />}
          <div className="flex flex-wrap gap-2">
            <Button
              icon="check"
              disabled={busy || confirmWarnings?.blocking || o.counter?.missing || o.offer.missing}
              onClick={() => void run(() => accept(o.id), t('trades.card.done', { name: partner }))}
            >
              {t('trades.card.accept')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => reject(o.id), t('trades.card.rejected'))}>
              {t('trades.card.rejectCounter')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Cost preview while the receiver picks: the dearer of the offered Pokémon and the picked one. */
function tradeWarningsCost(picked: { speciesSlug: string; isShiny: boolean }, o: TradeOfferView): number {
  return Math.max(tradeDustCostOf(picked), tradeDustCostOf(o.offer))
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="grid min-h-32 place-items-center bg-dusk-900 p-3 text-center text-sm text-mist-400 inset-shadow-well">
      <span className="flex flex-col items-center gap-2">
        <PixelIcon name="help" size={20} />
        {text}
      </span>
    </div>
  )
}

/** A closed offer in the history: what moved (or why not), when, and the Dust paid. */
export function HistoryRow({ offer: o }: { offer: TradeOfferView }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const sender = o.role === 'sender'
  const gave = sender ? o.offer : o.counter
  const got = sender ? o.counter : o.offer
  const gotEvolved = sender ? o.counterEvolvedTo : o.offerEvolvedTo
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(o.completedAt ?? o.updatedAt)
  const status =
    o.status === 'rejected' || o.status === 'cancelled' ? t(`trades.status.${o.status}${o.closedByMe ? 'Me' : 'Them'}`, { name: o.partner.trainerName }) : t(`trades.status.${o.status}`)
  return (
    <li className="flex flex-wrap items-center gap-3 bg-dusk-900 p-3 inset-shadow-well">
      <PixelIcon name={o.status === 'completed' ? 'check' : 'close'} size={16} className={o.status === 'completed' ? 'text-volt-400' : 'text-mist-400'} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-base leading-tight">{t('trades.history.with', { name: o.partner.trainerName })}</p>
        <p className="text-sm text-mist-300">
          {o.status === 'completed' && gave && got
            ? t('trades.history.swap', {
                gave: names.species(gave.speciesSlug),
                got: gotEvolved ? `${names.species(got.speciesSlug)} → ${names.species(gotEvolved)}` : names.species(got.speciesSlug),
              })
            : t('trades.history.offered', { name: names.species(o.offer.speciesSlug) })}
        </p>
      </div>
      <div className="text-right text-sm">
        <p>{status}</p>
        <p className="text-mist-400">
          {date}
          {o.status === 'completed' && o.dustCost !== null && <> · {t('trades.history.paid', { cost: fmtInt(o.dustCost, i18n.language) })}</>}
        </p>
      </div>
    </li>
  )
}

/** Link to the Trades screen with how many offers wait for me. */
export function TradesLink({ count }: { count: number }) {
  const { t } = useTranslation()
  return (
    <a href={hrefTo('trades')} className="inline-flex min-h-10 items-center gap-2 bg-dusk-800 px-3 font-display text-lg shadow-frame hover:bg-dusk-700">
      <PixelIcon name="reroll" size={20} />
      {t('trades.title')}
      {count > 0 && (
        <span className="grid h-5 min-w-5 place-items-center bg-cheek-500 px-1 font-num text-sm leading-none text-mist-50 shadow-frame" aria-label={t('trades.badge', { count })}>
          {count}
        </span>
      )}
    </a>
  )
}
