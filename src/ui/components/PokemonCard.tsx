import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PokemonView, TypeSlug } from '../../engine'
import { cx } from '../lib/cx'
import { useNames } from '../lib/names'
import { PixelIcon } from './PixelIcon'
import { ProgressBar } from './ProgressBar'
import { Sprite } from './Sprite'
import { Platform } from './Stage'
import { Tooltip } from './Tooltip'
import { TypeBadge } from './TypeBadge'

export interface PokemonCardProps {
  /** From the engine: `pokemonView(state, uid, now)`. */
  view: PokemonView
  /**
   * - `stage`: animated sprite on a platform + battle-style nameplate (team on the route).
   * - `compact`: box icon + nameplate in one row (lists, wave screen).
   */
  variant?: 'stage' | 'compact'
  leader?: boolean
  /** Active type condition for this member right now (multiplier > 1). */
  condition?: { type: TypeSlug | null; mult: number } | null
  /** Energy before the last change (shows a trail on the bar). */
  energyFrom?: number
  /** Override the energy shown (e.g. the session's start energy). */
  energy?: number
  /** Short-lived feedback above the card ("-12"). */
  floating?: ReactNode
  shake?: boolean
  dim?: boolean
  night?: boolean
  className?: string
  /** Extra line under the nameplate. */
  footer?: ReactNode
}

/** A team member: sprite + nameplate (name, level, types, Energy, leader crown). */
export function PokemonCard({ view, variant = 'stage', leader, condition, energyFrom, energy, floating, shake, dim, night, className, footer }: PokemonCardProps) {
  const { t } = useTranslation()
  const names = useNames()
  const p = view.pokemon
  const name = names.species(p.speciesSlug)
  const e = energy ?? view.energy
  const exhausted = e <= 0
  const plate = (
    <div className={cx('relative w-full bg-mist-50 px-3 pt-2 pb-2.5 text-ink shadow-raised', dim && 'opacity-70')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cx('min-w-0 truncate font-display leading-tight', variant === 'stage' ? 'text-base' : 'text-lg')}>
          {name}
          {p.isShiny && (
            <span className="ml-1 text-volt-700" aria-label={t('pokemon.shiny')}>
              ★
            </span>
          )}
        </span>
        <span className="shrink-0 font-num text-xl leading-none">
          {t('pokemon.levelShort')}
          {p.level}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {view.types.map((ty) => (
          <TypeBadge key={ty} type={ty} />
        ))}
        {condition && condition.mult > 1 && condition.type && (
          <Tooltip content={t('conditions.memberBoost', { type: names.type(condition.type), mult: condition.mult.toFixed(2) })}>
            <span tabIndex={0} className="ml-auto font-num text-lg leading-none text-leaf-600">
              ×{condition.mult.toFixed(2)}
            </span>
          </Tooltip>
        )}
      </div>
      <div className="mt-2">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="font-display text-sm text-dusk-600">{t('stats.hp.name')}</span>
          <span className="font-num text-lg leading-none tabular">
            {Math.round(e)}/{Math.round(view.maxEnergy)}
          </span>
        </div>
        <ProgressBar size="sm" variant="energy" value={e} from={energyFrom} max={view.maxEnergy} label={t('pokemon.energyOf', { name })} />
      </div>
      {exhausted && <p className="mt-1 text-xs font-bold text-cheek-700">{t('pokemon.exhausted')}</p>}
      {footer}
    </div>
  )

  if (variant === 'compact') {
    return (
      <div className={cx('relative flex items-center gap-2', shake && 'animate-shake', className)}>
        <div className="relative grid size-14 shrink-0 place-items-center bg-dusk-900 inset-shadow-well">
          <Sprite kind="icon" slug={p.speciesSlug} scale={1} alt="" />
          {leader && <LeaderMark />}
        </div>
        {plate}
        {floating && <div className="pointer-events-none absolute top-1 right-3 animate-float-up font-num text-4xl text-cheek-500 [text-shadow:0_2px_0_var(--color-ink)]">{floating}</div>}
      </div>
    )
  }

  return (
    <div className={cx('relative flex w-full flex-col items-center', shake && 'animate-shake', className)}>
      <div className="relative flex h-36 w-full items-end justify-center">
        <Platform width={120} night={night} className="absolute bottom-0" />
        <Sprite
          kind="showdown"
          slug={p.speciesSlug}
          shiny={p.isShiny}
          scale={2}
          flip
          alt={name}
          className={cx('relative mb-3', exhausted && 'grayscale', dim && 'brightness-75')}
        />
        {leader && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2">
            <LeaderMark large />
          </div>
        )}
        {floating && <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 animate-float-up font-num text-3xl text-cheek-400 [text-shadow:0_2px_0_var(--color-ink)]">{floating}</div>}
      </div>
      <div className="mt-2 w-full">{plate}</div>
    </div>
  )
}

function LeaderMark({ large }: { large?: boolean }) {
  const { t } = useTranslation()
  return (
    <Tooltip content={t('team.leaderTip')}>
      <span
        tabIndex={0}
        className={cx(
          'inline-flex items-center gap-1 bg-volt-400 text-ink shadow-frame',
          large ? 'px-1.5 py-0.5 font-display text-sm' : 'absolute -top-1 -left-1 p-0.5',
        )}
      >
        <PixelIcon name="crown" size={large ? 14 : 12} />
        {large && t('team.leader')}
      </span>
    </Tooltip>
  )
}
