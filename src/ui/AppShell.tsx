import { Suspense, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import { BALL_ORDER, missionsView } from '../engine'
import { DevToggle } from './dev/DevPanel'
import { StageBadge } from './changelog/StageBadge'
import { GroupInviteNotice } from './GroupInviteNotice'
import { MaintenanceBanner } from './MaintenanceBanner'
import { BallIcon, IconButton, Logo, PixelIcon, Tooltip } from './components'
import { hintAnchor, useHintEvent } from './hints'
import { cx } from './lib/cx'
import { flagEmoji } from './lib/countries'
import { fmtCountdown, fmtInt } from './lib/format'
import { hrefTo, useRoute, useRouteParams } from './router'
import { findRoute, ROUTES } from './routes'
import { useNow } from './store/clock'
import { useAuth } from './store/auth'
import { timerOf, useGame } from './store/game'
import { useIncomingCount } from './store/social'
import { usePhase, usePlayer } from './store/selectors'

/**
 * Desktop layout: a side rail (sections, live session chip, trainer and bag)
 * and the current screen. Below 1024px the rail collapses to icons; below
 * 640px it becomes a bottom bar.
 */
export function AppShell() {
  const route = useRoute()
  const Screen = findRoute(route).component
  const phase = usePhase()
  const focusing = phase === 'focus' || phase === 'paused'
  useFocusMainOnNavigate(route)
  // Prefetch the other screens once the browser is idle (they are small chunks).
  useEffect(() => {
    const go = () => ROUTES.forEach((r) => void r.preload?.())
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(go)
    else setTimeout(go, 1500)
  }, [])
  return (
    <div className="min-h-dvh xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] max-xl:sm:grid max-xl:sm:grid-cols-[5rem_minmax(0,1fr)]">
      <Rail route={route} focusing={focusing} />
      <GroupInviteNotice />
      <main id="main" tabIndex={-1} className={cx('min-w-0 outline-none px-4 pt-6 pb-24 sm:px-8 sm:pb-12 xl:px-10', focusing && route === 'home' && 'pixel-grid')}>
        <div className="mx-auto max-w-[76rem]">
          <MaintenanceBanner className="mb-6" />
          <Suspense fallback={<ScreenLoading />}>
            <Screen />
          </Suspense>
        </div>
      </main>
    </div>
  )
}

/**
 * Keyboard and screen-reader users: after navigating, put focus on <main> (the
 * link or button they pressed is gone or no longer relevant), so the next Tab
 * starts inside the new screen (QA R-07).
 * - A different screen always takes focus.
 * - Within one screen (`#/box` → `#/box/p12`, or Prev/Next in the detail) focus
 *   moves only if it was lost, so pressing Next repeatedly keeps working.
 * - Not on first load, so a reload does not skip the side menu.
 */
function useFocusMainOnNavigate(route: string) {
  const params = useRouteParams().join('/')
  const seen = useRef({ route, params })
  useEffect(() => {
    const before = seen.current
    seen.current = { route, params }
    if (before.route === route && before.params === params) return
    const active = document.activeElement
    const lost = !active || active === document.body || !document.body.contains(active)
    if (before.route !== route || lost) document.getElementById('main')?.focus({ preventScroll: true })
  }, [route, params])
}

function ScreenLoading() {
  const { t } = useTranslation()
  return (
    <p className="py-20 text-center font-display text-lg text-mist-400" role="status">
      {t('common.loading')}
    </p>
  )
}

function Rail({ route, focusing }: { route: string; focusing: boolean }) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('nav.label')}
      className={cx(
        'z-30 bg-dusk-900 shadow-[2px_0_0_0_var(--color-ink)] transition-opacity',
        'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:shadow-[0_-2px_0_0_var(--color-ink)]',
        'sm:sticky sm:top-0 sm:flex sm:h-dvh sm:flex-col',
      )}
    >
      <div className="hidden px-5 pt-6 pb-5 xl:flex xl:flex-col xl:items-start xl:gap-1">
        <a href={hrefTo('home')} aria-label="PokeFocus">
          <Logo height={32} />
        </a>
        <StageBadge />
      </div>
      {/* Icon-only rail (sm–xl): just the stage. Hidden in the phone's bottom bar (it is in Settings) and at xl (it sits under the logo). */}
      <div className="mt-3 hidden justify-center sm:flex xl:hidden">
        <StageBadge compact />
      </div>
      <ul className="flex justify-around gap-1 p-2 sm:flex-col sm:justify-start sm:px-3 sm:py-4 xl:pt-0">
        {ROUTES.filter((r) => r.nav).map((r) => {
          const active = r.id === route
          return (
            <li key={r.id}>
              <a
                href={hrefTo(r.id)}
                aria-current={active ? 'page' : undefined}
                {...hintAnchor(`nav.${r.id}`)}
                className={cx(
                  'group flex items-center gap-3 px-3 py-2.5 font-display text-lg transition-colors max-xl:justify-center',
                  active ? 'bg-volt-400 text-ink shadow-frame' : 'text-mist-300 hover:bg-dusk-800 hover:text-mist-50',
                  focusing && !active && 'opacity-60',
                )}
              >
                <span className="relative">
                  <PixelIcon name={r.icon} size={20} />
                  {r.id === 'missions' && <MissionsBadge active={active} />}
                  {r.id === 'friends' && <FriendsBadge active={active} />}
                </span>
                <span className="max-xl:sr-only">{t(r.labelKey)}</span>
              </a>
            </li>
          )
        })}
      </ul>
      <div className="mt-auto hidden flex-col gap-4 p-4 sm:flex">
        <LiveSessionChip />
        <TrainerCard />
      </div>
      <DevToggle />
    </nav>
  )
}

/** Count of missions ready to claim (engine `missionsView().claimable`), on the nav icon. */
function MissionsBadge({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const now = useNow()
  const player = useGame((s) => s.player)
  const minute = Math.floor(now / 60_000)
  const n = useMemo(() => (player ? missionsView(player, minute * 60_000).claimable : 0), [player, minute])
  useHintEvent('missionReady', n > 0 && !active)
  if (n === 0) return null
  return (
    <span
      className={cx('absolute -top-2 -left-2 grid h-4 min-w-4 place-items-center px-0.5 font-num text-sm leading-none shadow-frame', active ? 'bg-ink text-volt-300' : 'bg-cheek-500 text-mist-50')}
      aria-label={t('missions.badge', { count: n })}
    >
      {n}
    </span>
  )
}

/** Friend requests waiting for an answer, on the nav icon. */
function FriendsBadge({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const n = useIncomingCount()
  useHintEvent('friendRequest', n > 0 && !active)
  if (n === 0) return null
  return (
    <span
      className={cx('absolute -top-2 -left-2 grid h-4 min-w-4 place-items-center px-0.5 font-num text-sm leading-none shadow-frame', active ? 'bg-ink text-volt-300' : 'bg-cheek-500 text-mist-50')}
      aria-label={t('friends.badge', { count: n })}
    >
      {n}
    </span>
  )
}

function LiveSessionChip() {
  const { t } = useTranslation()
  const now = useNow()
  const player = useGame((s) => s.player)
  const timerState = useGame((s) => s.timer)
  const route = useRoute()
  if (!player?.activeSession || route === 'home') return null
  const timer = timerOf({ player, timer: timerState })!
  const left = timer.pausedAt !== null ? timer.endsAt - timer.pausedAt : timer.endsAt - now
  const done = left <= 0
  return (
    <a href={hrefTo('home')} className="flex items-center gap-2 bg-dusk-800 p-2 shadow-frame hover:bg-dusk-700">
      <PixelIcon name={done ? 'star' : 'clock'} size={20} className="text-volt-400" />
      <span className="max-xl:sr-only">
        <span className="block text-xs text-mist-300">{done ? t('nav.sessionDone') : t('nav.sessionLive')}</span>
        <span className="font-num text-2xl leading-none">{done ? t('claim.button') : fmtCountdown(left)}</span>
      </span>
    </a>
  )
}

function TrainerCard() {
  const { t, i18n } = useTranslation()
  const player = usePlayer()
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const streak = player.streak.current
  return (
    <div className="flex flex-col gap-3 bg-dusk-800 p-3 shadow-frame max-xl:items-center max-xl:p-2">
      <div className="flex items-start gap-2 max-xl:hidden">
        <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg leading-tight">
          {user?.trainerName ?? player.profile.trainerName}
          {user && (
            <span aria-hidden className="ml-1.5 text-base">
              {flagEmoji(user.country)}
            </span>
          )}
        </p>
        <p className="text-xs text-mist-300">{t('trainer.level', { level: player.trainer.level })}</p>
        {streak > 0 && <p className="text-xs text-volt-300">{t('trainer.streak', { count: streak })}</p>}
        </div>
        <IconButton icon="logout" size="sm" variant="ghost" label={t('account.logout')} onClick={() => void logout()} className="-mt-1 -mr-1 shrink-0" />
      </div>
      <IconButton icon="logout" size="sm" variant="ghost" label={t('account.logout')} onClick={() => void logout()} className="xl:hidden" />
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 max-xl:flex-col" aria-label={t('trainer.bag')}>
        {BALL_ORDER.map((b) => (
          <Tooltip key={b} content={t('trainer.ballCount', { count: player.inventory[b] ?? 0 })}>
            <li tabIndex={0} className="flex items-center gap-0.5">
              <BallIcon ball={b} size={30} />
              <span className="font-num text-lg leading-none">{player.inventory[b] ?? 0}</span>
            </li>
          </Tooltip>
        ))}
        <Tooltip content={t('items.dustTip')}>
          <li tabIndex={0} className="flex items-center gap-1">
            <PixelIcon name="dust" size={20} className="text-exp-400" />
            <span className="font-num text-lg leading-none">{fmtInt(player.dust, i18n.language)}</span>
          </li>
        </Tooltip>
      </ul>
    </div>
  )
}

