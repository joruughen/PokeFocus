import { cx } from '../lib/cx'

/** Row of pixel stars (Mastery 1–5, IV quality 0–4…). `label` is the accessible reading. */
export function Stars({ value, max, label, size = 12, className, tone = 'volt' }: { value: number; max: number; label: string; size?: 10 | 12 | 16; className?: string; tone?: 'volt' | 'ink' }) {
  return (
    <span role="img" aria-label={label} className={cx('inline-flex items-center gap-0.5', className)}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} viewBox="0 0 8 8" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
          <path
            d="M3 0h2v2h3v2H7v1h1v3H6V7H2v1H0V5h1V4H0V2h3z"
            className={i < value ? (tone === 'volt' ? 'fill-volt-400' : 'fill-volt-700') : tone === 'volt' ? 'fill-dusk-600' : 'fill-dusk-500/30'}
          />
        </svg>
      ))}
    </span>
  )
}
