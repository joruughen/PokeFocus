import type { ThrowBall } from '../../engine'
import { cx } from '../lib/cx'
import { useNames } from '../lib/names'
import { ArtIcon } from './ArtSvg'
import { Sprite } from './Sprite'
import { useTranslation } from 'react-i18next'

// The Study Ball has no official sprite: notebook-blue cap with a highlighter stripe.
const STUDY = [
  '....kkkk....',
  '..kkbbbbkk..',
  '.kbbbbbbbbk.',
  '.kyyyyyyyyk.',
  'kbbbbbbbbbbk',
  'kkkkkwwkkkkk',
  'kwwwkwwkwwwk',
  'kwwwwkkwwwwk',
  '.kwwwwwwwwk.',
  '.kwwwwwwwwk.',
  '..kkwwwwkk..',
  '....kkkk....',
]
const FILL: Record<string, string> = {
  k: 'var(--color-ink)',
  b: 'var(--color-exp-600)',
  y: 'var(--color-volt-400)',
  w: 'var(--color-mist-50)',
}

export function StudyBallIcon({ size = 24, className, label }: { size?: 12 | 24 | 48; className?: string; label?: string }) {
  return <ArtIcon name="icon-study-ball" size={size} label={label} className={cx('text-exp-400', className)} fallback={<DrawnStudyBall size={size} className={className} label={label} />} />
}

function DrawnStudyBall({ size, className, label }: { size: number; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {STUDY.flatMap((row, y) => [...row].map((ch, x) => (FILL[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={FILL[ch]} /> : null)))}
    </svg>
  )
}

/** Any ball by slug: item sprite for Poké/Great/Ultra, drawn icon for the Study Ball. Item sprites are 30px, so size 30/60 stays crisp. */
export function BallIcon({ ball, size = 30, className }: { ball: ThrowBall; size?: 30 | 60 | 24 | 48; className?: string }) {
  const names = useNames()
  const { t } = useTranslation()
  return (
    <span className={cx('inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      {ball === 'study-ball' ? (
        <StudyBallIcon size={size >= 48 ? 48 : 24} label={t('balls.study')} />
      ) : (
        <Sprite kind="item" slug={ball} scale={size >= 48 ? 2 : 1} alt={names.item(ball)} />
      )}
    </span>
  )
}
