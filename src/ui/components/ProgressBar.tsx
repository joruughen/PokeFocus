import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export type BarVariant = 'energy' | 'hp' | 'exp' | 'volt'

export interface ProgressBarProps {
  value: number
  max: number
  /**
   * - `energy`: a team member's daily Energy (green → amber → red, like the games' HP bar).
   * - `hp`: a wild Pokémon's remaining HP (same colors).
   * - `exp`: EXP towards the next level (blue).
   * - `volt`: generic progress (league, timer).
   */
  variant?: BarVariant
  /** Accessible name, e.g. "Energía de Bulbasaur". */
  label: string
  /** Visible text on the right ("31/45"). */
  valueText?: ReactNode
  /** Previous value: drawn as a pale trail (damage taken, EXP gained). */
  from?: number
  size?: 'sm' | 'md' | 'lg'
  /** Tick marks at these values (e.g. wave boundaries). */
  ticks?: number[]
  className?: string
}

function meterColor(f: number): string {
  if (f > 0.5) return 'bg-leaf-400'
  if (f > 0.2) return 'bg-amber-400'
  return 'bg-cheek-400'
}

const H = { sm: 'h-2', md: 'h-3', lg: 'h-5' }

/** Pixel meter. Uses role="meter" with the real values for assistive tech. */
export function ProgressBar({ value, max, variant = 'volt', label, valueText, from, size = 'md', ticks, className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1
  const f = Math.max(0, Math.min(1, value / safeMax))
  const trail = from !== undefined ? Math.max(0, Math.min(1, from / safeMax)) : null
  const fill =
    variant === 'exp' ? 'bg-exp-400' : variant === 'volt' ? 'bg-volt-400' : meterColor(f)
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeMax)}
        aria-valuenow={Math.round(value)}
        className={cx('relative flex-1 overflow-hidden bg-ink shadow-frame', H[size])}
      >
        {trail !== null && trail > f && (
          <div className="absolute inset-y-0 left-0 bg-mist-50/60" style={{ width: `${trail * 100}%` }} />
        )}
        {trail !== null && trail < f && (
          <div className={cx('absolute inset-y-0 left-0 opacity-50', fill)} style={{ width: `${f * 100}%` }} />
        )}
        <div
          className={cx('absolute inset-y-0 left-0 transition-[width] duration-700 ease-[var(--ease-calm)]', fill)}
          style={{ width: `${(trail !== null && trail < f ? trail : f) * 100}%` }}
        >
          <div className="h-[35%] max-h-1 bg-white/35" />
        </div>
        {ticks?.map((tk) => (
          <span
            key={tk}
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-ink/80"
            style={{ left: `${Math.max(0, Math.min(1, tk / safeMax)) * 100}%` }}
          />
        ))}
      </div>
      {valueText !== undefined && <span className="shrink-0 font-num text-lg leading-none text-mist-100 tabular">{valueText}</span>}
    </div>
  )
}
