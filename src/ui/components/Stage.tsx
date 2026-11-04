import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'
import type { TimeOfDay, WeatherKind } from '../lib/conditions'

/**
 * The route band: a pixel landscape whose sky follows the player's local time
 * (morning / day / evening / night, the same windows as the type conditions)
 * and whose weather follows the weather selector. Pokémon stand on platforms.
 * It is the one decorative element of the app, and it carries information.
 */
export interface StageProps {
  time: TimeOfDay
  weather: WeatherKind
  /** `route`: home; `focus`: calm, dimmed for sessions; `field`: tall grass for waves. */
  variant?: 'route' | 'focus' | 'field'
  className?: string
  children?: ReactNode
  /** Extra content pinned to the sky (top-left), e.g. a clock label. */
  sky?: ReactNode
  /** Draw the sun or moon (off for small repeated stages). */
  celestial?: boolean
}

const SKY: Record<TimeOfDay, string> = {
  morning: 'from-sky-morning-top to-sky-morning-bottom',
  day: 'from-sky-day-top to-sky-day-bottom',
  evening: 'from-sky-evening-top to-sky-evening-bottom',
  night: 'from-sky-night-top to-sky-night-bottom',
}

/** 24×12 grass tile drawn at 2× (pixel blades), as a data URI. */
const TUFTS =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" shape-rendering="crispEdges"><g fill="rgba(0,0,0,0.16)"><path d="M3 4h1v2H3zM4 5h1v1H4zM15 8h1v2h-1zM16 9h1v1h-1zM9 10h1v1H9z"/></g><g fill="rgba(255,255,255,0.14)"><path d="M20 3h1v1h-1zM7 7h1v1H7z"/></g></svg>',
  )

const STARS =
  '12px 14px var(--color-mist-50), 64px 38px var(--color-mist-50), 140px 22px var(--color-mist-300), 220px 54px var(--color-mist-50), 310px 18px var(--color-mist-300), 420px 44px var(--color-mist-50), 520px 12px var(--color-mist-50), 610px 60px var(--color-mist-300), 700px 26px var(--color-mist-50), 812px 48px var(--color-mist-50), 905px 16px var(--color-mist-300), 1010px 40px var(--color-mist-50), 1120px 20px var(--color-mist-50), 1230px 58px var(--color-mist-300)'

export function Stage({ time, weather, variant = 'route', className, children, sky, celestial = true }: StageProps) {
  const night = time === 'night'
  const groundStyle: CSSProperties = {
    backgroundImage: `linear-gradient(to bottom, rgb(255 255 255 / 0.2) 0 4px, transparent 4px), url("${TUFTS}")`,
    backgroundSize: 'auto, 48px 24px',
  }
  return (
    <div className={cx('relative isolate overflow-hidden shadow-plate', className)}>
      {/* Sky */}
      <div className={cx('absolute inset-0 -z-20 bg-linear-to-b', SKY[time], variant === 'focus' && 'brightness-[0.62] saturate-[0.85]')} aria-hidden />
      {night && <div className="absolute top-0 left-0 -z-10 size-0.5 animate-twinkle" style={{ boxShadow: STARS }} aria-hidden />}
      {/* Sun or moon */}
      {celestial && weather !== 'rain' && (
        <div
          aria-hidden
          className={cx(
            'absolute -z-10',
            night || time === 'evening' ? 'top-6 right-[12%] size-10 bg-mist-100' : 'top-5 right-[10%] size-14 bg-volt-300',
            weather === 'sun' && !night && 'size-20 bg-volt-400 shadow-[0_0_0_8px_rgb(255_210_63/0.35),0_0_0_16px_rgb(255_210_63/0.15)]',
          )}
          style={{ clipPath: 'polygon(30% 0,70% 0,70% 10%,90% 10%,90% 30%,100% 30%,100% 70%,90% 70%,90% 90%,70% 90%,70% 100%,30% 100%,30% 90%,10% 90%,10% 70%,0 70%,0 30%,10% 30%,10% 10%,30% 10%)' }}
        />
      )}
      {weather === 'rain' && (
        <>
          <PixelCloud className="top-4 left-[8%] opacity-90" />
          <PixelCloud className="top-10 left-[46%] scale-x-[-1]" />
          <PixelCloud className="top-3 right-[6%] opacity-80" />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 animate-rain opacity-60"
            style={{ backgroundImage: 'repeating-linear-gradient(115deg, transparent 0 22px, rgb(220 235 255 / 0.55) 22px 24px)', backgroundSize: '24px 48px' }}
          />
        </>
      )}
      {weather === 'cold' && (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 animate-snow"
          style={{
            backgroundImage:
              'radial-gradient(var(--color-mist-50) 1.5px, transparent 2px), radial-gradient(rgb(255 255 255 / 0.6) 1px, transparent 1.5px)',
            backgroundSize: '48px 48px, 32px 32px',
            backgroundPosition: '0 0, 16px 20px',
          }}
        />
      )}
      {/* Ground */}
      <div
        aria-hidden
        className={cx('absolute inset-x-0 bottom-0 -z-10', variant === 'field' ? 'h-[42%]' : 'h-[30%]', night ? 'bg-grass-night' : 'bg-grass-500', variant === 'focus' && 'brightness-[0.62]')}
        style={groundStyle}
      />
      {variant === 'field' && <TallGrass night={night} />}
      {sky && <div className="absolute top-3 left-4 z-10">{sky}</div>}
      <div className="relative z-0 h-full">{children}</div>
    </div>
  )
}

function PixelCloud({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 6" width={128} height={48} shapeRendering="crispEdges" className={cx('absolute -z-10', className)} aria-hidden>
      <path d="M4 0h5v1h2v1h3v1h1v3H0V3h1V2h3z" fill="var(--color-mist-300)" />
      <path d="M0 5h16v1H0z" fill="var(--color-mist-400)" />
    </svg>
  )
}

function TallGrass({ night }: { night: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-10"
      style={{
        backgroundImage: `linear-gradient(${night ? 'var(--color-grass-night)' : 'var(--color-grass-700)'} 0 0)`,
        clipPath: 'polygon(0 100%, 0 40%, 2% 0, 4% 40%, 6% 10%, 8% 40%, 10% 0, 12% 40%, 14% 15%, 16% 40%, 18% 0, 20% 40%, 22% 10%, 24% 40%, 26% 0, 28% 40%, 30% 15%, 32% 40%, 34% 0, 36% 40%, 38% 10%, 40% 40%, 42% 0, 44% 40%, 46% 15%, 48% 40%, 50% 0, 52% 40%, 54% 10%, 56% 40%, 58% 0, 60% 40%, 62% 15%, 64% 40%, 66% 0, 68% 40%, 70% 10%, 72% 40%, 74% 0, 76% 40%, 78% 15%, 80% 40%, 82% 0, 84% 40%, 86% 10%, 88% 40%, 90% 0, 92% 40%, 94% 15%, 96% 40%, 98% 0, 100% 40%, 100% 100%)',
      }}
    />
  )
}

/** Pixel ellipse a sprite stands on (like the battle platforms). */
export function Platform({ width = 112, night = false, ghost = false, className }: { width?: number; night?: boolean; ghost?: boolean; className?: string }) {
  const top = ghost ? 'transparent' : night ? 'var(--color-grass-night-light)' : 'var(--color-grass-300)'
  const bottom = ghost ? 'transparent' : night ? 'var(--color-grass-night)' : 'var(--color-grass-700)'
  return (
    <svg viewBox="0 0 28 7" width={width} height={(width * 7) / 28} shapeRendering="crispEdges" aria-hidden className={className}>
      <path d="M6 0h16v1h4v1h2v3h-2v1h-4v1H6V6H2V5H0V2h2V1h4z" fill={bottom} stroke={ghost ? 'var(--color-mist-300)' : 'none'} strokeWidth={ghost ? 0.5 : 0} strokeDasharray={ghost ? '1 1' : undefined} />
      {!ghost && <path d="M6 0h16v1h4v1h2v1H0V2h2V1h4z" fill={top} />}
    </svg>
  )
}
