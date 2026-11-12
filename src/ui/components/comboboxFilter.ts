/**
 * Search of the `Combobox` (pure). Lower case without accents; the text a
 * person types is matched against the label, the value (slug), extra search
 * terms and an optional number (the Pokédex number). Better matches come first:
 * exact, starts with, a word that starts with it, contains. Ties keep the order
 * the options came in.
 */

/** What the filter reads of an option (the component's options extend it). */
export interface Searchable {
  value: string
  label: string
  /** Other names or terms that find the option (the other language, a category). */
  keywords?: readonly string[]
  /** A number (Pokédex id): a digits-only query matches it exactly or by prefix, never "contains". */
  code?: string | number
}

/** Lower case, no accents or diacritics, one space between words, no edge spaces. */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim()
}

/** Tiers, best first. */
const EXACT = 0
const PREFIX = 1
const TERM_PREFIX = 2
const WORD = 3
const CONTAINS = 4
const TERM_CONTAINS = 5
const NONE = 99

function wordStarts(text: string, q: string): boolean {
  return text.split(/[\s\-_/.()]+/).some((w) => w.startsWith(q))
}

/** Tier of one option for an already normalized, non-empty query (`NONE` when it does not match). */
function tierOf(o: Searchable, q: string, digits: boolean): number {
  const label = normalizeSearch(o.label)
  const value = normalizeSearch(o.value)
  const terms = (o.keywords ?? []).map(normalizeSearch)
  if (o.code !== undefined) {
    const code = String(o.code).replace(/^0+(?=\d)/, '')
    if (digits) {
      const n = q.replace(/^#/, '').replace(/^0+(?=\d)/, '')
      if (code === n) return EXACT
      if (n !== '' && code.startsWith(n)) return TERM_PREFIX
    }
  }
  if (label === q || value === q || terms.includes(q)) return EXACT
  if (label.startsWith(q)) return PREFIX
  if (value.startsWith(q) || terms.some((k) => k.startsWith(q))) return TERM_PREFIX
  if (wordStarts(label, q)) return WORD
  if (label.includes(q)) return CONTAINS
  if (value.includes(q) || terms.some((k) => k.includes(q))) return TERM_CONTAINS
  return NONE
}

/**
 * The options that match `query`, best first. An empty query keeps every option
 * in its order. Several words must all match (in any order): the ranking is that
 * of the whole text when it matches as typed, else of the weakest word.
 */
export function filterOptions<T extends Searchable>(options: readonly T[], query: string): T[] {
  const q = normalizeSearch(query)
  if (q === '') return [...options]
  const digits = /^#?\d+$/.test(q)
  const words = q.split(' ')
  const ranked: { o: T; tier: number; i: number }[] = []
  options.forEach((o, i) => {
    let tier = tierOf(o, q, digits)
    if (tier === NONE && words.length > 1) {
      const tiers = words.map((w) => tierOf(o, w, false))
      if (tiers.every((x) => x !== NONE)) tier = Math.max(...tiers) + 1
    }
    if (tier !== NONE) ranked.push({ o, tier, i })
  })
  ranked.sort((a, b) => a.tier - b.tier || a.i - b.i)
  return ranked.map((r) => r.o)
}

/** The option whose value or label is exactly what was typed (ignoring case and accents), if any. */
export function exactOption<T extends Searchable>(options: readonly T[], text: string): T | undefined {
  const q = normalizeSearch(text)
  if (q === '') return undefined
  return options.find((o) => normalizeSearch(o.value) === q) ?? options.find((o) => normalizeSearch(o.label) === q)
}
