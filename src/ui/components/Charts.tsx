import type { ReactNode } from 'react'
import { cx } from '../lib/cx'
import { Tooltip } from './Tooltip'

export interface ChartDatum {
  /** Axis label under the column ("lu", "#12"). */
  label: string
  value: number
  /** Tooltip content (defaults to the formatted value). */
  tip?: ReactNode
  /** Draw this column in the accent ring (e.g. today). */
  highlight?: boolean
}

interface ChartProps {
  data: ChartDatum[]
  /** Accessible summary of the chart. */
  label: string
  format: (v: number) => string
  height?: number
  /** Fixed top of the scale (e.g. 1 for Focus); default: a round number above the max. */
  max?: number
  className?: string
  /** Empty-state text when every value is 0. */
  empty?: ReactNode
}

/** A "nice" axis top: 1, 2, 2.5 or 5 × 10^n just above `v`. */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

function Grid({ top, format, height }: { top: number; format: (v: number) => string; height: number }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden style={{ height }}>
      {[1, 0.5].map((f) => (
        <div key={f} className="absolute inset-x-0 border-t-2 border-dashed border-dusk-700" style={{ bottom: f * height }}>
          <span className="absolute -top-2.5 right-full mr-2 font-num text-base leading-none text-mist-400">{format(top * f)}</span>
        </div>
      ))}
    </div>
  )
}

/** Space between columns: 6% of the width, shrinking with many columns so the gaps never add up to more than ~30%. */
export function barGap(columns: number): string {
  return columns > 1 ? `${Math.min(6, 30 / (columns - 1))}%` : '0%'
}

/**
 * Single-series column chart in the pixel style (hand-built, no chart lib):
 * square columns anchored to an ink baseline, two recessive dashed gridlines,
 * a hover/focus tooltip per column. One series → no legend (the panel title names it).
 */
export function BarChart({ data, label, format, height = 160, max, className, empty }: ChartProps) {
  const peak = Math.max(0, ...data.map((d) => d.value))
  const top = max ?? niceMax(peak)
  if (peak === 0 && empty) return <div className={cx('grid place-items-center text-sm text-mist-400', className)} style={{ height: height + 28 }}>{empty}</div>
  return (
    <figure className={cx('pl-12', className)} aria-label={label} role="img">
      <div className="relative" style={{ height }}>
        <Grid top={top} format={format} height={height} />
        <div className="absolute inset-0 flex items-end border-b-2 border-ink px-[3%]" style={{ gap: barGap(data.length) }}>
          {data.map((d, i) => {
            const h = Math.round((Math.min(d.value, top) / top) * height)
            return (
              <Tooltip key={i} content={d.tip ?? `${d.label}: ${format(d.value)}`}>
                <span tabIndex={0} className="group relative flex h-full flex-1 items-end outline-offset-2">
                  <span
                    className={cx('block w-full transition-[height] duration-500 ease-[var(--ease-calm)]', d.value > 0 ? 'bg-volt-400 group-hover:bg-volt-300' : 'bg-transparent', d.highlight && 'outline-2 outline-offset-2 outline-mist-50')}
                    style={{ height: d.value > 0 ? Math.max(3, h) : 0 }}
                  >
                    {d.value > 0 && <span className="block h-1 bg-white/35" />}
                  </span>
                </span>
              </Tooltip>
            )
          })}
        </div>
      </div>
      {data.length <= 8 ? (
        <div className="mt-1.5 flex gap-[6%] px-[3%]" aria-hidden>
          {data.map((d, i) => (
            <span key={i} className={cx('flex-1 text-center text-xs whitespace-nowrap', d.highlight ? 'font-bold text-mist-50' : 'text-mist-400')}>
              {d.label}
            </span>
          ))}
        </div>
      ) : (
        // Many columns: label only the two ends, pinned to the edges, so text never collides or pushes the page wider.
        <div className="mt-1.5 flex justify-between px-[3%] text-xs whitespace-nowrap text-mist-400" aria-hidden>
          <span>{data[0]?.label}</span>
          <span>{data[data.length - 1]?.label}</span>
        </div>
      )}
    </figure>
  )
}

/**
 * Single-series line (trend over sessions): 2px stepped-free polyline with
 * square markers, recessive grid, per-point hover/focus tooltip on a wide hit column.
 */
export function LineChart({ data, label, format, height = 160, max, className, empty }: ChartProps) {
  const peak = Math.max(0, ...data.map((d) => d.value))
  const top = max ?? niceMax(peak)
  if ((data.length === 0 || peak === 0) && empty) return <div className={cx('grid place-items-center text-sm text-mist-400', className)} style={{ height: height + 28 }}>{empty}</div>
  const n = data.length
  const x = (i: number) => (n <= 1 ? 50 : 4 + (i / (n - 1)) * 92)
  const y = (v: number) => 100 - (Math.min(v, top) / top) * 100
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')
  return (
    <figure className={cx('pl-12', className)} aria-label={label} role="img">
      <div className="relative border-b-2 border-ink" style={{ height }}>
        <Grid top={top} format={format} height={height} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <polyline points={pts} fill="none" stroke="var(--color-exp-400)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="absolute inset-0">
          {data.map((d, i) => (
            <Tooltip key={i} content={d.tip ?? `${d.label}: ${format(d.value)}`}>
              <span
                tabIndex={0}
                className="group absolute inset-y-0 -translate-x-1/2 outline-offset-2"
                style={{ left: `${x(i)}%`, width: `${Math.max(4, 92 / Math.max(1, n))}%` }}
              >
                <span
                  className={cx('absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 bg-exp-400 shadow-[0_0_0_2px_var(--color-dusk-800)] group-hover:size-3.5 group-hover:bg-mist-50', d.highlight && 'bg-mist-50')}
                  style={{ bottom: `${100 - y(d.value)}%` }}
                />
              </span>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="relative mt-1.5 h-4" aria-hidden>
        {data.map((d, i) =>
          i === 0 || i === n - 1 || n <= 8 ? (
            <span key={i} className="absolute -translate-x-1/2 text-xs whitespace-nowrap text-mist-400" style={{ left: `${x(i)}%` }}>
              {d.label}
            </span>
          ) : null,
        )}
      </div>
    </figure>
  )
}
