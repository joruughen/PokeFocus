import { useState, type CSSProperties } from 'react'
import { trainerSpriteUrl } from '../../game/trainers'
import { cx } from '../lib/cx'

export interface TrainerSpriteProps {
  /** Slug of the trainer catalogue (src/game/trainerCatalog.ts). */
  slug: string
  /** Integer scale of the 80×80 Showdown PNG (pixel art is never scaled by fractions). */
  scale?: number
  /** Accessible name (the character's name); empty = decorative. */
  alt: string
  /** Mirror horizontally (the trainer looks at their team on the right, like the Pokémon). */
  flip?: boolean
  /** Load only when it is about to scroll into view (the picker draws hundreds). */
  lazy?: boolean
  className?: string
  style?: CSSProperties
}

/** The character a player picked: a local 80×80 PNG drawn with `image-rendering: pixelated`. */
export function TrainerSprite({ slug, scale = 1, alt, flip, lazy, className, style }: TrainerSpriteProps) {
  const src = trainerSpriteUrl(slug)
  const [failed, setFailed] = useState<string | null>(null)
  const size = 80 * Math.max(1, Math.round(scale))
  if (failed === src) {
    return <span role={alt ? 'img' : undefined} aria-label={alt || undefined} className={cx('inline-block bg-dusk-700/60 shadow-frame', className)} style={{ width: size, height: size, ...style }} />
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      onError={() => setFailed(src)}
      className={cx('pixelated max-w-none select-none', className)}
      style={{ transform: flip ? 'scaleX(-1)' : undefined, ...style }}
    />
  )
}
