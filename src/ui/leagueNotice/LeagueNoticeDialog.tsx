import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, waveSizeForRank, weekKey, wildQualityForRank } from '../../engine'
import { leaderboardApi } from '../api/endpoints'
import { whatsNewDue } from '../changelog/WhatsNewDialog'
import { Button, Dialog, Mascot, PixelIcon, toast } from '../components'
import { setHintsHeld, useHints } from '../hints'
import { cx } from '../lib/cx'
import { errorText } from '../lib/errors'
import { fmtInt, fmtPct } from '../lib/format'
import { sfx } from '../lib/sound'
import { owedLevelUps } from '../levelUp/owed'
import { LEAGUE_STYLE, rankName } from '../screens/league/rank'
import { useNow } from '../store/clock'
import { phaseOf, useGame } from '../store/game'
import { usePhase } from '../store/selectors'
import { decideLeagueNotice, leagueNoticesKey, mergeLeagueNotices, type LeagueNews } from './leagueNotice'

/** After the trainer level-up window's settle delay, so the two never race for the same moment. */
const SETTLE_MS = 2200
const RETRY_MS = 1000

const anotherDialogOpen = (): boolean => typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

function currentPhase(): string {
  const { player, timer, outcome, breakTimer } = useGame.getState()
  return phaseOf({ player, timer, outcome, breakTimer }, Date.now())
}

/** Notices this device already showed (until the server empties them). */
const seen = new Set<string>()

/**
 * League news host (GDD §14). Mount once in the app shell.
 * - Asks the server to close the previous week (podium) once per local week; the prize arrives as a notice.
 * - Shows `PlayerState.pendingLeagueNotices` at a calm moment: a window for a new league or a podium, a toast
 *   for rungs inside the same league. Then sends `ackLeagueNotices`.
 */
export function LeagueNoticeHost() {
  const { t, i18n } = useTranslation()
  const phase = usePhase()
  const hintOpen = useHints((s) => s.active !== null)
  const pending = useGame((s) => s.player?.pendingLeagueNotices)
  const ack = useGame((s) => s.ackLeagueNotices)
  const load = useGame((s) => s.load)
  const hasPlayer = useGame((s) => s.player !== null)
  const tz = useGame((s) => s.player?.profile.timezone)
  const now = useNow()
  const [shown, setShown] = useState<LeagueNews | null>(null)

  // Close last week once per local week (the server ignores repeats and weeks that are not final yet).
  const week = hasPlayer && tz !== undefined ? weekKey({ profile: { timezone: tz } } as Parameters<typeof weekKey>[0], now) : null
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (!week || asked.current === week) return
    asked.current = week
    leaderboardApi
      .settlePodium()
      .then((r) => {
        if (r.settled && r.settled.dust > 0) void load()
        // Not final in every time zone yet: ask again on the next visit.
        if (!r.settled) asked.current = null
      })
      .catch(() => {
        asked.current = null
      })
    // Asked again only when the local week changes (or after a reload).
  }, [week, load])

  const owed = (pending?.length ?? 0) > 0 && !seen.has(leagueNoticesKey(pending ?? []))
  const idle = shown === null

  useEffect(() => {
    if (!idle || !owed) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      const list = useGame.getState().player?.pendingLeagueNotices ?? []
      const news = mergeLeagueNotices(list)
      const d = decideLeagueNotice({ news, phase: currentPhase(), hintOpen: useHints.getState().active !== null, otherDialogOpen: anotherDialogOpen(), whatsNewPending: whatsNewDue(), levelUpOwed: owedLevelUps().length > 0 })
      if (d === 'wait') {
        timer = setTimeout(attempt, RETRY_MS)
        return
      }
      if (d === 'none' || !news) return
      seen.add(leagueNoticesKey(list))
      if (d === 'dialog') setShown(news)
      else {
        const rank = news.climb ? rankName(t, news.climb.to) : ''
        const floor = news.climb ? wildQualityForRank(news.climb.to, defaultContext().config).ivFloor : 0
        const better = t('league.notice.toastQuality', { floor })
        toast.add({ title: t('league.notice.toast', { rank }), description: news.dust > 0 ? `${better} · ${t('league.notice.toastDust', { dust: fmtInt(news.dust, i18n.language) })}` : better, type: 'success' })
        void ack()
      }
    }
    timer = setTimeout(attempt, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [idle, owed, pending, phase, hintOpen, ack, t, i18n.language])

  useEffect(() => {
    if (idle) return
    setHintsHeld(true)
    return () => setHintsHeld(false)
  }, [idle])

  if (!shown) return null
  const close = () => {
    setShown(null)
    void ack().then((err) => {
      if (err) toast.add({ title: errorText(err), type: 'danger' })
    })
  }
  return <LeagueNoticeModal news={shown} onClose={close} />
}

/** The window itself (controlled, open). Exported for tests. */
export function LeagueNoticeModal({ news, onClose }: { news: LeagueNews; onClose: () => void }) {
  const { t } = useTranslation()
  useEffect(() => {
    sfx('leagueUp')
  }, [])
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      size="md"
      title={t(news.podiums.length > 0 ? 'league.notice.podiumTitle' : 'league.notice.title')}
      footer={
        <Button icon="star" onClick={onClose}>
          {t('league.notice.gotIt')}
        </Button>
      }
    >
      <LeagueNoticeBody news={news} />
    </Dialog>
  )
}

/** Podium colors, as in the rankings. */
const PLACE: Record<number, string> = { 1: 'bg-volt-400 text-ink', 2: 'bg-mist-300 text-ink', 3: 'bg-amber-400 text-ink' }

/** Mascot, the rank reached (or the podium place) and the Dust it gave. */
export function LeagueNoticeBody({ news }: { news: LeagueNews }) {
  const { t, i18n } = useTranslation()
  const cfg = defaultContext().config
  const { climb, podiums } = news
  const quality = wildQualityForRank(climb?.to ?? { league: 'base', sub: 1 }, cfg)
  return (
    <div className="flex flex-col items-center gap-4" aria-label={t('league.notice.label')}>
      <Mascot pose="cheer" size={96} />
      {podiums.map((p) => (
        <div key={p.weekKey} className="flex w-full items-center gap-3 bg-dusk-900 p-3 inset-shadow-well">
          <span className={cx('grid size-12 shrink-0 place-items-center font-num text-3xl leading-none shadow-frame', PLACE[p.place] ?? 'bg-dusk-700 text-mist-100')}>{p.place}</span>
          <p className="min-w-0 flex-1 text-sm text-mist-100">{t(p.scope === 'global' ? 'league.notice.podiumGlobal' : 'league.notice.podiumCountry', { place: p.place, rank: rankName(t, p.rank) })}</p>
        </div>
      ))}
      {climb && (
        <div className="flex w-full flex-col items-center gap-2">
          <span className={cx('inline-flex items-center gap-2 px-3 py-1.5 font-display text-xl shadow-plate', LEAGUE_STYLE[climb.to.league])}>
            <PixelIcon name="league" size={24} />
            {rankName(t, climb.to)}
          </span>
          <p className="text-center font-display text-lg text-volt-300">
            {climb.to.index > climb.from.index + 1 ? t('league.notice.fromTo', { from: rankName(t, climb.from), to: rankName(t, climb.to) }) : t('league.notice.reached', { rank: rankName(t, climb.to) })}
          </p>
          <p className="text-center text-sm text-mist-300">{t('league.notice.waves', { count: waveSizeForRank(climb.to, cfg) })}</p>
          <p className="w-full bg-dusk-900 p-3 text-center text-sm text-volt-300 inset-shadow-well">
            {t('league.notice.quality', { floor: quality.ivFloor, pct: fmtPct(quality.hiddenAbilityChance, i18n.language) })}
          </p>
        </div>
      )}
      {news.dust > 0 && (
        <section aria-label={t('league.notice.rewards')} className="flex w-full flex-col gap-2">
          <h3 className="font-display text-base text-mist-300">{t('league.notice.rewards')}</h3>
          <ul className="flex flex-col gap-1.5 bg-dusk-900 p-3 inset-shadow-well">
            <li className="flex items-center gap-2">
              <span className="grid h-8 w-10 place-items-center">
                <PixelIcon name="dust" size={20} className="text-exp-400" />
              </span>
              <span className="min-w-0 flex-1 text-sm">{t('items.dust')}</span>
              <span className="font-num text-xl leading-none tabular">+{fmtInt(news.dust, i18n.language)}</span>
            </li>
          </ul>
          <p className="text-sm text-mist-300">{t('league.notice.added')}</p>
        </section>
      )}
    </div>
  )
}
