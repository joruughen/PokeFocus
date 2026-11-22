/**
 * Pokémon Showdown's trainer-sprite index (https://play.pokemonshowdown.com/sprites/trainers/): parsing it and
 * building `src/game/trainerCatalog.json` from it. Used by scripts/download-trainers.ts.
 */

export const TRAINERS_BASE = 'https://play.pokemonshowdown.com/sprites/trainers/'

export interface IndexedTrainer {
  slug: string
  /** Sprite author, as credited in the index (empty = uncredited: the stock Showdown sprites). */
  credit: string
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** Free text from the web ends up in a Markdown file: keep letters, digits and a few separators only. */
function cleanCredit(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/[^\p{L}\p{N} ._&,'-]/gu, '')
    .trim()
    .slice(0, 40)
}

/** Slugs (and credits) of the `<figure id="slug.png">` entries of the index page, sorted by slug. */
export function parseIndex(html: string): IndexedTrainer[] {
  const out = new Map<string, IndexedTrainer>()
  const re = /<figure id="([^"]+)\.png">[\s\S]*?<figcaption>[\s\S]*?<\/a>(?:<br \/>by ([^<]*))?<\/figcaption>/g
  for (const m of html.matchAll(re)) {
    const slug = m[1]!
    if (!SLUG_RE.test(slug)) continue
    out.set(slug, { slug, credit: cleanCredit(m[2] ?? '') })
  }
  return [...out.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

/** What `src/game/trainerCatalog.json` holds: the uncredited sprites, and the credited ones by author. */
export interface TrainerCatalogData {
  /** Uncredited (the stock Showdown sprites), sorted. Includes the older-game variants (`-gen3`…). */
  classic: string[]
  /** Fan art: author → slugs, both sorted. */
  fan: Record<string, string[]>
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function buildCatalog(index: IndexedTrainer[]): TrainerCatalogData {
  const classic = index.filter((t) => !t.credit).map((t) => t.slug).sort(cmp)
  const byAuthor = new Map<string, string[]>()
  for (const t of index) if (t.credit) byAuthor.set(t.credit, [...(byAuthor.get(t.credit) ?? []), t.slug])
  const fan: Record<string, string[]> = {}
  // Biggest author first, then by name: stable and readable in a diff.
  for (const [author, slugs] of [...byAuthor].sort((a, b) => b[1].length - a[1].length || cmp(a[0], b[0]))) fan[author] = slugs.sort(cmp)
  return { classic, fan }
}

export function catalogSlugs(c: TrainerCatalogData): string[] {
  return [...c.classic, ...Object.values(c.fan).flat()]
}
