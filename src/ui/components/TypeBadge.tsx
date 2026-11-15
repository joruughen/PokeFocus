import type { TypeSlug } from '../../engine'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'
import { fmtTimeLeft } from '../lib/format'
import { useNames } from '../lib/names'
import { PixelIcon } from './PixelIcon'

/** Static class strings so Tailwind can see them. Dark types get light text. */
const TYPE_CLASS: Record<TypeSlug, string> = {
  normal: 'bg-type-normal text-ink',
  fire: 'bg-type-fire text-ink',
  water: 'bg-type-water text-ink',
  electric: 'bg-type-electric text-ink',
  grass: 'bg-type-grass text-ink',
  ice: 'bg-type-ice text-ink',
  fighting: 'bg-type-fighting text-mist-50',
  poison: 'bg-type-poison text-mist-50',
  ground: 'bg-type-ground text-ink',
  flying: 'bg-type-flying text-ink',
  psychic: 'bg-type-psychic text-ink',
  bug: 'bg-type-bug text-ink',
  rock: 'bg-type-rock text-ink',
  ghost: 'bg-type-ghost text-mist-50',
  dragon: 'bg-type-dragon text-mist-50',
  dark: 'bg-type-dark text-mist-50',
  steel: 'bg-type-steel text-ink',
  fairy: 'bg-type-fairy text-ink',
}

/** Text color of a type, for small accents on dark surfaces. */
export const TYPE_TEXT: Record<TypeSlug, string> = {
  normal: 'text-type-normal',
  fire: 'text-type-fire',
  water: 'text-type-water',
  electric: 'text-type-electric',
  grass: 'text-type-grass',
  ice: 'text-type-ice',
  fighting: 'text-type-fighting',
  poison: 'text-type-poison',
  ground: 'text-type-ground',
  flying: 'text-type-flying',
  psychic: 'text-type-psychic',
  bug: 'text-type-bug',
  rock: 'text-type-rock',
  ghost: 'text-type-ghost',
  dragon: 'text-type-dragon',
  dark: 'text-type-dark',
  steel: 'text-type-steel',
  fairy: 'text-type-fairy',
}


/** Background color of a type (dots, swatches). */
export const TYPE_BG: Record<TypeSlug, string> = {
  normal: 'bg-type-normal',
  fire: 'bg-type-fire',
  water: 'bg-type-water',
  electric: 'bg-type-electric',
  grass: 'bg-type-grass',
  ice: 'bg-type-ice',
  fighting: 'bg-type-fighting',
  poison: 'bg-type-poison',
  ground: 'bg-type-ground',
  flying: 'bg-type-flying',
  psychic: 'bg-type-psychic',
  bug: 'bg-type-bug',
  rock: 'bg-type-rock',
  ghost: 'bg-type-ghost',
  dragon: 'bg-type-dragon',
  dark: 'bg-type-dark',
  steel: 'bg-type-steel',
  fairy: 'bg-type-fairy',
}

export interface TypeBadgeProps {
  type: TypeSlug
  size?: 'sm' | 'md'
  /** Dim the badge (e.g. a condition that is not active). */
  muted?: boolean
  className?: string
}

/** Localized type chip (name from types.json). */
export function TypeBadge({ type, size = 'sm', muted, className }: TypeBadgeProps) {
  const names = useNames()
  return (
    <span
      className={cx(
        'inline-flex items-center font-display leading-none whitespace-nowrap shadow-frame',
        size === 'sm' ? 'h-5 px-1.5 text-sm' : 'h-7 px-2.5 text-base',
        TYPE_CLASS[type],
        muted && 'opacity-45 saturate-50',
        className,
      )}
    >
      {names.type(type)}
    </span>
  )
}

/**
 * Active Terastallization (GDD §9.4, `PokemonView.tera`): a type chip with a crystal mark and "Tera", whose
 * tooltip / accessible text says the time and sessions left. `compact` shows only the mark in the type color.
 */
export function TeraBadge({
  tera,
  size = 'sm',
  compact,
  className,
}: {
  tera: { type: TypeSlug; msLeft: number; sessionsLeft: number }
  size?: 'sm' | 'md'
  compact?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const names = useNames()
  const label = t('training.tera.tip', { type: names.type(tera.type), time: fmtTimeLeft(tera.msLeft), count: tera.sessionsLeft })
  if (compact) return <PixelIcon name="sparkle" size={10} className={cx('shrink-0', TYPE_TEXT[tera.type], className)} label={label} />
  return (
    <span
      title={label}
      className={cx(
        'inline-flex items-center gap-1 font-display leading-none whitespace-nowrap shadow-frame outline-2 -outline-offset-2 outline-mist-50/70',
        size === 'sm' ? 'h-5 px-1.5 text-sm' : 'h-7 px-2.5 text-base',
        TYPE_CLASS[tera.type],
        className,
      )}
    >
      <PixelIcon name="sparkle" size={10} />
      {t('training.tera.badge')} {names.type(tera.type)}
      <span className="sr-only">. {label}</span>
    </span>
  )
}
