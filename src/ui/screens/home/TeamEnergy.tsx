import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PokemonView } from '../../../engine'
import { PixelIcon, ProgressBar, Sprite } from '../../components'
import { cx } from '../../lib/cx'
import { useNames } from '../../lib/names'

export interface TeamEnergyHit {
  uid: string
  /** Energy before the hit (pale trail on the bar). */
  from: number
  /** Short text floating over the row ("−12", "¡Falló!"). */
  text: string
  /** Re-mount key so the shake replays on every hit. */
  key: number
}

/**
 * The whole team's Energy in a compact grid (2 columns on phones, 3 from `sm`).
 * Counterattacks hit whoever attacked the wild, so the leader's bar alone is not enough.
 */
export function TeamEnergy({
  views,
  leaderUid,
  target,
  hit,
  energyOverride,
  title,
  help,
  className,
  ...rest
}: {
  views: PokemonView[]
  leaderUid?: string
  /** Member that would take the next counterattack (outlined). */
  target?: string | null
  /** Last counterattack, animated on its row. */
  hit?: TeamEnergyHit | null
  /** Energy to show instead of the view's (e.g. frozen while a ball shakes). */
  energyOverride?: Record<string, number>
  title?: ReactNode
  help?: ReactNode
  className?: string
} & Record<`data-${string}`, string | undefined>) {
  const { t } = useTranslation()
  const names = useNames()
  return (
    <section className={cx('min-w-0', className)} aria-label={t('teamEnergy.label')} {...rest}>
      {(title || help) && (
        <p className="mb-1.5 flex items-center gap-2 text-sm text-mist-300">
          {title ?? t('teamEnergy.title')}
          {help}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {views.map((v) => {
          const uid = v.pokemon.uid
          // Nickname when it has one (same as the Box and the Team); the full "Nickname (Species)" is the tooltip.
          const name = names.pokemon(v.pokemon)
          const fullName = names.pokemonFull(v.pokemon)
          const e = energyOverride?.[uid] ?? v.energy
          const out = e <= 0
          const isHit = hit?.uid === uid
          const isTarget = target === uid
          return (
            <li
              key={isHit ? `${uid}-${hit.key}` : uid}
              className={cx(
                'relative flex min-w-0 items-center gap-1 bg-dusk-800 py-1 pr-2 pl-0.5 shadow-frame',
                isTarget && 'outline-2 -outline-offset-2 outline-volt-400',
                isHit && 'motion-safe:animate-shake',
              )}
            >
              <Sprite kind="icon" slug={v.pokemon.speciesSlug} shiny={v.pokemon.isShiny} alt="" className={cx('-my-2 shrink-0', out && 'opacity-50 grayscale')} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1">
                    {uid === leaderUid && <PixelIcon name="crown" size={10} className="shrink-0 text-volt-300" label={t('team.leader')} />}
                    <span title={v.pokemon.nickname ? fullName : undefined} className={cx('truncate font-display text-sm leading-tight', out ? 'text-mist-400' : 'text-mist-50')}>
                      {name}
                    </span>
                  </span>
                  <span className="shrink-0 font-num text-base leading-none tabular text-mist-100">
                    {out ? t('teamEnergy.out') : `${Math.round(e)}/${Math.round(v.maxEnergy)}`}
                  </span>
                </span>
                <ProgressBar
                  className="mt-1"
                  size="sm"
                  variant="energy"
                  value={e}
                  from={isHit ? hit.from : undefined}
                  max={v.maxEnergy}
                  label={t('pokemon.energyOf', { name: fullName })}
                  ariaValueText={`${Math.round(e)}/${Math.round(v.maxEnergy)}`}
                />
              </span>
              {isTarget && <span className="sr-only">{t('teamEnergy.nextTarget')}</span>}
              {isHit && (
                <span className="pointer-events-none absolute -top-3 right-1 animate-float-up font-num text-lg leading-none text-cheek-400" aria-hidden>
                  {hit.text}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
