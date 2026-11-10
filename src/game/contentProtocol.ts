/**
 * Live content over HTTP (docs/admin-plan.md §1 "Cliente"): what the client
 * expects from GET /api/content and GET /api/content/:hash. Shared by the
 * client store (src/ui/store/content.ts) and the server route.
 *
 * - `GET /api/content` (public): the content in force now. `ETag: hash`,
 *   `Cache-Control: no-cache` (304 when the ETag matches).
 * - `GET /api/content/:hash`: the same shape for one pinned hash; immutable
 *   (`Cache-Control: public, max-age=31536000, immutable`), 404 when unknown.
 * - A 404 on `GET /api/content` means "no content server": the client keeps
 *   the shipped (base) content.
 * - SSE `{ type: 'content', hash }` tells clients the current hash changed.
 */
import type { ContentItem, ContentPatch, EventOverlay } from '../engine/content'

export interface ContentResponse {
  /** Identifies this exact content (patch + events). */
  hash: string
  /** sha256 of the shipped data this patch applies to (src/data/game/meta.json of the server build). */
  baseHash: string
  patch: ContentPatch
  /** Events active when the content was resolved (public fields only). */
  events: EventOverlay[]
  /** Items of every published event, past ones included (so the bag keeps their names). */
  eventItems: Record<string, ContentItem>
}

export const CONTENT_PATH = '/content'
