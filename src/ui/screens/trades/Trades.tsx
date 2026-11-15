import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, tradeDustCostOf, type PlayerState } from '../../../engine'
import type { FriendSummary, TradeOfferView, TradePokemonView, TradesResponse } from '../../../game/protocol'
import { Button, Dialog, DialogClose, EmptyState, Mascot, Panel, PixelIcon, Sprite, Tabs, TextField, toast } from '../../components'
import { cx } from '../../lib/cx'
import { errorText } from '../../lib/errors'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { hrefTo, navigate, useRouteParams } from '../../router'
import { useNow } from '../../store/clock'
import { useGame } from '../../store/game'
import { useFriends } from '../../store/social'
import { useTrades } from '../../store/trades'
import { friendTradeState, tradeWarnings, type TradeWarning } from './eligibility'
import { DustChip, MonPicker, TradeStage, tradeErrorText, WarningList } from './TradeParts'

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

  // Which list is open. null = the default (where something waits for me); after sending an offer it jumps to «Sent».
  const [tab, setTab] = useState<TradeTab | null>(null)
  const newFor = params[0] === 'new' ? params[1] : undefined
  const friend = newFor ? friends?.find((f) => f.userId === newFor) : undefined

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl">
            <PixelIcon name="trade" size={30} className="text-volt-400" />
            {t('trades.title')}
          </h1>
          <p className="mt-1 max-w-[60ch] text-mist-300">{t('trades.subtitle')}</p>
        </div>
        {data && <TodayMeter used={data.today} limit={data.dailyLimit} />}
      </header>
      {newFor && player && data && (friend ? <NewOffer friend={friend} player={player} data={data} onSent={() => setTab('outgoing')} /> : friends && <p className="text-cheek-400">{t('trades.new.notFriend')}</p>)}
      {!newFor && friends && <FriendPicker friends={friends} />}
      {/* While composing the very first offer the big «no trades yet» state would only repeat the form above. */}
      {!(newFor && data && data.incoming.length + data.outgoing.length + data.history.length === 0) && <TradesView data={data} error={error} player={player} onRetry={() => void load()} tab={tab} onTab={setTab} />}
    </div>
  )
}

/** Trades left today as three pips (the daily limit), not a bare number. */
export function TodayMeter({ used, limit }: { used: number; limit: number }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2" role="img" aria-label={t('trades.today', { count: used, limit })}>
      <span className="font-display text-base text-mist-300" aria-hidden>
        {t('trades.todayShort')}
      </span>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: limit }, (_, i) => (
          <span key={i} className={cx('size-3.5 shadow-frame', i < used ? 'bg-dusk-600' : 'bg-volt-400')} />
        ))}
      </span>
    </div>
  )
}

/** "Offer to…": the friends I can trade with right now, one tap to start. */
function FriendPicker({ friends }: { friends: FriendSummary[] }) {
  const { t, i18n } = useTranslation()
  const now = useNow()
  const accepted = friends.filter((f) => f.status === 'friend')
  if (accepted.length === 0) return null
  return (
    <Panel title={t('trades.pickFriend.title')} variant="frame" headingLevel={2}>
      <ul className="flex flex-wrap gap-2">
        {accepted.map((f) => {
          const s = friendTradeState(f, now)
          const lead = f.team?.[0]
          return (
            <li key={f.userId}>
              {s.ok ? (
                <a href={hrefTo('trades', 'new', f.userId)} className="flex min-h-12 items-center gap-2 bg-dusk-800 py-1 pr-3 pl-1 font-display text-lg shadow-frame hover:-translate-y-0.5 hover:bg-dusk-700">
                  <span className="grid h-10 w-12 place-items-center bg-dusk-900">{lead && <Sprite kind="icon" slug={lead.speciesSlug} shiny={lead.shiny} alt="" />}</span>
                  {f.trainerName}
                </a>
              ) : (
                <span className="flex min-h-12 items-center gap-2 bg-dusk-900 py-1 pr-3 pl-2 text-mist-400 inset-shadow-well">
                  <PixelIcon name="lock" size={14} />
                  <span>
                    <span className="block font-display text-lg leading-tight">{f.trainerName}</span>
                    <span className="block text-xs">
                      {s.reason === 'too_new' ? t('trades.pickFriend.from', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(s.readyAt) }) : ''}
                    </span>
                  </span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

export type TradeTab = 'incoming' | 'outgoing' | 'history'

/** The list to open on: where something waits for my answer, else the first one that has anything (never an empty tab with another full). */
export function defaultTradeTab(data: Pick<TradesResponse, 'incoming' | 'outgoing' | 'history'>): TradeTab {
  const turn = (offers: TradeOfferView[]) => offers.filter((o) => o.myTurn).length
  if (turn(data.incoming) > 0) return 'incoming'
  if (turn(data.outgoing) > 0) return 'outgoing'
  if (data.incoming.length > 0) return 'incoming'
  if (data.outgoing.length > 0) return 'outgoing'
  return data.history.length > 0 ? 'history' : 'incoming'
}

/** The three lists (server-renderable: everything comes in through props). */
export function TradesView({
  data,
  error,
  player,
  onRetry,
  tab = null,
  onTab,
}: {
  data: TradesResponse | null
  error: string | null
  player: PlayerState | null
  onRetry?: () => void
  /** Controlled tab (null = let the view pick: the list where something waits for me). */
  tab?: TradeTab | null
  onTab?: (tab: TradeTab) => void
}) {
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
  const nothingYet = data.incoming.length + data.outgoing.length + data.history.length === 0
  if (nothingYet) {
    return (
      <div className="bg-dusk-900 inset-shadow-well">
        <EmptyState
          pose="point"
          title={t('trades.empty.title')}
          body={t('trades.empty.body')}
          action={
            <a href={hrefTo('friends')} className="inline-flex min-h-10 items-center gap-2 bg-volt-400 px-4 font-display text-lg text-ink shadow-frame hover:bg-volt-300">
              <PixelIcon name="friends" size={20} />
              {t('trades.empty.toFriends')}
            </a>
          }
        />
      </div>
    )
  }
  return <TradeTabs data={data} player={player} tab={tab} onTab={onTab} />
}

/** What each empty list says: where the offers will show up and how to get one going (not a bare "nothing"). */
function TabEmpty({ kind }: { kind: TradeTab }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-2 bg-dusk-900 px-6 py-8 text-center inset-shadow-well">
      <Mascot pose={kind === 'history' ? 'idle' : 'think'} size={48} />
      <p className="font-display text-lg">{t(`trades.empty.${kind}`)}</p>
      <p className="max-w-[44ch] text-sm text-mist-300">{t(`trades.empty.${kind}Body`)}</p>
    </div>
  )
}

function TradeTabs({ data, player, tab, onTab }: { data: TradesResponse; player: PlayerState; tab: TradeTab | null; onTab?: (tab: TradeTab) => void }) {
  const { t } = useTranslation()
  const turn = (offers: TradeOfferView[]) => offers.filter((o) => o.myTurn).length
  // Frozen at first render: open where something waits for me, then stay put until the player (or sending an offer) moves it.
  const [initial] = useState<TradeTab>(() => defaultTradeTab(data))
  const [own, setOwn] = useState<TradeTab | null>(null)
  const value = tab ?? own ?? initial
  const list = (offers: TradeOfferView[], key: 'incoming' | 'outgoing') =>
    offers.length === 0 ? (
      <TabEmpty kind={key} />
    ) : (
      <ul className="flex flex-col gap-6">
        {offers.map((o) => (
          <OfferCard key={o.id} offer={o} player={player} data={data} />
        ))}
      </ul>
    )
  const tabLabel = (text: string, n: number) => (
    <span className="flex items-center gap-1.5">
      {text}
      {n > 0 && <span className="grid h-4 min-w-4 place-items-center bg-cheek-500 px-0.5 font-num text-sm leading-none text-mist-50">{n}</span>}
    </span>
  )
  return (
    <Tabs
      label={t('trades.tabs.label')}
      value={value}
      onValueChange={(v) => {
        setOwn(v as TradeTab)
        onTab?.(v as TradeTab)
      }}
      items={[
        { value: 'incoming', label: tabLabel(t('trades.tabs.incoming', { count: data.incoming.length }), turn(data.incoming)), content: list(data.incoming, 'incoming') },
        { value: 'outgoing', label: tabLabel(t('trades.tabs.outgoing', { count: data.outgoing.length }), turn(data.outgoing)), content: list(data.outgoing, 'outgoing') },
        {
          value: 'history',
          label: t('trades.tabs.history'),
          content:
            data.history.length === 0 ? (
              <TabEmpty kind="history" />
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

/** What the other player sees of one of my Pokémon (to preview the stage before sending). */
function viewOf(player: PlayerState, uid: string): TradePokemonView | null {
  const p = player.pokemon[uid]
  if (!p) return null
  return {
    uid,
    speciesSlug: p.speciesSlug,
    level: p.level,
    ivs: p.ivs,
    nature: p.nature,
    ability: p.ability,
    isShiny: p.isShiny,
    equippedMoves: p.equippedMoves,
    moves: [],
    moveMasteryMinutes: p.moveMasteryMinutes,
    traded: p.traded,
    mintNature: p.mintNature,
    bottleCapped: p.bottleCapped,
    teraType: p.teraType,
    teraUntil: p.teraUntil,
  }
}

/** The final check before a trade step: the stage again, the cost and the warnings, in one dialog. */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  give,
  get,
  partner,
  cost,
  warnings,
  confirm,
  busy,
  onConfirm,
  note,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  give: TradePokemonView | null
  get: TradePokemonView | null
  partner: string
  cost: number | null
  warnings: TradeWarning[]
  confirm: string
  busy: boolean
  onConfirm: () => void
  note?: string
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={title}
      description={note}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
          <Button icon="check" disabled={busy} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TradeStage
          left={{ label: t('trades.card.youGive'), mon: give }}
          right={{ label: t('trades.card.youGet'), mon: get, pending: t('trades.card.theyPick', { name: partner }) }}
          center={cost !== null ? <DustChip cost={cost} /> : undefined}
        />
        <WarningList warnings={warnings} />
      </div>
    </Dialog>
  )
}

/** Start an offer to a friend: pick my Pokémon, optional message, confirm. */
function NewOffer({ friend, player, data, onSent }: { friend: FriendSummary; player: PlayerState; data: TradesResponse; onSent?: () => void }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const now = useNow()
  const offer = useTrades((s) => s.offer)
  const [uid, setUid] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const { busy, run } = useRun()
  const max = defaultContext().config.trade.messageMax
  const state = friendTradeState(friend, now)
  const mine = uid ? player.pokemon[uid] : undefined
  const minCost = mine ? tradeDustCostOf(mine) : null
  // Before the friend picks, only the warnings about what I give apply (theirs come with the counteroffer).
  const mineOnly = mine ? tradeWarnings(player, mine, uid, now).warnings.filter((w) => w.kind === 'savedTeam' || w.kind === 'legendaryOnce' || w.kind === 'dailyLimit') : []
  const limitReached = mineOnly.some((w) => w.kind === 'dailyLimit')
  return (
    <Panel title={t('trades.new.title', { name: friend.trainerName })} className="outline-2 -outline-offset-2 outline-volt-400/60">
      {!state.ok ? (
        <p className="text-cheek-400">
          {state.reason === 'too_new'
            ? t('trades.friend.tooNew', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(state.readyAt) })
            : t('trades.new.notFriend')}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="max-w-[65ch] text-mist-300">{t('trades.new.how', { name: friend.trainerName })}</p>
          <MonPicker player={player} lockedUids={data.lockedUids} selected={uid} onSelect={setUid} />
          {mine && (
            <TradeStage
              left={{ label: t('trades.card.youGive'), mon: viewOf(player, mine.uid) }}
              right={{ label: t('trades.card.youGet'), mon: null, pending: t('trades.card.theyPick', { name: friend.trainerName }) }}
              center={<span className="text-sm text-mist-300">{t('trades.new.cost', { cost: fmtInt(minCost ?? 0, i18n.language) })}</span>}
            />
          )}
          {mine && <WarningList warnings={mineOnly} />}
          <TextField
            label={t('trades.new.message')}
            placeholder={t('trades.new.messagePlaceholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={max * 2}
            hint={t('trades.new.messageHint', { max })}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button icon="trade" disabled={!mine || busy || limitReached} onClick={() => setConfirming(true)}>
              {mine ? t('trades.new.sendNamed', { name: names.pokemon(mine) }) : t('trades.new.send')}
            </Button>
            <Button variant="ghost" onClick={() => navigate('trades')}>
              {t('common.cancel')}
            </Button>
          </div>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t('trades.confirm.offerTitle', { name: friend.trainerName })}
            note={t('trades.confirm.offerNote', { name: friend.trainerName })}
            give={uid ? viewOf(player, uid) : null}
            get={null}
            partner={friend.trainerName}
            cost={null}
            warnings={mineOnly}
            confirm={t('trades.new.send')}
            busy={busy}
            onConfirm={async () => {
              if (!uid) return
              const ok = await run(() => offer(friend.userId, uid, message.trim() || null), t('trades.new.sent', { name: friend.trainerName }))
              setConfirming(false)
              if (ok) {
                onSent?.()
                navigate('trades')
              }
            }}
          />
        </div>
      )}
    </Panel>
  )
}

/** An open offer: the stage with both sides, the cost, the warnings and the buttons of whoever has to act. */
export function OfferCard({ offer: o, player, data }: { offer: TradeOfferView; player: PlayerState; data: Pick<TradesResponse, 'lockedUids'> }) {
  const { t } = useTranslation()
  const names = useNames()
  const now = useNow()
  const counter = useTrades((s) => s.counter)
  const accept = useTrades((s) => s.accept)
  const reject = useTrades((s) => s.reject)
  const cancel = useTrades((s) => s.cancel)
  const [picking, setPicking] = useState(false)
  const [uid, setUid] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const { busy, run } = useRun()
  const sender = o.role === 'sender'
  const partner = o.partner.trainerName
  const hours = Math.max(1, Math.ceil((o.expiresAt - now) / 3_600_000))

  // Receiver picking what to give back: the stage previews the pick.
  const picked = uid ? viewOf(player, uid) : null
  const pickWarnings = !sender && o.status === 'offered' ? tradeWarnings(player, o.offer, uid, now) : null
  // Sender confirming the counteroffer.
  const confirmWarnings = sender && o.status === 'countered' && o.counter ? tradeWarnings(player, o.counter, o.offer.uid, now) : null

  const mineView = sender ? o.offer : (o.counter ?? (picking ? picked : null))
  const theirView = sender ? o.counter : o.offer
  const cost = o.dustCost ?? (picked ? Math.max(tradeDustCostOf(picked), tradeDustCostOf(o.offer)) : null)

  return (
    <li className={cx('flex flex-col gap-3 bg-dusk-800 p-3 shadow-frame sm:p-4', o.myTurn && 'outline-2 -outline-offset-2 outline-volt-400/70')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-xl leading-tight">{sender ? t('trades.card.toFriend', { name: partner }) : t('trades.card.fromFriend', { name: partner })}</p>
        <p className="flex items-center gap-1 text-sm text-mist-400">
          <PixelIcon name="clock" size={14} />
          {t('trades.card.expires', { count: hours })}
        </p>
      </div>
      {o.message && (
        <p className="relative max-w-[60ch] self-start bg-mist-50 px-3 py-2 text-ink shadow-raised">
          <span className="sr-only">{t('trades.card.messageFrom', { name: sender ? t('trades.card.you') : partner })}</span>
          {o.message}
        </p>
      )}
      <TradeStage
        live={o.myTurn}
        left={{ label: t('trades.card.youGive'), mon: mineView, pending: sender ? undefined : t('trades.card.youPick') }}
        right={{ label: t('trades.card.youGet'), mon: theirView, pending: t('trades.card.theyPick', { name: partner }) }}
        center={cost !== null ? <DustChip cost={cost} /> : undefined}
      />

      {/* Receiver: pick and send the counteroffer. */}
      {!sender && o.status === 'offered' && (
        <div className="flex flex-col gap-3">
          {pickWarnings && <WarningList warnings={pickWarnings.warnings.filter((w) => picking || w.kind !== 'savedTeam')} />}
          {picking ? (
            <>
              <p className="font-display text-lg">{t('trades.card.pickTitle', { name: partner })}</p>
              <MonPicker player={player} lockedUids={data.lockedUids} selected={uid} onSelect={setUid} />
              <div className="flex flex-wrap gap-2">
                <Button icon="trade" disabled={!picked || busy || pickWarnings?.blocking} onClick={() => setConfirming(true)}>
                  {picked ? t('trades.card.sendCounter', { name: names.species(picked.speciesSlug) }) : t('trades.card.pickFirst')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPicking(false)
                    setUid(null)
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button icon="box" disabled={busy || o.offer.missing || pickWarnings?.warnings.some((w) => w.kind === 'overLevelCap' || w.kind === 'dailyLimit')} onClick={() => setPicking(true)}>
                {t('trades.card.pick')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => reject(o.id), t('trades.card.rejected'))}>
                {t('trades.card.reject')}
              </Button>
            </div>
          )}
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t('trades.confirm.counterTitle', { name: partner })}
            note={t('trades.confirm.counterNote', { name: partner })}
            give={picked}
            get={o.offer}
            partner={partner}
            cost={cost}
            warnings={pickWarnings?.warnings ?? []}
            confirm={t('trades.confirm.counterButton')}
            busy={busy}
            onConfirm={async () => {
              if (!uid) return
              const ok = await run(() => counter(o.id, uid), t('trades.card.countered', { name: partner }))
              setConfirming(false)
              if (ok) setPicking(false)
            }}
          />
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
            <Button icon="check" disabled={busy || confirmWarnings?.blocking || o.counter?.missing || o.offer.missing} onClick={() => setConfirming(true)}>
              {t('trades.card.accept')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => reject(o.id), t('trades.card.rejected'))}>
              {t('trades.card.rejectCounter')}
            </Button>
          </div>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t('trades.confirm.acceptTitle', { name: partner })}
            note={t('trades.confirm.acceptNote')}
            give={o.offer}
            get={o.counter}
            partner={partner}
            cost={o.dustCost}
            warnings={confirmWarnings?.warnings ?? []}
            confirm={t('trades.card.accept')}
            busy={busy}
            onConfirm={async () => {
              await run(() => accept(o.id), t('trades.card.done', { name: partner }))
              setConfirming(false)
            }}
          />
        </div>
      )}
    </li>
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
  const done = o.status === 'completed'
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(o.completedAt ?? o.updatedAt)
  const status = o.status === 'rejected' || o.status === 'cancelled' ? t(`trades.status.${o.status}${o.closedByMe ? 'Me' : 'Them'}`, { name: o.partner.trainerName }) : t(`trades.status.${o.status}`)
  const icon = (m: TradePokemonView | null, evolved?: string | null) =>
    m ? (
      <span className="grid h-10 w-12 shrink-0 place-items-center bg-dusk-800">
        <Sprite kind="icon" slug={evolved ?? m.speciesSlug} shiny={m.isShiny} alt="" />
      </span>
    ) : null
  return (
    <li className={cx('flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well sm:flex-row sm:items-center sm:gap-3', !done && 'opacity-75')}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
          {icon(gave)}
          <PixelIcon name={done ? 'trade' : 'close'} size={14} className={done ? 'text-volt-400' : 'text-mist-400'} />
          {done && icon(got, gotEvolved)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base leading-tight">{t('trades.history.with', { name: o.partner.trainerName })}</p>
          <p className="text-sm text-mist-300">
            {done && gave && got
              ? t('trades.history.swap', {
                  gave: names.species(gave.speciesSlug),
                  got: gotEvolved ? t('trades.history.evolved', { from: names.species(got.speciesSlug), to: names.species(gotEvolved) }) : names.species(got.speciesSlug),
                })
              : t('trades.history.offered', { name: names.species(o.offer.speciesSlug) })}
          </p>
        </div>
      </div>
      {/* Phones: status, date and Dust on one line under the text, not a column that squeezes it. */}
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm sm:block sm:text-right">
        <p className={done ? 'text-volt-300' : 'text-mist-300'}>{status}</p>
        <p className="text-mist-400">{date}</p>
        {done && o.dustCost !== null && <p className="text-mist-400">{t('trades.history.paid', { cost: fmtInt(o.dustCost, i18n.language) })}</p>}
      </div>
    </li>
  )
}

/** Link to the Trades screen with how many offers wait for me. */
export function TradesLink({ count }: { count: number }) {
  const { t } = useTranslation()
  return (
    <a href={hrefTo('trades')} className="inline-flex min-h-10 items-center gap-2 bg-dusk-800 px-3 font-display text-lg shadow-frame hover:bg-dusk-700">
      <PixelIcon name="trade" size={20} />
      {t('trades.title')}
      {count > 0 && (
        <span className="grid h-5 min-w-5 place-items-center bg-cheek-500 px-1 font-num text-sm leading-none text-mist-50 shadow-frame" aria-label={t('trades.badge', { count })}>
          {count}
        </span>
      )}
    </a>
  )
}
