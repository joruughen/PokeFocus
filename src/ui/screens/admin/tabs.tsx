/**
 * Registry of the admin screen's tabs. To add a tab (e.g. Events): create its panel in its own folder and add ONE
 * entry to `ADMIN_TABS` (id, i18n label under `admin.tabs.*`, who sees it, a lazy component). Order = tab order.
 * `Admin.tsx` only renders what this list says.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { UserRole } from '../../../game/protocol'
import MaintenancePanel from './Maintenance'

export interface AdminTabContext {
  /** Role of the signed-in account (undefined while anonymous / not loaded). */
  role: UserRole | undefined
}

export interface AdminTabDef {
  /** Stable id (also the tab value). */
  id: string
  /** i18n key of the tab label, `admin.tabs.<id>`. */
  labelKey: string
  /** Who sees the tab. The server enforces the real permissions; this only hides what would be refused. */
  visible: (ctx: AdminTabContext) => boolean
  /** The panel. Lazy for everything but the maintenance form, so the admin chunk stays small. */
  component: ComponentType | LazyExoticComponent<ComponentType>
}

const isStaff = ({ role }: AdminTabContext): boolean => role === 'support' || role === 'admin'

export const ADMIN_TABS: readonly AdminTabDef[] = [
  { id: 'content', labelKey: 'admin.tabs.content', visible: isStaff, component: lazy(() => import('./content/ContentPanel')) },
  // Events (E9): { id: 'events', labelKey: 'admin.tabs.events', visible: ({ role }) => role === 'admin', component: lazy(() => import('./events/EventsPanel')) },
  { id: 'players', labelKey: 'admin.tabs.players', visible: isStaff, component: lazy(() => import('./players/PlayersPanel').then((m) => ({ default: m.PlayersPanel }))) },
  { id: 'metrics', labelKey: 'admin.tabs.metrics', visible: isStaff, component: lazy(() => import('./metrics/MetricsPanel')) },
  // Maintenance: admin accounts, or anybody holding the deprecated ADMIN_TOKEN; support has no use for it.
  { id: 'maintenance', labelKey: 'admin.tabs.maintenance', visible: ({ role }) => role !== 'support', component: MaintenancePanel },
]

export function visibleTabs(ctx: AdminTabContext, tabs: readonly AdminTabDef[] = ADMIN_TABS): AdminTabDef[] {
  return tabs.filter((tab) => tab.visible(ctx))
}
