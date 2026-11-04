import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'

export type MascotPose = 'idle' | 'point' | 'cheer' | 'think' | 'sleep'

const failed = new Set<string>()

export interface MascotProps {
  pose?: MascotPose
  /** Square size in px: the art is a 48px grid, so only whole multiples. */
  size?: 48 | 96 | 144
  className?: string
  /** Decorative by default (the bubble text carries the meaning). */
  label?: string
}

/**
 * The studious mascot. Renders `/art/mascot-{pose}.svg` (made by the art
 * pipeline); if the file is missing it draws a small pixel placeholder so the
 * UI never shows a broken image.
 */
export function Mascot({ pose = 'idle', size = 96, className, label }: MascotProps) {
  const src = `/art/mascot-${pose}.svg`
  const [, force] = useState(0)
  if (failed.has(src)) return <MascotPlaceholder pose={pose} size={size} className={className} label={label} />
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={cx('pixelated select-none', className)}
      onError={() => {
        failed.add(src)
        force((n) => n + 1)
      }}
    />
  )
}

// 16×16 placeholder: k ink, y yellow, w lens, r cheek.
const FACE = [
  '.k............k.',
  '.kk..........kk.',
  '.kyk........kyk.',
  '.kyyk......kyyk.',
  '..kyyk....kyyk..',
  '..kyyykkkkyyyk..',
  '..kyyyyyyyyyyk..',
  '.kyyyyyyyyyyyyk.',
  '.kykkkkyykkkkyk.',
  '.kykwwkkkkwwkyk.',
  '.kykkkkyykkkkyk.',
  '.krryyyyyyyyrrk.',
  '.krryyykkyyyrrk.',
  '..kyyyyyyyyyyk..',
  '...kkyyyyyykk...',
  '.....kkkkkk.....',
]
const FILL: Record<string, string> = {
  k: 'var(--color-ink)',
  y: 'var(--color-volt-400)',
  w: 'var(--color-mist-50)',
  r: 'var(--color-cheek-400)',
}

function MascotPlaceholder({ pose, size, className, label }: Required<Pick<MascotProps, 'pose' | 'size'>> & Pick<MascotProps, 'className' | 'label'>) {
  const { t } = useTranslation()
  const rects: { x: number; y: number; c: string }[] = []
  FACE.forEach((row, y) => [...row].forEach((ch, x) => FILL[ch] && rects.push({ x, y, c: FILL[ch] })))
  return (
    <svg
      viewBox="-2 -2 20 20"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cx('select-none', pose === 'sleep' && 'opacity-80', className)}
    >
      <title>{label ?? t('mascot.name')}</title>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={1} height={1} fill={r.c} />
      ))}
      {pose === 'sleep' && <text x="14" y="1" fontSize="5" fill="var(--color-mist-100)" fontFamily="var(--font-display)">z</text>}
      {pose === 'cheer' && <rect x="16" y="2" width="1" height="4" fill="var(--color-volt-300)" />}
      {pose === 'think' && <rect x="15" y="0" width="2" height="2" fill="var(--color-mist-100)" />}
    </svg>
  )
}
