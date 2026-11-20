import { useTranslation } from 'react-i18next'
import { toLocal, weekKey, type PlayerState } from '../../../engine'
import { rankName } from '../league/rank'
import { BarChart, Button, EmptyState, Mascot, Panel, PixelIcon, Platform, ProgressBar, Sprite, Tooltip } from '../../components'
import { cx } from '../../lib/cx'
import { countryName, flagEmoji } from '../../lib/countries'
import { fmtInt, fmtPct, intlZone } from '../../lib/format'
import { useNames } from '../../lib/names'
import { navigate } from '../../router'
import { useAuth } from '../../store/auth'
import { useNow } from '../../store/clock'
import { useContent } from '../../store/content'
import { usePlayer } from '../../store/selectors'
import { companionOf, lastDays, nextLevelReward, profileStats, streakStatus, trainerProgress, trainerUnlocks, weeklyMinutes } from './profileModel'

/** Weeks the minutes chart covers. */
const CHART_WEEKS = 8

/** «1 h 20 min» / «45 min»: study time in words. */
export function fmtStudy(min: number, lng: string): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${fmtInt(h, lng)} h` : `${fmtInt(h, lng)} h ${m} min`
}

/** Study time for a tile: big numbers, small units («4 h 10 min»). */
function Duration({ min }: { min: number }) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  const unit = (u: string) => <span className="mr-1.5 ml-1 font-display text-base text-mist-300">{u}</span>
  return (
    <>
      {h > 0 && (
        <>
          {h}
          {unit('h')}
        </>
      )}
      {(m > 0 || h === 0) && (
        <>
          {m}
          {unit('min')}
        </>
      )}
    </>
  )
}

function fmtLongDate(ts: number, tz: PlayerState['profile']['timezone'], lng: string): string {
  const base: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
  try {
    return new Intl.DateTimeFormat(lng, { ...base, timeZone: intlZone(tz) }).format(ts)
  } catch {
    return new Intl.DateTimeFormat(lng, base).format(ts)
  }
}

/**
 * Profile (`#/profile`): the trainer card (identity and partner), trainer level with what is missing for the
 * next one, the study streak, the unlock ladder and the study statistics. Read-only: everything is derived
 * from the player state and the config (see profileModel.ts).
 */
export default function Profile() {
  const { t } = useTranslation()
  const player = usePlayer()
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl">{t('profile.pageTitle')}</h1>
        <p className="mt-1 text-mist-300">{t('profile.subtitle')}</p>
      </header>
      <TrainerCard player={player} />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <LevelPanel player={player} />
        <StreakPanel player={player} />
      </div>
      <UnlocksPanel player={player} />
      <StatsSection player={player} />
    </div>
  )
}

/** The «?» of the game's panels (same look as HelpDot) with content that carries live numbers from the config. */
function HowTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip variant="help" side="bottom" content={children}>
      <button
        type="button"
        aria-label={label}
        className="inline-grid size-6 shrink-0 place-items-center bg-dusk-600 text-volt-300 shadow-frame transition-colors hover:bg-volt-400 hover:text-ink focus-visible:bg-volt-400 focus-visible:text-ink"
      >
        <PixelIcon name="help" size={10} />
      </button>
    </Tooltip>
  )
}

// --- Trainer card ------------------------------------------------------------

export function TrainerCard({ player }: { player: PlayerState }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const user = useAuth((s) => s.user)
  const mon = companionOf(player)
  const isLeader = Boolean(mon && player.team[0] === mon.uid)
  const name = user?.trainerName ?? player.profile.trainerName
  const since = user?.createdAt ?? player.profile.createdAt
  return (
    <Panel padded={false} className="overflow-hidden" aria-label={t('profile.hero.label')}>
      <div className="grid grid-cols-1 sm:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="relative flex h-44 items-end justify-center bg-[linear-gradient(to_bottom,var(--color-dusk-700),var(--color-dusk-900))] sm:h-auto sm:min-h-48">
          {mon ? (
            <>
              <Platform width={130} night className="absolute bottom-4" />
              <Sprite
                kind="showdown"
                slug={mon.speciesSlug}
                shiny={mon.isShiny}
                scale={2}
                maxHeight={120}
                maxWidth={150}
                alt={names.pokemonFull(mon)}
                className="relative mb-7"
              />
            </>
          ) : (
            <Mascot pose="idle" size={96} className="mb-4" />
          )}
        </div>
        <div className="flex min-w-0 flex-col justify-between gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h2 className="flex min-w-0 items-center gap-2 text-3xl leading-tight break-words">
                <span className="min-w-0">{name}</span>
                {user && (
                  <span title={countryName(user.country, lng)} aria-label={t('profile.hero.country', { country: countryName(user.country, lng) })} role="img" className="shrink-0 text-2xl">
                    {flagEmoji(user.country)}
                  </span>
                )}
              </h2>
              {mon && (
                <p className="mt-2 text-sm text-mist-100">
                  <span className="font-display text-base text-volt-300">{t('profile.hero.companion')}</span> {names.pokemon(mon)}
                  <span className="text-mist-400"> · {isLeader ? t('profile.hero.companionLeader') : t('profile.hero.companionBond')}</span>
                </p>
              )}
              <p className="mt-1 text-mist-300">{t('profile.hero.since', { date: fmtLongDate(since, player.profile.timezone, lng) })}</p>
              {user?.anonymousRankings && (
                <p className="mt-3">
                  <Tooltip variant="help" content={t('profile.hero.anonymousTip')}>
                    <button type="button" className="inline-flex min-h-8 items-center gap-1.5 bg-dusk-900 px-2.5 font-display text-sm text-mist-100 shadow-frame">
                      <PixelIcon name="eyeOff" size={10} />
                      {t('profile.hero.anonymous')}
                    </button>
                  </Tooltip>
                </p>
              )}
            </div>
            <LevelBadge level={player.trainer.level} />
          </div>
        </div>
      </div>
    </Panel>
  )
}

function LevelBadge({ level }: { level: number }) {
  const { t } = useTranslation()
  return (
    <div className="grid shrink-0 place-items-center bg-volt-400 px-5 py-2 text-ink shadow-plate" role="img" aria-label={t('profile.level.reached', { level })}>
      <span className="font-display text-sm leading-none">{t('profile.hero.levelWord')}</span>
      <span className="font-num text-[3.5rem] leading-[0.9] tabular">{level}</span>
    </div>
  )
}

// --- Trainer level -------------------------------------------------------------

export function LevelPanel({ player }: { player: PlayerState }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const ctx = useContent()
  const cfg = ctx.config.trainer
  const p = trainerProgress(player.trainer, ctx)
  const reward = nextLevelReward(p.level, ctx)
  const items = reward ? Object.entries(reward.items).filter(([, n]) => n > 0) : []
  return (
    <Panel
      title={t('profile.level.title')}
      actions={
        <HowTip label={t('profile.level.howAria')}>
          <span className="flex flex-col gap-1.5">
            <span className="font-display text-base">{t('profile.level.howTitle')}</span>
            <span>{t('profile.level.howMinutes', { count: cfg.expPerMinute })}</span>
            <span>{t('profile.level.howSpecies', { count: cfg.expPerNewSpecies })}</span>
            <span className="text-ink/70">{t('profile.level.howNo')}</span>
            <span>{t('profile.level.howReward')}</span>
          </span>
        </HowTip>
      }
    >
      <p className="font-display text-2xl text-volt-300">{t('profile.level.reached', { level: p.level })}</p>
      {p.isMax ? (
        <div className="mt-4 flex items-center gap-4 bg-dusk-900 p-4 inset-shadow-well">
          <Mascot pose="cheer" size={48} className="shrink-0" />
          <div>
            <p className="font-display text-lg">{t('profile.level.max')}</p>
            <p className="text-sm text-mist-300">{t('profile.level.maxBody', { max: p.maxLevel })}</p>
            <p className="mt-1 font-num text-xl leading-none tabular">{t('profile.level.totalExp', { exp: fmtInt(p.exp, lng) })}</p>
          </div>
        </div>
      ) : (
        <>
          <ProgressBar
            className="mt-3"
            variant="exp"
            size="lg"
            value={p.into}
            max={p.span ?? 1}
            label={t('profile.level.expLabel')}
            valueText={t('profile.level.expText', { into: fmtInt(p.into, lng), span: fmtInt(p.span ?? 0, lng) })}
          />
          <div className="mt-4 bg-dusk-900 p-3 inset-shadow-well">
            <p className="text-mist-50">{t('profile.level.missing', { count: p.missing, exp: fmtInt(p.missing, lng), next: p.level + 1 })}</p>
            {p.minutes !== null && (
              <p className="mt-1 text-sm text-mist-300">
                {t('profile.level.approx', { time: fmtStudy(p.minutes, lng) })}
                {p.species !== null && p.species > 0 && `, ${t('profile.level.orSpecies', { count: p.species })}`}
              </p>
            )}
          </div>
          <section aria-label={t('profile.level.nextReward', { level: p.level + 1 })} className="mt-5">
            <h3 className="mb-2 font-display text-base text-mist-300">{t('profile.level.nextReward', { level: p.level + 1 })}</h3>
            {reward && (reward.dust > 0 || items.length > 0) ? (
              <>
                <ul className="flex flex-wrap gap-2">
                  {reward.dust > 0 && (
                    <li className="flex items-center gap-2 bg-dusk-900 py-1 pr-3 pl-2 inset-shadow-well">
                      <PixelIcon name="dust" size={20} className="text-exp-400" />
                      <span className="sr-only">{t('items.dust')}</span>
                      <span className="font-num text-xl leading-none tabular">+{fmtInt(reward.dust, lng)}</span>
                    </li>
                  )}
                  {items.map(([slug, n]) => (
                    <li key={slug} className="flex items-center gap-1.5 bg-dusk-900 py-1 pr-3 pl-1.5 inset-shadow-well">
                      <Sprite kind="item" slug={slug} fit={30} alt="" />
                      <span className="sr-only">{names.item(slug)}</span>
                      <span className="font-num text-xl leading-none tabular">×{n}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-mist-400">{t('profile.level.rewardAdded')}</p>
              </>
            ) : (
              <p className="text-sm text-mist-300">{t('profile.level.rewardNothing')}</p>
            )}
          </section>
        </>
      )}
    </Panel>
  )
}

// --- Streak ------------------------------------------------------------------

export function StreakPanel({ player }: { player: PlayerState }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const ctx = useContent()
  const now = useNow()
  const todayKey = toLocal(now, player.profile.timezone).dayKey
  const s = streakStatus(player.streak, todayKey)
  const week = lastDays(player.days, todayKey, 7)
  const dayFmt = new Intl.DateTimeFormat(lng, { weekday: 'short', timeZone: 'UTC' })
  const dayName = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return dayFmt.format(Date.UTC(y!, m! - 1, d!)).replace('.', '')
  }
  const move = names.move('amnesia')
  return (
    <Panel
      title={t('profile.streak.title')}
      actions={
        <HowTip label={t('profile.streak.howAria')}>
          <span className="flex flex-col gap-1.5">
            <span className="font-display text-base">{t('profile.streak.howTitle')}</span>
            <span>{t('profile.streak.howDay')}</span>
            <span>{t('profile.streak.howMiss')}</span>
            <span>{t('profile.streak.howProtect', { move })}</span>
            <span>{t('profile.streak.howDragon', { count: ctx.config.conditions.dragonStreakDays, type: names.type('dragon') })}</span>
          </span>
        </HowTip>
      }
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-mist-300">{t('profile.streak.current')}</p>
          <p className={cx('mt-1 flex items-baseline gap-2 leading-none', s.current > 0 ? 'text-volt-300' : 'text-mist-300')}>
            <PixelIcon name="bolt" size={20} className="self-center" />
            <span className="font-num text-[3.5rem] leading-[0.8] tabular">{s.current}</span>
            <span className="font-display text-lg">{t('profile.streak.unit', { count: s.current })}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-mist-300">{t('profile.streak.best')}</p>
          <p className="mt-1 flex items-baseline justify-end gap-1.5 leading-none">
            <span className="font-num text-3xl tabular">{s.best}</span>
            <span className="font-display text-base text-mist-300">{t('profile.streak.unit', { count: s.best })}</span>
          </p>
        </div>
      </div>
      <ol className="mt-5 grid grid-cols-7 gap-1.5" aria-label={t('profile.streak.title')}>
        {week.map((d) => (
          <li key={d.dayKey} className="flex flex-col items-center gap-1">
            <span
              className={cx('grid size-9 w-full place-items-center shadow-frame', d.studied ? 'bg-volt-400 text-ink' : 'bg-dusk-900 text-mist-500', d.today && 'outline-2 outline-offset-2 outline-mist-50')}
              role="img"
              aria-label={t(d.studied ? 'profile.streak.dayStudied' : 'profile.streak.dayEmpty', { day: dayName(d.dayKey) })}
            >
              {d.studied && <PixelIcon name="check" size={10} />}
            </span>
            <span className={cx('text-xs', d.today ? 'font-bold text-mist-50' : 'text-mist-400')}>{dayName(d.dayKey)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 bg-dusk-900 p-3 text-sm text-mist-100 inset-shadow-well">{t(`profile.streak.state.${s.state}`, { move })}</p>
    </Panel>
  )
}

// --- Unlock ladder -----------------------------------------------------------------

export function UnlocksPanel({ player }: { player: PlayerState }) {
  const { t } = useTranslation()
  const names = useNames()
  const ctx = useContent()
  const level = player.trainer.level
  const ladder = trainerUnlocks(level, ctx)
  const nextLevel = ladder.find((l) => !l.done)?.level
  return (
    <Panel title={t('profile.unlocks.title')}>
      <p className="mb-4 text-mist-300">{nextLevel !== undefined ? t('profile.unlocks.untilNext', { count: nextLevel - level, level: nextLevel }) : t('profile.unlocks.allDone')}</p>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ladder.map((l) => {
          const next = l.level === nextLevel
          return (
            <li
              key={l.level}
              aria-current={next ? 'step' : undefined}
              className={cx('flex flex-col gap-3 bg-dusk-900 p-3 inset-shadow-well', next && 'outline-2 -outline-offset-2 outline-volt-400', l.done && 'opacity-75')}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={cx('font-display text-lg', l.done ? 'text-mist-300' : 'text-mist-50')}>{t('profile.unlocks.level', { level: l.level })}</p>
                {l.done ? (
                  <span className="inline-flex items-center gap-1 text-sm text-leaf-400">
                    <PixelIcon name="check" size={10} />
                    {t('profile.unlocks.unlocked')}
                  </span>
                ) : (
                  <span className={cx('inline-flex items-center gap-1 px-1.5 text-sm', next ? 'bg-volt-400 font-display text-ink' : 'text-mist-400')}>
                    <PixelIcon name="lock" size={10} />
                    {next ? t('profile.unlocks.next') : t('profile.unlocks.locked')}
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-2.5">
                {l.entries.map((e) => (
                  <li key={e.kind} className="flex items-start gap-3">
                    <span className="grid h-9 w-10 shrink-0 place-items-center bg-dusk-800 shadow-frame">
                      {e.kind === 'wild' ? <PixelIcon name="up" size={20} className="text-leaf-400" /> : e.item ? <Sprite kind="item" slug={e.item} fit={30} alt="" /> : <PixelIcon name="missions" size={20} className="text-exp-400" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-base leading-tight text-mist-50">{t(`profile.unlocks.kind.${e.kind}.name`)}</span>
                      <span className="block text-sm text-mist-300">
                        {e.kind === 'wild' && e.wild
                          ? t('profile.unlocks.kind.wild.body', { min: e.wild.min, max: e.wild.max })
                          : e.kind === 'missions' && e.item
                            ? t('profile.unlocks.kind.missionsItem', { item: names.item(e.item) })
                            : t(`profile.unlocks.kind.${e.kind}.body`)}
                      </span>
                      {e.gift && <span className="mt-0.5 block text-sm text-volt-300">{t('profile.unlocks.gift', { count: e.gift.count, item: names.item(e.gift.item) })}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

// --- Statistics ----------------------------------------------------------------------

function Tile({ label, value, note, icon }: { label: string; value: React.ReactNode; note?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    // Container query: the big size only when the tile is wide enough (4 columns at 1024 px are narrow and a long number overflowed).
    <li className="@container flex min-w-0 flex-col bg-dusk-800 p-4 shadow-frame">
      <p className="text-sm text-mist-300">{label}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 font-num text-3xl leading-none tabular @[13rem]:text-4xl">
        {icon}
        <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
      </p>
      {note && <p className="mt-1 truncate text-xs text-mist-400">{note}</p>}
    </li>
  )
}

export function StatsSection({ player }: { player: PlayerState }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const names = useNames()
  const ctx = useContent()
  const now = useNow()
  const st = profileStats(player, ctx)
  const has = st.sessions > 0
  const wk = weekKey(player, now)
  const weeks = weeklyMinutes(player.history, wk, CHART_WEEKS)
  const dateFmt = new Intl.DateTimeFormat(lng, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const dateOf = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return dateFmt.format(Date.UTC(y!, m! - 1, d!)).replace('.', '')
  }
  const chart = weeks.map((w, i) => ({
    // Every other week is labeled so the labels never crowd a phone-width chart.
    label: (weeks.length - 1 - i) % 2 === 0 ? dateOf(w.weekKey) : '',
    value: w.minutes,
    highlight: i === weeks.length - 1,
    tip: t('profile.stats.weekTip', { date: dateOf(w.weekKey), minutes: fmtInt(w.minutes, lng) }),
  }))
  const bond = st.longestBond
  return (
    <section aria-labelledby="profile-stats" className="flex flex-col gap-4">
      <h2 id="profile-stats" className="text-2xl">
        {t('profile.stats.title')}
      </h2>
      <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {has && (
          <>
            <Tile label={t('profile.stats.hours')} value={<Duration min={st.totalMinutes} />} />
            <Tile label={t('profile.stats.sessions')} value={fmtInt(st.sessions, lng)} note={t('profile.stats.sessionsNote', { minutes: st.avgMinutes })} />
            <Tile label={t('profile.stats.longest')} value={<Duration min={st.longestMinutes} />} />
            <Tile label={t('profile.stats.focus')} value={st.avgFocus === null ? '—' : fmtPct(st.avgFocus, lng).replace(/\s/g, '')} />
            <Tile label={t('profile.stats.days')} value={fmtInt(st.studyDays, lng)} />
          </>
        )}
        <Tile label={t('profile.stats.dex')} value={`${st.speciesCaught}/${st.speciesTotal}`} note={t('profile.stats.dexNote', { count: st.speciesSeen })} />
        <Tile label={t('profile.stats.shiny')} value={fmtInt(st.shinyOwned, lng)} />
        <Tile label={t('profile.stats.legendary')} value={fmtInt(st.legendaryCaught, lng)} />
        <Tile label={t('profile.stats.traded')} value={fmtInt(st.tradedOwned, lng)} note={t('profile.stats.tradedNote')} />
        <Tile label={t('profile.stats.league')} value={<span className="font-display text-2xl">{rankName(t, { league: st.bestLeague, sub: st.bestSub })}</span>} />
        {has && <Tile label={t('profile.stats.dust')} value={fmtInt(st.dustEarned, lng)} note={t('profile.stats.dustNote')} icon={<PixelIcon name="dust" size={20} className="text-exp-400" />} />}
        {bond && (
          <Tile
            label={t('profile.stats.bond')}
            value={<Duration min={bond.bondMinutes} />}
            note={names.pokemon(bond)}
            icon={<Sprite kind="icon" slug={bond.speciesSlug} shiny={bond.isShiny} alt="" maxHeight={32} maxWidth={40} />}
          />
        )}
      </ul>
      {has ? (
        <Panel title={t('profile.stats.weeksTitle')}>
          <BarChart data={chart} label={t('profile.stats.weeksLabel', { count: CHART_WEEKS })} format={(v) => `${Math.round(v)}`} />
          <p className="mt-3 text-sm text-mist-300">{t('profile.stats.weeksNote')}</p>
          {st.sessions >= ctx.config.historyLimit && <p className="mt-1 text-sm text-mist-400">{t('profile.stats.capped', { count: ctx.config.historyLimit })}</p>}
        </Panel>
      ) : (
        <div className="bg-dusk-800 shadow-plate">
          <EmptyState
            pose="cheer"
            title={t('profile.stats.empty.title')}
            body={t('profile.stats.empty.body')}
            action={
              <Button icon="play" onClick={() => navigate('home')}>
                {t('placeholder.cta')}
              </Button>
            }
          />
        </div>
      )}
    </section>
  )
}
