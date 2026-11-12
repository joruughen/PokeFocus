import { useMemo, type ReactNode } from 'react'
import { parseRich, type RichColor, type RichNode } from '../../game/richText'
import { cx } from '../lib/cx'

/** Full class names (Tailwind reads them statically); the colours are theme tokens (`--color-rich-*`). */
export const RICH_TEXT_CLASS: Record<RichColor, string> = {
  red: 'text-rich-red',
  orange: 'text-rich-orange',
  yellow: 'text-rich-yellow',
  green: 'text-rich-green',
  blue: 'text-rich-blue',
  purple: 'text-rich-purple',
  pink: 'text-rich-pink',
}

function render(nodes: readonly RichNode[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.t === 'text') return n.text
    if (n.t === 'bold') return <strong key={i}>{render(n.children)}</strong>
    if (n.t === 'italic') return <em key={i}>{render(n.children)}</em>
    return (
      <span key={i} className={RICH_TEXT_CLASS[n.color]}>
        {render(n.children)}
      </span>
    )
  })
}

/**
 * A description in the event mini-format (`src/game/richText.ts`): bold, italic and the fixed colours.
 * Rendered as React elements only (text nodes are escaped by React), never as HTML. Line breaks are kept.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const tree = useMemo(() => parseRich(text), [text])
  return <p className={cx('break-words whitespace-pre-line', className)}>{render(tree)}</p>
}
