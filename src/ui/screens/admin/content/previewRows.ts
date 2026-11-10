import type { AdminSpawnPreview } from '../../../../game/protocol'

export interface PreviewRow {
  slug: string
  /** Probability with the live content (0 = cannot appear). */
  live: number
  /** Probability with the draft (0 = cannot appear). */
  draft: number
  /** draft − live, in probability points. */
  delta: number
}

/** Merge the live and the draft previews by species, most likely first (by the larger of the two). */
export function previewRows(live: AdminSpawnPreview | null, draft: AdminSpawnPreview | null): PreviewRow[] {
  const rows = new Map<string, PreviewRow>()
  const row = (slug: string): PreviewRow => {
    let r = rows.get(slug)
    if (!r) rows.set(slug, (r = { slug, live: 0, draft: 0, delta: 0 }))
    return r
  }
  for (const s of live?.species ?? []) row(s.slug).live = s.probability
  for (const s of draft?.species ?? []) row(s.slug).draft = s.probability
  for (const r of rows.values()) r.delta = r.draft - r.live
  return [...rows.values()].sort((a, b) => Math.max(b.live, b.draft) - Math.max(a.live, a.draft) || (a.slug < b.slug ? -1 : 1))
}

/** Species that appear only in the draft / only in the live content. */
export function appearDisappear(rows: PreviewRow[]): { appear: number; vanish: number } {
  return { appear: rows.filter((r) => r.live === 0 && r.draft > 0).length, vanish: rows.filter((r) => r.live > 0 && r.draft === 0).length }
}
