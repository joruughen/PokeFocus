import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserRole } from '../game/protocol'
import { PixelIcon } from './components'
import { hintAnchor } from './hints'
import { cx } from './lib/cx'
import { hrefTo } from './router'
import type { RouteDef } from './routes'

/** Sections that keep their own button in the phone's bottom bar; every other section goes in «More». */
export const PRIMARY_NAV = ['home', 'box', 'team', 'missions'] as const

/** Roles that can open the admin console. */
const STAFF: readonly UserRole[] = ['admin', 'support']

export interface NavSplit {
  primary: RouteDef[]
  more: RouteDef[]
}

/**
 * Splits the navigation for the phone bar: the main sections stay as buttons, the rest (and
 * Administration for staff, who otherwise only reach it by URL) goes into the «More» sheet.
 */
export function splitNav(routes: readonly RouteDef[], role?: UserRole | null): NavSplit {
  const primary = PRIMARY_NAV.map((id) => routes.find((r) => r.id === id && r.nav)).filter((r): r is RouteDef => Boolean(r))
  const more = routes.filter((r) => r.nav && !(PRIMARY_NAV as readonly string[]).includes(r.id))
  const admin = routes.find((r) => r.id === 'admin')
  if (admin && role && STAFF.includes(role)) more.push(admin)
  return { primary, more }
}

/** Alert count per section id (friend requests, live events…): shown on its row and summed on the «More» button. */
export type NavBadges = Partial<Record<string, number>>

export function badgeTotal(more: readonly RouteDef[], badges: NavBadges): number {
  return more.reduce((a, r) => a + (badges[r.id] ?? 0), 0)
}

const BADGE_CLASS = 'grid h-4 min-w-4 place-items-center bg-cheek-500 px-0.5 font-num text-sm leading-none text-mist-50 shadow-frame'

/** The sections inside «More»: one big tappable row each, with its alert badge. Pure view (server-renderable). */
export function MoreList({ routes, route, badges, onNavigate }: { routes: readonly RouteDef[]; route: string; badges: NavBadges; onNavigate?: () => void }) {
  const { t } = useTranslation()
  return (
    <ul className="grid grid-cols-2 gap-2">
      {routes.map((r) => {
        const active = r.id === route
        const n = badges[r.id] ?? 0
        return (
          <li key={r.id}>
            <a
              href={hrefTo(r.id)}
              aria-current={active ? 'page' : undefined}
              onClick={onNavigate}
              {...hintAnchor(`nav.${r.id}`)}
              className={cx(
                'flex min-h-12 items-center gap-3 px-3 py-2 font-display text-lg transition-colors',
                active ? 'bg-volt-400 text-ink shadow-frame' : 'bg-dusk-800 text-mist-100 shadow-frame hover:bg-dusk-700',
              )}
            >
              <span className="relative shrink-0">
                <PixelIcon name={r.icon} size={20} />
              </span>
              <span className="min-w-0 flex-1 truncate">{t(r.labelKey)}</span>
              {n > 0 && (
                <span className={BADGE_CLASS} aria-label={t(`nav.badge.${r.id}`, { count: n, defaultValue: String(n) })}>
                  {n}
                </span>
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The bottom bar's «More» button (phones only) and the sheet it opens: a modal bottom sheet with
 * the other sections. Focus is trapped inside while open, Escape or a tap outside closes it, and
 * focus returns to the button. It also closes when the route changes.
 */
export function MoreNav({
  routes,
  route,
  badges,
  focusing,
  defaultOpen = false,
}: {
  routes: readonly RouteDef[]
  route: string
  badges: NavBadges
  focusing?: boolean
  defaultOpen?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => setOpen(false), [route])
  // The sheet is phone-only: close it if the window grows past the bottom-bar breakpoint.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 640) setOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const total = badgeTotal(routes, badges)
  const inside = routes.some((r) => r.id === route)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        {...hintAnchor('nav.more')}
        aria-label={total > 0 ? `${t('nav.more')} (${t('nav.moreBadge', { count: total })})` : undefined}
        className={cx(
          'group flex w-full items-center justify-center px-1 py-2.5 font-display text-lg transition-colors',
          inside || open ? 'bg-volt-400 text-ink shadow-frame' : 'text-mist-300 hover:bg-dusk-800 hover:text-mist-50',
          focusing && !inside && !open && 'opacity-60',
        )}
      >
        <span className="relative">
          <PixelIcon name="more" size={20} />
          {total > 0 && (
            <span aria-hidden className={cx('absolute -top-2 -left-2', BADGE_CLASS, inside && 'bg-ink text-volt-300')}>
              {total}
            </span>
          )}
        </span>
        <span className="sr-only">{t('nav.more')}</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ink/70 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cx(
            'fixed inset-x-0 bottom-0 z-50 max-h-[calc(100dvh-3rem)] overflow-y-auto bg-dusk-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-2px_0_0_var(--color-ink)] outline-none',
            'transition-[opacity,translate] duration-150 ease-[var(--ease-snap)] data-ending-style:translate-y-6 data-ending-style:opacity-0 data-starting-style:translate-y-6 data-starting-style:opacity-0',
            'sm:hidden',
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <Dialog.Title className="font-display text-xl text-mist-50">{t('nav.moreTitle')}</Dialog.Title>
            <Dialog.Close className="grid size-10 place-items-center text-mist-300 hover:bg-dusk-800 hover:text-mist-50" aria-label={t('common.close')}>
              <PixelIcon name="close" size={20} />
            </Dialog.Close>
          </div>
          <MoreList routes={routes} route={route} badges={badges} onNavigate={() => setOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
