import { useTranslation } from 'react-i18next'
import type { SpeciesRole } from '../../engine'
import { cx } from '../lib/cx'
import { PixelIcon, type IconName } from './PixelIcon'
import { Tooltip } from './Tooltip'

/** One pixel icon per role, so it reads at a glance and never looks like a type chip. */
const ROLE_ICON: Record<SpeciesRole, IconName> = {
  scholar: 'chart',
  hunter: 'search',
  sprinter: 'bolt',
  marathoner: 'heart',
  technician: 'sparkle',
  guardian: 'shield',
  support: 'plus',
  allrounder: 'team',
}

/**
 * Static class strings so Tailwind can see them. The frame is a plain 2px border (square
 * corners) and the inside stays empty, unlike TypeBadge (solid type colour + notched ink frame).
 * `tab` is the filled "Rol" label of the large size; it has the frame's colour so they read as one piece.
 */
const SURFACE = {
  light: { frame: 'border-dusk-700 text-dusk-800 hover:bg-dusk-700/10', tab: 'bg-dusk-700 text-mist-50' },
  dark: { frame: 'border-mist-300 text-mist-100 hover:bg-mist-100/10', tab: 'bg-mist-300 text-ink' },
}

export interface RoleBadgeProps {
  role: SpeciesRole | undefined
  /** `sm` (default): icon + name, for lists. `md`: adds the "Rol" label and a "?" so it invites a tap, for a nameplate. */
  size?: 'sm' | 'md'
  /** On a light surface (the nameplate card) instead of a dark one. */
  onLight?: boolean
  className?: string
}

/**
 * The species' PokeFocus role (curation sheet): an outlined tag with a role icon, so it is
 * not mistaken for a type or for the nature. Opens a help popover (hover, focus, click and tap)
 * saying what the role does and that it belongs to the species, not to this individual.
 */
export function RoleBadge({ role, size = 'sm', onLight, className }: RoleBadgeProps) {
  const { t } = useTranslation()
  if (!role) return null
  const name = t(`roles.${role}.name`)
  const s = SURFACE[onLight ? 'light' : 'dark']
  const md = size === 'md'
  return (
    <Tooltip
      variant="help"
      content={
        <span className="flex flex-col gap-1.5">
          <span className="font-display text-base">{name}</span>
          <span>{t(`roles.${role}.body`)}</span>
          <span className="border-t-2 border-dusk-600/20 pt-1.5 text-dusk-700">{t('roleInfo.species')}</span>
          <span className="text-dusk-700">{t('roleInfo.notNature')}</span>
        </span>
      }
    >
      <button
        type="button"
        aria-label={t('roleInfo.aria', { name })}
        className={cx(
          'inline-flex cursor-help items-stretch border-2 font-display leading-none whitespace-nowrap transition-colors',
          md ? 'h-8 text-base' : 'h-6 text-sm',
          s.frame,
          className,
        )}
      >
        {md && <span className={cx('grid place-items-center px-2', s.tab)}>{t('roleInfo.prefix')}</span>}
        <span className={cx('inline-flex items-center gap-1.5', md ? 'px-2.5' : 'px-1.5')}>
          <PixelIcon name={ROLE_ICON[role]} size={10} />
          {name}
          {md && <PixelIcon name="help" size={10} className="opacity-60" />}
        </span>
      </button>
    </Tooltip>
  )
}
