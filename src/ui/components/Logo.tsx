import { cx } from '../lib/cx'
import { ArtSvg } from './ArtSvg'

/**
 * `/art/logo.svg` (83×16 grid) inlined so its colors follow the theme: on our
 * dark surfaces "Focus" and the outline use the light mist color.
 * `height` should be a multiple of 16 (32, 48) to keep pixels crisp.
 */
export function Logo({ height = 32, className, onLight = false }: { height?: 16 | 32 | 48 | 64; className?: string; onLight?: boolean }) {
  const width = (height / 16) * 83
  const vars = onLight
    ? undefined
    : ({ '--logo-accent': 'var(--color-mist-50)', '--logo-primary': 'var(--color-cheek-400)', '--logo-paper': 'var(--color-mist-50)' } as React.CSSProperties)
  return (
    <ArtSvg
      name="logo"
      width={width}
      height={height}
      label="PokeFocus"
      className={className}
      style={vars}
      fallback={
        <span className={cx('inline-flex items-center font-display text-mist-50', className)} style={{ fontSize: height * 0.75, lineHeight: 1, height }}>
          PokeFocus
        </span>
      }
    />
  )
}
