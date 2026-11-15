/**
 * Pure and async logic of the JSON import / export of the admin screen (docs/admin-json.md): which draft an
 * imported event becomes, what to do when its slug already exists, how the content draft is created, and the
 * export texts. Free of React so it can be tested alone. The format itself (schema, validation) lives in
 * src/game/content/adminJson.ts and is loaded lazily: it carries zod and the engine.
 */
import type { ContentItem, ContentPatch } from '../../../../engine/content'
import type { AdminContentVersionResponse, AdminEvent } from '../../../../game/protocol'
import type { ContentImportData, EventImportData, TiedContentData } from '../../../../game/content'
import type { CreateDraftInput, SaveDraftInput } from '../content/api'
import { draftFromBody, draftFromEvent, draftToBody, type DraftMeta, type DraftProblem, type EventDraft } from '../events/draft'

/** The format module, loaded on demand (it pulls zod and the engine into its own chunk). */
export const loadAdminJson = () => import('../../../../game/content')

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const isSlug = (s: string): boolean => s.length >= 1 && s.length <= 64 && SLUG.test(s)

// ---------------------------------------------------------------------------
// Event: slug clashes and the draft an import becomes
// ---------------------------------------------------------------------------

export type SlugState = { kind: 'free' } | { kind: 'draft'; event: AdminEvent } | { kind: 'taken'; event: AdminEvent }

/** Slugs are unique for ever, across every status: only a DRAFT can be updated by an import. */
export function slugState(slug: string, events: readonly AdminEvent[]): SlugState {
  const hit = events.find((e) => e.slug === slug)
  if (!hit) return { kind: 'free' }
  return hit.status === 'draft' ? { kind: 'draft', event: hit } : { kind: 'taken', event: hit }
}

/** `slug-2`, `slug-3`… the first one nobody uses (kept within 64 characters). */
export function freeSlug(slug: string, events: readonly AdminEvent[]): string {
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`
    const candidate = `${slug.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (slugState(candidate, events).kind === 'free') return candidate
  }
  return slug
}

/** Items of the published and archived events: the server counts them as known item slugs for every other event. */
export function knownEventItems(events: readonly AdminEvent[], exceptId?: string | null): Record<string, ContentItem> {
  const out: Record<string, ContentItem> = {}
  for (const e of events) if (e.status !== 'draft' && e.id !== exceptId) Object.assign(out, e.overlay.items ?? {})
  return out
}

/**
 * The draft an imported event becomes. With a `target` (an existing draft) it keeps its identity and image and
 * replaces every field; without one it is a new, unsaved draft. `slug` overrides the JSON's (another slug).
 */
export function importedDraft(data: EventImportData, opts: { target?: AdminEvent | null; slug?: string } = {}): EventDraft {
  const meta: DraftMeta = opts.target ? pickMeta(draftFromEvent(opts.target)) : { id: null, status: 'new', revision: 1, imageId: null, image: null }
  return draftFromBody({ ...data, slug: opts.slug ?? data.slug }, meta)
}

/** The editor's current draft with every field replaced by the import (identity, image and — once published — the slug stay). */
export function filledDraft(current: EventDraft, data: EventImportData): EventDraft {
  const next = draftFromBody(data, pickMeta(current))
  return current.status === 'published' ? { ...next, slug: current.slug } : next
}

const pickMeta = (d: EventDraft): DraftMeta => ({ id: d.id, status: d.status, revision: d.revision, imageId: d.imageId, image: d.image })

/** What the editor tells the admin after an import (nothing here was published or saved). */
export interface ImportInfo {
  /** `imageNote` of the JSON: the image is never imported. */
  imageNote?: string
  /** The content draft created for the JSON's tied content. */
  tied?: { id: number; title: string; revertWhenEnds: boolean }
  /** Why that draft could not be created (translated). */
  tiedError?: string
}

// ---------------------------------------------------------------------------
// Content: the draft an import becomes
// ---------------------------------------------------------------------------

export interface ContentDraftApi {
  createDraft: (body: CreateDraftInput) => Promise<AdminContentVersionResponse>
  saveDraft: (id: number, body: SaveDraftInput) => Promise<AdminContentVersionResponse>
}

/**
 * Create a content draft for a patch: `applyOver: "live"` starts from what is in force and merges the JSON's patch
 * over it (the JSON lists only the changes); `"base"` starts from the base data and takes the patch as it is.
 * Nothing is published. Errors of the API propagate (too many drafts, forbidden…).
 */
export async function createContentDraft(
  data: Pick<ContentImportData, 'title' | 'note' | 'applyOver' | 'patch'>,
  live: ContentPatch | null,
  api: ContentDraftApi,
): Promise<AdminContentVersionResponse> {
  const { patchToApply } = await loadAdminJson()
  const created = await api.createDraft({ from: data.applyOver === 'live' ? 'active' : 'empty', title: data.title, ...(data.note && { note: data.note }) })
  return api.saveDraft(created.version.id, { patch: patchToApply(data, live) })
}

/** Create the draft of an event's tied content and say how to publish it. */
export async function createTiedDraft(content: TiedContentData, live: ContentPatch | null, api: ContentDraftApi): Promise<NonNullable<ImportInfo['tied']>> {
  const res = await createContentDraft(content, live, api)
  return { id: res.version.id, title: content.title, revertWhenEnds: content.revertWhenEnds }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Offset of the browser's zone at an instant, in minutes east of UTC (so dates are exported as the admin sees them). */
export const browserOffsetMinutes = (ms: number): number => -new Date(ms).getTimezoneOffset()

/** The event form as pretty JSON in the import format; the problems of the form when it cannot be read yet. */
export async function eventExportText(d: EventDraft, opts: { offsetMinutes?: (ms: number) => number } = {}): Promise<{ ok: true; text: string } | { ok: false; problems: DraftProblem[] }> {
  const { body, problems } = draftToBody(d)
  if (problems.length > 0) return { ok: false, problems }
  const { eventToJson } = await loadAdminJson()
  return { ok: true, text: `${JSON.stringify(eventToJson(body, { offsetMinutes: opts.offsetMinutes ?? browserOffsetMinutes }), null, 2)}\n` }
}

/** A content draft as pretty JSON in the import format (a full patch over the base). */
export async function contentExportText(c: { title: string; note?: string; patch: ContentPatch }): Promise<string> {
  const { contentToJson } = await loadAdminJson()
  const title = c.title.trim().slice(0, 80) || 'Export'
  return `${JSON.stringify(contentToJson({ title, ...(c.note?.trim() && { note: c.note.trim() }), patch: c.patch }), null, 2)}\n`
}

/** A safe file name for a download (`semana-pikachu.event.json`). */
export function exportFileName(base: string, kind: 'event' | 'content'): string {
  const slug = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || kind}.${kind}.json`
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

/** The text of an uploaded file. */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsText(file)
  })
}

/** Offer a text as a file download. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
