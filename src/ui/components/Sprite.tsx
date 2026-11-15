import { useState, type CSSProperties } from 'react'
import { defaultContext } from '../../engine'
import { cx } from '../lib/cx'

export type SpriteKind = 'showdown' | 'icon' | 'item'

export interface SpriteProps {
  kind: SpriteKind
  /** Species slug (showdown/icon) or item slug (item). */
  slug: string
  shiny?: boolean
  /** Integer scale (1, 2, 3…). Pixel art is never scaled by fractions. */
  scale?: number
  /** Items only: max box in px (some item sprites are 160px renders, not pixel art). */
  fit?: number
  /**
   * Max rendered height in px: the largest integer scale ≤ `scale` that fits is used (big
   * Pokémon such as Machamp drop from ×2 to ×1 instead of overflowing their card); only if
   * even ×1 is too tall does it shrink by a fraction.
   */
  maxHeight?: number
  /** Same for the width: wide sprites (Moltres is 217 px at ×1) must not push past their box either. Combines with `maxHeight`. */
  maxWidth?: number
  alt: string
  className?: string
  style?: CSSProperties
  /** Mirror horizontally (team faces right, wilds face left). */
  flip?: boolean
}

/**
 * Integer scale ≤ `scale` whose size fits `maxHeight` × `maxWidth` (fractional only when even ×1 is
 * too big). Without a limit, or with an unknown natural size, the requested scale is kept.
 */
export function spriteScale(naturalHeight: number, scale: number, maxHeight?: number, naturalWidth = 0, maxWidth?: number): number {
  let s = Math.max(1, Math.round(scale))
  const limitH = maxHeight !== undefined && naturalHeight > 0
  const limitW = maxWidth !== undefined && naturalWidth > 0
  if (!limitH && !limitW) return s
  const fits = (k: number) => (!limitH || naturalHeight * k <= maxHeight!) && (!limitW || naturalWidth * k <= maxWidth!)
  while (s > 1 && !fits(s)) s--
  if (fits(s)) return s
  return Math.min(limitH ? maxHeight! / naturalHeight : Infinity, limitW ? maxWidth! / naturalWidth : Infinity)
}

export function spriteUrl(kind: SpriteKind, slug: string, shiny = false): string {
  if (kind === 'item') return `/sprites/items/${slug}.png`
  const id = defaultContext().speciesBySlug.get(slug)?.id ?? 0
  if (kind === 'icon') return `/sprites/icons/${id}.png`
  return shiny ? `/sprites/showdown-shiny/${id}.gif` : `/sprites/showdown/${id}.gif`
}

/**
 * Local sprite with integer scaling and `image-rendering: pixelated`.
 * The size is set from the image's natural size × `scale` once it loads, so a
 * 45×49 GIF at scale 2 is exactly 90×98 CSS px.
 */
export function Sprite({ kind, slug, shiny = false, scale = 1, fit, maxHeight, maxWidth, alt, className, style, flip }: SpriteProps) {
  const src = spriteUrl(kind, slug, shiny)
  const [size, setSize] = useState<{ src: string; w: number; h: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const known = size?.src === src ? size : null
  let w: number | undefined
  let h: number | undefined
  if (known) {
    const big = fit !== undefined && Math.max(known.w, known.h) > fit
    const s = big ? fit / Math.max(known.w, known.h) : spriteScale(known.h, scale, maxHeight, known.w, maxWidth)
    w = Math.round(known.w * s)
    h = Math.round(known.h * s)
  }
  if (failed === src) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={cx('inline-block bg-dusk-700/60 shadow-frame', className)}
        style={{ width: 24 * scale, height: 24 * scale, ...style }}
      />
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      width={w}
      height={h}
      draggable={false}
      decoding="async"
      onLoad={(e) => setSize({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      onError={() => setFailed(src)}
      className={cx('pixelated max-w-none select-none', !known && 'opacity-0', className)}
      style={{ transform: flip ? 'scaleX(-1)' : undefined, ...style }}
    />
  )
}
