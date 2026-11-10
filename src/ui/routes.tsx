/**
 * Screen registry. To add a screen: write the component in `screens/` (default
 * export), then add its entry here with `lazy(() => import(...))`. `nav: true`
 * puts it in the side rail. Home is eager (it is the landing screen); the rest
 * are code-split and load on first visit (AppShell wraps them in Suspense).
 * See docs/ui-foundation.md §Adding a screen.
 */
import { lazy, type ComponentType } from 'react'
import type { IconName } from './components'
import { HomeRoute } from './screens/home/HomeRoute'

export interface RouteDef {
  /** URL id: `#/<id>`. */
  id: string
  /** i18n key of the nav label (`nav.<id>` by convention). */
  labelKey: string
  icon: IconName
  component: ComponentType
  nav: boolean
  /** Module loader, to prefetch on hover/idle. */
  preload?: () => Promise<unknown>
}

const loaders = {
  box: () => import('./screens/box/BoxRoute'),
  team: () => import('./screens/team/Team'),
  dex: () => import('./screens/dex/Dex'),
  league: () => import('./screens/league/League'),
  friends: () => import('./screens/friends/Friends'),
  missions: () => import('./screens/missions/Missions'),
  events: () => import('./screens/events/Events'),
  settings: () => import('./screens/Settings'),
  changelog: () => import('./changelog/Changelog'),
  admin: () => import('./screens/admin/Admin'),
}

export const ROUTES: RouteDef[] = [
  { id: 'home', labelKey: 'nav.home', icon: 'home', component: HomeRoute, nav: true },
  { id: 'box', labelKey: 'nav.box', icon: 'box', component: lazy(loaders.box), nav: true, preload: loaders.box },
  { id: 'team', labelKey: 'nav.team', icon: 'team', component: lazy(loaders.team), nav: true, preload: loaders.team },
  { id: 'dex', labelKey: 'nav.dex', icon: 'dex', component: lazy(loaders.dex), nav: true, preload: loaders.dex },
  { id: 'league', labelKey: 'nav.league', icon: 'league', component: lazy(loaders.league), nav: true, preload: loaders.league },
  { id: 'friends', labelKey: 'nav.friends', icon: 'friends', component: lazy(loaders.friends), nav: true, preload: loaders.friends },
  { id: 'missions', labelKey: 'nav.missions', icon: 'missions', component: lazy(loaders.missions), nav: true, preload: loaders.missions },
  { id: 'events', labelKey: 'nav.events', icon: 'sparkle', component: lazy(loaders.events), nav: true, preload: loaders.events },
  { id: 'settings', labelKey: 'nav.settings', icon: 'settings', component: lazy(loaders.settings), nav: true, preload: loaders.settings },
  // Reachable from the version badge / Settings (changelog) and by URL (admin); not in the side rail.
  { id: 'changelog', labelKey: 'nav.changelog', icon: 'star', component: lazy(loaders.changelog), nav: false, preload: loaders.changelog },
  { id: 'admin', labelKey: 'nav.admin', icon: 'wrench', component: lazy(loaders.admin), nav: false },
]

export function findRoute(id: string): RouteDef {
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0]!
}
