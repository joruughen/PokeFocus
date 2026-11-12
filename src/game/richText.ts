/**
 * Rich text of an event description: a tiny, safe mini-format (no HTML ever).
 *
 *   **bold**   *italic*   [red]coloured[/red]   (red orange yellow green blue purple pink)
 *   \*  \[  \\   escape a marker so it shows as text
 *
 * - Markers nest (`**a *b* [red]c[/red]**`), up to `RICH_MAX_DEPTH` levels.
 * - `*` follows the Markdown flanking rule: it opens before a non-space and closes after a non-space, so
 *   `2 * 3 * 4` stays literal. Underscores, links, lists and any other syntax are NOT special.
 * - Anything that does not parse (unknown `[tag]`, a closer without an opener, an opener never closed,
 *   nesting too deep) is shown as the literal text that was typed.
 * - Length: the limit of a description (`DATA_LIMITS.longText`, 400) counts the VISIBLE characters
 *   (`richPlainLength`: markers and escapes do not count); the stored string may be at most
 *   `RICH_RAW_FACTOR` times that, so markup cannot be used to store a lot of data.
 *
 * Pure and dependency-free: the server validator, the admin editor and the player UI share it.
 * The UI renders the tree as React elements (never as HTML).
 */

export const RICH_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const
export type RichColor = (typeof RICH_COLORS)[number]

/** Deepest nesting of markers; a deeper opener is literal text. */
export const RICH_MAX_DEPTH = 6
/** The stored text may be this many times the visible limit (room for the markers). */
export const RICH_RAW_FACTOR = 3

export type RichNode =
  | { t: 'text'; text: string }
  | { t: 'bold'; children: RichNode[] }
  | { t: 'italic'; children: RichNode[] }
  | { t: 'color'; color: RichColor; children: RichNode[] }

type FrameKind = 'root' | 'bold' | 'italic' | RichColor

interface Frame {
  kind: FrameKind
  /** What was typed to open it (shown as is if it is never closed). */
  open: string
  children: RichNode[]
}

const ESCAPABLE = new Set(['*', '[', '\\'])
const COLOR_TAG = new RegExp(`^\\[(/?)(${RICH_COLORS.join('|')})\\]`)

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch)

function push(into: RichNode[], text: string): void {
  if (text === '') return
  const last = into[into.length - 1]
  if (last?.t === 'text') last.text += text
  else into.push({ t: 'text', text })
}

function toNode(f: Frame): RichNode {
  if (f.kind === 'bold') return { t: 'bold', children: f.children }
  if (f.kind === 'italic') return { t: 'italic', children: f.children }
  if (f.kind === 'root') return { t: 'text', text: '' }
  return { t: 'color', color: f.kind, children: f.children }
}

/** Parse the mini-format. Never throws; the text nodes hold exactly what is visible. */
export function parseRich(src: string): RichNode[] {
  const stack: Frame[] = [{ kind: 'root', open: '', children: [] }]
  const top = (): Frame => stack[stack.length - 1]!
  const sink = (): RichNode[] => top().children

  /** Frames above index `keep` were never closed: their opener becomes literal text and their content stays. */
  const spill = (keep: number) => {
    while (stack.length - 1 > keep) {
      const f = stack.pop()!
      const into = sink()
      push(into, f.open)
      for (const c of f.children) {
        if (c.t === 'text') push(into, c.text)
        else into.push(c)
      }
    }
  }
  /** Close the frame at index `at` (anything left open above it turns literal). */
  const closeAt = (at: number) => {
    spill(at)
    const f = stack.pop()!
    sink().push(toNode(f))
  }
  const open = (kind: FrameKind, literal: string): boolean => {
    if (stack.length > RICH_MAX_DEPTH) return false
    stack.push({ kind, open: literal, children: [] })
    return true
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.has(src[i + 1]!)) {
      push(sink(), src[i + 1]!)
      i += 2
      continue
    }
    if (ch === '[') {
      const m = COLOR_TAG.exec(src.slice(i, i + 12))
      if (m) {
        const color = m[2] as RichColor
        if (m[1] === '/') {
          const at = stack.map((f) => f.kind).lastIndexOf(color)
          if (at > 0) closeAt(at)
          else push(sink(), m[0])
        } else if (!open(color, m[0])) push(sink(), m[0])
        i += m[0].length
        continue
      }
    }
    if (ch === '*') {
      let n = 0
      while (src[i + n] === '*') n++
      const canClose = !isSpace(src[i - 1])
      const canOpen = !isSpace(src[i + n])
      let left = n
      if (canClose) {
        // `***` closes `**` + `*`, the innermost first.
        for (;;) {
          const k = top().kind
          if (k === 'italic' && left >= 1) {
            closeAt(stack.length - 1)
            left -= 1
          } else if (k === 'bold' && left >= 2) {
            closeAt(stack.length - 1)
            left -= 2
          } else break
        }
      }
      if (left === n && canOpen) {
        // Only a run that closed nothing opens (`**a** **b**`, `***a***`).
        while (left >= 2 && open('bold', '**')) left -= 2
        if (left >= 1 && open('italic', '*')) left -= 1
      }
      push(sink(), '*'.repeat(left))
      i += n
      continue
    }
    let j = i + 1
    while (j < src.length && src[j] !== '*' && src[j] !== '[' && src[j] !== '\\') j++
    push(sink(), src.slice(i, j))
    i = j
  }
  spill(0)
  return stack[0]!.children
}

function plainOf(nodes: readonly RichNode[]): string {
  let out = ''
  for (const n of nodes) out += n.t === 'text' ? n.text : plainOf(n.children)
  return out
}

/** The text a player reads, without any marker (what the banner and short texts show). */
export function richPlainText(src: string): string {
  return plainOf(parseRich(src))
}

/** Visible characters (what the 400-character limit counts). */
export function richPlainLength(src: string): number {
  return richPlainText(src).length
}

/** Escape a string so that the mini-format shows it literally. */
export function escapeRich(s: string): string {
  return s.replace(/[\\*[]/g, (c) => `\\${c}`)
}

/** The markers that wrap a slice of text for a format (the editor's toolbar). */
export function richMarkers(kind: 'bold' | 'italic' | RichColor): { open: string; close: string } {
  if (kind === 'bold') return { open: '**', close: '**' }
  if (kind === 'italic') return { open: '*', close: '*' }
  return { open: `[${kind}]`, close: `[/${kind}]` }
}

/**
 * The editor's toolbar: wrap the selection `[start, end)` of `value` in a format. Spaces at the edges of the
 * selection stay outside (`**a **` would not parse). Returns the new text and the selection to restore
 * (the wrapped text, or the empty spot between the markers when nothing was selected).
 */
export function wrapSelection(value: string, start: number, end: number, kind: 'bold' | 'italic' | RichColor): { value: string; start: number; end: number } {
  let a = Math.max(0, Math.min(start, end, value.length))
  let b = Math.min(value.length, Math.max(start, end))
  while (a < b && /\s/.test(value[a]!)) a++
  while (b > a && /\s/.test(value[b - 1]!)) b--
  const { open, close } = richMarkers(kind)
  return { value: value.slice(0, a) + open + value.slice(a, b) + close + value.slice(b), start: a + open.length, end: b + open.length }
}

/** A line that starts with "- " or "• " (after optional spaces) is a bullet point. */
const BULLET = /^\s*(?:-|•)\s+/

export type RichBlock = { t: 'para'; text: string } | { t: 'list'; items: string[] }

/**
 * Split a description into blocks: runs of bullet lines become a list, everything else stays as
 * paragraph text (line breaks kept). Inline formats are parsed per block, so a format does not
 * cross from a bullet into the next line.
 */
export function richBlocks(src: string): RichBlock[] {
  const out: RichBlock[] = []
  for (const line of src.split('\n')) {
    const m = BULLET.exec(line)
    const last = out[out.length - 1]
    if (m) {
      const item = line.slice(m[0].length)
      if (last?.t === 'list') last.items.push(item)
      else out.push({ t: 'list', items: [item] })
    } else if (last?.t === 'para') last.text += `\n${line}`
    else out.push({ t: 'para', text: line })
  }
  return out
}

/** Plain text of a description with bullets shown as "• " (banner and short texts). */
export function richPlainWithBullets(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const m = BULLET.exec(line)
      return m ? `• ${richPlainText(line.slice(m[0].length))}` : richPlainText(line)
    })
    .join('\n')
}

/**
 * The editor's bullet button: add "- " to every line touched by the selection, or remove it when
 * all of them already are bullets. Returns the new text and a selection covering those lines.
 */
export function toggleBullets(value: string, start: number, end: number): { value: string; start: number; end: number } {
  const a = Math.max(0, Math.min(start, end, value.length))
  const b = Math.min(value.length, Math.max(start, end))
  const from = value.lastIndexOf('\n', a - 1) + 1
  const nl = value.indexOf('\n', b > a && value[b - 1] === '\n' ? b - 1 : b)
  const to = nl === -1 ? value.length : nl
  const lines = value.slice(from, to).split('\n')
  const all = lines.every((l) => BULLET.test(l) || l.trim() === '')
  const next = lines.map((l) => (all ? l.replace(BULLET, '') : l.trim() === '' || BULLET.test(l) ? l : `- ${l}`)).join('\n')
  return { value: value.slice(0, from) + next + value.slice(to), start: from, end: from + next.length }
}
