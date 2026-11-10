import type { AdminSpawnPreview } from '../../../../game/protocol'

export interface PreviewRow {
  slug: string
  /** Probability without the event (the content in force), 0 when it does not appear. */
  before: number
  /** Probability with the event on top. */
  after: number
  /** after − before. */
  delta: number
  /** The event features this species. */
  featured: boolean
}

/** Join the two spawn tables (without / with the event) by species, the biggest shares first. */
export function mergePreviews(without: Pick<AdminSpawnPreview, 'species'>, withEvent: Pick<AdminSpawnPreview, 'species'>, featured: readonly string[] = [], limit = 16): PreviewRow[] {
  const before = new Map(without.species.map((s) => [s.slug, s.probability]))
  const after = new Map(withEvent.species.map((s) => [s.slug, s.probability]))
  const slugs = new Set([...before.keys(), ...after.keys()])
  const rows = [...slugs].map((slug) => {
    const b = before.get(slug) ?? 0
    const a = after.get(slug) ?? 0
    return { slug, before: b, after: a, delta: a - b, featured: featured.includes(slug) }
  })
  // The featured ones always show (that is what the admin is checking), then the rest by share.
  return rows
    .sort((x, y) => Number(y.featured) - Number(x.featured) || Math.max(y.before, y.after) - Math.max(x.before, x.after))
    .slice(0, Math.max(limit, featured.length))
}
