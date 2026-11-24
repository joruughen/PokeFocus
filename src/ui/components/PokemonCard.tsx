import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PokemonView, TypeSlug } from '../../engine'
import { cx } from '../lib/cx'
import { fmtNum } from '../lib/format'
import { lookOf } from '../lib/look'
import { useNames } from '../lib/names'
import { PixelIcon } from './PixelIcon'
import { ProgressBar } from './ProgressBar'
import { Sprite } from './Sprite'
import { Platform } from './Stage'
import { Tooltip } from './Tooltip'
import { TeraBadge, TypeBadge } from './TypeBadge'

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
  const name = names.pokemon(p)
  const fullName = names.pokemonFull(p)
  const look = lookOf(view)
  const e = energy ?? view.energy
  const exhausted = e <= 0
  const plate = (
    <div className={cx('relative w-full bg-mist-50 px-3 pt-2 pb-2.5 text-ink shadow-raised', dim && 'opacity-70')}>
      <div className="flex items-baseline justify-between gap-2">
        <span title={p.nickname ? fullName : undefined} className={cx('min-w-0 truncate font-display leading-tight', variant === 'stage' ? 'text-base' : 'text-lg')}>
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
        {view.fightTypes.map((ty) => (
          <TypeBadge key={ty} type={ty} />
        ))}
        {view.tera && <TeraBadge tera={view.tera} />}
        {condition && condition.mult > 1 && condition.type && (
          <Tooltip content={t('conditions.memberBoost', { type: names.type(condition.type), mult: fmtNum(condition.mult) })}>
            <span tabIndex={0} className="ml-auto font-num text-lg leading-none text-leaf-600">
              ×{fmtNum(condition.mult)}
            </span>
          </Tooltip>
        )}
      </div>
      {view.copy && <CopyLookBadge speciesSlug={view.copy.speciesSlug} onLight className="mt-1.5" />}
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
          <Sprite kind="icon" slug={look.slug} shiny={look.shiny} scale={1} alt="" />
          {leader && <LeaderMark />}
        </div>
        {plate}
        {floating && <div className="pointer-events-none absolute top-1 right-3 animate-float-up font-num text-4xl text-cheek-500 [text-shadow:0_2px_0_var(--color-ink)]">{floating}</div>}
      </div>
    )
  }

  return (
    <div className={cx('relative flex w-full flex-col items-center', shake && 'animate-shake', className)}>
      <div className="relative flex h-56 w-full items-end justify-center">
        <Platform width={120} night={night} className="absolute bottom-0" />
        <Sprite
          kind="showdown"
          slug={look.slug}
          shiny={look.shiny}
          box={{ height: 210, width: 180 }}
          flip
          alt={fullName}
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

/** "Copia a {{name}}": small outlined tag for a Pokémon that is copying a teammate (Ditto). Truncates instead of overflowing its card. */
export function CopyLookBadge({ speciesSlug, onLight, className }: { speciesSlug: string; onLight?: boolean; className?: string }) {
  const { t } = useTranslation()
  const names = useNames()
  const label = t('copyLook.badge', { name: names.species(speciesSlug) })
  return (
    <span
      title={label}
      className={cx(
        'inline-flex w-fit max-w-full items-center gap-1 border-2 px-1.5 py-0.5 font-display text-sm leading-none',
        onLight ? 'border-dusk-700 text-dusk-800' : 'border-mist-300 text-mist-100',
        className,
      )}
    >
      <PixelIcon name="sparkle" size={10} className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
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
