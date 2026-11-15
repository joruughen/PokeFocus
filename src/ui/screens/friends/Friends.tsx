import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { LeagueId } from '../../../engine'
import type { FriendSummary } from '../../../game/protocol'
import { Button, Dialog, DialogClose, EmptyState, HelpDot, IconButton, Panel, PixelIcon, Sprite, TextField, toast, Tooltip } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { countryName, flagEmoji } from '../../lib/countries'
import { cx } from '../../lib/cx'
import { errorText, requestErrorText } from '../../lib/errors'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { useAuth } from '../../store/auth'
import { useFriends } from '../../store/social'
import { useNow } from '../../store/clock'
import { useTradeTurnCount } from '../../store/trades'
import { hrefTo } from '../../router'
import { friendTradeState } from '../trades/eligibility'
import { TradesLink } from '../trades/Trades'

const LEAGUE_STYLE: Record<string, string> = {
  base: 'bg-dusk-600 text-mist-100',
  super: 'bg-exp-400 text-ink',
  ultra: 'bg-volt-400 text-ink',
  master: 'bg-type-psychic text-ink',
}

/** Friend codes use 8 characters from an alphabet without 0/O/1/I. */
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

function normalizeCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** "ABCDEFGH" → "ABCD EFGH" (easier to read aloud and compare). */
function spaced(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code
}

/**
 * Friends (`#/friends`): share your code, add by code, answer requests, and
 * see your friends' level, league, weekly points and team. Updates live on
 * the SSE 'friends' event (store/social.ts).
 */
export default function Friends() {
  useHintScreen('friends')
  const { t } = useTranslation()
  const friends = useFriends((s) => s.friends)
  const error = useFriends((s) => s.error)
  const load = useFriends((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])

  const accepted = friends?.filter((f) => f.status === 'friend') ?? []
  const incoming = friends?.filter((f) => f.status === 'incoming') ?? []
  const outgoing = friends?.filter((f) => f.status === 'outgoing') ?? []
  const sorted = [...accepted].sort((a, b) => (b.weeklyPoints ?? 0) - (a.weeklyPoints ?? 0))
  const tradeTurns = useTradeTurnCount()

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-3xl">
            {t('friends.title')}
            <HelpDot hint="friends.code" />
          </h1>
          <p className="mt-1 max-w-[60ch] text-mist-300">{t('friends.subtitle')}</p>
        </div>
        <TradesLink count={tradeTurns} />
      </header>

      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <MyCode />
        <AddFriend />
      </div>

      {incoming.length > 0 && (
        <Panel title={t('friends.incoming', { count: incoming.length })} className="outline-2 -outline-offset-2 outline-volt-400/60">
          <ul className="flex flex-col gap-2">
            {incoming.map((f) => (
              <RequestRow key={f.userId} friend={f} kind="incoming" />
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={t('friends.listTitle', { count: accepted.length })}>
        {friends === null ? (
          error ? (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-cheek-400">{errorText(error)}</p>
              <Button size="sm" variant="secondary" icon="reroll" onClick={() => void load()}>
                {t('auth.splash.retry')}
              </Button>
            </div>
          ) : (
            <p role="status" className="py-8 text-center font-display text-lg text-mist-400">
              {t('common.loading')}
            </p>
          )
        ) : sorted.length === 0 ? (
          <div className="bg-dusk-900 inset-shadow-well">
            <EmptyState pose="point" title={t('friends.empty.title')} body={t('friends.empty.body')} />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {sorted.map((f) => (
              <FriendCard key={f.userId} friend={f} />
            ))}
          </ul>
        )}
      </Panel>

      {outgoing.length > 0 && (
        <Panel variant="frame" title={t('friends.outgoing', { count: outgoing.length })} headingLevel={3}>
          <ul className="flex flex-col gap-2">
            {outgoing.map((f) => (
              <RequestRow key={f.userId} friend={f} kind="outgoing" />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

/**
 * Clipboard API when available; otherwise (plain-HTTP origins are not a secure
 * context, so navigator.clipboard is undefined) the legacy execCommand path.
 */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('copy_failed')
}

/** My code on a light "trainer ID" plate, with a copy button. */
function MyCode() {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)
  const [copied, setCopied] = useState(false)
  if (!user) return null
  const copy = async () => {
    try {
      await copyText(user.friendCode)
      setCopied(true)
      toast.add({ title: t('friends.copied'), type: 'success' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.add({ title: t('friends.copyFailed'), type: 'danger' })
    }
  }
  return (
    <Panel title={t('friends.myCode')} {...hintAnchor('friends.code')}>
      <div className="flex flex-wrap items-center gap-4 bg-mist-50 p-4 text-ink shadow-raised">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base">{user.trainerName}</p>
          <p className="font-num text-[2.5rem] leading-none tracking-[0.12em] whitespace-nowrap tabular select-all" aria-label={t('friends.codeAria', { code: user.friendCode.split('').join(' ') })}>
            {spaced(user.friendCode)}
          </p>
        </div>
        <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
          {copied ? t('friends.copiedShort') : t('friends.copy')}
        </Button>
      </div>
      <p className="mt-3 text-sm text-mist-300">{t('friends.codeNote')}</p>
    </Panel>
  )
}

function AddFriend() {
  const { t } = useTranslation()
  const request = useFriends((s) => s.request)
  const myCode = useAuth((s) => s.user?.friendCode ?? '')
  const [code, setCode] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clean = normalizeCode(code)
  const invalid = !CODE_RE.test(clean) ? 'friends.invalidCode' : clean === myCode ? 'friends.ownCode' : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      const status = await request(clean)
      setCode('')
      setTried(false)
      if (status === 'friend') toast.add({ title: t('friends.connected'), type: 'success' })
      else toast.add({ title: t('friends.sent'), description: t('friends.sentBody'), type: 'success' })
    } catch (err) {
      setError(requestErrorText(err, 'friends'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('friends.addTitle')} {...hintAnchor('friends.add')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <TextField
            className="min-w-56 flex-1"
            label={t('friends.codeLabel')}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD EFGH"
            error={(tried && invalid ? t(invalid) : null) ?? error}
            hint={t('friends.codeHint')}
          />
          <Button type="submit" icon="plus" disabled={busy} className="mt-8">
            {t('friends.send')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function Who({ friend }: { friend: FriendSummary }) {
  const { i18n } = useTranslation()
  return (
    <span className="min-w-0">
      <span className="block truncate font-display text-lg leading-tight">{friend.trainerName}</span>
      <span className="block text-xs text-mist-400">
        <span aria-hidden>{flagEmoji(friend.country)} </span>
        {countryName(friend.country, i18n.language)}
      </span>
    </span>
  )
}

function RequestRow({ friend, kind }: { friend: FriendSummary; kind: 'incoming' | 'outgoing' }) {
  const { t } = useTranslation()
  const accept = useFriends((s) => s.accept)
  const remove = useFriends((s) => s.remove)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.add({ title: ok, type: 'success' })
    } catch (err) {
      toast.add({ title: requestErrorText(err, 'friends'), type: 'danger' })
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-3 bg-dusk-900 p-3 inset-shadow-well">
      <PixelIcon name="user" size={20} className="shrink-0 text-mist-300" />
      <div className="min-w-0 flex-1">
        <Who friend={friend} />
      </div>
      {kind === 'incoming' ? (
        <div className="flex gap-2">
          <Button size="sm" icon="check" disabled={busy} onClick={() => void run(() => accept(friend.userId), t('friends.accepted', { name: friend.trainerName }))}>
            {t('friends.accept')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => remove(friend.userId), t('friends.declined', { name: friend.trainerName }))}>
            {t('friends.decline')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm text-mist-400">{t('friends.waiting')}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => remove(friend.userId), t('friends.canceled', { name: friend.trainerName }))}>
            {t('friends.cancelRequest')}
          </Button>
        </div>
      )}
    </li>
  )
}

function FriendCard({ friend }: { friend: FriendSummary }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const remove = useFriends((s) => s.remove)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const league = friend.league ?? 'base'
  const team = friend.team ?? []
  return (
    <li className="flex flex-col gap-3 bg-dusk-900 p-4 inset-shadow-well">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Who friend={friend} />
          {friend.trainerLevel !== undefined && <p className="mt-1 text-sm text-mist-300">{t('trainer.level', { level: friend.trainerLevel })}</p>}
        </div>
        <div className="text-right">
          <p className="font-num text-3xl leading-none tabular">{fmtInt(friend.weeklyPoints ?? 0, i18n.language)}</p>
          <p className="text-xs text-mist-400">{t('league.weekPoints')}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ul className="flex items-end gap-1" aria-label={t('friends.teamOf', { name: friend.trainerName })}>
          {team.length === 0 && <li className="text-sm text-mist-400">{t('friends.noTeam')}</li>}
          {team.map((m, i) => (
            <li key={`${m.speciesSlug}-${i}`} className="relative">
              <Tooltip content={t('friends.member', { name: names.species(m.speciesSlug), level: m.level })}>
                <span tabIndex={0} className={cx('grid h-10 w-12 place-items-center', i === 0 && 'bg-dusk-800 shadow-frame')}>
                  <Sprite kind="icon" slug={m.speciesSlug} shiny={m.shiny} alt={names.species(m.speciesSlug)} />
                </span>
              </Tooltip>
              {i === 0 && <PixelIcon name="crown" size={10} className="absolute -top-2 left-1/2 -translate-x-1/2 text-volt-400" label={t('friends.leader')} />}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <TradeButton friend={friend} />
          <Tooltip content={t(`league.names.${league as LeagueId}`, { defaultValue: league })}>
            <span tabIndex={0} className={cx('inline-flex h-7 items-center px-2 font-display text-base shadow-frame', LEAGUE_STYLE[league] ?? LEAGUE_STYLE.base)}>
              {t(`league.short.${league as LeagueId}`, { defaultValue: league })}
            </span>
          </Tooltip>
          <IconButton icon="trash" size="sm" variant="ghost" label={t('friends.removeOf', { name: friend.trainerName })} onClick={() => setConfirm(true)} />
        </div>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('friends.removeTitle', { name: friend.trainerName })}
        description={t('friends.removeBody')}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t('common.cancel')}</Button>} />
            <Button
              variant="danger"
              icon="trash"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await remove(friend.userId)
                  setConfirm(false)
                  toast.add({ title: t('friends.removed', { name: friend.trainerName }), type: 'success' })
                } catch (err) {
                  toast.add({ title: requestErrorText(err, 'friends'), type: 'danger' })
                  setBusy(false)
                }
              }}
            >
              {t('friends.remove')}
            </Button>
          </>
        }
      />
    </li>
  )
}

/** «Trade» with this friend: a link to a new offer, or disabled with the reason (friends for less than 3 days). */
function TradeButton({ friend }: { friend: FriendSummary }) {
  const { t, i18n } = useTranslation()
  const now = useNow()
  const state = friendTradeState(friend, now)
  if (state.ok) {
    return (
      <a href={hrefTo('trades', 'new', friend.userId)} className="inline-flex h-8 items-center gap-1.5 bg-dusk-700 px-2 font-display text-base shadow-frame hover:bg-dusk-600" aria-label={t('trades.friend.buttonOf', { name: friend.trainerName })}>
        <PixelIcon name="trade" size={14} />
        {t('trades.friend.button')}
      </a>
    )
  }
  const reason = state.reason === 'too_new' ? t('trades.friend.tooNew', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(state.readyAt) }) : t('trades.new.notFriend')
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} role="button" aria-disabled="true" aria-label={`${t('trades.friend.buttonOf', { name: friend.trainerName })}. ${reason}`} className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 bg-dusk-800 px-2 font-display text-base text-mist-400 opacity-70 shadow-frame">
        <PixelIcon name="lock" size={14} />
        {t('trades.friend.button')}
      </span>
    </Tooltip>
  )
}
