import { useMemo, type ReactNode } from 'react'
import { parseRich, richBlocks, type RichColor, type RichNode } from '../../game/richText'
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
 * A description in the event mini-format (`src/game/richText.ts`): bold, italic, the fixed colours and
 * bullet lines ("- "). Rendered as React elements only (text nodes are escaped by React), never as HTML.
 * Line breaks are kept.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => richBlocks(text).map((b) => (b.t === 'para' ? { t: b.t, nodes: parseRich(b.text) } : { t: b.t, items: b.items.map(parseRich) })), [text])
  if (blocks.length === 1 && blocks[0]!.t === 'para') return <p className={cx('break-words whitespace-pre-line', className)}>{render(blocks[0]!.nodes!)}</p>
  return (
    <div className={cx('break-words', className)}>
      {blocks.map((b, i) =>
        b.t === 'para' ? (
          <p key={i} className="whitespace-pre-line">
            {render(b.nodes!)}
          </p>
        ) : (
          <ul key={i} className="my-1 list-disc space-y-0.5 pl-5 marker:text-volt-300">
            {b.items!.map((item, j) => (
              <li key={j}>{render(item)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}
