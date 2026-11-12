/**
 * The publishing flow, without React: the outcomes of publish / rollback (the API answers with several
 * non-error statuses the screen has to handle: sudo needed, confirmation needed, validation failed), the schedule
 * input check and the «re-enter the password, then retry» helper.
 */
import type { AdminContentVersion, ContentIssue } from '../../../../game/protocol'
import { errorCode, isApiError } from '../../../api'
import { fromLocalInput } from '../../../lib/maintenance'
import { contentApi, type PublishInput } from './api'

export type Outcome<T> =
  | { kind: 'ok'; value: T }
  /** 403 `elevation_required`: ask for the password (sudo mode, 30 min). */
  | { kind: 'elevation' }
  /** 409 `confirm_required`: warnings beyond ×3 / ×5 need an explicit tick. */
  | { kind: 'confirm'; warnings: ContentIssue[] }
  /** 422 `validation_failed`: errors block the publication. */
  | { kind: 'invalid'; errors: ContentIssue[]; warnings: ContentIssue[] }
  | { kind: 'error'; code: string; retryAfter: number | null }

const issues = (v: unknown): ContentIssue[] => (Array.isArray(v) ? (v as ContentIssue[]) : [])

/** Turn what the API threw into an outcome (anything unexpected becomes `error`). */
export function classify(e: unknown): Outcome<never> {
  if (isApiError(e)) {
    if (e.status === 403 && e.code === 'elevation_required') return { kind: 'elevation' }
    if (e.status === 409 && e.code === 'confirm_required') return { kind: 'confirm', warnings: issues(e.body?.warnings) }
    if (e.status === 422 && e.code === 'validation_failed') return { kind: 'invalid', errors: issues(e.body?.errors), warnings: issues(e.body?.warnings) }
    return { kind: 'error', code: e.code, retryAfter: e.retryAfter }
  }
  return { kind: 'error', code: errorCode(e), retryAfter: null }
}

async function attempt(run: () => Promise<{ version: AdminContentVersion }>): Promise<Outcome<AdminContentVersion>> {
  try {
    return { kind: 'ok', value: (await run()).version }
  } catch (e) {
    return classify(e)
  }
}

/** Publish a draft now (no `effectiveAt`) or schedule it. */
export function publishDraft(id: number, input: PublishInput): Promise<Outcome<AdminContentVersion>> {
  return attempt(() => contentApi.publish(id, input))
}

/** Republish an old version as a new one, effective now. */
export function rollbackTo(id: number, input: { confirm?: boolean; note?: string } = {}): Promise<Outcome<AdminContentVersion>> {
  return attempt(() => contentApi.rollback(id, input))
}

/** Cancel a scheduled version: it goes back to a draft. */
export function unscheduleVersion(id: number): Promise<Outcome<AdminContentVersion>> {
  return attempt(() => contentApi.unschedule(id))
}

/**
 * Run a sudo-protected action after re-entering the password: reauth first, then the action. A wrong password
 * (403 `wrong_password`) comes back as an `error` outcome and the action never runs.
 */
export async function reauthThen<T>(password: string, run: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    await contentApi.reauth(password)
  } catch (e) {
    return classify(e)
  }
  return run()
}

// --- Schedule ---------------------------------------------------------------

/** A scheduled publication can be at most this far ahead (server: 400 `invalid_effective_at`). */
export const MAX_SCHEDULE_MS = 60 * 86_400_000
/** Safety margin so a value that is valid now is still valid when it reaches the server. */
const MARGIN_MS = 60_000

export type SchedulePlan = { mode: 'now' } | { mode: 'later'; at: number } | { mode: 'event'; eventId: string; revert: boolean }
export type ScheduleProblem = 'invalid' | 'past' | 'tooFar'

/** Check what the admin typed (a `datetime-local` value, in their own zone) as a publication time. */
export function checkSchedule(localValue: string, now: number): { ok: true; at: number } | { ok: false; problem: ScheduleProblem } {
  const at = fromLocalInput(localValue)
  if (Number.isNaN(at)) return { ok: false, problem: 'invalid' }
  if (at <= now + MARGIN_MS) return { ok: false, problem: 'past' }
  if (at > now + MAX_SCHEDULE_MS - MARGIN_MS) return { ok: false, problem: 'tooFar' }
  return { ok: true, at }
}

/** Body of the publish request for the chosen plan. */
export function publishInput(plan: SchedulePlan, confirm: boolean, note: string): PublishInput {
  const n = note.trim()
  return {
    ...(plan.mode === 'later' && { effectiveAt: plan.at }),
    ...(plan.mode === 'event' && { linkEventId: plan.eventId, ...(plan.revert && { revertWhenEnds: true }) }),
    ...(confirm && { confirm: true }),
    ...(n && { note: n }),
  }
}

/** The events a version can be tied to: published and not over, the soonest first. */
export function linkableEvents<E extends { status: string; endsAt: number; startsAt: number }>(events: readonly E[], now: number): E[] {
  return events.filter((e) => e.status === 'published' && e.endsAt > now).sort((a, b) => a.startsAt - b.startsAt)
}

/** When a version tied to an event takes effect: its start, or right now when the event already started (mirrors the server). */
export const linkedEffectiveAt = (startsAt: number, now: number): number => Math.max(startsAt, now)
