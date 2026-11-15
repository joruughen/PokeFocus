import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultContext, type OwnedPokemon } from '../../engine'
import { cx } from '../lib/cx'
import { useNames } from '../lib/names'
import { PixelIcon } from './PixelIcon'
import { Sprite } from './Sprite'
import { TYPE_BG } from './TypeBadge'

export interface MonTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  mon: OwnedPokemon
  /** Team slot (0 = leader) or null when in the box. */
  teamSlot: number | null
  /** Energy fraction 0–1 (shows a thin meter); omit to hide. */
  energy?: number
  selected?: boolean
  /**
   * Selection mode (Box multi-select): the tile becomes a checkbox. With `blockedReason` it
   * cannot be checked (still focusable, the reason is read out and shown as a tooltip).
   */
  select?: { checked: boolean; blockedReason?: string }
}

/**
 * One Pokémon in the Box grid: pixel box icon on a well, name, level, team /
 * leader marker, shiny star, a thin Energy meter. A single button (no nested
 * focusables) with a full aria-label.
 */
export const MonTile = forwardRef<HTMLButtonElement, MonTileProps>(function MonTile({ mon, teamSlot: slot, energy, selected, select, className, ...rest }, ref) {
  const { t } = useTranslation()
  const names = useNames()
  const sp = defaultContext().speciesBySlug.get(mon.speciesSlug)
  const name = names.pokemon(mon)
  const types = sp?.types ?? []
  const label = [
    names.pokemonFull(mon),
    `${t('pokemon.levelShort')} ${mon.level}`,
    mon.isShiny ? t('pokemon.shiny') : '',
    slot === 0 ? t('team.leader') : slot !== null ? t('box.inTeam') : '',
    energy !== undefined && energy <= 0 ? t('box.exhaustedShort') : '',
    select?.blockedReason ?? '',
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      {...(select ? { role: 'checkbox', 'aria-checked': select.checked, 'aria-disabled': select.blockedReason ? true : undefined, title: select.blockedReason } : {})}
      className={cx(
        'group relative flex flex-col items-stretch bg-dusk-800 text-left shadow-frame transition-[background-color,translate] duration-75',
        'hover:-translate-y-0.5 hover:bg-dusk-700 active:translate-y-0',
        selected && 'bg-dusk-700 outline-3 outline-offset-2 outline-volt-400',
        select?.checked && 'bg-dusk-700 outline-3 -outline-offset-3 outline-cheek-400',
        select?.blockedReason && 'opacity-55 hover:translate-y-0 hover:bg-dusk-800',
        className,
      )}
      {...rest}
    >
      <span className={cx('relative grid h-[4.5rem] place-items-center inset-shadow-well', mon.isShiny ? 'bg-[radial-gradient(circle,var(--color-dusk-700)_0_45%,var(--color-dusk-900)_46%)]' : 'bg-dusk-900')}>
        <Sprite kind="icon" slug={mon.speciesSlug} scale={2} alt="" className={cx(energy !== undefined && energy <= 0 && 'grayscale')} />
        {slot !== null && (
          <span className={cx('absolute top-1 left-1 inline-flex h-5 items-center gap-0.5 px-1 font-display text-sm leading-none shadow-frame', slot === 0 ? 'bg-volt-400 text-ink' : 'bg-dusk-600 text-mist-50')}>
            {slot === 0 ? <PixelIcon name="crown" size={10} /> : <PixelIcon name="team" size={10} />}
            {slot + 1}
          </span>
        )}
        {mon.isShiny && (
          <span className="absolute top-1 right-1 bg-shiny-300 px-1 font-display text-sm leading-tight text-ink shadow-frame" aria-hidden>
            ★
          </span>
        )}
        {select && (
          <span
            className={cx('absolute right-1 bottom-1 grid size-6 place-items-center shadow-frame', select.checked ? 'bg-cheek-500 text-mist-50' : select.blockedReason ? 'bg-dusk-700 text-mist-400' : 'bg-dusk-900 text-transparent')}
            aria-hidden
          >
            {select.blockedReason ? <PixelIcon name="lock" size={14} /> : <PixelIcon name="check" size={14} />}
          </span>
        )}
        <span className="absolute bottom-1 left-1 flex gap-0.5" aria-hidden>
          {types.map((ty) => (
            <span key={ty} className={cx('size-2.5 shadow-frame', TYPE_BG[ty])} />
          ))}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-1 px-2 pt-1.5">
        <span title={mon.nickname ? names.pokemonFull(mon) : undefined} className="min-w-0 truncate font-display text-base leading-tight">{name}</span>
        <span className="shrink-0 font-num text-lg leading-none text-mist-300">
          {t('pokemon.levelShort')}
          {mon.level}
        </span>
      </span>
      <span className="px-2 pt-1 pb-2" aria-hidden>
        {energy !== undefined ? (
          <span className="block h-1.5 bg-ink">
            <span className={cx('block h-full', energy > 0.5 ? 'bg-leaf-400' : energy > 0.2 ? 'bg-amber-400' : 'bg-cheek-400')} style={{ width: `${Math.max(0, Math.min(1, energy)) * 100}%` }} />
          </span>
        ) : (
          <span className="block h-1.5" />
        )}
      </span>
    </button>
  )
})
