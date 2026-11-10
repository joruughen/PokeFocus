import type { AdminContentVersionSummary } from '../../../../game/protocol'

/** What a row of the version list is, for its badge and its actions. */
export type VersionKind = 'active' | 'scheduled' | 'published' | 'draft' | 'archived'

export function versionKind(v: Pick<AdminContentVersionSummary, 'status' | 'active' | 'scheduled'>): VersionKind {
  if (v.status === 'draft') return 'draft'
  if (v.status === 'archived') return 'archived'
  if (v.active) return 'active'
  return v.scheduled ? 'scheduled' : 'published'
}

/** Staff capabilities on the content tab: support reads, admin edits (the server enforces both). */
export interface ContentPermissions {
  read: boolean
  edit: boolean
}

export function contentPermissions(role: string | undefined): ContentPermissions {
  return { read: role === 'support' || role === 'admin', edit: role === 'admin' }
}

/** A version can be republished when it already took effect and is not the one in force. */
export function canRollback(v: Pick<AdminContentVersionSummary, 'status' | 'active' | 'scheduled'>): boolean {
  return v.status !== 'draft' && !v.scheduled && !v.active
}

/** «#12 · Title» or just «#12». */
export function versionName(v: Pick<AdminContentVersionSummary, 'id' | 'title'>): string {
  return v.title ? `#${v.id} · ${v.title}` : `#${v.id}`
}

/** First 8 characters of a content hash (`base` stays as is). */
export const shortHash = (h: string | null): string => (h === null ? '—' : h.length > 10 ? h.slice(0, 8) : h)
