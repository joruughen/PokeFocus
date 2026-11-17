import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { weeklyLadderOf } from '../../../engine'
import type { LeaderboardPeriod, LeaderboardResponse, LeaderboardRow, LeaderboardScope } from '../../../game/protocol'
import { leaderboardApi } from '../../api/endpoints'
import { Button, EmptyState, Panel, PixelIcon, Segmented, Select, Sprite, Tooltip } from '../../components'
import { hintAnchor } from '../../hints'
import { countryName, flagEmoji } from '../../lib/countries'
import { cx } from '../../lib/cx'
import { requestErrorText } from '../../lib/errors'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { navigate } from '../../router'
import { useAuth } from '../../store/auth'
import { useGame } from '../../store/game'
import { useContent } from '../../store/content'
import { LEAGUE_STYLE, rankName, rankShort } from './rank'

/** Podium colors for ranks 1–3 (gold is the app's one accent). */
const PODIUM: Record<number, string> = {
  1: 'bg-volt-400 text-ink',
  2: 'bg-mist-300 text-ink',
  3: 'bg-amber-400 text-ink',
}

type State = { key: string; data: LeaderboardResponse | null; error: string | null }

/**
 * Rankings (GET /api/leaderboard): my country, global or friends × this week or this month, limited to one
 * rank of the ladder (mine by default), to any other, or to none. Top 100 with my row highlighted; if I'm
 * further down, my row is pinned under the table. A country with too few trainers in a rank shows the global
 * board of that rank, with a note.
 */
export function Leaderboards() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const country = useAuth((s) => s.user?.country ?? '')
  const version = useGame((s) => s.version)
  // The ladder comes from the live config (re-read when the content changes).
  const cfg = useContent().config
  const [scope, setScope] = useState<LeaderboardScope>('country')
  const [period, setPeriod] = useState<LeaderboardPeriod>('week')
  const [rank, setRank] = useState('mine')
  const [state, setState] = useState<State>({ key: '', data: null, error: null })
  const [retry, setRetry] = useState(0)
  // Friends are few: their board is never cut by rank.
  const rankFilter = scope === 'friends' ? 'all' : rank
  const key = `${scope}:${period}:${rankFilter}`

  useEffect(() => {
    let alive = true
    leaderboardApi
      .get(scope, period, rankFilter)
      .then((data) => alive && setState({ key, data, error: null }))
      .catch((e: unknown) => alive && setState((s) => ({ key, data: s.key === key ? s.data : null, error: requestErrorText(e) })))
    return () => {
      alive = false
    }
    // `version`: my points change after a claim (here or in another tab), so refresh.
  }, [scope, period, rankFilter, key, version, retry])

  const current = state.key === key ? state : null
  const data = current?.data ?? null
  const mineOutside = data?.mine && !data.rows.some((r) => r.me) ? data.mine : null
  // The last answer names my rank even while another board loads.
  const myRank = (data ?? state.data)?.myRank ?? null
  const rankOptions = [
    { value: 'mine', label: myRank ? t('leaderboard.rankMine', { rank: rankShort(t, myRank) }) : t('leaderboard.rankMine', { rank: '…' }) },
    { value: 'all', label: t('leaderboard.rankAll') },
    ...weeklyLadderOf(cfg).map((r) => ({ value: `${r.league}:${r.sub}`, label: rankName(t, r) })),
  ]

  return (
    <Panel title={t('leaderboard.title')} help="league.leaderboards" {...hintAnchor('league.leaderboards')}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <Segmented<LeaderboardScope>
          label={t('leaderboard.scopeLabel')}
          value={scope}
          onChange={setScope}
          options={[
            {
              value: 'country',
              label: (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="text-lg leading-none">
                    {flagEmoji(country)}
                  </span>
                  {t('leaderboard.scope.country')}
                </span>
              ),
              ariaLabel: t('leaderboard.scope.countryOf', { country: countryName(country, lng) }),
            },
            { value: 'global', label: <ScopeLabel icon="globe" text={t('leaderboard.scope.global')} />, ariaLabel: t('leaderboard.scope.global') },
            { value: 'friends', label: <ScopeLabel icon="friends" text={t('leaderboard.scope.friends')} />, ariaLabel: t('leaderboard.scope.friends') },
          ]}
        />
        <Segmented<LeaderboardPeriod>
          label={t('leaderboard.periodLabel')}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: t('leaderboard.period.week') },
            { value: 'month', label: t('leaderboard.period.month') },
          ]}
        />
        {scope !== 'friends' && <Select className="w-full sm:w-64" label={t('leaderboard.rankLabel')} value={rank} onChange={setRank} options={rankOptions} />}
      </div>

      {data?.fallback && data.rank && (
        <p role="status" className="mb-3 flex items-start gap-2 bg-dusk-900 p-3 text-sm text-mist-100 inset-shadow-well">
          <PixelIcon name="globe" size={16} className="mt-0.5 shrink-0 text-volt-400" />
          {t('leaderboard.fallback', { min: data.fallback.minPlayers, rank: rankName(t, data.rank) })}
        </p>
      )}

      {data && (
        <p className="mb-3 text-sm text-mist-300">
          {periodLabel(data, lng, t)} {data.rank ? t('leaderboard.totalRank', { count: data.total, rank: rankName(t, data.rank) }) : t('leaderboard.total', { count: data.total })}
        </p>
      )}

      {current?.error && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 bg-dusk-900 p-4 inset-shadow-well">
          <p className="flex-1 text-cheek-400">{current.error}</p>
          <Button size="sm" variant="secondary" icon="reroll" onClick={() => setRetry((n) => n + 1)}>
            {t('auth.splash.retry')}
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className="py-10 text-center font-display text-lg text-mist-400">
          {t('common.loading')}
        </p>
      ) : data.rows.length === 0 ? (
        data.rank && data.rank.index !== data.myRank.index ? (
          <div className="bg-dusk-900 inset-shadow-well">
            <EmptyState
              pose="think"
              title={t('leaderboard.empty.rankTitle', { rank: rankName(t, data.rank) })}
              body={t('leaderboard.empty.rankBody')}
              action={
                <Button variant="secondary" onClick={() => setRank('mine')}>
                  {t('leaderboard.rankMine', { rank: rankShort(t, data.myRank) })}
                </Button>
              }
            />
          </div>
        ) : (
          <EmptyLeaderboard scope={scope} period={period} />
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-separate border-spacing-y-1.5 text-left">
            <caption className="sr-only">{t('leaderboard.caption', { scope: t(`leaderboard.scope.${data.scope}`), period: t(`leaderboard.period.${period}`) })}</caption>
            <thead className="text-xs text-mist-400">
              <tr>
                <th scope="col" className="w-14 px-2 font-normal">
                  {t('leaderboard.col.rank')}
                </th>
                <th scope="col" className="px-2 font-normal">
                  {t('leaderboard.col.trainer')}
                </th>
                <th scope="col" className="px-2 font-normal">
                  {t('leaderboard.col.league')}
                </th>
                <th scope="col" className="px-2 text-right font-normal">
                  {t('leaderboard.col.points')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <LeaderRow key={r.userId} row={r} scope={data.scope} />
              ))}
              {mineOutside && (
                <>
                  <tr aria-hidden>
                    <td colSpan={4} className="py-1 text-center font-num text-xl leading-none text-mist-400">
                      ⋮
                    </td>
                  </tr>
                  <LeaderRow row={mineOutside} scope={data.scope} />
                </>
              )}
            </tbody>
          </table>
          {!data.mine && (
            <p className="mt-3 text-sm text-mist-400">
              {data.rank && data.rank.index !== data.myRank.index ? t('leaderboard.notInRank', { rank: rankName(t, data.myRank) }) : t('leaderboard.notRanked')}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

function ScopeLabel({ icon, text }: { icon: 'globe' | 'friends'; text: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <PixelIcon name={icon} size={20} />
      {text}
    </span>
  )
}

/**
 * One table row. `trainerName === null` is a trainer who chose to be anonymous in
 * the global and country rankings: shown muted as "Anonymous trainer" (the flag
 * and country stay). On my own row, `anonymous` adds a "Hidden from others" tag
 * (not in the friends scope, where friends do see my name).
 */
export function LeaderRow({ row, scope = 'global' }: { row: LeaderboardRow; scope?: LeaderboardScope }) {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const lng = i18n.language
  const cell = cx('px-2 py-2', row.me ? 'bg-volt-400/15' : 'bg-dusk-900')
  return (
    <tr aria-current={row.me ? 'true' : undefined} className={cx(row.me && 'outline-2 -outline-offset-2 outline-volt-400')}>
      <td className={cell}>
        <span className={cx('inline-grid h-8 min-w-8 place-items-center px-1 font-num text-xl leading-none shadow-frame', PODIUM[row.rank] ?? 'bg-dusk-700 text-mist-100')}>{row.rank}</span>
      </td>
      <td className={cell}>
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-10 shrink-0 place-items-center">
            {row.leader ? <Sprite kind="icon" slug={row.leader} alt={names.species(row.leader)} /> : <PixelIcon name="user" size={20} className="text-mist-400" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-base">
              {row.trainerName ?? <span className="text-mist-400">{t('leaderboard.anonymous')}</span>}
              {row.me && <span className="ml-2 text-sm text-volt-300">{t('leaderboard.you')}</span>}
              {row.me && row.anonymous && scope !== 'friends' && (
                <span className="ml-2 inline-flex items-center gap-1 bg-dusk-700 px-1.5 text-sm text-mist-300 align-middle">
                  <PixelIcon name="eyeOff" size={12} />
                  {t('leaderboard.hidden')}
                </span>
              )}
            </span>
            <span className="block text-xs text-mist-400">
              <span aria-hidden>{flagEmoji(row.country)} </span>
              {countryName(row.country, lng)}
            </span>
          </span>
        </span>
      </td>
      <td className={cell}>
        <Tooltip content={rankName(t, { league: row.league, sub: row.sub ?? 1 })}>
          <span tabIndex={0} className={cx('inline-flex h-7 items-center px-2 font-display text-base whitespace-nowrap shadow-frame', LEAGUE_STYLE[row.league] ?? LEAGUE_STYLE.base)}>
            {rankShort(t, { league: row.league, sub: row.sub ?? 1 })}
          </span>
        </Tooltip>
      </td>
      <td className={cx(cell, 'text-right font-num text-2xl leading-none tabular')}>{fmtInt(row.points, lng)}</td>
    </tr>
  )
}

function EmptyLeaderboard({ scope, period }: { scope: LeaderboardScope; period: LeaderboardPeriod }) {
  const { t } = useTranslation()
  if (scope === 'friends') {
    return (
      <div className="bg-dusk-900 inset-shadow-well">
        <EmptyState
          pose="point"
          title={t('leaderboard.empty.friendsTitle')}
          body={t('leaderboard.empty.friendsBody')}
          action={
            <Button icon="friends" onClick={() => navigate('friends')}>
              {t('leaderboard.empty.friendsCta')}
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <div className="bg-dusk-900 inset-shadow-well">
      <EmptyState
        pose="cheer"
        title={t('leaderboard.empty.title')}
        body={t(period === 'week' ? 'leaderboard.empty.bodyWeek' : 'leaderboard.empty.bodyMonth')}
        action={
          <Button icon="play" onClick={() => navigate('home')}>
            {t('placeholder.cta')}
          </Button>
        }
      />
    </div>
  )
}

/** '2026-W45' → "Semana 45 de 2026"; '2026-11' → "noviembre de 2026". */
function periodLabel(data: LeaderboardResponse, lng: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const w = /^(\d{4})-W(\d{1,2})$/.exec(data.periodKey)
  if (w) return t('leaderboard.weekKey', { week: Number(w[2]), year: w[1] })
  const m = /^(\d{4})-(\d{2})$/.exec(data.periodKey)
  if (m) {
    const label = new Intl.DateTimeFormat(lng, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    return t('leaderboard.monthKey', { month: label })
  }
  // Week keys may also be the Monday's date ('2026-11-02').
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.periodKey)
  if (d) {
    const label = new Intl.DateTimeFormat(lng, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])))
    return t('leaderboard.weekOf', { date: label })
  }
  return data.periodKey
}
