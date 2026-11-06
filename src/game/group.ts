/**
 * Study-group overlap math (docs/session-depth-plan.md §C), shared by the
 * server (authoritative, at claim) and the client (live estimate).
 *
 * A member is "in the group" from `joinedAt` until they leave (pause, cancel,
 * leave) or their session ends (`endsAt`), whichever comes first. My
 * accompanied time is the part of my own in-group interval during which at
 * least one OTHER member was in the group too. `friendOverlap` = that time ÷
 * my session length (0–1). Once I am alone, it stops growing.
 */
import type { StudyGroupMember } from './protocol'

export interface Interval {
  from: number
  to: number
}

type MemberSpan = Pick<StudyGroupMember, 'userId' | 'joinedAt' | 'endsAt' | 'leftAt'>

/** In-group interval of a member, optionally cut at `until` (e.g. now for a live estimate). */
export function memberInterval(m: MemberSpan, until = Infinity): Interval {
  const to = Math.min(m.endsAt, m.leftAt ?? Infinity, until)
  return { from: m.joinedAt, to: Math.max(m.joinedAt, to) }
}

/** Length of `mine` covered by the union of `others`. */
export function coveredMs(mine: Interval, others: readonly Interval[]): number {
  const cut = others
    .map((o) => ({ from: Math.max(o.from, mine.from), to: Math.min(o.to, mine.to) }))
    .filter((o) => o.to > o.from)
    .sort((a, b) => a.from - b.from)
  let total = 0
  let curFrom = -Infinity
  let curTo = -Infinity
  for (const o of cut) {
    if (o.from > curTo) {
      if (curTo > curFrom) total += curTo - curFrom
      curFrom = o.from
      curTo = o.to
    } else curTo = Math.max(curTo, o.to)
  }
  if (curTo > curFrom) total += curTo - curFrom
  return total
}

export interface GroupOverlap {
  /** Accompanied time so far (or in total, without `until`). */
  accompaniedMs: number
  /** My session length (minutes of the group). */
  sessionMs: number
  /** accompaniedMs / sessionMs, 0–1. */
  overlap: number
}

/**
 * Overlap of `userId` with the rest of the group. `until` cuts every interval
 * (live view: accompanied so far). Without it, open intervals run to each
 * member's `endsAt` (= the final value if nobody leaves early).
 */
export function groupOverlap(members: readonly MemberSpan[], userId: string, until = Infinity): GroupOverlap | null {
  const me = members.find((m) => m.userId === userId)
  if (!me) return null
  const sessionMs = Math.max(1, me.endsAt - me.joinedAt)
  const mine = memberInterval(me, until)
  const others = members.filter((m) => m.userId !== userId).map((m) => memberInterval(m, until))
  const accompaniedMs = coveredMs(mine, others)
  return { accompaniedMs, sessionMs, overlap: Math.min(1, Math.max(0, accompaniedMs / sessionMs)) }
}

/** Fairy condition multiplier for an overlap: 1 + (fairy − 1) · overlap. */
export function fairyMultiplier(overlap: number | null | undefined, fairy: number): number {
  const o = Math.min(1, Math.max(0, overlap ?? 0))
  return 1 + (fairy - 1) * o
}
