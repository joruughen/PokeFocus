import { useTranslation } from 'react-i18next'
import { defaultContext } from '../../../engine'
import type { LiveEventPublic } from '../../../game/protocol'
import { canAppearAt, speciesReach, type SpawnReach } from '../../../game/content/spawnOdds'
import { Sprite } from '../../components'
import { cx } from '../../lib/cx'
import { asLocale, speciesName } from '../../lib/names'
import { fmtMult } from './model'

/** What the player-facing list says about a featured species that cannot show up for them yet (null = it can, or unknown level). */
export function lockedReach(species: string, trainerLevel: number | undefined): SpawnReach | null {
  if (trainerLevel === undefined) return null
  const ctx = defaultContext()
  const sp = ctx.speciesBySlug.get(species)
  if (!sp) return null
  const reach = speciesReach(ctx, sp)
  return canAppearAt(reach, trainerLevel) ? null : reach
}

export interface FeaturedListProps {
  featured: LiveEventPublic['featured']
  /** The player's trainer level: species that cannot be a wild yet are dimmed with a friendly tag. Absent = no marks. */
  trainerLevel?: number
  /** Show the one-line "the number is how much more likely" note (the page; the pop-up is short). */
  note?: boolean
}

/**
 * The event's featured species as tiles (× multiplier). Species that cannot spawn at the player's level are
 * not hidden: they are dimmed and tagged «From lv. N» (or «Evolution only») with a short explanation underneath.
 */
export function FeaturedList({ featured, trainerLevel, note }: FeaturedListProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const locks = featured.map((f) => lockedReach(f.species, trainerLevel))
  const anyFrom = locks.some((r) => r?.kind === 'wild')
  const anyEvolution = locks.some((r) => r?.kind === 'evolution')
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {featured.map((f, i) => {
          const lock = locks[i]
          const title = lock?.kind === 'wild' ? t('events.featuredFromTitle', { wild: lock.wildLevel, trainer: lock.trainerLevel }) : lock?.kind === 'evolution' ? t('events.featuredEvolutionTitle') : undefined
          return (
            <li key={f.species} title={title} data-locked={lock ? 'true' : undefined} className="flex min-w-[5.5rem] flex-col items-center gap-0.5 bg-dusk-900 px-2 py-1.5 inset-shadow-well">
              <span className={cx('grid h-10 place-items-center', lock && 'opacity-50 grayscale-[.7]')}>
                <Sprite kind="icon" slug={f.species} scale={1} alt="" />
              </span>
              <span className={cx('text-center text-sm leading-tight', lock && 'text-mist-300')}>{speciesName(f.species, lng)}</span>
              <span className={cx('font-num text-lg leading-none', lock ? 'text-mist-400' : 'text-volt-300')}>×{fmtMult(f.weightMult)}</span>
              {lock && (
                <span className="mt-0.5 bg-dusk-700 px-1 pt-0.5 text-center font-display text-xs leading-tight text-mist-100">
                  {lock.kind === 'wild' ? t('events.featuredFrom', { level: lock.trainerLevel }) : t('events.featuredEvolution')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {note && <p className="text-xs text-mist-400">{t('events.featuredNote')}</p>}
      {anyFrom && <p className="text-xs text-mist-400">{t('events.featuredFromNote')}</p>}
      {anyEvolution && <p className="text-xs text-mist-400">{t('events.featuredEvolutionNote')}</p>}
    </>
  )
}
