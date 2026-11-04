import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../lib/cx'

/**
 * Inlines one of the generated SVGs in `/public/art/` so it can be themed:
 * icons use `currentColor`, the logo reads `--logo-primary/accent/paper`.
 * Files are our own build output (scripts/art), fetched once and cached.
 * While loading, or if the file is missing, `fallback` is shown.
 */
const cache = new Map<string, Promise<string | null>>()
const ready = new Map<string, string | null>()

function load(name: string): Promise<string | null> {
  let p = cache.get(name)
  if (!p) {
    p = fetch(`/art/${name}.svg`)
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('svg') ? r.text() : null))
      .then((txt) => {
        // Make it scale with its box.
        const svg = txt?.replace(/<svg([^>]*?)\swidth="\d+"\sheight="\d+"/, '<svg$1 width="100%" height="100%"') ?? null
        ready.set(name, svg)
        return svg
      })
      .catch(() => {
        ready.set(name, null)
        return null
      })
    cache.set(name, p)
  }
  return p
}

export type ArtIconName =
  | 'stat-energy'
  | 'stat-pace'
  | 'stat-output'
  | 'stat-catch'
  | 'stat-technique'
  | 'stat-grit'
  | 'icon-study-ball'
  | 'icon-dust'
  | 'icon-candy'
  | 'icon-leader'
  | 'icon-timer'
  | 'icon-bond'
  | 'icon-shiny'
  | 'icon-sleep'
  | 'icon-paralysis'

export interface ArtSvgProps {
  name: ArtIconName | 'logo' | 'logo-mark' | 'logo-wordmark'
  /** CSS box; keep integer multiples of the art grid (icons: 12px, logo: 16px high). */
  width: number
  height: number
  label?: string
  className?: string
  style?: CSSProperties
  fallback?: ReactNode
}

export function ArtSvg({ name, width, height, label, className, style, fallback = null }: ArtSvgProps) {
  const [svg, setSvg] = useState<string | null | undefined>(ready.get(name))
  useEffect(() => {
    let live = true
    if (!ready.has(name)) void load(name).then((s) => live && setSvg(s))
    else setSvg(ready.get(name))
    return () => {
      live = false
    }
  }, [name])
  if (!svg) return <>{fallback}</>
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('inline-block shrink-0 [&>svg]:block', className)}
      style={{ width, height, ...style }}
      dangerouslySetInnerHTML={{ __html: svg.replace(/<title>.*?<\/title>/, '') }}
    />
  )
}

/** A 12×12 art icon at an integer scale (size 12, 24, 36…). Tint with `text-*`. */
export function ArtIcon({ name, size = 24, label, className, fallback }: { name: ArtIconName; size?: 12 | 24 | 36 | 48; label?: string; className?: string; fallback?: ReactNode }) {
  return <ArtSvg name={name} width={size} height={size} label={label} className={className} fallback={fallback ?? <span className="inline-block shrink-0" style={{ width: size, height: size }} />} />
}
