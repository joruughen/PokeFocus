import { useTranslation } from 'react-i18next'
import {
  addDays,
  bestRank,
  currentMaxWaveSize,
  currentRank,
  leagueLadder,
  monthlyPoints,
  nextRankProgress,
  rankForPoints,
  rankUpDust,
  stageWeightsForRank,
  toLocal,
  waveSizeForRank,
  weekKey,
  weeklyPoints,
  type GameConfig,
  type LadderRung,
  type LeagueId,
} from '../../../engine'
import { BarChart, Button, EmptyState, HelpDot, LineChart, Panel, PixelIcon, ProgressBar, Tooltip } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { fmtInt, fmtPct } from '../../lib/format'
import { navigate } from '../../router'
import { Leaderboards } from './Leaderboards'
import { LEAGUE_STYLE, rankName } from './rank'
import { useNow } from '../../store/clock'
import { usePlayer } from '../../store/selectors'
import { useContent } from '../../store/content'

export { LEAGUE_STYLE } from './rank'

/** Which wilds a league offers, from its stage weights at the last subrank (GDD §10.2). */
function stagesKey(league: LeagueId, subs: number, cfg: GameConfig): 's1' | 's12' | 's123' | 'all' {
  const w = stageWeightsForRank({ league, sub: subs }, cfg)
  if (w.legendary > 0) return 'all'
  if (w.stage3 > 0) return 's123'
  return w.stage2 > 0 ? 's12' : 's1'
}

/** League of the week (thresholds, wave-size cap, weekly reset) and study stats. */
export default function League() {
  const cfg = useContent().config
  const ORDER = cfg.leagues.order as LeagueId[]
  useHintScreen('league')
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const now = useNow()
  const player = usePlayer()
  const tz = player.profile.timezone
  const rank = currentRank(player, now)
  const league = rank.league
  const points = weeklyPoints(player, now)
  const next = nextRankProgress(player, now)
  const maxWave = currentMaxWaveSize(player, now)
  const month = monthlyPoints(player, now)
  const monthRank = rankForPoints(month, 'month')
  const best = bestRank(player)
  const ladder = leagueLadder('week')
  const local = toLocal(now, tz)
  const daysLeft = (8 - local.weekday) % 7 || 7
  const minsLeft = daysLeft * 1440 - local.minuteOfDay
  const resetIn = { d: Math.floor(minsLeft / 1440), h: Math.floor((minsLeft % 1440) / 60) }

  // --- Stats ---------------------------------------------------------------
  const wk = weekKey(player, now)
  const dayFmt = new Intl.DateTimeFormat(lng, { weekday: 'short', timeZone: 'UTC' })
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(wk, i)
    const minutes = player.history.filter((h) => h.dayKey === key).reduce((a, h) => a + h.minutes, 0)
    const [y, m, d] = key.split('-').map(Number)
    const label = dayFmt.format(Date.UTC(y!, m! - 1, d!)).replace('.', '')
    return { label, value: minutes, highlight: key === local.dayKey, tip: t('stats.dayTip', { day: label, count: minutes }) }
  })
  const weekMinutes = week.reduce((a, d) => a + d.value, 0)
  const recent = player.history.slice(-14)
  const dateFmt = new Intl.DateTimeFormat(lng, { day: 'numeric', month: 'short' })
  const sessionsPts = recent.map((h, i) => ({ label: dateFmt.format(h.startedAt), value: h.points, tip: t('stats.sessionTip', { date: dateFmt.format(h.startedAt), points: fmtInt(h.points, lng), minutes: h.minutes }), highlight: i === recent.length - 1 }))
  const focus = recent.map((h, i) => ({ label: dateFmt.format(h.startedAt), value: h.focus, tip: t('stats.focusTip', { date: dateFmt.format(h.startedAt), pct: fmtPct(h.focus, lng) }), highlight: i === recent.length - 1 }))
  const totalMin = player.history.reduce((a, h) => a + h.minutes, 0)
  const caughtTotal = player.history.reduce((a, h) => a + h.caught, 0)

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="flex items-center gap-3 text-3xl">
          {t('league.pageTitle')}
          <HelpDot hint="league.intro" />
        </h1>
        <p className="mt-1 text-mist-300">{t('league.resetIn', { d: resetIn.d, h: resetIn.h })}</p>
      </header>

      {/* The weekly climb. */}
      <Panel padded={false} className="p-6" {...hintAnchor('league.ladder')}>
        <div className="flex flex-wrap items-center gap-6">
          <span className={cx('grid size-16 shrink-0 place-items-center shadow-plate sm:size-24', LEAGUE_STYLE[league])}>
            <PixelIcon name="league" size={48} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl sm:text-3xl">{rankName(t, rank)}</h2>
            <p className="mt-1 text-mist-300">{t('league.maxWave', { count: maxWave })}</p>
            <p className="mt-1 text-sm text-mist-400">{t('league.best', { rank: rankName(t, best) })}</p>
          </div>
          <div className="w-full sm:w-auto sm:text-right">
            <p className="font-num text-[4rem] leading-[0.8] tabular">{fmtInt(points, lng)}</p>
            <p className="mt-1 text-sm text-mist-300">{t('league.weekPoints')}</p>
          </div>
        </div>

        {/* The step in progress: from this rank to the next one. */}
        <div className="mt-6 bg-dusk-900 p-4 inset-shadow-well">
          {next ? (
            <>
              <div className="mb-2 flex items-baseline justify-between gap-3 font-display text-base">
                <span>{rankName(t, rank)}</span>
                <span className="text-mist-300">{rankName(t, next.next)}</span>
              </div>
              <ProgressBar size="lg" variant="volt" value={points - next.from} max={next.to - next.from} label={t('league.progressLabel', { rank: rankName(t, next.next) })} ariaValueText={fmtPct(next.progress, lng)} />
              <p className="mt-3 text-mist-100">{t('league.toNext', { points: fmtInt(next.pointsNeeded, lng), rank: rankName(t, next.next) })}</p>
              {rankUpDust(next.next.index, cfg) > 0 && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-mist-300">
                  <PixelIcon name="dust" size={14} className="text-exp-400" />
                  {t('league.rankUpDust', { dust: fmtInt(rankUpDust(next.next.index, cfg), lng) })}
                </p>
              )}
            </>
          ) : (
            <p className="text-mist-100">{t('league.top')}</p>
          )}
        </div>

        {/* The whole ladder: one block per league, one pip per rank. */}
        <ol className="mt-6 mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('league.ladderLabel')}>
          {ORDER.map((id) => {
            const rungs = ladder.filter((r) => r.league === id)
            const first = rungs[0] as LadderRung
            const here = id === league
            const reached = points >= first.points
            const waveFrom = waveSizeForRank(first, cfg)
            const waveTo = waveSizeForRank(rungs[rungs.length - 1] as LadderRung, cfg)
            return (
              <li key={id} className={cx('flex flex-col gap-3 p-3', here ? 'bg-dusk-900 shadow-frame' : 'bg-dusk-900/50')} aria-current={here ? 'step' : undefined}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cx('inline-flex h-7 items-center px-2 font-display text-base shadow-frame', reached ? LEAGUE_STYLE[id] : 'bg-dusk-900 text-mist-400')}>{t(`league.short.${id}`)}</span>
                  <span className="text-xs text-mist-400">{t('league.from', { points: fmtInt(first.points, lng) })}</span>
                </div>
                <ul className="flex flex-wrap gap-1" aria-label={t(`league.names.${id}`)}>
                  {rungs.map((r) => {
                    const done = points >= r.points
                    const current = r.index === rank.index
                    return (
                      <li key={r.sub}>
                        <Tooltip content={t('league.subOf', { rank: rankName(t, r), points: fmtInt(r.points, lng), wave: waveSizeForRank(r, cfg) })}>
                          <span
                            tabIndex={0}
                            aria-label={t('league.subOf', { rank: rankName(t, r), points: fmtInt(r.points, lng), wave: waveSizeForRank(r, cfg) })}
                            className={cx(
                              'grid h-7 w-7 place-items-center font-num text-lg leading-none tabular',
                              current ? 'bg-volt-400 text-ink shadow-frame' : done ? 'bg-volt-500/50 text-ink' : 'bg-ink text-mist-400',
                            )}
                          >
                            {r.sub}
                          </span>
                        </Tooltip>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-xs leading-relaxed text-mist-300">
                  {waveFrom === waveTo ? t('league.wavesFlat', { to: waveTo }) : t('league.waves', { from: waveFrom, to: waveTo })}
                  <br />
                  {t(`league.stages.${stagesKey(id, rungs.length, cfg)}`)}
                </p>
              </li>
            )
          })}
        </ol>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <p className="bg-dusk-900 p-3 text-sm text-mist-300 inset-shadow-well">{t('league.resetsLong')}</p>
          <p className="bg-dusk-900 p-3 text-sm text-mist-300 inset-shadow-well">{t('league.podiumRule', { min: cfg.leagues.podium.minPlayers })}</p>
          <p className="bg-dusk-900 p-3 text-sm text-mist-300 inset-shadow-well">
            {t('league.month', { points: fmtInt(month, lng), rank: rankName(t, monthRank), mult: cfg.leagues.monthlyMultiplier })}
          </p>
        </div>
      </Panel>

      <Leaderboards />

      {player.history.length === 0 ? (
        <div className="bg-dusk-800 shadow-plate">
          <EmptyState pose="cheer" title={t('stats.empty.title')} body={t('stats.empty.body')} action={<Button icon="play" onClick={() => navigate('home')}>{t('placeholder.cta')}</Button>} />
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label={t('stats.summary')}>
            <Tile label={t('stats.tile.week')} value={fmtHours(weekMinutes, lng)} note={t('stats.tile.weekNote', { count: player.history.filter((h) => h.weekKey === wk).length })} />
            <Tile label={t('stats.tile.total')} value={fmtHours(totalMin, lng)} note={t('stats.tile.totalNote', { count: player.history.length })} />
            <Tile label={t('stats.tile.streak')} value={String(player.streak.current)} note={t('stats.tile.streakNote', { best: player.streak.best })} />
            <Tile label={t('stats.tile.caught')} value={String(caughtTotal)} note={t('stats.tile.caughtNote', { count: player.pokedex.caught.length })} />
          </ul>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <Panel title={t('stats.weekTitle')} {...hintAnchor('league.stats')}>
              <BarChart data={week} label={t('stats.weekLabel', { count: weekMinutes })} format={(v) => `${Math.round(v)}`} empty={t('stats.weekEmpty')} />
              <p className="mt-3 text-sm text-mist-300">{t('stats.weekNote')}</p>
            </Panel>
            <Panel title={t('stats.pointsTitle')}>
              <BarChart data={sessionsPts} label={t('stats.pointsLabel', { count: sessionsPts.length })} format={(v) => fmtInt(v, lng)} />
              <p className="mt-3 text-sm text-mist-300">{t('stats.pointsNote', { count: sessionsPts.length })}</p>
            </Panel>
            <Panel title={t('stats.focusTitle')} help="league.focus">
              <LineChart data={focus} label={t('stats.focusLabel')} max={1} format={(v) => fmtPct(v, lng)} />
              <p className="mt-3 text-sm text-mist-300">{t('stats.focusNote')}</p>
            </Panel>
            <Panel title={t('stats.historyTitle')}>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-dusk-800 text-xs text-mist-400">
                    <tr>
                      <th className="py-1.5 pr-2 font-normal">{t('stats.col.when')}</th>
                      <th className="py-1.5 pr-2 text-right font-normal">{t('stats.col.minutes')}</th>
                      <th className="py-1.5 pr-2 text-right font-normal">{t('stats.col.points')}</th>
                      <th className="py-1.5 pr-2 text-right font-normal">{t('stats.col.focus')}</th>
                      <th className="py-1.5 text-right font-normal">{t('stats.col.caught')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...player.history].reverse().slice(0, 30).map((h) => (
                      <tr key={h.id} className="border-t-2 border-dusk-700">
                        <td className="py-2 pr-2 text-mist-100">
                          {new Intl.DateTimeFormat(lng, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(h.startedAt)}
                          {h.lateClaim && (
                            <Tooltip content={t('stats.lateTip')}>
                              <span tabIndex={0} className="ml-1.5 text-amber-400">
                                <PixelIcon name="clock" size={10} className="inline" />
                              </span>
                            </Tooltip>
                          )}
                        </td>
                        <td className="py-2 pr-2 text-right font-num text-lg leading-none tabular">{h.minutes}</td>
                        <td className="py-2 pr-2 text-right font-num text-lg leading-none tabular">{fmtInt(h.points, lng)}</td>
                        <td className="py-2 pr-2 text-right font-num text-lg leading-none tabular">{fmtPct(h.focus, lng)}</td>
                        <td className="py-2 text-right font-num text-lg leading-none tabular">
                          {h.caught}/{h.wilds}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function fmtHours(min: number, lng: string): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${fmtInt(h, lng)} h ${m}` : `${m} min`
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <li className="bg-dusk-800 p-4 shadow-frame">
      <p className="text-sm text-mist-300">{label}</p>
      <p className="mt-1 font-num text-4xl leading-none tabular">{value}</p>
      <p className="mt-1 text-xs text-mist-400">{note}</p>
    </li>
  )
}

