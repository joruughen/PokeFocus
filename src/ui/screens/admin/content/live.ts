/**
 * Live validation while typing: the same `validateContentPatch` the server runs, without the engine smoke test
 * (that one is the server's «Validate» button). The validator pulls zod and the engine, so it is imported lazily.
 */
import type { ContentPatch } from '../../../../engine/content'
import type { AdminContentValidation, ContentIssue } from '../../../../game/protocol'

export interface IssueSet {
  errors: ContentIssue[]
  warnings: ContentIssue[]
  requiresConfirm: boolean
}

export const NO_ISSUES: IssueSet = { errors: [], warnings: [], requiresConfirm: false }

let loading: Promise<typeof import('../../../../game/content')> | null = null

/** Validate a patch with the cheap checks (shape, references, rules, coverage, ×3 / ×5 guard). */
export async function liveValidate(patch: ContentPatch): Promise<IssueSet> {
  loading ??= import('../../../../game/content')
  const { validateContentPatch } = await loading
  const r = validateContentPatch(patch, { smoke: false })
  return { errors: r.errors, warnings: r.warnings, requiresConfirm: r.requiresConfirm }
}

/** The server's stored validation as an issue set. */
export function issuesOf(v: AdminContentValidation | null | undefined): IssueSet {
  return v ? { errors: v.errors, warnings: v.warnings, requiresConfirm: v.requiresConfirm } : NO_ISSUES
}

/** Issues grouped by the exact path they point at (for the per-field messages). */
export function issuesByPath(set: IssueSet): Map<string, { errors: ContentIssue[]; warnings: ContentIssue[] }> {
  const out = new Map<string, { errors: ContentIssue[]; warnings: ContentIssue[] }>()
  const slot = (p: string) => {
    let s = out.get(p)
    if (!s) out.set(p, (s = { errors: [], warnings: [] }))
    return s
  }
  for (const e of set.errors) slot(e.path).errors.push(e)
  for (const w of set.warnings) slot(w.path).warnings.push(w)
  return out
}
