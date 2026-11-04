/** Small numeric and markdown helpers for the balance simulator. */

export function sum(xs: readonly number[]): number {
  let s = 0
  for (const x of xs) s += x
  return s
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length
}

/** Linear-interpolated quantile of a list (any order). */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = s[lo] as number
  const b = s[hi] as number
  return a + (b - a) * (pos - lo)
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5)
}

/** Round to a number of decimals. */
export function round(x: number, d = 0): number {
  const m = Math.pow(10, d)
  return Math.round(x * m) / m
}

/** Round to the nearest multiple of `step`. */
export function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step
}

/** Thousands separator "12,345". */
export function n0(x: number): string {
  return Math.round(x).toLocaleString('en-US')
}

export function n1(x: number): string {
  return (Math.round(x * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function n2(x: number): string {
  return x.toFixed(2)
}

export function pct(x: number, d = 0): string {
  return `${(x * 100).toFixed(d)}%`
}

/** Markdown table. `align`: 'l' | 'r' per column (default: first column left, others right). */
export function mdTable(headers: string[], rows: (string | number)[][], align?: ('l' | 'r')[]): string {
  const al = align ?? headers.map((_, i) => (i === 0 ? 'l' : 'r'))
  const head = `| ${headers.join(' | ')} |`
  const sep = `|${al.map((a) => (a === 'l' ? '---' : '---:')).join('|')}|`
  const body = rows.map((r) => `| ${r.map((c) => String(c)).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

/** Deterministic 32-bit string hash (for seeds). */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Throttled progress line on stderr (overwrites itself). */
export function progress(label: string, done: number, total: number, state: { last: number }): void {
  const now = Date.now()
  if (done < total && now - state.last < 700) return
  state.last = now
  process.stderr.write(`\r  ${label}: ${done}/${total}`.padEnd(60))
  if (done >= total) process.stderr.write('\n')
}
