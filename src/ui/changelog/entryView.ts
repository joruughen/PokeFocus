import type { ChangeKind } from './entries'

/** Chip colours of the New / Improved / Fixed tags (news page and the "What's new" dialog). */
export const KIND_STYLE: Record<ChangeKind, string> = {
  new: 'bg-volt-400 text-ink',
  improved: 'bg-exp-400 text-ink',
  fixed: 'bg-leaf-400 text-ink',
}

/** "6 de noviembre de 2026": entries carry a calendar date, so format it in UTC to avoid shifting a day. */
export function fmtEntryDate(iso: string, lng: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(lng, { dateStyle: 'long', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d))
}
